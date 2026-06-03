import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';

const router = Router();

// GET /api/scheduler/time-presets - Get all time presets for current user
router.get('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(`
      SELECT * FROM time_presets
      WHERE user_id = $1
      ORDER BY name ASC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching time presets:', error);
    res.status(500).json({ error: 'Failed to fetch time presets' });
  }
});

// GET /api/scheduler/time-presets/:id - Get single time preset
router.get('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(`
      SELECT * FROM time_presets
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time preset not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching time preset:', error);
    res.status(500).json({ error: 'Failed to fetch time preset' });
  }
});

// POST /api/scheduler/time-presets - Create new time preset
router.post('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { name, times } = req.body;

    if (!name || !times || !Array.isArray(times)) {
      return res.status(400).json({ error: 'Name and times array are required' });
    }

    // Check for duplicate name
    const existingResult = await pool.query(`
      SELECT id FROM time_presets WHERE user_id = $1 AND name = $2
    `, [userId, name]);

    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'A preset with this name already exists' });
    }

    const result = await pool.query(`
      INSERT INTO time_presets (user_id, name, times)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [userId, name, JSON.stringify(times)]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating time preset:', error);
    res.status(500).json({ error: 'Failed to create time preset' });
  }
});

// PUT /api/scheduler/time-presets/:id - Update time preset
router.put('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { name, times } = req.body;

    // Check if name already exists (excluding current preset)
    if (name) {
      const existingResult = await pool.query(`
        SELECT id FROM time_presets WHERE user_id = $1 AND name = $2 AND id != $3
      `, [userId, name, id]);

      if (existingResult.rows.length > 0) {
        return res.status(400).json({ error: 'A preset with this name already exists' });
      }
    }

    const result = await pool.query(`
      UPDATE time_presets
      SET
        name = COALESCE($1, name),
        times = COALESCE($2, times),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `, [
      name,
      times ? JSON.stringify(times) : null,
      id,
      userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time preset not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating time preset:', error);
    res.status(500).json({ error: 'Failed to update time preset' });
  }
});

// DELETE /api/scheduler/time-presets/:id - Delete time preset
router.delete('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM time_presets
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time preset not found' });
    }

    res.json({ message: 'Time preset deleted successfully' });
  } catch (error) {
    console.error('Error deleting time preset:', error);
    res.status(500).json({ error: 'Failed to delete time preset' });
  }
});

export default router;
