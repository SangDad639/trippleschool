import express, { Response } from 'express';
import pool from '../db.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { runIdolTaskPipeline } from '../lib/idol-pipeline.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { uploadLocalFileToDropbox, deleteVideoFromDropbox } from '../utils/dropbox.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for idol images
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, webp) are allowed'));
    }
  }
});

const router = express.Router();

// ============================================
// Startup recovery: auto-retry orphaned active tasks (resume from where they left off)
// ============================================
// Run after a short delay to ensure DB is ready
setTimeout(async () => {
  try {
    // 1. Reset idol_template_tasks กลับเป็น pending (pipeline จะ resume จากจุดที่ค้าง — ไม่ gen ใหม่)
    //    จับเฉพาะ tasks ที่ค้างระหว่างทำ (ไม่รวม pending เพราะอาจเป็น task ใหม่ที่ยังไม่มีรูป)
    const result = await pool.query(
      `UPDATE idol_template_tasks
       SET status = 'pending',
           current_step = NULL,
           error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('prompt_generating', 'image_generating', 'video_generating', 'concatenating')
       RETURNING id, user_id`
    );

    if (result.rows.length > 0) {
      const taskIds = result.rows.map((r: any) => r.id);
      console.log(`[IdolRecovery] Auto-retry ${taskIds.length} orphaned tasks: [${taskIds.join(', ')}]`);

      // 2. Reset schedule_queue items กลับเป็น idol_pending
      //    external_task_id format: "idol-{jobId}-{taskId}"
      const taskInfoResult = await pool.query(
        `SELECT id, job_id FROM idol_template_tasks WHERE id = ANY($1::int[])`,
        [taskIds]
      );
      const externalIds = taskInfoResult.rows.map((r: any) => `idol-${r.job_id}-${r.id}`);
      if (externalIds.length > 0) {
        await pool.query(
          `UPDATE schedule_queue
           SET status = 'idol_pending', updated_at = CURRENT_TIMESTAMP
           WHERE external_task_id = ANY($1::text[])
             AND status NOT IN ('done', 'failed')`,
          [externalIds]
        );
      }

      // 3. Kick off pipeline directly (watchdog ปิดอยู่ ไม่มีใครเรียกให้)
      for (const row of result.rows) {
        runIdolTaskPipeline(row.id, row.user_id).catch(err => {
          console.error(`[IdolRecovery] Pipeline error for task ${row.id}:`, err.message);
        });
      }
    } else {
      console.log('[IdolRecovery] No orphaned tasks found');
    }
  } catch (err) {
    console.error('[IdolRecovery] Error:', err);
  }
}, 3000);

// ============================================
// GET /api/idol-templates — List all active templates (from DB)
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { sort, page, limit } = req.query;
    const orderBy = sort === 'popular' ? 'times_used DESC, created_at DESC'
      : sort === 'latest' ? 'created_at DESC'
      : 'display_order, created_at';

    const paginated = page !== undefined || limit !== undefined;
    const limitNum = Math.max(1, Math.min(parseInt(limit as string) || 20, 100));
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const offset = (pageNum - 1) * limitNum;

    const baseSelect = `SELECT slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder,
              template_variables, fixed_scenes, scene_descriptions, field_config, yearly_only, times_used, gender
       FROM idol_templates WHERE is_active = true ORDER BY ${orderBy}`;

    if (!paginated) {
      const result = await pool.query(baseSelect);
      return res.json(result.rows);
    }

    const [rowsRes, countRes] = await Promise.all([
      pool.query(`${baseSelect} LIMIT $1 OFFSET $2`, [limitNum, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM idol_templates WHERE is_active = true`),
    ]);
    const total = countRes.rows[0].total;
    res.json({
      data: rowsRes.rows,
      pagination: { hasMore: pageNum * limitNum < total, total, page: pageNum, limit: limitNum },
    });
  } catch (error: any) {
    console.error('[IdolTemplates] List templates error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// ============================================
// Admin CRUD — /api/idol-templates/admin/*
// ============================================

// GET /api/idol-templates/admin — List ALL templates (including inactive) for admin
router.get('/admin', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM idol_templates ORDER BY display_order, created_at`
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error('[IdolTemplates] Admin list error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// POST /api/idol-templates/admin — Create new template
router.post('/admin', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order, is_active, template_variables, fixed_scenes, scene_descriptions, field_config, yearly_only, image_prompt_template, video_prompt_template, gender } = req.body;

    if (!slug || !name || !(image_prompt_template || system_prompt)) {
      return res.status(400).json({ error: 'slug, name, and image_prompt_template are required' });
    }

    const result = await pool.query(
      `INSERT INTO idol_templates (slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order, is_active, template_variables, fixed_scenes, scene_descriptions, field_config, yearly_only, image_prompt_template, video_prompt_template, gender)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
      [slug, name, description || '', thumbnail_url || '', preview_video_url || '', input_mode || 'single',
       input_label || '', input_placeholder || '', system_prompt || '', display_order ?? 0, is_active ?? true,
       JSON.stringify(template_variables || []), fixed_scenes ?? null, JSON.stringify(scene_descriptions || []),
       JSON.stringify(field_config || { show_channel: true, show_language: true, show_scenes: true, show_videos: true }),
       yearly_only ?? false, image_prompt_template || '', video_prompt_template || '', gender || null]
    );

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Template slug already exists' });
    }
    console.error('[IdolTemplates] Create template error:', error);
    res.status(500).json({ error: error.message || 'Failed to create template' });
  }
});

// PUT /api/idol-templates/admin/:slug — Update template
router.put('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { slug: oldSlug } = req.params;
    const { slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order, is_active, template_variables, fixed_scenes, scene_descriptions, field_config, yearly_only, image_prompt_template, video_prompt_template, gender } = req.body;

    const result = await pool.query(
      `UPDATE idol_templates SET
        slug = COALESCE($1, slug),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        thumbnail_url = COALESCE($4, thumbnail_url),
        preview_video_url = COALESCE($5, preview_video_url),
        input_mode = COALESCE($6, input_mode),
        input_label = COALESCE($7, input_label),
        input_placeholder = COALESCE($8, input_placeholder),
        system_prompt = COALESCE($9, system_prompt),
        display_order = COALESCE($10, display_order),
        is_active = COALESCE($11, is_active),
        template_variables = COALESCE($12, template_variables),
        fixed_scenes = $13,
        scene_descriptions = COALESCE($14, scene_descriptions),
        field_config = COALESCE($15, field_config),
        yearly_only = COALESCE($16, yearly_only),
        image_prompt_template = COALESCE($18, image_prompt_template),
        video_prompt_template = COALESCE($19, video_prompt_template),
        gender = $20,
        updated_at = CURRENT_TIMESTAMP
       WHERE slug = $17 RETURNING *`,
      [slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder,
       system_prompt, display_order, is_active,
       template_variables ? JSON.stringify(template_variables) : null,
       fixed_scenes ?? null,
       scene_descriptions ? JSON.stringify(scene_descriptions) : null,
       field_config ? JSON.stringify(field_config) : null,
       yearly_only ?? null,
       oldSlug,
       image_prompt_template ?? null,
       video_prompt_template ?? null,
       gender ?? null]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });

    // If slug changed, update existing jobs referencing old slug
    if (slug && slug !== oldSlug) {
      await pool.query(
        'UPDATE idol_template_jobs SET template_slug = $1 WHERE template_slug = $2',
        [slug, oldSlug]
      );
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Template slug already exists' });
    }
    console.error('[IdolTemplates] Update template error:', error);
    res.status(500).json({ error: error.message || 'Failed to update template' });
  }
});

// DELETE /api/idol-templates/admin/:slug — Delete template
router.delete('/admin/:slug', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM idol_templates WHERE slug = $1 RETURNING id',
      [req.params.slug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[IdolTemplates] Delete template error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete template' });
  }
});

// ============================================
// POST /api/idol-templates/jobs — Create a job with tasks
// (MUST be before /:slug to avoid route conflict)
// ============================================

router.post('/jobs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { template_slug, channel_id, language, scenes_per_video, tasks, custom_system_prompt, custom_prompt_id, duration } = req.body;

    if (!template_slug || !tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'template_slug and tasks are required' });
    }

    // Validate template exists in DB (skip for custom prompts)
    if (template_slug !== 'custom') {
      const templateCheck = await pool.query('SELECT slug FROM idol_templates WHERE slug = $1 AND is_active = true', [template_slug]);
      if (templateCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid template slug' });
      }
    }

    // Create job
    const jobResult = await pool.query(
      `INSERT INTO idol_template_jobs (user_id, template_slug, channel_id, language, scenes_per_video, custom_system_prompt, custom_prompt_id, duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, template_slug, channel_id || null, language || 'th', scenes_per_video || 1, custom_system_prompt || null, custom_prompt_id || null, duration || 10]
    );
    const job = jobResult.rows[0];

    // Create tasks
    const createdTasks = [];
    for (let i = 0; i < tasks.length; i++) {
      const taskResult = await pool.query(
        `INSERT INTO idol_template_tasks (job_id, user_id, task_index, character_name, character_names, task_variables)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [job.id, userId, i, tasks[i].character_name ?? '', tasks[i].character_names ? JSON.stringify(tasks[i].character_names) : null,
         tasks[i].task_variables ? JSON.stringify(tasks[i].task_variables) : '{}']
      );
      createdTasks.push(taskResult.rows[0]);
    }

    // Increment times_used counter
    if (template_slug !== 'custom') {
      await pool.query(`UPDATE idol_templates SET times_used = COALESCE(times_used, 0) + 1 WHERE slug = $1`, [template_slug]);
    }

    res.json({ ...job, tasks: createdTasks });
  } catch (error: any) {
    console.error('[IdolTemplates] Create job error:', error);
    res.status(500).json({ error: error.message || 'Failed to create job' });
  }
});

// ============================================
// POST /api/idol-templates/upload-image — Upload image to Dropbox + save to gallery
// ============================================
router.post('/upload-image', authenticate, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.userId!;
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${uniqueSuffix}${ext}`;
    const dropboxPath = `/trippleviral/idol-gallery/${userId}/${filename}`;

    // Write buffer to temp file then upload to Dropbox
    const tmpPath = path.join(os.tmpdir(), `idol-upload-${filename}`);
    fs.writeFileSync(tmpPath, req.file.buffer);
    try {
      const { sharedUrl, dropboxPath: savedPath } = await uploadLocalFileToDropbox(tmpPath, dropboxPath);

      // Save to gallery DB
      const result = await pool.query(
        `INSERT INTO idol_image_gallery (user_id, filename, dropbox_path, shared_url, category)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, req.file.originalname, savedPath, sharedUrl, req.body.category || 'general']
      );

      res.json({ url: sharedUrl, filename: req.file.originalname, id: result.rows[0].id, dropbox_path: savedPath });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (error: any) {
    const errMsg = error.message || 'Upload failed';
    console.error('[IdolTemplates] Upload image error:', errMsg, error.stack?.substring(0, 300));
    res.status(500).json({ error: errMsg });
  }
});

// ============================================
// GET /api/idol-templates/gallery — List user's uploaded images
// ============================================
router.get('/gallery', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const category = req.query.category as string || undefined;
    const query = category
      ? `SELECT * FROM idol_image_gallery WHERE user_id = $1 AND category = $2 ORDER BY created_at DESC LIMIT 200`
      : `SELECT * FROM idol_image_gallery WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`;
    const params = category ? [userId, category] : [userId];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error: any) {
    console.error('[IdolTemplates] Gallery list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list gallery' });
  }
});

// ============================================
// DELETE /api/idol-templates/gallery/:id — Delete image from gallery + Dropbox
// ============================================
router.delete('/gallery/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM idol_image_gallery WHERE id = $1 AND user_id = $2 RETURNING dropbox_path`,
      [id, userId]
    );
    if (result.rows.length > 0 && result.rows[0].dropbox_path) {
      deleteVideoFromDropbox(result.rows[0].dropbox_path).catch(() => {});
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('[IdolTemplates] Gallery delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete image' });
  }
});

// ============================================
// GET /api/idol-templates/jobs — List user's jobs
// ============================================

router.get('/jobs', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobs = await pool.query(
      `SELECT j.*,
        (SELECT json_agg(t ORDER BY t.task_index) FROM idol_template_tasks t WHERE t.job_id = j.id) as tasks
       FROM idol_template_jobs j
       WHERE j.user_id = $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json(jobs.rows.map(j => ({ ...j, tasks: j.tasks || [] })));
  } catch (error: any) {
    console.error('[IdolTemplates] List jobs error:', error);
    res.status(500).json({ error: error.message || 'Failed to list jobs' });
  }
});

// ============================================
// GET /api/idol-templates/jobs/:jobId — Get job with tasks
// ============================================

router.get('/jobs/:jobId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    const jobResult = await pool.query(
      'SELECT * FROM idol_template_jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const tasksResult = await pool.query(
      'SELECT * FROM idol_template_tasks WHERE job_id = $1 ORDER BY task_index',
      [jobId]
    );

    res.json({ ...jobResult.rows[0], tasks: tasksResult.rows });
  } catch (error: any) {
    console.error('[IdolTemplates] Get job error:', error);
    res.status(500).json({ error: error.message || 'Failed to get job' });
  }
});

// ============================================
// GET /api/idol-templates/jobs/:jobId/status — Poll task statuses
// ============================================

router.get('/jobs/:jobId/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    // Verify job ownership
    const jobCheck = await pool.query(
      'SELECT id FROM idol_template_jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobCheck.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const tasksResult = await pool.query(
      'SELECT * FROM idol_template_tasks WHERE job_id = $1 ORDER BY task_index',
      [jobId]
    );

    res.json({ tasks: tasksResult.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get status' });
  }
});

// ============================================
// POST /api/idol-templates/jobs/:jobId/tasks/:taskId/generate — Generate single task
// ============================================

router.post('/jobs/:jobId/tasks/:taskId/generate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);
    const taskId = parseInt(req.params.taskId);

    // Verify ownership
    const taskResult = await pool.query(
      `SELECT t.* FROM idol_template_tasks t
       JOIN idol_template_jobs j ON t.job_id = j.id
       WHERE t.id = $1 AND j.id = $2 AND j.user_id = $3`,
      [taskId, jobId, userId]
    );
    if (taskResult.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

    const task = taskResult.rows[0];
    if (task.status !== 'pending' && task.status !== 'failed') {
      return res.status(400).json({ error: `Task is already ${task.status}` });
    }

    // Update character_name if provided
    if (req.body.character_name) {
      await pool.query(
        'UPDATE idol_template_tasks SET character_name = $1 WHERE id = $2',
        [req.body.character_name, taskId]
      );
    }
    // Update character_names if provided (multi-character templates)
    if (req.body.character_names && Array.isArray(req.body.character_names)) {
      await pool.query(
        'UPDATE idol_template_tasks SET character_names = $1 WHERE id = $2',
        [JSON.stringify(req.body.character_names), taskId]
      );
    }
    // Update task_variables if provided (flexible variable system)
    if (req.body.task_variables && typeof req.body.task_variables === 'object') {
      await pool.query(
        'UPDATE idol_template_tasks SET task_variables = $1 WHERE id = $2',
        [JSON.stringify(req.body.task_variables), taskId]
      );
    }

    // Reset only status/error/logs — keep existing data for smart retry
    await pool.query(
      `UPDATE idol_template_tasks SET status = 'pending', current_step = NULL, error = NULL,
       final_video_url = NULL, logs = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [taskId]
    );

    // Start pipeline async (don't await)
    runIdolTaskPipeline(taskId, userId).catch(err => {
      console.error(`[IdolTemplates] Pipeline error for task ${taskId}:`, err);
    });

    res.json({ success: true, message: 'Generation started' });
  } catch (error: any) {
    console.error('[IdolTemplates] Generate task error:', error);
    res.status(500).json({ error: error.message || 'Failed to start generation' });
  }
});

// ============================================
// POST /api/idol-templates/jobs/:jobId/generate-all — Generate all pending tasks
// ============================================

router.post('/jobs/:jobId/generate-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    // Verify ownership
    const jobCheck = await pool.query(
      'SELECT id FROM idol_template_jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobCheck.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    // Get all pending/failed tasks
    const tasksResult = await pool.query(
      `SELECT * FROM idol_template_tasks WHERE job_id = $1 AND status IN ('pending', 'failed') ORDER BY task_index`,
      [jobId]
    );

    if (tasksResult.rows.length === 0) {
      return res.status(400).json({ error: 'No pending tasks to generate' });
    }

    // Update character names if provided
    if (req.body.tasks && Array.isArray(req.body.tasks)) {
      for (const t of req.body.tasks) {
        if (t.id && t.character_name) {
          await pool.query(
            'UPDATE idol_template_tasks SET character_name = $1 WHERE id = $2 AND job_id = $3',
            [t.character_name, t.id, jobId]
          );
        }
        if (t.id && t.character_names && Array.isArray(t.character_names)) {
          await pool.query(
            'UPDATE idol_template_tasks SET character_names = $1 WHERE id = $2 AND job_id = $3',
            [JSON.stringify(t.character_names), t.id, jobId]
          );
        }
        if (t.id && t.task_variables && typeof t.task_variables === 'object') {
          await pool.query(
            'UPDATE idol_template_tasks SET task_variables = $1 WHERE id = $2 AND job_id = $3',
            [JSON.stringify(t.task_variables), t.id, jobId]
          );
        }
      }
    }

    // Reset and start all tasks
    for (const task of tasksResult.rows) {
      const hasExistingMedia = task.ai_prompts && Array.isArray(task.ai_prompts) && task.ai_prompts.length > 0;
      if (hasExistingMedia) {
        // Smart retry: มี ai_prompts/image_tasks อยู่แล้ว — เก็บไว้ให้ pipeline ข้าม step ที่เสร็จ
        await pool.query(
          `UPDATE idol_template_tasks SET status = 'pending', current_step = NULL, error = NULL,
           final_video_url = NULL, logs = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [task.id]
        );
      } else {
        // ไม่มีข้อมูลเก่า — สร้างใหม่ตั้งแต่ต้น
        await pool.query(
          `UPDATE idol_template_tasks SET status = 'pending', current_step = NULL, error = NULL,
           ai_prompts = NULL, image_tasks = '[]', video_tasks = '[]', final_video_url = NULL,
           updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [task.id]
        );
      }

      // Start each pipeline async
      runIdolTaskPipeline(task.id, userId).catch(err => {
        console.error(`[IdolTemplates] Pipeline error for task ${task.id}:`, err);
      });
    }

    // Update job status
    await pool.query(
      `UPDATE idol_template_jobs SET status = 'generating', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId]
    );

    res.json({ success: true, message: `Started ${tasksResult.rows.length} task(s)` });
  } catch (error: any) {
    console.error('[IdolTemplates] Generate all error:', error);
    res.status(500).json({ error: error.message || 'Failed to start generation' });
  }
});

// ============================================
// DELETE /api/idol-templates/jobs/:jobId/tasks/:taskId — Delete single task
// ============================================

router.delete('/jobs/:jobId/tasks/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);
    const taskId = parseInt(req.params.taskId);

    const result = await pool.query(
      `DELETE FROM idol_template_tasks t
       USING idol_template_jobs j
       WHERE t.id = $1 AND t.job_id = j.id AND j.id = $2 AND j.user_id = $3
       RETURNING t.id`,
      [taskId, jobId, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete task' });
  }
});

// ============================================
// DELETE /api/idol-templates/jobs/:jobId — Delete entire job
// ============================================

router.delete('/jobs/:jobId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);

    const result = await pool.query(
      'DELETE FROM idol_template_jobs WHERE id = $1 AND user_id = $2 RETURNING id',
      [jobId, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete job' });
  }
});

// ============================================
// PATCH /api/idol-templates/jobs/:jobId/tasks/:taskId — Update task (character_name)
// ============================================

router.patch('/jobs/:jobId/tasks/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jobId = parseInt(req.params.jobId);
    const taskId = parseInt(req.params.taskId);
    const { character_name, character_names } = req.body;

    if (!character_name && !character_names) return res.status(400).json({ error: 'character_name or character_names is required' });

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [];
    let idx = 1;
    if (character_name !== undefined) {
      updates.push(`character_name = $${idx++}`);
      values.push(character_name);
    }
    if (character_names !== undefined) {
      updates.push(`character_names = $${idx++}`);
      values.push(JSON.stringify(character_names));
    }
    values.push(taskId, jobId, userId);

    const result = await pool.query(
      `UPDATE idol_template_tasks SET ${updates.join(', ')}
       WHERE id = $${idx++} AND job_id = $${idx++} AND user_id = $${idx++} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update task' });
  }
});

// ============================================
// Custom Prompts CRUD
// ============================================

// GET /api/idol-templates/all-prompts — List admin templates + user custom prompts (for AI mode picker)
router.get('/all-prompts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { sort } = req.query;
    const orderBy = sort === 'popular' ? 'times_used DESC, created_at DESC'
      : sort === 'latest' ? 'created_at DESC'
      : 'display_order, created_at';
    // Admin templates (system_prompt + image/video prompt templates)
    const templates = await pool.query(
      `SELECT slug, name, description, thumbnail_url, preview_video_url, system_prompt as prompt_text,
              image_prompt_template, video_prompt_template,
              input_mode, input_label, input_placeholder, template_variables, field_config, fixed_scenes,
              gender, 'template' as source
       FROM idol_templates WHERE is_active = true ORDER BY ${orderBy}`
    );
    // User custom prompts — inherit template_variables, field_config, input_* from parent template
    // image/video prompt: prefer custom's own; fallback to parent template
    const custom = await pool.query(
      `SELECT vcp.id, vcp.name, vcp.description, vcp.thumbnail_url, vcp.youtube_url as preview_video_url, vcp.prompt_text,
              COALESCE(vcp.image_prompt_template, vt.image_prompt_template) as image_prompt_template,
              COALESCE(vcp.video_prompt_template, vt.video_prompt_template) as video_prompt_template,
              COALESCE(vcp.template_variables, vt.template_variables) as template_variables,
              COALESCE(vcp.field_config, vt.field_config) as field_config,
              COALESCE(vcp.fixed_scenes, vt.fixed_scenes) as fixed_scenes,
              vt.input_mode, vt.input_label, vt.input_placeholder,
              vcp.template_slug as slug,
              'custom' as source
       FROM idol_custom_prompts vcp
       LEFT JOIN idol_templates vt ON vt.slug = vcp.template_slug
       WHERE vcp.user_id = $1 ORDER BY vcp.updated_at DESC`,
      [req.userId!]
    );
    res.json([...templates.rows, ...custom.rows]);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get prompts' });
  }
});

// GET /api/idol-templates/custom-prompts-all — List ALL user's custom prompts
router.get('/custom-prompts-all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Alias image/video_prompt_template → image/video_prompt_text so frontend form populates correctly
    const result = await pool.query(
      `SELECT vcp.*, vcp.image_prompt_template AS image_prompt_text, vcp.video_prompt_template AS video_prompt_text, vt.name as template_name FROM idol_custom_prompts vcp
       LEFT JOIN idol_templates vt ON vt.slug = vcp.template_slug
       WHERE vcp.user_id = $1 ORDER BY vcp.updated_at DESC`,
      [req.userId!]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get custom prompts' });
  }
});

// GET /api/idol-templates/custom-prompts/:templateSlug — List user's custom prompts
router.get('/custom-prompts/:templateSlug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT *, image_prompt_template AS image_prompt_text, video_prompt_template AS video_prompt_text FROM idol_custom_prompts WHERE user_id = $1 AND template_slug = $2 ORDER BY updated_at DESC`,
      [req.userId!, req.params.templateSlug]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get custom prompts' });
  }
});

// POST /api/idol-templates/custom-prompts — Create custom prompt
router.post('/custom-prompts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { template_slug, name, prompt_text, description, youtube_url, thumbnail_url,
            template_variables, field_config, fixed_scenes, scene_descriptions,
            image_prompt_text, video_prompt_text } = req.body;
    if (!template_slug || !name) {
      return res.status(400).json({ error: 'template_slug and name are required' });
    }
    // DB columns are `image_prompt_template` / `video_prompt_template`; frontend form fields use `_text` suffix — same value, mapped here.
    // `prompt_text` column is NOT NULL (legacy) — mirror image_prompt_text when caller doesn't provide one.
    const finalPromptText = (typeof prompt_text === 'string' && prompt_text) ? prompt_text : (image_prompt_text || '');
    const result = await pool.query(
      `INSERT INTO idol_custom_prompts (user_id, template_slug, name, prompt_text, description, youtube_url, thumbnail_url,
       template_variables, field_config, fixed_scenes, scene_descriptions, image_prompt_template, video_prompt_template)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *, image_prompt_template AS image_prompt_text, video_prompt_template AS video_prompt_text`,
      [req.userId!, template_slug, name, finalPromptText, description || '', youtube_url || '', thumbnail_url || '',
       JSON.stringify(template_variables || []), field_config ? JSON.stringify(field_config) : null,
       fixed_scenes || null, JSON.stringify(scene_descriptions || []),
       image_prompt_text || '', video_prompt_text || '']
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create custom prompt' });
  }
});

// PUT /api/idol-templates/custom-prompts/:id — Update custom prompt
router.put('/custom-prompts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, prompt_text, description, youtube_url, thumbnail_url,
            template_variables, field_config, fixed_scenes, scene_descriptions,
            image_prompt_text, video_prompt_text } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    // prompt_text column is NOT NULL — mirror image_prompt_text when caller doesn't provide one.
    const finalPromptText = (typeof prompt_text === 'string' && prompt_text) ? prompt_text : (image_prompt_text || '');
    const result = await pool.query(
      `UPDATE idol_custom_prompts SET name = $1, prompt_text = $2, description = $3, youtube_url = $4, thumbnail_url = $5,
       template_variables = $6, field_config = $7, fixed_scenes = $8, scene_descriptions = $9,
       image_prompt_template = $10, video_prompt_template = $11, updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND user_id = $13 RETURNING *, image_prompt_template AS image_prompt_text, video_prompt_template AS video_prompt_text`,
      [name, finalPromptText, description || '', youtube_url || '', thumbnail_url || '',
       JSON.stringify(template_variables || []), field_config ? JSON.stringify(field_config) : null,
       fixed_scenes || null, JSON.stringify(scene_descriptions || []),
       image_prompt_text || '', video_prompt_text || '',
       req.params.id, req.userId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Custom prompt not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update custom prompt' });
  }
});

// DELETE /api/idol-templates/custom-prompts/:id — Delete custom prompt
router.delete('/custom-prompts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `DELETE FROM idol_custom_prompts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Custom prompt not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete custom prompt' });
  }
});

// POST /api/idol-templates/jobs/retry-task/:taskId — Retry an idol task (reset to pending)
router.post('/jobs/retry-task/:taskId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const userId = req.userId!;
    // Reset idol task to pending (smart retry will skip completed steps)
    await pool.query(
      `UPDATE idol_template_tasks SET status = 'pending', error = NULL, current_step = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    // Reset schedule_queue to idol_pending so idolRunnerJob picks up posting after pipeline done
    await pool.query(
      `UPDATE schedule_queue SET status = 'idol_pending', error = NULL, updated_at = CURRENT_TIMESTAMP WHERE external_task_id LIKE '%' || $1::text AND user_id = $2`,
      [taskId, userId]
    );
    // Kick off pipeline directly (watchdog ถูกปิดไว้ ต้องเรียกเอง)
    runIdolTaskPipeline(taskId, userId).catch(err => {
      console.error(`[IdolRetry] Pipeline error for task ${taskId}:`, err.message);
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retry task' });
  }
});

// ============================================
// Favorites (MUST be before /:slug to avoid slug catching "favorites")
// ============================================

// Ensure table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS user_idol_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_slug TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, template_slug)
  )
`).catch(() => {});

// GET /api/idol-templates/favorites — list user's favorite slugs
router.get('/favorites', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT template_slug FROM user_idol_favorites WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.userId!]
    );
    res.json(result.rows.map((r: any) => r.template_slug));
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get favorites' });
  }
});

// POST /api/idol-templates/:slug/favorite — toggle favorite
router.post('/:slug/favorite', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const existing = await pool.query(
      `SELECT id FROM user_idol_favorites WHERE user_id = $1 AND template_slug = $2`,
      [req.userId!, slug]
    );
    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM user_idol_favorites WHERE user_id = $1 AND template_slug = $2`, [req.userId!, slug]);
      res.json({ favorited: false });
    } else {
      await pool.query(`INSERT INTO user_idol_favorites (user_id, template_slug) VALUES ($1, $2)`, [req.userId!, slug]);
      res.json({ favorited: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to toggle favorite' });
  }
});

// ============================================
// GET /api/idol-templates/:slug — Get template detail
// (MUST be LAST to avoid catching /jobs as a slug)
// ============================================

router.get('/:slug', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder,
              template_variables, fixed_scenes, scene_descriptions, field_config, yearly_only, gender
       FROM idol_templates WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get template' });
  }
});

export default router;
