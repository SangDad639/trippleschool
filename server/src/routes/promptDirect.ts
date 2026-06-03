import { Router, Response } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';
import { runPromptDirectTask } from '../lib/prompt-direct-pipeline.js';

const router = Router();

// Platform → API mapping (prompt_library.platform → schedule_queue-compatible values)
const PLATFORM_MAP: Record<string, { platform: string; ai_model: string | null; duration: string }> = {
  'kie-grok-10s':        { platform: 'sora2-kie',   ai_model: 'kie_grok_imagine', duration: '10' },
  'kie-grok-10s-extend': { platform: 'sora2-kie',   ai_model: 'kie_grok_extend',  duration: '10' },
  'kie_grok_imagine':    { platform: 'sora2-kie',   ai_model: 'kie_grok_imagine', duration: '10' },
  'grok_imagine':        { platform: 'sora2-vidgo', ai_model: 'grok_imagine',     duration: '6' },
  'sora2':               { platform: 'sora2-kie',   ai_model: 'kie_sora2',        duration: '15' },
  'sora2-vidgo':         { platform: 'sora2-vidgo', ai_model: 'sora2_15s',        duration: '15' },
  'sora2-kie':           { platform: 'sora2-kie',   ai_model: 'kie_sora2',        duration: '15' },
  'sora2-grsai':         { platform: 'sora2-grsai', ai_model: null,               duration: '10' },
};

/**
 * POST /api/prompt-direct/jobs — Create job + resolve tasks (round-robin)
 */
router.post('/jobs', authenticate, requireSubscription, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { prompt_library_id, channel_id, number_of_videos, language } = req.body;

    if (!prompt_library_id) return res.status(400).json({ error: 'prompt_library_id is required' });

    const numVideos = Math.min(Math.max(number_of_videos || 1, 1), 50);

    // Load prompt
    const promptResult = await pool.query('SELECT * FROM prompt_library WHERE id = $1', [prompt_library_id]);
    if (promptResult.rows.length === 0) return res.status(404).json({ error: 'Prompt not found' });
    const prompt = promptResult.rows[0];

    // Create job
    const jobResult = await pool.query(`
      INSERT INTO prompt_direct_jobs (user_id, prompt_library_id, prompt_name, platform, channel_id, language)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [userId, prompt_library_id, prompt.name, prompt.platform, channel_id || null, language || 'th']);
    const job = jobResult.rows[0];

    // Round-robin resolve variables for each task
    const variables = prompt.variables || [];
    const extendVars = prompt.extend_variables || [];
    const varIndexes: Record<string, number> = {};
    for (const v of [...variables, ...extendVars]) varIndexes[v.name] = 0;

    const tasks: any[] = [];
    for (let i = 0; i < numVideos; i++) {
      const variablesUsed: Record<string, string> = {};
      let resolvedPrompt = prompt.prompt_template || '';
      let resolvedExtend = prompt.extend_prompt_template || '';

      for (const v of variables) {
        const vals = (v.values || []).filter((vv: any) => vv.value);
        let val = '';
        if (vals.length > 0) {
          val = vals[varIndexes[v.name] % vals.length].value;
          varIndexes[v.name]++;
        }
        variablesUsed[v.name] = val;
        const pattern = new RegExp(`\\{${v.name}\\}|\\[${v.name}\\]`, 'g');
        resolvedPrompt = resolvedPrompt.replace(pattern, val);
        if (resolvedExtend) resolvedExtend = resolvedExtend.replace(pattern, val);
      }

      for (const v of extendVars) {
        if (variablesUsed[v.name] !== undefined) continue;
        const vals = (v.values || []).filter((vv: any) => vv.value);
        let val = '';
        if (vals.length > 0) {
          val = vals[varIndexes[v.name] % vals.length].value;
          varIndexes[v.name]++;
        }
        variablesUsed[v.name] = val;
        const pattern = new RegExp(`\\{${v.name}\\}|\\[${v.name}\\]`, 'g');
        if (resolvedExtend) resolvedExtend = resolvedExtend.replace(pattern, val);
      }

      const taskResult = await pool.query(`
        INSERT INTO prompt_direct_tasks (job_id, user_id, task_index, prompt, extend_prompt, variables_used)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
      `, [job.id, userId, i, resolvedPrompt, resolvedExtend || null, JSON.stringify(variablesUsed)]);
      tasks.push(taskResult.rows[0]);
    }

    await pool.query('UPDATE prompt_library SET times_used = times_used + $1 WHERE id = $2', [numVideos, prompt_library_id]);

    res.json({ ...job, tasks });
  } catch (error: any) {
    console.error('[PromptDirect] Create job error:', error);
    res.status(500).json({ error: error.message || 'Failed to create job' });
  }
});

/**
 * GET /api/prompt-direct/jobs — List user's jobs
 */
router.get('/jobs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const promptLibraryId = req.query.prompt_library_id ? parseInt(req.query.prompt_library_id as string) : undefined;

    let query = `SELECT * FROM prompt_direct_jobs WHERE user_id = $1`;
    const params: any[] = [userId];
    if (promptLibraryId) {
      query += ` AND prompt_library_id = $${params.length + 1}`;
      params.push(promptLibraryId);
    }
    query += ` ORDER BY created_at DESC LIMIT 50`;

    const jobs = await pool.query(query, params);

    // Load tasks for each job
    const jobsWithTasks = await Promise.all(jobs.rows.map(async (job: any) => {
      const tasks = await pool.query(
        'SELECT * FROM prompt_direct_tasks WHERE job_id = $1 ORDER BY task_index ASC',
        [job.id]
      );
      return { ...job, tasks: tasks.rows };
    }));

    res.json(jobsWithTasks);
  } catch (error: any) {
    console.error('[PromptDirect] List jobs error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/prompt-direct/jobs/:jobId/status — Poll task statuses
 */
router.get('/jobs/:jobId/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    const tasks = await pool.query(
      'SELECT * FROM prompt_direct_tasks WHERE job_id = $1 AND user_id = $2 ORDER BY task_index ASC',
      [jobId, userId]
    );

    res.json({ tasks: tasks.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/prompt-direct/jobs/:jobId/tasks/:taskId/generate — Generate single task
 */
router.post('/jobs/:jobId/tasks/:taskId/generate', authenticate, requireSubscription, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);
    const taskId = parseInt(req.params.taskId);

    // Verify ownership
    const taskResult = await pool.query(
      `SELECT t.* FROM prompt_direct_tasks t
       JOIN prompt_direct_jobs j ON t.job_id = j.id
       WHERE t.id = $1 AND j.id = $2 AND j.user_id = $3`,
      [taskId, jobId, userId]
    );
    if (taskResult.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

    const task = taskResult.rows[0];
    if (task.status !== 'pending' && task.status !== 'failed') {
      return res.status(400).json({ error: `Task is already ${task.status}` });
    }

    // Reset task for (re)generation
    await pool.query(
      `UPDATE prompt_direct_tasks SET status = 'pending', error = NULL, video_url = NULL,
       external_task_id = NULL, logs = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [taskId]
    );

    // Fire pipeline async
    runPromptDirectTask(taskId, userId).catch((err: any) => {
      console.error(`[PromptDirect] Pipeline error for task ${taskId}:`, err);
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[PromptDirect] Generate task error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/prompt-direct/jobs/:jobId/generate-all — Generate all pending/failed tasks
 */
router.post('/jobs/:jobId/generate-all', authenticate, requireSubscription, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    // Verify ownership
    const jobCheck = await pool.query(
      'SELECT id FROM prompt_direct_jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobCheck.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    // Get pending/failed tasks
    const tasks = await pool.query(
      `SELECT id FROM prompt_direct_tasks WHERE job_id = $1 AND status IN ('pending', 'failed') ORDER BY task_index ASC`,
      [jobId]
    );

    // Reset all + fire pipeline
    for (const task of tasks.rows) {
      await pool.query(
        `UPDATE prompt_direct_tasks SET status = 'pending', error = NULL, video_url = NULL,
         external_task_id = NULL, logs = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [task.id]
      );

      runPromptDirectTask(task.id, userId).catch((err: any) => {
        console.error(`[PromptDirect] Pipeline error for task ${task.id}:`, err);
      });
    }

    res.json({ success: true, count: tasks.rows.length });
  } catch (error: any) {
    console.error('[PromptDirect] Generate all error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/prompt-direct/jobs/:jobId/tasks/:taskId/variables
 * Update task variables_used + re-resolve prompt
 */
router.patch('/jobs/:jobId/tasks/:taskId/variables', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);
    const taskId = parseInt(req.params.taskId);
    const { variables_used } = req.body;

    if (!variables_used || typeof variables_used !== 'object') {
      return res.status(400).json({ error: 'variables_used is required (object)' });
    }

    // Verify ownership
    const taskResult = await pool.query(
      `SELECT t.*, j.prompt_library_id FROM prompt_direct_tasks t
       JOIN prompt_direct_jobs j ON t.job_id = j.id
       WHERE t.id = $1 AND j.id = $2 AND j.user_id = $3`,
      [taskId, jobId, userId]
    );
    if (taskResult.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const task = taskResult.rows[0];

    // Don't allow editing while generating/done
    if (task.status === 'generating' || task.status === 'done') {
      return res.status(400).json({ error: `Cannot edit variables while task is ${task.status}` });
    }

    // Load prompt template + extend template
    const promptResult = await pool.query('SELECT * FROM prompt_library WHERE id = $1', [task.prompt_library_id]);
    if (promptResult.rows.length === 0) return res.status(404).json({ error: 'Prompt template not found' });
    const prompt = promptResult.rows[0];

    // Re-resolve {VAR} placeholders with new variables_used
    let resolvedPrompt = prompt.prompt_template || '';
    let resolvedExtend = prompt.extend_prompt_template || '';

    for (const [name, val] of Object.entries(variables_used)) {
      const pattern = new RegExp(`\\{${name}\\}|\\[${name}\\]`, 'g');
      resolvedPrompt = resolvedPrompt.replace(pattern, String(val || ''));
      if (resolvedExtend) resolvedExtend = resolvedExtend.replace(pattern, String(val || ''));
    }

    // Update task
    await pool.query(
      `UPDATE prompt_direct_tasks SET prompt = $1, extend_prompt = $2, variables_used = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [resolvedPrompt, resolvedExtend || null, JSON.stringify(variables_used), taskId]
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('[PromptDirect] Update variables error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/prompt-direct/jobs/:jobId — Delete job + all tasks
 */
router.delete('/jobs/:jobId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    await pool.query('DELETE FROM prompt_direct_jobs WHERE id = $1 AND user_id = $2', [jobId, userId]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[PromptDirect] Delete job error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
