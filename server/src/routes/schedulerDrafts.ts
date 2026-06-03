import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';

const router = Router();

// GET /api/scheduler/drafts/:channelId - Get all drafts for a channel
router.get('/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);
    console.log(`📝 [GET drafts] User ${userId} requesting drafts for channel ${channelId}`);

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Verify user owns this channel
    const channelCheck = await pool.query(
      'SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );

    if (channelCheck.rows.length === 0) {
      console.log(`📝 [GET drafts] Channel ${channelId} not found for user ${userId}`);
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get all drafts for this channel
    const result = await pool.query(
      `SELECT id, scheduled_date, time_slot, prompt, is_ai_generated, created_at, updated_at
       FROM channel_prompt_drafts
       WHERE channel_id = $1 AND user_id = $2
       ORDER BY scheduled_date ASC, time_slot ASC`,
      [channelId, userId]
    );

    console.log(`📝 [GET drafts] Found ${result.rows.length} drafts for channel ${channelId}`);

    // Format dates for frontend - AVOID timezone conversion issues!
    // PostgreSQL DATE returns a JS Date at midnight local time
    // Using toISOString() converts to UTC which can shift the date by 1 day
    const drafts = result.rows.map(row => {
      const d = row.scheduled_date;
      // Get local date components to avoid UTC conversion issues
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const scheduled_date = `${year}-${month}-${day}`;
      return {
        ...row,
        scheduled_date
      };
    });

    // Log each draft for debugging
    drafts.forEach(d => {
      console.log(`   - ${d.scheduled_date} ${d.time_slot}: "${d.prompt.substring(0, 30)}..."`);
    });

    res.json({ drafts });
  } catch (error: any) {
    console.error('❌ Error fetching drafts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/scheduler/drafts - Save/Update a draft (upsert)
router.post('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { channel_id, scheduled_date, time_slot, prompt, is_ai_generated = false } = req.body;
    console.log(`💾 [SAVE draft] User ${userId}: channel=${channel_id}, date=${scheduled_date}, time=${time_slot}, prompt="${prompt?.substring(0, 30)}..."`);

    // Validate required fields
    if (!channel_id || !scheduled_date || !time_slot) {
      console.log(`❌ [SAVE draft] Missing required fields`);
      return res.status(400).json({ error: 'channel_id, scheduled_date, and time_slot are required' });
    }

    // Verify user owns this channel
    const channelCheck = await pool.query(
      'SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channel_id, userId]
    );

    if (channelCheck.rows.length === 0) {
      console.log(`❌ [SAVE draft] Channel ${channel_id} not found for user ${userId}`);
      return res.status(404).json({ error: 'Channel not found' });
    }

    // If prompt is empty, delete the draft instead
    if (!prompt || !prompt.trim()) {
      console.log(`🗑️ [SAVE draft] Empty prompt - deleting draft`);
      await pool.query(
        `DELETE FROM channel_prompt_drafts
         WHERE channel_id = $1 AND user_id = $2 AND scheduled_date = $3 AND time_slot = $4`,
        [channel_id, userId, scheduled_date, time_slot]
      );
      return res.json({ success: true, deleted: true });
    }

    // Upsert the draft
    const result = await pool.query(
      `INSERT INTO channel_prompt_drafts (user_id, channel_id, scheduled_date, time_slot, prompt, is_ai_generated, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (channel_id, scheduled_date, time_slot)
       DO UPDATE SET
         prompt = EXCLUDED.prompt,
         is_ai_generated = EXCLUDED.is_ai_generated,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, scheduled_date, time_slot, prompt, is_ai_generated`,
      [userId, channel_id, scheduled_date, time_slot, prompt.trim(), is_ai_generated]
    );

    console.log(`✅ [SAVE draft] Saved successfully: id=${result.rows[0].id}`);

    // Format date without timezone conversion
    const d = result.rows[0].scheduled_date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    res.json({
      success: true,
      draft: {
        ...result.rows[0],
        scheduled_date: `${year}-${month}-${day}`
      }
    });
  } catch (error: any) {
    console.error('❌ Error saving draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/scheduler/drafts/:channelId/:date/:time - Delete a specific draft
// Note: time uses dash instead of colon for URL safety (e.g., "10-00" instead of "10:00")
router.delete('/:channelId/:date/:time', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);
    const date = req.params.date; // "YYYY-MM-DD"
    const time = req.params.time.replace('-', ':'); // Convert "10-00" back to "10:00"

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Delete the draft
    const result = await pool.query(
      `DELETE FROM channel_prompt_drafts
       WHERE channel_id = $1 AND user_id = $2 AND scheduled_date = $3 AND time_slot = $4
       RETURNING id`,
      [channelId, userId, date, time]
    );

    res.json({
      success: true,
      deleted: result.rowCount && result.rowCount > 0
    });
  } catch (error: any) {
    console.error('Error deleting draft:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/scheduler/drafts/:channelId - Delete all drafts for a channel
router.delete('/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Delete all drafts for this channel
    const result = await pool.query(
      `DELETE FROM channel_prompt_drafts
       WHERE channel_id = $1 AND user_id = $2
       RETURNING id`,
      [channelId, userId]
    );

    res.json({
      success: true,
      deletedCount: result.rowCount
    });
  } catch (error: any) {
    console.error('Error deleting all drafts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
