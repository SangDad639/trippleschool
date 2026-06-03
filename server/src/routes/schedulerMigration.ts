import { Router } from 'express';
import pool from '../db.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/scheduler/migrate-ai - Run AI Prompt System migration
router.get('/migrate-ai', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log('🚀 Running AI Prompt System migration for scheduler...');

    // Add AI Prompt Template columns to scheduler_channels
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS channel_highlight TEXT,
      ADD COLUMN IF NOT EXISTS system_prompt TEXT,
      ADD COLUMN IF NOT EXISTS system_prompt_generated_at TIMESTAMP;
    `);
    console.log('✅ AI Prompt columns added to scheduler_channels');

    // Create channel_example_prompts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channel_example_prompts (
        id SERIAL PRIMARY KEY,
        channel_id INTEGER NOT NULL REFERENCES scheduler_channels(id) ON DELETE CASCADE,
        prompt_text TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        times_used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ channel_example_prompts table created');

    // Create indexes for channel_example_prompts
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_channel_example_prompts_channel_id ON channel_example_prompts(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_example_prompts_order ON channel_example_prompts(channel_id, display_order);
    `);
    console.log('✅ channel_example_prompts indexes created');

    res.json({
      success: true,
      message: 'AI Prompt System migration completed successfully!',
      changes: [
        'Added channel_highlight column to scheduler_channels',
        'Added system_prompt column to scheduler_channels',
        'Added system_prompt_generated_at column to scheduler_channels',
        'Created channel_example_prompts table'
      ],
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ AI Prompt System migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scheduler/migrate - Run scheduler migration
router.get('/migrate', authenticate, async (req: AuthRequest, res) => {
  try {
    if (!req.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log('🚀 Running scheduler migration...');

    // Create scheduler_channels table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_channels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        platform VARCHAR(50) NOT NULL DEFAULT 'sora2-kie',
        duration VARCHAR(10) NOT NULL DEFAULT '10',
        aspect_ratio VARCHAR(20) NOT NULL DEFAULT 'portrait',
        prompt_template TEXT NOT NULL,
        variables JSONB DEFAULT '[]',
        caption_language VARCHAR(10) DEFAULT 'en',
        custom_hashtags TEXT DEFAULT '',
        timezone VARCHAR(100) DEFAULT 'local',
        time_slots JSONB DEFAULT '["10:00", "14:00", "18:00"]',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ scheduler_channels table created');

    // Create schedule_queue table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id INTEGER REFERENCES scheduler_channels(id) ON DELETE SET NULL,
        scheduled_time TIMESTAMP NOT NULL,
        prompt TEXT NOT NULL,
        variable_values JSONB DEFAULT '{}',
        platform VARCHAR(50) NOT NULL DEFAULT 'sora2-kie',
        duration VARCHAR(10) NOT NULL DEFAULT '10',
        aspect_ratio VARCHAR(20) NOT NULL DEFAULT 'portrait',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        video_url TEXT,
        error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ schedule_queue table created');

    // Create time_presets table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_presets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        times JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, name)
      );
    `);
    console.log('✅ time_presets table created');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduler_channels_user_id ON scheduler_channels(user_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_queue_user_id ON schedule_queue(user_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_queue_channel_id ON schedule_queue(channel_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_queue_status ON schedule_queue(status);
      CREATE INDEX IF NOT EXISTS idx_schedule_queue_scheduled_time ON schedule_queue(scheduled_time);
      CREATE INDEX IF NOT EXISTS idx_time_presets_user_id ON time_presets(user_id);
    `);
    console.log('✅ Indexes created');

    // ========== AI Prompt System ==========
    // Add AI Prompt Template columns to scheduler_channels
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS channel_highlight TEXT,
      ADD COLUMN IF NOT EXISTS system_prompt TEXT,
      ADD COLUMN IF NOT EXISTS system_prompt_generated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS posts_per_day INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS blotato_account_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS page_ids JSONB DEFAULT '{"facebook":"","instagram":"","tiktok":"","twitter":"","youtube":""}';
    `);
    console.log('✅ AI Prompt columns added to scheduler_channels');

    // Create channel_example_prompts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channel_example_prompts (
        id SERIAL PRIMARY KEY,
        channel_id INTEGER NOT NULL REFERENCES scheduler_channels(id) ON DELETE CASCADE,
        prompt_text TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        times_used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ channel_example_prompts table created');

    // Create indexes for channel_example_prompts
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_channel_example_prompts_channel_id ON channel_example_prompts(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_example_prompts_order ON channel_example_prompts(channel_id, display_order);
    `);
    console.log('✅ channel_example_prompts indexes created');

    // Add Blotato fields to schedule_queue
    await pool.query(`
      ALTER TABLE schedule_queue
      ADD COLUMN IF NOT EXISTS caption TEXT,
      ADD COLUMN IF NOT EXISTS blotato_post_ids JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS generate_only BOOLEAN DEFAULT false;
    `);
    console.log('✅ Blotato fields added to schedule_queue');

    // Channel Prompt Drafts table (for persisting draft prompts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channel_prompt_drafts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id INTEGER NOT NULL REFERENCES scheduler_channels(id) ON DELETE CASCADE,
        scheduled_date DATE NOT NULL,
        time_slot VARCHAR(5) NOT NULL,
        prompt TEXT NOT NULL,
        is_ai_generated BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel_id, scheduled_date, time_slot)
      );
    `);
    console.log('✅ Channel Prompt Drafts table created');

    // Indexes for channel_prompt_drafts
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_channel ON channel_prompt_drafts(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_user ON channel_prompt_drafts(user_id);
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_date ON channel_prompt_drafts(scheduled_date);
    `);
    console.log('✅ Channel Prompt Drafts indexes created');

    // Add blotato_api_key and auto_retry_hours columns
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS blotato_api_key VARCHAR(255),
      ADD COLUMN IF NOT EXISTS auto_retry_hours INTEGER;
    `);
    console.log('✅ blotato_api_key and auto_retry_hours columns added');

    // Add prompt_temperature to scheduler_channels
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS prompt_temperature NUMERIC(2,1) DEFAULT 0.5;
    `);
    console.log('✅ prompt_temperature column added to scheduler_channels');

    // Add prompt_mode to scheduler_channels (ai = AI Prompt System, variable = Variable System)
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS prompt_mode VARCHAR(20) DEFAULT 'ai';
    `);
    console.log('✅ prompt_mode column added to scheduler_channels');

    // Add channel_concept to scheduler_channels
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS channel_concept TEXT;
    `);
    console.log('✅ channel_concept column added to scheduler_channels');

    // Add ai_model to scheduler_channels
    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS ai_model VARCHAR(20) DEFAULT 'sora2_15s';
    `);
    console.log('✅ ai_model column added to scheduler_channels');

    // Remove duplicate queue items (keep lowest ID per channel+time) and add UNIQUE constraint
    await pool.query(`
      DELETE FROM schedule_queue a
      USING schedule_queue b
      WHERE a.id > b.id
        AND a.channel_id = b.channel_id
        AND a.scheduled_time = b.scheduled_time;
    `);
    console.log('✅ Removed duplicate queue items');

    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE schedule_queue
        ADD CONSTRAINT uq_channel_scheduled_time UNIQUE (channel_id, scheduled_time);
      EXCEPTION WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log('✅ UNIQUE constraint on schedule_queue (channel_id, scheduled_time)');

    // Register tool in database
    await pool.query(`
      INSERT INTO tools (category_id, name, slug, description, icon, credit_cost, is_featured, is_active, route_path, component_name, display_order)
      VALUES (
        (SELECT id FROM categories WHERE slug = 'automation' LIMIT 1),
        'Content Scheduler',
        'content-scheduler',
        'วางแผนและจัดการ queue สำหรับ generate video อัตโนมัติ ด้วยปฏิทินและ time slots',
        'Calendar',
        0,
        true,
        true,
        '/dashboard/content-scheduler',
        'ContentScheduler',
        99
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        credit_cost = EXCLUDED.credit_cost,
        route_path = EXCLUDED.route_path,
        icon = EXCLUDED.icon;
    `);
    console.log('✅ Content Scheduler tool registered');

    res.json({
      success: true,
      message: 'Scheduler migration completed successfully!',
      tables: ['scheduler_channels', 'schedule_queue', 'time_presets'],
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Scheduler migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scheduler/migrate-concept - Add channel_concept column only
router.get('/migrate-concept', authenticate, async (req: AuthRequest, res) => {
  try {
    console.log('🚀 Adding channel_concept column...');

    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS channel_concept TEXT;
    `);
    console.log('✅ channel_concept column added');

    res.json({
      success: true,
      message: 'channel_concept column added successfully!',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scheduler/migrate-ai-model - Add ai_model column
router.get('/migrate-ai-model', authenticate, async (req: AuthRequest, res) => {
  try {
    console.log('🚀 Adding ai_model column...');

    await pool.query(`
      ALTER TABLE scheduler_channels
      ADD COLUMN IF NOT EXISTS ai_model VARCHAR(20) DEFAULT 'sora2_15s';
    `);
    console.log('✅ ai_model column added');

    res.json({
      success: true,
      message: 'ai_model column added successfully!',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scheduler/migrate-late-profiles - Create saved_late_profiles table
router.get('/migrate-late-profiles', authenticate, async (req: AuthRequest, res) => {
  try {
    console.log('🚀 Creating saved_late_profiles table...');

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
    console.log('✅ saved_late_profiles table created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_late_profiles_user_id ON saved_late_profiles(user_id);
    `);
    console.log('✅ Index created');

    res.json({
      success: true,
      message: 'saved_late_profiles table created successfully!',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/scheduler/migrate-extend-prompt - Add extend_prompt column to schedule_queue
router.get('/migrate-extend-prompt', authenticate, async (req: AuthRequest, res) => {
  try {
    console.log('🚀 Adding extend_prompt column to schedule_queue...');

    await pool.query(`
      ALTER TABLE schedule_queue
      ADD COLUMN IF NOT EXISTS extend_prompt TEXT;
    `);
    console.log('✅ extend_prompt column added to schedule_queue');

    res.json({
      success: true,
      message: 'extend_prompt column added successfully!',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
