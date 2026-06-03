import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';

const router = Router();

// Auto-migrate: add ai_model column
(async () => {
  try {
    await pool.query(`ALTER TABLE gen_task_drafts ADD COLUMN IF NOT EXISTS ai_model VARCHAR(30)`);
  } catch {}
})();

// GET /api/scheduler/gen-tasks/:channelId - Get gen task drafts for a channel
router.get('/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Verify user owns this channel
    const channelCheck = await pool.query(
      'SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get tasks for this channel
    const result = await pool.query(
      `SELECT id, template_id, custom_prompt, ai_model, created_at
       FROM gen_task_drafts
       WHERE channel_id = $1 AND user_id = $2
       ORDER BY id ASC`,
      [channelId, userId]
    );

    res.json({ tasks: result.rows });
  } catch (error: any) {
    console.error('Error fetching gen task drafts:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/scheduler/gen-tasks/:channelId - Save/Replace all gen task drafts for a channel
router.put('/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);
    const { tasks } = req.body; // Array of { templateId: string, customPrompt: string }

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: 'tasks must be an array' });
    }

    // Verify user owns this channel
    const channelCheck = await pool.query(
      'SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Delete existing tasks for this channel
    await pool.query(
      'DELETE FROM gen_task_drafts WHERE channel_id = $1 AND user_id = $2',
      [channelId, userId]
    );

    // Insert new tasks
    if (tasks.length > 0) {
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      tasks.forEach((task: { templateId: string; customPrompt: string; ai_model?: string }) => {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
        values.push(userId, channelId, task.templateId || '', task.customPrompt || '', task.ai_model || null);
        paramIndex += 5;
      });

      await pool.query(
        `INSERT INTO gen_task_drafts (user_id, channel_id, template_id, custom_prompt, ai_model)
         VALUES ${placeholders.join(', ')}`,
        values
      );
    }

    res.json({ success: true, count: tasks.length });
  } catch (error: any) {
    console.error('Error saving gen task drafts:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/scheduler/gen-tasks/:channelId - Delete all gen task drafts for a channel
router.delete('/:channelId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const channelId = parseInt(req.params.channelId);

    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const result = await pool.query(
      'DELETE FROM gen_task_drafts WHERE channel_id = $1 AND user_id = $2 RETURNING id',
      [channelId, userId]
    );

    res.json({ success: true, deletedCount: result.rowCount });
  } catch (error: any) {
    console.error('Error deleting gen task drafts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
