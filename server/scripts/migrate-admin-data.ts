/**
 * Admin Data Migration Script
 *
 * Migrates ContentScheduler data for admin user from sora-spark-forge to trippleviral
 *
 * Usage:
 *   SOURCE_DB_URL="postgresql://..." DATABASE_URL="postgresql://..." npx tsx scripts/migrate-admin-data.ts
 *
 * Tables migrated (in FK order):
 *   1. users (admin only)
 *   2. scheduler_channels
 *   3. schedule_queue
 *   4. time_presets
 *   5. channel_example_prompts
 *   6. channel_prompt_drafts
 */

import pg from 'pg';
const { Pool } = pg;

const ADMIN_EMAIL = '123456789123456789ori@gmail.com';

// Helper to safely stringify JSONB values
function toJsonb(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// Validate environment variables
if (!process.env.SOURCE_DB_URL) {
  console.error('❌ Missing SOURCE_DB_URL environment variable');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL environment variable');
  process.exit(1);
}

// Connect to both databases
const sourcePool = new Pool({
  connectionString: process.env.SOURCE_DB_URL,
  ssl: { rejectUnauthorized: false }
});
const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createSchedulerTables() {
  console.log('🔧 Creating scheduler tables in target database...');

  // Create scheduler_channels table
  await targetPool.query(`
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
      channel_highlight TEXT,
      system_prompt TEXT,
      system_prompt_generated_at TIMESTAMP,
      posts_per_day INTEGER DEFAULT 3,
      blotato_account_id VARCHAR(255),
      page_ids JSONB DEFAULT '{"facebook":"","instagram":"","tiktok":"","twitter":"","youtube":""}',
      blotato_api_key VARCHAR(255),
      auto_retry_hours INTEGER,
      prompt_temperature NUMERIC(2,1) DEFAULT 0.5,
      prompt_mode VARCHAR(20) DEFAULT 'ai',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log('   ✅ scheduler_channels table');

  // Create schedule_queue table
  await targetPool.query(`
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
      caption TEXT,
      blotato_post_ids JSONB DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log('   ✅ schedule_queue table');

  // Create time_presets table
  await targetPool.query(`
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
  console.log('   ✅ time_presets table');

  // Create channel_example_prompts table
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS channel_example_prompts (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES scheduler_channels(id) ON DELETE CASCADE,
      prompt_text TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('   ✅ channel_example_prompts table');

  // Create channel_prompt_drafts table
  await targetPool.query(`
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
  console.log('   ✅ channel_prompt_drafts table');

  // Create indexes
  await targetPool.query(`
    CREATE INDEX IF NOT EXISTS idx_scheduler_channels_user_id ON scheduler_channels(user_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_queue_user_id ON schedule_queue(user_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_queue_channel_id ON schedule_queue(channel_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_queue_status ON schedule_queue(status);
    CREATE INDEX IF NOT EXISTS idx_schedule_queue_scheduled_time ON schedule_queue(scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_time_presets_user_id ON time_presets(user_id);
    CREATE INDEX IF NOT EXISTS idx_channel_example_prompts_channel_id ON channel_example_prompts(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_channel ON channel_prompt_drafts(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_user ON channel_prompt_drafts(user_id);
  `);
  console.log('   ✅ Scheduler indexes created');

  // ========== PROMPT LIBRARY TABLES ==========
  // Create prompt_library table
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS prompt_library (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      description TEXT,
      youtube_url TEXT,
      youtube_id VARCHAR(50),
      thumbnail_url TEXT,
      platform VARCHAR(50) NOT NULL DEFAULT 'sora2',
      prompt_template TEXT NOT NULL,
      variables JSONB DEFAULT '[]',
      is_featured BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      display_order INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('   ✅ prompt_library table');

  // Create user_prompt_favorites table
  await targetPool.query(`
    CREATE TABLE IF NOT EXISTS user_prompt_favorites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt_library_id INTEGER NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, prompt_library_id)
    );
  `);
  console.log('   ✅ user_prompt_favorites table');

  // Create prompt library indexes
  await targetPool.query(`
    CREATE INDEX IF NOT EXISTS idx_prompt_library_slug ON prompt_library(slug);
    CREATE INDEX IF NOT EXISTS idx_prompt_library_platform ON prompt_library(platform);
    CREATE INDEX IF NOT EXISTS idx_prompt_library_is_active ON prompt_library(is_active);
    CREATE INDEX IF NOT EXISTS idx_prompt_library_is_featured ON prompt_library(is_featured);
    CREATE INDEX IF NOT EXISTS idx_user_prompt_favorites_user ON user_prompt_favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_prompt_favorites_prompt ON user_prompt_favorites(prompt_library_id);
  `);
  console.log('   ✅ Prompt library indexes created');
  console.log('');
}

async function migrateAdminData() {
  console.log('🚀 Starting admin data migration...');
  console.log(`📧 Admin email: ${ADMIN_EMAIL}`);
  console.log('');

  try {
    // Create scheduler tables first
    await createSchedulerTables();
    // ========== 1. USERS ==========
    console.log('📦 [1/6] Migrating users...');
    const { rows: [adminUser] } = await sourcePool.query(
      `SELECT * FROM users WHERE email = $1`, [ADMIN_EMAIL]
    );

    if (!adminUser) {
      throw new Error(`Admin user not found: ${ADMIN_EMAIL}`);
    }
    console.log(`   Found admin user ID: ${adminUser.id}`);

    // Map sora-spark-forge schema → trippleviral schema:
    // password_hash → password_hash (same)
    // is_admin → is_admin (same)
    // created_at/join_date → join_date
    // credits: decimal → integer (floor)
    const isAdmin = adminUser.role === 'admin';
    const credits = Math.floor(Number(adminUser.credits) || 0);

    await targetPool.query(`
      INSERT INTO users (id, email, password_hash, credits, is_admin, join_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        credits = EXCLUDED.credits,
        is_admin = EXCLUDED.is_admin
    `, [adminUser.id, adminUser.email, adminUser.password_hash, credits,
        isAdmin, adminUser.created_at || adminUser.join_date]);
    console.log('   ✅ Admin user migrated');

    // ========== 2. SCHEDULER_CHANNELS ==========
    console.log('📦 [2/6] Migrating scheduler_channels...');
    const { rows: channels } = await sourcePool.query(
      `SELECT * FROM scheduler_channels WHERE user_id = $1`, [adminUser.id]
    );
    console.log(`   Found ${channels.length} channels`);

    for (const ch of channels) {
      await targetPool.query(`
        INSERT INTO scheduler_channels (
          id, user_id, name, platform, duration, aspect_ratio,
          prompt_template, variables, caption_language, custom_hashtags,
          timezone, time_slots, channel_highlight, system_prompt,
          system_prompt_generated_at, posts_per_day, blotato_account_id,
          page_ids, blotato_api_key, auto_retry_hours, prompt_temperature,
          prompt_mode, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          platform = EXCLUDED.platform,
          prompt_template = EXCLUDED.prompt_template,
          variables = EXCLUDED.variables,
          system_prompt = EXCLUDED.system_prompt,
          channel_highlight = EXCLUDED.channel_highlight,
          page_ids = EXCLUDED.page_ids,
          updated_at = EXCLUDED.updated_at
      `, [
        ch.id, ch.user_id, ch.name, ch.platform, ch.duration, ch.aspect_ratio,
        ch.prompt_template, toJsonb(ch.variables), ch.caption_language, ch.custom_hashtags,
        ch.timezone, toJsonb(ch.time_slots), ch.channel_highlight, ch.system_prompt,
        ch.system_prompt_generated_at, ch.posts_per_day, ch.blotato_account_id,
        toJsonb(ch.page_ids), ch.blotato_api_key, ch.auto_retry_hours, ch.prompt_temperature,
        ch.prompt_mode, ch.created_at, ch.updated_at
      ]);
    }
    console.log('   ✅ Channels migrated');

    // ========== 3. SCHEDULE_QUEUE ==========
    console.log('📦 [3/6] Migrating schedule_queue...');
    const { rows: queueItems } = await sourcePool.query(
      `SELECT * FROM schedule_queue WHERE user_id = $1`, [adminUser.id]
    );
    console.log(`   Found ${queueItems.length} queue items`);

    for (const item of queueItems) {
      await targetPool.query(`
        INSERT INTO schedule_queue (
          id, user_id, channel_id, scheduled_time, prompt, variable_values,
          platform, duration, aspect_ratio, status, video_url, error,
          caption, blotato_post_ids, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          video_url = EXCLUDED.video_url,
          caption = EXCLUDED.caption,
          updated_at = EXCLUDED.updated_at
      `, [
        item.id, item.user_id, item.channel_id, item.scheduled_time, item.prompt,
        toJsonb(item.variable_values), item.platform, item.duration, item.aspect_ratio,
        item.status, item.video_url, item.error, item.caption, toJsonb(item.blotato_post_ids),
        item.created_at, item.updated_at
      ]);
    }
    console.log('   ✅ Queue items migrated');

    // ========== 4. TIME_PRESETS ==========
    console.log('📦 [4/6] Migrating time_presets...');
    const { rows: presets } = await sourcePool.query(
      `SELECT * FROM time_presets WHERE user_id = $1`, [adminUser.id]
    );
    console.log(`   Found ${presets.length} time presets`);

    for (const preset of presets) {
      await targetPool.query(`
        INSERT INTO time_presets (id, user_id, name, times, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, name) DO UPDATE SET
          times = EXCLUDED.times,
          updated_at = EXCLUDED.updated_at
      `, [preset.id, preset.user_id, preset.name, toJsonb(preset.times),
          preset.created_at, preset.updated_at]);
    }
    console.log('   ✅ Time presets migrated');

    // ========== 5. CHANNEL_EXAMPLE_PROMPTS ==========
    console.log('📦 [5/6] Migrating channel_example_prompts...');
    const channelIds = channels.map(c => c.id);

    if (channelIds.length > 0) {
      const { rows: examplePrompts } = await sourcePool.query(
        `SELECT * FROM channel_example_prompts WHERE channel_id = ANY($1)`, [channelIds]
      );
      console.log(`   Found ${examplePrompts.length} example prompts`);

      for (const ep of examplePrompts) {
        await targetPool.query(`
          INSERT INTO channel_example_prompts (id, channel_id, prompt_text, display_order, times_used, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            prompt_text = EXCLUDED.prompt_text,
            display_order = EXCLUDED.display_order,
            times_used = EXCLUDED.times_used
        `, [ep.id, ep.channel_id, ep.prompt_text, ep.display_order, ep.times_used, ep.created_at]);
      }
    }
    console.log('   ✅ Example prompts migrated');

    // ========== 6. CHANNEL_PROMPT_DRAFTS ==========
    console.log('📦 [6/6] Migrating channel_prompt_drafts...');
    const { rows: drafts } = await sourcePool.query(
      `SELECT * FROM channel_prompt_drafts WHERE user_id = $1`, [adminUser.id]
    );
    console.log(`   Found ${drafts.length} prompt drafts`);

    for (const draft of drafts) {
      await targetPool.query(`
        INSERT INTO channel_prompt_drafts (
          id, user_id, channel_id, scheduled_date, time_slot, prompt,
          is_ai_generated, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (channel_id, scheduled_date, time_slot) DO UPDATE SET
          prompt = EXCLUDED.prompt,
          is_ai_generated = EXCLUDED.is_ai_generated,
          updated_at = EXCLUDED.updated_at
      `, [
        draft.id, draft.user_id, draft.channel_id, draft.scheduled_date,
        draft.time_slot, draft.prompt, draft.is_ai_generated,
        draft.created_at, draft.updated_at
      ]);
    }
    console.log('   ✅ Prompt drafts migrated');

    // ========== 7. PROMPT_LIBRARY ==========
    console.log('📦 [7/8] Migrating prompt_library (all templates)...');
    const { rows: promptTemplates } = await sourcePool.query(
      `SELECT * FROM prompt_library`
    );
    console.log(`   Found ${promptTemplates.length} prompt templates`);

    for (const pt of promptTemplates) {
      await targetPool.query(`
        INSERT INTO prompt_library (
          id, name, slug, description, youtube_url, youtube_id, thumbnail_url,
          platform, prompt_template, variables, is_featured, is_active,
          display_order, times_used, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          prompt_template = EXCLUDED.prompt_template,
          variables = EXCLUDED.variables,
          is_featured = EXCLUDED.is_featured,
          is_active = EXCLUDED.is_active,
          updated_at = EXCLUDED.updated_at
      `, [
        pt.id, pt.name, pt.slug, pt.description, pt.youtube_url, pt.youtube_id,
        pt.thumbnail_url, pt.platform, pt.prompt_template, toJsonb(pt.variables),
        pt.is_featured, pt.is_active, pt.display_order, pt.times_used,
        pt.created_at, pt.updated_at
      ]);
    }
    console.log('   ✅ Prompt templates migrated');

    // ========== 8. USER_PROMPT_FAVORITES ==========
    console.log('📦 [8/8] Migrating user_prompt_favorites...');
    const { rows: favorites } = await sourcePool.query(
      `SELECT * FROM user_prompt_favorites WHERE user_id = $1`, [adminUser.id]
    );
    console.log(`   Found ${favorites.length} favorites`);

    for (const fav of favorites) {
      await targetPool.query(`
        INSERT INTO user_prompt_favorites (id, user_id, prompt_library_id, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, prompt_library_id) DO NOTHING
      `, [fav.id, fav.user_id, fav.prompt_library_id, fav.created_at]);
    }
    console.log('   ✅ User favorites migrated');

    // ========== RESET SEQUENCES ==========
    console.log('');
    console.log('🔧 Resetting sequences...');

    await targetPool.query(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users))`);
    await targetPool.query(`SELECT setval('scheduler_channels_id_seq', (SELECT COALESCE(MAX(id), 1) FROM scheduler_channels))`);
    await targetPool.query(`SELECT setval('schedule_queue_id_seq', (SELECT COALESCE(MAX(id), 1) FROM schedule_queue))`);
    await targetPool.query(`SELECT setval('time_presets_id_seq', (SELECT COALESCE(MAX(id), 1) FROM time_presets))`);
    await targetPool.query(`SELECT setval('channel_example_prompts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM channel_example_prompts))`);
    await targetPool.query(`SELECT setval('channel_prompt_drafts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM channel_prompt_drafts))`);
    await targetPool.query(`SELECT setval('prompt_library_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prompt_library))`);
    await targetPool.query(`SELECT setval('user_prompt_favorites_id_seq', (SELECT COALESCE(MAX(id), 1) FROM user_prompt_favorites))`);

    console.log('   ✅ Sequences reset');

    // ========== SUMMARY ==========
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('✅ MIGRATION COMPLETE!');
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log('Summary:');
    console.log(`  • Admin user: ${adminUser.email}`);
    console.log(`  • Channels: ${channels.length}`);
    console.log(`  • Queue items: ${queueItems.length}`);
    console.log(`  • Time presets: ${presets.length}`);
    console.log(`  • Prompt templates: ${promptTemplates.length}`);
    console.log(`  • User favorites: ${favorites.length}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Login to trippleviral with admin credentials');
    console.log('  2. Verify channels appear in ContentScheduler');
    console.log('  3. Check queue items in calendar');

  } catch (error: any) {
    console.error('');
    console.error('❌ MIGRATION FAILED:', error.message);
    console.error('');
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

// Run migration
migrateAdminData();
