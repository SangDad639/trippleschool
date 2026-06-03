/**
 * Chat-based AI Agent routes.
 *
 *   GET    /api/story-agent/chat/threads          — list threads (sidebar history)
 *   POST   /api/story-agent/chat/threads          — create a new empty thread
 *   GET    /api/story-agent/chat/threads/:id      — full thread incl. messages
 *   DELETE /api/story-agent/chat/threads/:id      — delete a thread
 *   PATCH  /api/story-agent/chat/threads/:id      — update active_skill_ids / title
 *   POST   /api/story-agent/chat/threads/:id/send — send user message + stream agent response (SSE)
 *
 * SSE event format:
 *   data: {"type":"text_delta","text":"..."}\n\n
 *   data: {"type":"tool_use_start","name":"generate_idea","input":{...}}\n\n
 *   ...
 *   data: {"type":"done"}\n\n
 */
import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { runChatTurn, type ChatMessage, type ChatStreamEvent } from '../services/chatAgent.js';
import type { LlmKeys } from '../services/storyAgentLLM.js';

const router = express.Router();

interface ThreadRow {
  id: number;
  user_id: number;
  title: string | null;
  active_skill_ids: number[];
  messages: ChatMessage[];
  linked_job_id: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  created_at: string;
  updated_at: string;
}

// GET /threads
router.get('/threads', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query<ThreadRow>(
      `SELECT id, user_id, title, active_skill_ids, linked_job_id,
              total_input_tokens, total_output_tokens, created_at, updated_at,
              jsonb_array_length(messages) AS msg_count
       FROM chat_threads
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [req.userId!]
    );
    res.json({ items: r.rows });
  } catch (err: any) {
    console.error('[chat:listThreads]', err);
    res.status(500).json({ error: err?.message || 'List failed' });
  }
});

// POST /threads
router.post('/threads', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { title, active_skill_ids } = req.body as {
      title?: string;
      active_skill_ids?: number[];
    };
    // Default active skills = user's is_default=true skills, if none specified.
    let activeIds = Array.isArray(active_skill_ids) ? active_skill_ids.filter(Number.isFinite) : [];
    if (activeIds.length === 0) {
      const r = await pool.query<{ id: number }>(
        `SELECT id FROM user_skills WHERE user_id = $1 AND is_default = TRUE ORDER BY updated_at DESC`,
        [req.userId!]
      );
      activeIds = r.rows.map((x) => x.id);
    }

    const insert = await pool.query<ThreadRow>(
      `INSERT INTO chat_threads (user_id, title, active_skill_ids, messages)
       VALUES ($1, $2, $3, '[]'::jsonb)
       RETURNING *`,
      [req.userId!, title?.trim() || null, activeIds]
    );
    res.json({ thread: insert.rows[0] });
  } catch (err: any) {
    console.error('[chat:createThread]', err);
    res.status(500).json({ error: err?.message || 'Create failed' });
  }
});

// GET /threads/:id
router.get('/threads/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const r = await pool.query<ThreadRow>(
      `SELECT * FROM chat_threads WHERE id = $1 AND user_id = $2`,
      [id, req.userId!]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ thread: r.rows[0] });
  } catch (err: any) {
    console.error('[chat:getThread]', err);
    res.status(500).json({ error: err?.message || 'Get failed' });
  }
});

// PATCH /threads/:id
router.patch('/threads/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const existing = await pool.query<ThreadRow>(
      `SELECT * FROM chat_threads WHERE id = $1 AND user_id = $2`,
      [id, req.userId!]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: 'not found' });
    const cur = existing.rows[0];

    const { title, active_skill_ids } = req.body as {
      title?: string;
      active_skill_ids?: number[];
    };

    const r = await pool.query<ThreadRow>(
      `UPDATE chat_threads
       SET title = $1, active_skill_ids = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [
        title?.trim() ?? cur.title,
        Array.isArray(active_skill_ids) ? active_skill_ids : cur.active_skill_ids,
        id,
        req.userId!,
      ]
    );
    res.json({ thread: r.rows[0] });
  } catch (err: any) {
    console.error('[chat:patchThread]', err);
    res.status(500).json({ error: err?.message || 'Patch failed' });
  }
});

// DELETE /threads/:id
router.delete('/threads/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const r = await pool.query(`DELETE FROM chat_threads WHERE id = $1 AND user_id = $2`, [
      id,
      req.userId!,
    ]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[chat:deleteThread]', err);
    res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

// POST /threads/:id/send — SSE streaming chat turn
router.post('/threads/:id/send', authenticate, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { text } = req.body as { text?: string };
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  // Load thread + user keys
  const threadRes = await pool.query<ThreadRow>(
    `SELECT * FROM chat_threads WHERE id = $1 AND user_id = $2`,
    [id, req.userId!]
  );
  if (threadRes.rowCount === 0) return res.status(404).json({ error: 'thread not found' });
  const thread = threadRes.rows[0];

  const keyRow = await pool.query<{
    anthropic_api_key: string | null;
    openrouter_api_key: string | null;
  }>(
    `SELECT anthropic_api_key, openrouter_api_key FROM users WHERE id = $1`,
    [req.userId!]
  );
  const llmKeys: LlmKeys = {
    anthropic: keyRow.rows[0]?.anthropic_api_key || process.env.ANTHROPIC_API_KEY || null,
    openrouter: keyRow.rows[0]?.openrouter_api_key || null,
  };

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  (res as any).flushHeaders?.();

  const sendEvent = (ev: ChatStreamEvent) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };

  try {
    // Auto-title the thread from the first user message
    if (!thread.title) {
      const autoTitle = text.trim().substring(0, 60);
      await pool.query(`UPDATE chat_threads SET title = $1 WHERE id = $2`, [autoTitle, id]);
    }

    const finalMessages = await runChatTurn({
      userId: req.userId!,
      activeSkillIds: thread.active_skill_ids || [],
      history: thread.messages || [],
      newUserMessage: text.trim(),
      llmKeys,
      onEvent: sendEvent,
    });

    // Persist updated messages + token usage
    const turnEnd = finalMessages; // already include the assistant's tool dance
    await pool.query(
      `UPDATE chat_threads
       SET messages = $1::jsonb,
           total_input_tokens = total_input_tokens + 0,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(turnEnd), id]
    );

    sendEvent({ type: 'turn_end' } as any);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('[chat:send]', err);
    sendEvent({ type: 'error', message: err?.message || 'Chat turn failed' });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  }
});

export default router;
