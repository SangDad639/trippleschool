/**
 * AI Agent pipeline route — orchestrates the 8-stage clip generator.
 *
 * Frontend interaction:
 *   POST   /api/story-agent/create        — start a new job
 *   GET    /api/story-agent/status/:id    — poll a job + its scenes
 *   GET    /api/story-agent/history       — list user's jobs
 *   DELETE /api/story-agent/:id           — delete a job
 *
 * The actual work happens in storyAgentRunnerJob.ts (background cron).
 * This route only persists the job record and returns its id; the runner
 * picks up `status='pending'` rows and advances them through stages.
 */
import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { deriveSceneCount } from '../services/storyAgentLLM.js';

const router = express.Router();

// Ensure tables exist at startup. The 017 migration handles the canonical
// schema, but this defensive create matches the pattern used by other routes
// (gptImage2, grokImagine) for fresh-database / migration-skipped deployments.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS story_agent_jobs (
        id              SERIAL PRIMARY KEY,
        user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id      INT,
        topic           TEXT NOT NULL,
        duration_sec    INT NOT NULL,
        tone            TEXT,
        language        TEXT NOT NULL DEFAULT 'th',
        scene_count     INT NOT NULL,
        current_stage   TEXT NOT NULL DEFAULT 'idea',
        status          TEXT NOT NULL DEFAULT 'pending',
        idea_json       JSONB,
        script_json     JSONB,
        storyboard_json JSONB,
        final_video_url TEXT,
        caption_fb      TEXT,
        caption_tt      TEXT,
        post_results    JSONB,
        error           TEXT,
        logs            JSONB DEFAULT '[]'::jsonb,
        retry_count     INT DEFAULT 0,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_story_agent_jobs_user ON story_agent_jobs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_story_agent_jobs_status ON story_agent_jobs(status, current_stage) WHERE status IN ('pending', 'running');

      CREATE TABLE IF NOT EXISTS story_agent_scenes (
        id                SERIAL PRIMARY KEY,
        job_id            INT NOT NULL REFERENCES story_agent_jobs(id) ON DELETE CASCADE,
        scene_number      INT NOT NULL,
        script_text       TEXT NOT NULL,
        image_prompt      TEXT,
        panel_desc_th     TEXT,
        voice_url         TEXT,
        voice_duration    REAL,
        image_kie_task_id TEXT,
        image_url         TEXT,
        image_status      TEXT DEFAULT 'pending',
        video_kie_task_id TEXT,
        video_url         TEXT,
        video_status      TEXT DEFAULT 'pending',
        error             TEXT,
        created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(job_id, scene_number)
      );
      CREATE INDEX IF NOT EXISTS idx_story_agent_scenes_job ON story_agent_scenes(job_id, scene_number);

      ALTER TABLE users ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_voice_id_th TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_voice_id_en TEXT;
    `);
    console.log('✅ story_agent_jobs + story_agent_scenes tables ready');
  } catch (err) {
    console.error('Failed to create story_agent tables:', err);
  }
})();

// Append a log entry to a job's logs JSONB array.
export async function appendJobLog(jobId: number, emoji: string, text: string): Promise<void> {
  try {
    const entry = [{ time: new Date().toISOString(), emoji, text }];
    await pool.query(
      `UPDATE story_agent_jobs
       SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(entry), jobId]
    );
  } catch (err: any) {
    console.error('[storyAgent:appendJobLog] failed:', err?.message);
  }
}

// POST /api/story-agent/create
router.post('/create', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { topic, duration_sec, tone, language, channel_id } = req.body as {
      topic?: string;
      duration_sec?: number;
      tone?: string;
      language?: string;
      channel_id?: number;
    };

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ error: 'topic is required' });
    }
    const dur = Number(duration_sec);
    if (!dur || dur < 30 || dur > 180) {
      return res.status(400).json({ error: 'duration_sec must be 30-180' });
    }
    const lang = language === 'en' ? 'en' : 'th';
    const sceneCount = deriveSceneCount(dur);

    const insert = await pool.query(
      `INSERT INTO story_agent_jobs
         (user_id, channel_id, topic, duration_sec, tone, language, scene_count, current_stage, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'idea', 'pending')
       RETURNING id, user_id, channel_id, topic, duration_sec, tone, language, scene_count,
                 current_stage, status, created_at`,
      [
        userId,
        channel_id ?? null,
        topic.trim(),
        dur,
        tone || null,
        lang,
        sceneCount,
      ]
    );
    const job = insert.rows[0];
    await appendJobLog(job.id, '🚀', `เริ่มงาน — หัวข้อ "${topic.substring(0, 60)}", ${dur}s, ${sceneCount} ฉาก`);
    return res.json({ success: true, job });
  } catch (err: any) {
    console.error('[storyAgent:create] Error:', err);
    return res.status(500).json({ error: err?.message || 'Create failed' });
  }
});

// GET /api/story-agent/status/:id  — returns job + its scenes
router.get('/status/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const jobRes = await pool.query(
      `SELECT * FROM story_agent_jobs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (jobRes.rowCount === 0) return res.status(404).json({ error: 'job not found' });

    const scenesRes = await pool.query(
      `SELECT id, scene_number, script_text, image_prompt, panel_desc_th,
              voice_url, voice_duration,
              image_kie_task_id, image_url, image_status,
              video_kie_task_id, video_url, video_status, error
       FROM story_agent_scenes
       WHERE job_id = $1
       ORDER BY scene_number ASC`,
      [id]
    );

    return res.json({ job: jobRes.rows[0], scenes: scenesRes.rows });
  } catch (err: any) {
    console.error('[storyAgent:status] Error:', err);
    return res.status(500).json({ error: err?.message || 'Status failed' });
  }
});

// GET /api/story-agent/history
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const offset = parseInt(String(req.query.offset || '0')) || 0;

    const rows = await pool.query(
      `SELECT id, topic, duration_sec, tone, language, scene_count,
              current_stage, status, final_video_url, error,
              created_at, updated_at
       FROM story_agent_jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS c FROM story_agent_jobs WHERE user_id = $1`,
      [userId]
    );
    return res.json({ items: rows.rows, total: total.rows[0].c });
  } catch (err: any) {
    console.error('[storyAgent:history] Error:', err);
    return res.status(500).json({ error: err?.message || 'History failed' });
  }
});

// DELETE /api/story-agent/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const r = await pool.query(
      `DELETE FROM story_agent_jobs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'job not found' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[storyAgent:delete] Error:', err);
    return res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

export default router;
