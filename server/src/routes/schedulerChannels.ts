import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/requireSubscription.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadLocalFileToDropbox, deleteVideoFromDropbox, isDropboxConfigured } from '../utils/dropbox.js';

// Configure S3 client (HWC OBS — virtual-host style)
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: false,
});

const S3_BUCKET = process.env.S3_BUCKET || '';

// Configure multer with memory storage (upload to S3, not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const router = Router();

// Helper: merge variable value statuses from DB to prevent frontend auto-save from overwriting
// queue-runner's 'used'/'new' tracking
function mergeVariableStatuses(incoming: any[], existing: any[]): any[] {
  const existingStatusMap = new Map<string, string>();
  for (const v of (existing || [])) {
    for (const val of (v.values || [])) {
      if (val.id) existingStatusMap.set(val.id, val.status || 'new');
    }
  }
  return incoming.map(v => ({
    ...v,
    values: (v.values || []).map((val: any) => ({
      ...val,
      status: val.id && existingStatusMap.has(val.id)
        ? existingStatusMap.get(val.id)
        : (val.status || 'new'),
    })),
  }));
}

// Auto-migrate scheduler_channels columns on startup
let migrationRan = false;
const ensureSchedulerColumns = async () => {
  if (migrationRan) return;
  migrationRan = true;
  try {
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS ai_model VARCHAR(20) DEFAULT 'sora2_15s',
      ADD COLUMN IF NOT EXISTS channel_concept TEXT,
      ADD COLUMN IF NOT EXISTS prompt_mode VARCHAR(20) DEFAULT 'ai',
      ADD COLUMN IF NOT EXISTS prompt_temperature NUMERIC(2,1) DEFAULT 0.5,
      ADD COLUMN IF NOT EXISTS auto_retry_hours INTEGER,
      ADD COLUMN IF NOT EXISTS extend_prompt TEXT,
      ADD COLUMN IF NOT EXISTS extend_variables JSONB,
      ADD COLUMN IF NOT EXISTS extend_prompt_templates JSONB,
      ADD COLUMN IF NOT EXISTS extend_template_selection_mode VARCHAR(20) DEFAULT 'round-robin',
      ADD COLUMN IF NOT EXISTS extend_template_round_robin_index INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS watermark_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS watermark_type VARCHAR(10) DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS watermark_text VARCHAR(255) DEFAULT '',
      ADD COLUMN IF NOT EXISTS watermark_image_url TEXT,
      ADD COLUMN IF NOT EXISTS watermark_image_path TEXT,
      ADD COLUMN IF NOT EXISTS watermark_position VARCHAR(20) DEFAULT 'bottom-right',
      ADD COLUMN IF NOT EXISTS watermark_opacity INTEGER DEFAULT 50,
      ADD COLUMN IF NOT EXISTS watermark_image_size VARCHAR(10) DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS watermark_circular BOOLEAN DEFAULT false;
    `);
    console.log('✅ Scheduler columns ensured');
  } catch (e) {
    console.error('Migration error (non-fatal):', e);
  }
};
// Run on module load
ensureSchedulerColumns();

// Helper function to get AI config (key + provider) from user
async function getAIConfig(userId: number): Promise<{ apiKey: string; provider: string; baseUrl: string }> {
  const result = await pool.query(
    'SELECT openai_api_key, openrouter_api_key, ai_provider FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Please configure your AI API key in Settings');
  }

  const user = result.rows[0];
  const provider = user.ai_provider || 'openai';

  if (provider === 'openrouter') {
    if (!user.openrouter_api_key) {
      throw new Error('Please configure your OpenRouter API key in Settings');
    }
    return { apiKey: user.openrouter_api_key, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
  }

  if (!user.openai_api_key) {
    throw new Error('Please configure your OpenAI API key in Settings');
  }
  return { apiKey: user.openai_api_key, provider: 'openai', baseUrl: 'https://api.openai.com/v1' };
}

// Backwards-compatible wrapper
async function getOpenAIKey(userId: number): Promise<string> {
  const config = await getAIConfig(userId);
  return config.apiKey;
}

// ==================== Saved Late Profiles (must be before /:id route) ====================

const ensureLateProfilesTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_late_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_id VARCHAR(255) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, profile_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_saved_late_profiles_user_id ON saved_late_profiles(user_id);
  `);
};

router.get('/late-profiles', authenticate, async (req: AuthRequest, res) => {
  try {
    await ensureLateProfilesTable();
    const userId = req.userId;
    const result = await pool.query(`
      SELECT * FROM saved_late_profiles
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (error: any) {
    console.error('Get late profiles error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

router.post('/late-profiles', authenticate, async (req: AuthRequest, res) => {
  try {
    await ensureLateProfilesTable();
    const userId = req.userId;
    const { profile_id, display_name, avatar_url } = req.body;
    if (!profile_id || !display_name) {
      return res.status(400).json({ error: 'profile_id and display_name are required' });
    }
    const result = await pool.query(`
      INSERT INTO saved_late_profiles (user_id, profile_id, display_name, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, profile_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url
      RETURNING *
    `, [userId, profile_id, display_name, avatar_url || null]);
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Create late profile error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

router.delete('/late-profiles/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const profileId = parseInt(req.params.id);
    const result = await pool.query(`
      DELETE FROM saved_late_profiles
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [profileId, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (error: any) {
    console.error('Delete late profile error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// GET /api/scheduler/channels - Get all channels for current user
router.get('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(`
      SELECT * FROM scheduler_channels
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    // Get example prompts for all channels
    const channelIds = result.rows.map(c => c.id);
    const examplesResult = channelIds.length > 0 ? await pool.query(`
      SELECT * FROM channel_example_prompts
      WHERE channel_id = ANY($1)
      ORDER BY channel_id, display_order ASC
    `, [channelIds]) : { rows: [] };

    // Group examples by channel_id
    const examplesByChannel: Record<number, any[]> = {};
    for (const example of examplesResult.rows) {
      if (!examplesByChannel[example.channel_id]) {
        examplesByChannel[example.channel_id] = [];
      }
      examplesByChannel[example.channel_id].push(example);
    }

    // Get saved late profiles for this user
    const profilesResult = await pool.query(
      `SELECT profile_id, display_name, avatar_url FROM saved_late_profiles WHERE user_id = $1`,
      [userId]
    );
    const profilesMap: Record<string, { display_name: string; avatar_url: string | null }> = {};
    for (const p of profilesResult.rows) {
      profilesMap[p.profile_id] = { display_name: p.display_name, avatar_url: p.avatar_url };
    }

    // Add example_prompts and profile info to each channel
    const channelsWithExamples = result.rows.map(channel => {
      const profile = (channel.fb_admin_profile_id || channel.late_profile_id) ? profilesMap[channel.fb_admin_profile_id || channel.late_profile_id] : null;
      return {
        ...channel,
        example_prompts: examplesByChannel[channel.id] || [],
        fb_admin_name: profile?.display_name || null,
        fb_admin_avatar: profile?.avatar_url || null,
      };
    });

    res.json(channelsWithExamples);
  } catch (error) {
    console.error('Error fetching scheduler channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// GET /api/scheduler/channels/:id - Get single channel with example prompts
router.get('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(`
      SELECT * FROM scheduler_channels
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get example prompts for this channel
    const examplesResult = await pool.query(`
      SELECT * FROM channel_example_prompts
      WHERE channel_id = $1
      ORDER BY display_order ASC, created_at ASC
    `, [id]);

    console.log('[Channel GET] id:', id, 'fb_admin_profile_id:', result.rows[0]?.fb_admin_profile_id);
    console.log('[Channel GET] prompt_templates from DB:', JSON.stringify(result.rows[0]?.prompt_templates?.map((t: any) => ({ id: t.id, vars: t.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })) }))));

    res.json({
      ...result.rows[0],
      example_prompts: examplesResult.rows
    });
  } catch (error) {
    console.error('Error fetching scheduler channel:', error);
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

// POST /api/scheduler/channels - Create new channel
router.post('/', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const {
      name,
      platform,
      duration,
      aspect_ratio,
      prompt_mode,
      prompt_template,
      variables,
      caption_language,
      custom_hashtags,
      timezone,
      posts_per_day,
      // Posting service
      posting_service,
      // Blotato integration
      blotato_account_id,
      blotato_api_key,
      page_ids,
      // Late integration
      late_api_key,
      late_profile_id,
      late_accounts,
      // Post for Me integration
      postforme_api_key,
      postforme_accounts,
      // AI Prompt Template fields
      channel_highlight,
      channel_concept,
      example_prompts,
      // Auto-retry
      auto_retry_hours,
      // AI Temperature
      prompt_temperature,
      // Facebook Admin Profile (separate from late_profile_id)
      fb_admin_profile_id,
      // Multi-template support
      prompt_templates,
      template_selection_mode,
      // AI mode prompt templates (separate from variable-mode prompt_templates)
      ai_prompt_templates,
      selected_viral_prompts,
      viral_scenes_per_video,
      selected_idol_prompts,
      idol_scenes_per_video,
      // Extend prompt for kie_grok_extend model
      extend_prompt,
      extend_variables,
      extend_prompt_templates,
      extend_template_selection_mode
    } = req.body;

    if (!name || !platform) {
      return res.status(400).json({ error: 'Name and platform are required' });
    }

    // Check channel limit (max 50 per user)
    const channelCount = await pool.query(
      'SELECT COUNT(*) FROM scheduler_channels WHERE user_id = $1',
      [userId]
    );
    if (parseInt(channelCount.rows[0].count) >= 50) {
      return res.status(403).json({ error: 'Channel limit reached (max 50)' });
    }

    const result = await pool.query(`
      INSERT INTO scheduler_channels (
        user_id, name, platform, duration, aspect_ratio,
        prompt_mode, prompt_template, variables, caption_language,
        custom_hashtags, timezone, posts_per_day,
        posting_service, blotato_account_id, blotato_api_key, page_ids,
        late_api_key, late_profile_id, late_accounts,
        postforme_api_key, postforme_accounts,
        channel_highlight, channel_concept, auto_retry_hours, prompt_temperature,
        fb_admin_profile_id,
        prompt_templates, template_selection_mode,
        extend_prompt_templates, extend_template_selection_mode,
        ai_prompt_templates, selected_viral_prompts, viral_scenes_per_video,
        selected_idol_prompts, idol_scenes_per_video
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
      RETURNING *
    `, [
      userId,
      name,
      platform || 'sora2-grsai',
      duration || '10',
      aspect_ratio || 'portrait',
      prompt_mode || 'ai',
      prompt_template || '',
      JSON.stringify(variables || []),
      caption_language || 'en',
      custom_hashtags || '',
      timezone || 'local',
      posts_per_day || 3,
      posting_service || 'none',
      blotato_account_id || null,
      blotato_api_key || null,
      page_ids ? JSON.stringify(page_ids) : JSON.stringify({ facebook: '', instagram: '', tiktok: '', twitter: '', youtube: '' }),
      late_api_key || null,
      late_profile_id || null,
      late_accounts ? JSON.stringify(late_accounts) : JSON.stringify([]),
      postforme_api_key || null,
      postforme_accounts ? JSON.stringify(postforme_accounts) : JSON.stringify([]),
      channel_highlight || '',
      channel_concept || '',
      auto_retry_hours != null ? parseInt(auto_retry_hours) : null,
      prompt_temperature != null ? parseFloat(prompt_temperature) : 0.5,
      fb_admin_profile_id || null,
      JSON.stringify(prompt_templates || []),
      template_selection_mode || 'round-robin',
      JSON.stringify(extend_prompt_templates || []),
      extend_template_selection_mode || 'round-robin',
      JSON.stringify(ai_prompt_templates || []),
      JSON.stringify(selected_viral_prompts || []),
      viral_scenes_per_video ?? 3,
      JSON.stringify(selected_idol_prompts || []),
      idol_scenes_per_video ?? 3
    ]);

    const channelId = result.rows[0].id;

    // Insert example prompts if provided
    if (example_prompts && Array.isArray(example_prompts) && example_prompts.length > 0) {
      for (let i = 0; i < example_prompts.length; i++) {
        const promptText = example_prompts[i];
        if (promptText && promptText.trim()) {
          await pool.query(`
            INSERT INTO channel_example_prompts (channel_id, prompt_text, display_order)
            VALUES ($1, $2, $3)
          `, [channelId, promptText.trim(), i]);
        }
      }
    }

    // Get the channel with example prompts
    const examplesResult = await pool.query(`
      SELECT * FROM channel_example_prompts WHERE channel_id = $1 ORDER BY display_order ASC
    `, [channelId]);

    res.status(201).json({
      ...result.rows[0],
      example_prompts: examplesResult.rows
    });
  } catch (error) {
    console.error('Error creating scheduler channel:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// PUT /api/scheduler/channels/:id - Update channel
router.put('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    console.log('[Channel Update] ID:', id, 'Body:', JSON.stringify(req.body, null, 2));

    const {
      name,
      platform,
      duration,
      aspect_ratio,
      prompt_mode,
      prompt_template,
      variables,
      caption_language,
      custom_hashtags,
      timezone,
      posts_per_day,
      time_slots,
      // Posting service
      posting_service,
      // Blotato integration
      blotato_account_id,
      blotato_api_key,
      page_ids,
      // Late integration
      late_api_key,
      late_profile_id,
      late_accounts,
      // Post for Me integration
      postforme_api_key,
      postforme_accounts,
      // AI Prompt Template fields
      channel_highlight,
      channel_concept,
      system_prompt,
      // Auto-retry
      auto_retry_hours,
      // AI Temperature
      prompt_temperature,
      // AI Model
      ai_model,
      // Facebook Admin Profile (separate from late_profile_id)
      fb_admin_profile_id,
      // Multi-template support
      prompt_templates,
      template_selection_mode,
      // AI mode prompt templates (separate from variable-mode prompt_templates)
      ai_prompt_templates,
      selected_viral_prompts,
      viral_scenes_per_video,
      selected_idol_prompts,
      idol_scenes_per_video,
      // Extend prompt for kie_grok_extend model
      extend_prompt,
      extend_variables,
      extend_prompt_templates,
      extend_template_selection_mode,
      // Watermark settings
      watermark_enabled,
      watermark_type,
      watermark_text,
      watermark_image_url,
      watermark_image_path,
      watermark_position,
      watermark_opacity,
      watermark_image_size,
      watermark_circular
    } = req.body;

    console.log('[Channel Update] fb_admin_profile_id from body:', JSON.stringify(fb_admin_profile_id), '-> saving as:', JSON.stringify(fb_admin_profile_id || null));

    // Auto-derive platform from ai_model
    const derivedPlatform = (ai_model === 'kie_sora2' || ai_model === 'kie_grok_imagine' || ai_model === 'kie_grok_extend' || ai_model === 'kie_viral_template') ? 'sora2-kie'
      : (ai_model === 'sora2_15s' || ai_model === 'veo3_1' || ai_model === 'grok_imagine') ? 'sora2-vidgo'
      : platform;

// Use transaction + FOR UPDATE to prevent race condition with queue-runner's variable status tracking
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');

      // Lock row first, then merge variable statuses
      let mergedVariables = variables;
      let mergedPromptTemplates = prompt_templates;
      let mergedExtendPromptTemplates = extend_prompt_templates;
      let mergedAiPromptTemplates = ai_prompt_templates;
      if (variables || prompt_templates || extend_prompt_templates || ai_prompt_templates) {
        const currentChannel = await client.query(
          `SELECT variables, prompt_templates, extend_prompt_templates, ai_prompt_templates FROM scheduler_channels WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [id, userId]
        );
        if (currentChannel.rows.length > 0) {
          const dbRow = currentChannel.rows[0];
          console.log('[Channel Update] prompt_templates received:', JSON.stringify(prompt_templates?.map((t: any) => ({ id: t.id, vars: t.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })) }))));
          console.log('[Channel Update] DB prompt_templates:', JSON.stringify(dbRow.prompt_templates?.map((t: any) => ({ id: t.id, vars: t.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })) }))));
          if (variables && dbRow.variables) {
            mergedVariables = mergeVariableStatuses(variables, dbRow.variables);
          }
          if (prompt_templates && dbRow.prompt_templates) {
            mergedPromptTemplates = prompt_templates.map((tmpl: any) => {
              const dbTmpl = dbRow.prompt_templates.find((dt: any) => dt.id === tmpl.id);
              if (dbTmpl) {
                const merged: any = { ...tmpl };
                if (tmpl.variables) {
                  merged.variables = mergeVariableStatuses(tmpl.variables, dbTmpl.variables || []);
                }
                if (tmpl.extend_variables) {
                  merged.extend_variables = mergeVariableStatuses(tmpl.extend_variables, dbTmpl.extend_variables || []);
                }
                return merged;
              }
              return tmpl;
            });
          }
          if (extend_prompt_templates && dbRow.extend_prompt_templates) {
            mergedExtendPromptTemplates = extend_prompt_templates.map((tmpl: any) => {
              const dbTmpl = dbRow.extend_prompt_templates.find((dt: any) => dt.id === tmpl.id);
              if (dbTmpl && tmpl.variables) {
                return { ...tmpl, variables: mergeVariableStatuses(tmpl.variables, dbTmpl.variables || []) };
              }
              return tmpl;
            });
          }
          // Preserve variable status (used/new) ใน ai_prompt_templates (สำหรับ viral template)
          if (ai_prompt_templates && dbRow.ai_prompt_templates) {
            mergedAiPromptTemplates = ai_prompt_templates.map((tmpl: any) => {
              const dbTmpl = dbRow.ai_prompt_templates.find((dt: any) => dt.id === tmpl.id);
              if (dbTmpl && tmpl.variables) {
                return { ...tmpl, variables: mergeVariableStatuses(tmpl.variables, dbTmpl.variables || []) };
              }
              return tmpl;
            });
          }
        }
      }

      console.log('[Channel Update] mergedPromptTemplates to save:', JSON.stringify(mergedPromptTemplates?.map((t: any) => ({ id: t.id, vars: t.variables?.map((v: any) => ({ name: v.name, valuesCount: v.values?.length })) }))));

      result = await client.query(`
        UPDATE scheduler_channels
        SET
          name = COALESCE($1, name),
          platform = COALESCE($2, platform),
          duration = COALESCE($3, duration),
          aspect_ratio = COALESCE($4, aspect_ratio),
          prompt_mode = COALESCE($5, prompt_mode),
          prompt_template = COALESCE($6, prompt_template),
          variables = COALESCE($7, variables),
          caption_language = COALESCE($8, caption_language),
          custom_hashtags = COALESCE($9, custom_hashtags),
          timezone = COALESCE($10, timezone),
          posts_per_day = COALESCE($11, posts_per_day),
          time_slots = COALESCE($12, time_slots),
          posting_service = COALESCE($13, posting_service),
          blotato_account_id = COALESCE($14, blotato_account_id),
          blotato_api_key = COALESCE($15, blotato_api_key),
          page_ids = COALESCE($16, page_ids),
          late_api_key = COALESCE($17, late_api_key),
          late_profile_id = COALESCE($18, late_profile_id),
          late_accounts = COALESCE($19, late_accounts),
          postforme_api_key = COALESCE($20, postforme_api_key),
          postforme_accounts = COALESCE($21, postforme_accounts),
          channel_highlight = COALESCE($22, channel_highlight),
          channel_concept = COALESCE($23, channel_concept),
          auto_retry_hours = $24,
          prompt_temperature = COALESCE($25, prompt_temperature),
          system_prompt = COALESCE($26, system_prompt),
          ai_model = COALESCE($27, ai_model),
          fb_admin_profile_id = $28,
          prompt_templates = COALESCE($29, prompt_templates),
          template_selection_mode = COALESCE($30, template_selection_mode),
          extend_prompt = COALESCE($31, extend_prompt),
          extend_variables = COALESCE($32, extend_variables),
          extend_prompt_templates = COALESCE($33, extend_prompt_templates),
          extend_template_selection_mode = COALESCE($34, extend_template_selection_mode),
          ai_prompt_templates = COALESCE($37, ai_prompt_templates),
          selected_viral_prompts = COALESCE($38, selected_viral_prompts),
          watermark_enabled = COALESCE($39, watermark_enabled),
          watermark_type = COALESCE($40, watermark_type),
          watermark_text = COALESCE($41, watermark_text),
          watermark_image_url = $42,
          watermark_image_path = $43,
          watermark_position = COALESCE($44, watermark_position),
          watermark_opacity = COALESCE($45, watermark_opacity),
          watermark_image_size = COALESCE($46, watermark_image_size),
          watermark_circular = COALESCE($47, watermark_circular),
          viral_scenes_per_video = COALESCE($48, viral_scenes_per_video),
          selected_idol_prompts = COALESCE($49, selected_idol_prompts),
          idol_scenes_per_video = COALESCE($50, idol_scenes_per_video),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $35 AND user_id = $36
        RETURNING *
      `, [
        name,
        derivedPlatform,
        duration,
        aspect_ratio,
        prompt_mode,
        prompt_template,
        mergedVariables ? JSON.stringify(mergedVariables) : null,
        caption_language,
        custom_hashtags,
        timezone,
        posts_per_day,
        time_slots ? JSON.stringify(time_slots) : null,
        posting_service || null,
        blotato_account_id,
        blotato_api_key,
        page_ids ? JSON.stringify(page_ids) : null,
        late_api_key || null,
        late_profile_id || null,
        late_accounts ? JSON.stringify(late_accounts) : null,
        postforme_api_key || null,
        postforme_accounts ? JSON.stringify(postforme_accounts) : null,
        channel_highlight,
        channel_concept,
        auto_retry_hours != null ? parseInt(auto_retry_hours) : null,
        prompt_temperature != null ? parseFloat(prompt_temperature) : null,
        system_prompt || null,
        ai_model || null,
        fb_admin_profile_id || null,  // $28
        mergedPromptTemplates ? JSON.stringify(mergedPromptTemplates) : null,  // $29
        template_selection_mode || null,  // $30
        extend_prompt || null,  // $31
        extend_variables ? JSON.stringify(extend_variables) : null,  // $32
        mergedExtendPromptTemplates ? JSON.stringify(mergedExtendPromptTemplates) : null,  // $33
        extend_template_selection_mode || null,  // $34
        id,  // $35
        userId,  // $36
        mergedAiPromptTemplates ? JSON.stringify(mergedAiPromptTemplates) : null,  // $37
        selected_viral_prompts ? JSON.stringify(selected_viral_prompts) : null,  // $38
        watermark_enabled !== undefined ? !!watermark_enabled : null,  // $39
        watermark_type || null,  // $40
        watermark_text !== undefined ? watermark_text : null,  // $41
        watermark_image_url !== undefined ? watermark_image_url : null,  // $42
        watermark_image_path !== undefined ? watermark_image_path : null,  // $43
        watermark_position || null,  // $44
        watermark_opacity !== undefined && watermark_opacity !== null ? parseInt(watermark_opacity) : null,  // $45
        watermark_image_size || null,  // $46
        watermark_circular !== undefined ? !!watermark_circular : null,  // $47
        viral_scenes_per_video ?? null,  // $48
        selected_idol_prompts ? JSON.stringify(selected_idol_prompts) : null,  // $49
        idol_scenes_per_video ?? null  // $50
      ]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    console.log('[Channel Update] Result:', result.rows.length > 0 ? 'Success' : 'Not found', 'fb_admin_profile_id saved:', result.rows[0]?.fb_admin_profile_id);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get example prompts
    const examplesResult = await pool.query(`
      SELECT * FROM channel_example_prompts WHERE channel_id = $1 ORDER BY display_order ASC
    `, [id]);

    res.json({
      ...result.rows[0],
      example_prompts: examplesResult.rows
    });
  } catch (error: any) {
    console.error('Error updating scheduler channel:', error);
    res.status(500).json({ error: `Failed to update channel: ${error?.message || 'Unknown'}` });
  }
});

// PATCH /api/scheduler/channels/:id/variables - Update only variables (lightweight)
router.patch('/:id/variables', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { variables } = req.body;

    if (!variables) {
      return res.status(400).json({ error: 'variables is required' });
    }

    // Merge variable statuses from DB to prevent frontend from overwriting queue-runner's tracking
    const currentChannel = await pool.query(
      `SELECT variables FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    const mergedVars = currentChannel.rows.length > 0 && currentChannel.rows[0].variables
      ? mergeVariableStatuses(variables, currentChannel.rows[0].variables)
      : variables;

    const result = await pool.query(`
      UPDATE scheduler_channels
      SET variables = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [JSON.stringify(mergedVars), id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating variables:', error);
    res.status(500).json({ error: 'Failed to update variables' });
  }
});

// DELETE /api/scheduler/channels/:id - Delete channel
router.delete('/:id', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM scheduler_channels
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    console.error('Error deleting scheduler channel:', error);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// GET /api/scheduler/channels/:id/stock - Get stock info for channel
router.get('/:id/stock', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Get channel
    const channelResult = await pool.query(`
      SELECT * FROM scheduler_channels
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Count pending items in queue
    const queueResult = await pool.query(`
      SELECT COUNT(*) as pending_count
      FROM schedule_queue
      WHERE channel_id = $1 AND status = 'pending'
    `, [id]);

    // Calculate unused variable values
    const variables = channel.variables || [];
    let unusedCount = 0;
    for (const variable of variables) {
      if (variable.values) {
        unusedCount += variable.values.filter((v: any) => v.status === 'new').length;
      }
    }

    // Calculate days worth of content
    const postsPerDay = channel.posts_per_day || 3;
    const daysOfContent = Math.floor(unusedCount / postsPerDay);

    res.json({
      channelId: id,
      pendingInQueue: parseInt(queueResult.rows[0].pending_count),
      unusedVariables: unusedCount,
      postsPerDay,
      daysOfContent
    });
  } catch (error) {
    console.error('Error getting channel stock:', error);
    res.status(500).json({ error: 'Failed to get channel stock info' });
  }
});

// =====================================================
// Example Prompts CRUD
// =====================================================

// POST /api/scheduler/channels/:id/examples - Add example prompt
router.post('/:id/examples', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { prompt_text } = req.body;

    if (!prompt_text) {
      return res.status(400).json({ error: 'prompt_text is required' });
    }

    // Verify channel belongs to user
    const channelCheck = await pool.query(
      `SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get next display order
    const orderResult = await pool.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order
       FROM channel_example_prompts WHERE channel_id = $1`,
      [id]
    );
    const nextOrder = orderResult.rows[0].next_order;

    const result = await pool.query(`
      INSERT INTO channel_example_prompts (channel_id, prompt_text, display_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, prompt_text, nextOrder]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding example prompt:', error);
    res.status(500).json({ error: 'Failed to add example prompt' });
  }
});

// PUT /api/scheduler/channels/:id/examples/:exampleId - Update example prompt
router.put('/:id/examples/:exampleId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id, exampleId } = req.params;
    const { prompt_text } = req.body;

    if (!prompt_text) {
      return res.status(400).json({ error: 'prompt_text is required' });
    }

    // Verify channel belongs to user
    const channelCheck = await pool.query(
      `SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const result = await pool.query(`
      UPDATE channel_example_prompts
      SET prompt_text = $1
      WHERE id = $2 AND channel_id = $3
      RETURNING *
    `, [prompt_text, exampleId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Example prompt not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating example prompt:', error);
    res.status(500).json({ error: 'Failed to update example prompt' });
  }
});

// DELETE /api/scheduler/channels/:id/examples/:exampleId - Delete example prompt
router.delete('/:id/examples/:exampleId', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id, exampleId } = req.params;

    // Verify channel belongs to user
    const channelCheck = await pool.query(
      `SELECT id FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const result = await pool.query(`
      DELETE FROM channel_example_prompts
      WHERE id = $1 AND channel_id = $2
      RETURNING id
    `, [exampleId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Example prompt not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting example prompt:', error);
    res.status(500).json({ error: 'Failed to delete example prompt' });
  }
});

// =====================================================
// AI Prompt Generation
// =====================================================

// POST /api/scheduler/channels/:id/generate-system-prompt - Generate system prompt using AI
router.post('/:id/generate-system-prompt', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Verify channel belongs to user and get data
    const channelResult = await pool.query(
      `SELECT * FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    // Get example prompts
    const examplesResult = await pool.query(
      `SELECT prompt_text FROM channel_example_prompts
       WHERE channel_id = $1
       ORDER BY display_order ASC`,
      [id]
    );

    const examplePrompts = examplesResult.rows.map(r => r.prompt_text);

    if (!channel.channel_highlight && examplePrompts.length === 0) {
      return res.status(400).json({
        error: 'Please add channel highlight or example prompts first'
      });
    }

    try {
      const aiConfig = await getAIConfig(userId!);

      const systemPromptForAI = `You are an expert at creating system prompts for AI video/content generation.

Your task is to analyze the channel information and example prompts provided, then create a comprehensive system prompt that will help generate similar content.

The system prompt you create should:
1. Capture the unique style, tone, and structure of the example prompts
2. Identify key elements that make the content engaging
3. Include specific patterns, camera work, mood, and pacing used
4. Provide clear guidelines for creating similar but unique content
5. Be written in a way that instructs an AI to generate prompts following this style

Output ONLY the system prompt text, no explanations or additional commentary.
Write the system prompt in the same language as the example prompts (if Thai examples, write in Thai).`;

      const userPromptForAI = `Create a system prompt based on the following channel information:

CHANNEL HIGHLIGHT (จุดเด่นของช่อง):
${channel.channel_highlight || 'Not specified'}

EXAMPLE PROMPTS (${examplePrompts.length} examples):
${examplePrompts.map((p: string, i: number) => `\n--- Example ${i + 1} ---\n${p}`).join('\n')}

Based on this information, create a detailed system prompt that will help generate similar viral-worthy content prompts. The system prompt should capture the essence, style, and patterns of these examples.`;

      const apiResponse = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPromptForAI },
            { role: 'user', content: userPromptForAI }
          ],
          max_tokens: 2000,
          temperature: 0.5,
        }),
      });

      if (!apiResponse.ok) {
        const errorData: any = await apiResponse.json().catch(() => ({}));
        console.error('AI API Error Response:', errorData);
        return res.status(apiResponse.status).json({
          error: `AI API error: ${errorData.error?.message || apiResponse.status}`
        });
      }

      const data: any = await apiResponse.json();
      const generatedSystemPrompt = data.choices[0]?.message?.content || '';

      // Save to database
      await pool.query(
        `UPDATE scheduler_channels
         SET system_prompt = $1, system_prompt_generated_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [generatedSystemPrompt, id]
      );

      res.json({
        system_prompt: generatedSystemPrompt,
        generated_at: new Date().toISOString()
      });

    } catch (aiError: any) {
      console.error('AI API call failed:', aiError);
      throw aiError;
    }

  } catch (error: any) {
    console.error('Generate system prompt error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// POST /api/scheduler/channels/:id/generate-inspired-prompt - Generate inspired prompt using AI
router.post('/:id/generate-inspired-prompt', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { example_prompt_id } = req.body;

    if (!example_prompt_id) {
      return res.status(400).json({ error: 'example_prompt_id is required' });
    }

    // Verify channel belongs to user and get data
    const channelResult = await pool.query(
      `SELECT * FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    if (!channel.system_prompt) {
      return res.status(400).json({
        error: 'Please generate a system prompt first'
      });
    }

    // Get the selected example prompt
    const exampleResult = await pool.query(
      `SELECT * FROM channel_example_prompts WHERE id = $1 AND channel_id = $2`,
      [example_prompt_id, id]
    );

    if (exampleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Example prompt not found' });
    }

    const examplePrompt = exampleResult.rows[0];

    try {
      const aiConfig = await getAIConfig(userId!);

      const userPromptForAI = `Based on this example prompt, create a NEW prompt that closely follows the style of the example:
1. Use the SAME writing style, sentence structure, and format
2. Keep the same tone, pacing, and level of detail
3. Use a DIFFERENT subject, location, or scenario
4. You MAY reuse key phrases and stylistic patterns from the example
5. The result should feel like it belongs to the same series

EXAMPLE PROMPT:
${examplePrompt.prompt_text}

Generate a new prompt that closely matches the style and quality of the example above.

IMPORTANT: Output ONLY the new prompt, no explanations or additional text.`;

      const apiResponse = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: channel.system_prompt },
            { role: 'user', content: userPromptForAI }
          ],
          max_tokens: 2000,
          temperature: channel.prompt_temperature ?? 0.5,
        }),
      });

      if (!apiResponse.ok) {
        const errorData: any = await apiResponse.json().catch(() => ({}));
        console.error('AI API Error Response:', errorData);
        return res.status(apiResponse.status).json({
          error: `AI API error: ${errorData.error?.message || apiResponse.status}`
        });
      }

      const data: any = await apiResponse.json();
      const generatedPrompt = data.choices[0]?.message?.content || '';

      // Update usage count for the example
      await pool.query(
        `UPDATE channel_example_prompts
         SET times_used = times_used + 1
         WHERE id = $1`,
        [example_prompt_id]
      );

      res.json({
        generated_prompt: generatedPrompt,
        inspired_by_example_id: example_prompt_id
      });

    } catch (aiError: any) {
      console.error('AI API call failed:', aiError);
      throw aiError;
    }

  } catch (error: any) {
    console.error('Generate inspired prompt error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// POST /api/scheduler/channels/:id/auto-generate-prompt - Auto generate prompt (random example)
router.post('/:id/auto-generate-prompt', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Verify channel belongs to user and get data
    const channelResult = await pool.query(
      `SELECT * FROM scheduler_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const channel = channelResult.rows[0];

    if (!channel.system_prompt) {
      return res.status(400).json({
        error: 'Please generate a system prompt first'
      });
    }

    // Get all example prompts and randomly select one
    const examplesResult = await pool.query(
      `SELECT * FROM channel_example_prompts
       WHERE channel_id = $1
       ORDER BY RANDOM()
       LIMIT 1`,
      [id]
    );

    if (examplesResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Please add at least one example prompt first'
      });
    }

    const randomExample = examplesResult.rows[0];

    try {
      const aiConfig = await getAIConfig(userId!);

      const userPromptForAI = `Based on this example prompt, create a NEW prompt that closely follows the style of the example:
1. Use the SAME writing style, sentence structure, and format
2. Keep the same tone, pacing, and level of detail
3. Use a DIFFERENT subject, location, or scenario
4. You MAY reuse key phrases and stylistic patterns from the example
5. The result should feel like it belongs to the same series

EXAMPLE PROMPT:
${randomExample.prompt_text}

Generate a new prompt that closely matches the style and quality of the example above.

IMPORTANT: Output ONLY the new prompt, no explanations or additional text.`;

      const apiResponse = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: channel.system_prompt },
            { role: 'user', content: userPromptForAI }
          ],
          max_tokens: 2000,
          temperature: channel.prompt_temperature ?? 0.5,
        }),
      });

      if (!apiResponse.ok) {
        const errorData: any = await apiResponse.json().catch(() => ({}));
        console.error('AI API Error Response:', errorData);
        return res.status(apiResponse.status).json({
          error: `AI API error: ${errorData.error?.message || apiResponse.status}`
        });
      }

      const data: any = await apiResponse.json();
      const generatedPrompt = data.choices[0]?.message?.content || '';

      // Update usage count for the example
      await pool.query(
        `UPDATE channel_example_prompts
         SET times_used = times_used + 1
         WHERE id = $1`,
        [randomExample.id]
      );

      res.json({
        generated_prompt: generatedPrompt,
        inspired_by_example_id: randomExample.id
      });

    } catch (openaiError: any) {
      console.error('OpenAI API call failed:', openaiError);
      throw openaiError;
    }

  } catch (error: any) {
    console.error('Auto generate prompt error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// POST /api/scheduler/channels/generate-variable-values - Generate variable values using AI
router.post('/generate-variable-values', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { system_prompt, variable_name, count, image_url, template_context } = req.body;

    if (!system_prompt || !variable_name || !count) {
      return res.status(400).json({ error: 'system_prompt, variable_name, and count are required' });
    }

    const requestedCount = Math.min(Math.max(1, parseInt(count)), 100); // Clamp 1-100
    const generateCount = requestedCount + 5; // Request extra to compensate for LLM undershoot

    try {
      const aiConfig = await getAIConfig(userId!);
      const model = aiConfig.provider === 'openrouter' ? 'openai/gpt-4o' : 'gpt-4o';

      // Build user content — optionally include image (vision) + template context
      const contextLines: string[] = [];
      if (template_context) contextLines.push(`Template context: ${String(template_context).slice(0, 500)}`);
      const textInstruction = `${contextLines.length ? contextLines.join('\n') + '\n\n' : ''}Generate exactly ${generateCount} unique values for the variable "{${variable_name}}".

Return ONLY a JSON array of strings, no explanations or additional text.
Example format: ["value1", "value2", "value3"]

Generate exactly ${generateCount} values.`;

      let userMessage: any;
      if (image_url && typeof image_url === 'string' && image_url.startsWith('http')) {
        userMessage = {
          role: 'user',
          content: [
            { type: 'text', text: textInstruction },
            { type: 'image_url', image_url: { url: image_url } },
          ],
        };
      } else {
        userMessage = { role: 'user', content: textInstruction };
      }

      const apiResponse = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system_prompt },
            userMessage,
          ],
          max_tokens: 4000,
          temperature: 0.8,
        }),
      });

      if (!apiResponse.ok) {
        const errorData: any = await apiResponse.json().catch(() => ({}));
        console.error('AI API Error Response:', errorData);
        return res.status(apiResponse.status).json({
          error: `${aiConfig.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API error: ${errorData.error?.message || apiResponse.status}`
        });
      }

      const data: any = await apiResponse.json();
      const content = data.choices[0]?.message?.content || '[]';

      // Parse JSON array from response
      let values: string[] = [];
      try {
        // Try to extract JSON array from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          values = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        // Fallback: split by newlines
        values = content.split('\n').map((line: string) => line.trim()).filter((line: string) => line && !line.startsWith('[') && !line.startsWith(']'));
      }

      // Ensure all values are strings, then trim to requested count
      values = values.map((v: any) => String(v).trim()).filter((v: string) => v.length > 0);
      values = values.slice(0, requestedCount);

      res.json({ values });

    } catch (openaiError: any) {
      console.error('OpenAI API call failed:', openaiError);
      throw openaiError;
    }

  } catch (error: any) {
    console.error('Generate variable values error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// ==================== File Upload ====================

// POST /api/scheduler/channels/upload-avatar - Upload avatar image to S3
router.post('/upload-avatar', authenticate, upload.single('avatar'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const key = `avatars/avatar-${uniqueSuffix}${path.extname(req.file.originalname)}`;

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    // Return proxy URL (served through our backend)
    const avatarUrl = `/api/scheduler/channels/avatars/${key}`;
    res.json({ url: avatarUrl, filename: key });
  } catch (error: any) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// GET /api/scheduler/channels/avatars/* - Proxy avatar from S3
router.get('/avatars/*', async (req, res) => {
  try {
    const key = (req.params as any)[0];
    const response = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));

    if (response.ContentType) {
      res.setHeader('Content-Type', response.ContentType);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = response.Body as any;
    stream.pipe(res);
  } catch (error: any) {
    console.error('Avatar proxy error:', error.message);
    res.status(404).json({ error: 'Not found' });
  }
});

// GET /api/scheduler/channels/guide/* - Proxy guide images from S3
router.get('/guide/*', async (req, res) => {
  try {
    const key = 'guide/' + (req.params as any)[0];
    const response = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));

    if (response.ContentType) {
      res.setHeader('Content-Type', response.ContentType);
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = response.Body as any;
    stream.pipe(res);
  } catch (error: any) {
    console.error('Guide image proxy error:', error.message);
    res.status(404).json({ error: 'Not found' });
  }
});

// POST /api/scheduler/channels/upload-guide - Upload guide images to S3 (admin only)
router.post('/upload-guide', authenticate, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const userResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = req.body.filename || req.file.originalname;
    const key = `guide/${filename}`;

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));

    const url = `/api/scheduler/channels/guide/${filename}`;
    res.json({ url, key });
  } catch (error: any) {
    console.error('Upload guide image error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// POST /api/scheduler/channels/:id/watermark-image - Upload watermark image to Dropbox
router.post('/:id/watermark-image', authenticate, requireSubscription, upload.single('image'), async (req: AuthRequest, res) => {
  let tempPath: string | null = null;
  try {
    if (!isDropboxConfigured()) {
      return res.status(500).json({ error: 'Dropbox not configured' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const channelId = parseInt(req.params.id);
    const userId = req.userId;

    // Verify channel ownership
    const channelResult = await pool.query(
      'SELECT id, watermark_image_path FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const oldPath = channelResult.rows[0].watermark_image_path;

    // Determine extension
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || 'png';
    const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';

    // Write buffer to temp file
    tempPath = path.join(os.tmpdir(), `wm-${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    // Upload to Dropbox (overwrite mode replaces existing file)
    const dropboxPath = `/trippleviral/watermarks/${userId}/${channelId}/watermark.${safeExt}`;
    const { sharedUrl } = await uploadLocalFileToDropbox(tempPath, dropboxPath);

    // Delete old watermark if path differs (different extension)
    if (oldPath && oldPath !== dropboxPath) {
      try { await deleteVideoFromDropbox(oldPath); } catch {}
    }

    res.json({ imageUrl: sharedUrl, imagePath: dropboxPath });
  } catch (error: any) {
    console.error('Upload watermark image error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
});

// DELETE /api/scheduler/channels/:id/watermark-image - Remove watermark image from Dropbox + channel
router.delete('/:id/watermark-image', authenticate, requireSubscription, async (req: AuthRequest, res) => {
  try {
    const channelId = parseInt(req.params.id);
    const userId = req.userId;

    const channelResult = await pool.query(
      'SELECT watermark_image_path FROM scheduler_channels WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );
    if (channelResult.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const oldPath = channelResult.rows[0].watermark_image_path;

    if (oldPath) {
      try { await deleteVideoFromDropbox(oldPath); } catch {}
    }

    await pool.query(
      'UPDATE scheduler_channels SET watermark_image_url = NULL, watermark_image_path = NULL WHERE id = $1 AND user_id = $2',
      [channelId, userId]
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete watermark image error:', error);
    res.status(500).json({ error: error.message || 'Delete failed' });
  }
});

export default router;
