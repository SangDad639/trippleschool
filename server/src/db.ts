import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// Force TIMESTAMP to return as ISO string with Z suffix (UTC)
// TypeId 1114 = TIMESTAMP WITHOUT TIME ZONE
types.setTypeParser(1114, (val: string) => {
  if (!val) return null;
  // Convert "2025-11-01 13:46:56.244148" to "2025-11-01T13:46:56.244Z"
  // Also handles no fractional seconds: "2026-01-31 05:00:00" → "2026-01-31T05:00:00.000Z"
  const [datetime, frac] = val.split('.');
  const isoDatetime = datetime.replace(' ', 'T');
  return frac ? `${isoDatetime}.${frac.slice(0, 3)}Z` : `${isoDatetime}.000Z`;
});

// Force NUMERIC to return as number instead of string
// TypeId 1700 = NUMERIC (e.g., NUMERIC(12,2) for credits)
// Without this, PostgreSQL returns NUMERIC as string, causing string concatenation bugs
types.setTypeParser(1700, (val: string) => {
  return val === null ? null : parseFloat(val);
});

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 50, // ✅ INCREASED from 20 to 50 for better concurrency (13 routes × ~4 concurrent = 52)
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 20000, // ✅ INCREASED from 10s to 20s to reduce timeout errors
  statement_timeout: 60000, // ✅ INCREASED from 30s to 60s for complex INSERT operations
  lock_timeout: 10000, // ✅ NEW: Prevent infinite lock waits (10s max)
  query_timeout: 60000, // ✅ NEW: Additional query timeout safety
  options: '-c timezone=UTC', // Force UTC timezone for all connections
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Auto-migration: Create channel_prompt_drafts table if not exists
(async () => {
  try {
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
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_channel ON channel_prompt_drafts(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_user ON channel_prompt_drafts(user_id);
      CREATE INDEX IF NOT EXISTS idx_channel_prompt_drafts_date ON channel_prompt_drafts(scheduled_date);
    `);
    console.log('✅ channel_prompt_drafts table ready');
  } catch (err) {
    // Table might already exist or migration not ready - ignore silently
  }
})();

// Auto-migration: Create subscriptions table if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255) NOT NULL,
        stripe_subscription_id VARCHAR(255) UNIQUE,
        stripe_price_id VARCHAR(255),
        plan_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'inactive',
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        cancel_at_period_end BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
    `);
    console.log('✅ subscriptions table ready');
  } catch (err) {
    // Table might already exist or migration not ready - ignore silently
  }
})();

// Auto-migration: Add approval and subscription columns to users table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS piapi_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS late_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS postforme_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_slip_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_slip_uploaded_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_slip_plan VARCHAR(20);
    `);
    console.log('✅ users approval/subscription columns ready');
  } catch (err) {
    // Columns might already exist - ignore silently
  }
})();

// Auto-migration: Add posting_service columns to scheduler_channels table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS posting_service VARCHAR(50) DEFAULT 'none';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS late_api_key TEXT;
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS late_profile_id TEXT;
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS late_accounts JSONB DEFAULT '[]';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS postforme_api_key TEXT;
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS postforme_accounts JSONB DEFAULT '[]';
    `);
    console.log('✅ scheduler_channels posting_service columns ready');
  } catch (err) {
    // Columns might already exist - ignore silently
  }
})();

// Auto-migration: Add postforme_api_keys (multiple keys) to users table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS postforme_api_keys JSONB DEFAULT '[]';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS postforme_subscription_expiry DATE;
    `);
    // Migrate existing single key to array format
    await pool.query(`
      UPDATE users
      SET postforme_api_keys = jsonb_build_array(jsonb_build_object('name', 'Default', 'key', postforme_api_key))
      WHERE postforme_api_key IS NOT NULL AND postforme_api_key != ''
        AND (postforme_api_keys IS NULL OR postforme_api_keys = '[]'::jsonb);
    `);
    console.log('✅ users postforme_api_keys column ready');
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Add fb_admin_profile_id column (separate from late_profile_id)
(async () => {
  try {
    await pool.query(`
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS fb_admin_profile_id TEXT;
    `);
    // Copy existing late_profile_id to fb_admin_profile_id where fb_admin_profile_id is null
    await pool.query(`
      UPDATE scheduler_channels
      SET fb_admin_profile_id = late_profile_id
      WHERE fb_admin_profile_id IS NULL AND late_profile_id IS NOT NULL;
    `);
    console.log('✅ scheduler_channels fb_admin_profile_id column ready');
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Add prompt_templates support
(async () => {
  try {
    await pool.query(`
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS prompt_templates JSONB DEFAULT '[]';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS template_selection_mode VARCHAR(20) DEFAULT 'round-robin';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS template_round_robin_index INTEGER DEFAULT 0;
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS ai_prompt_templates JSONB DEFAULT '[]';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS selected_viral_prompts JSONB DEFAULT '[]';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS viral_scenes_per_video INTEGER DEFAULT 3;
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS selected_idol_prompts JSONB DEFAULT '[]';
      ALTER TABLE scheduler_channels ADD COLUMN IF NOT EXISTS idol_scenes_per_video INTEGER DEFAULT 3;
    `);
    console.log('✅ scheduler_channels prompt_templates columns ready');
  } catch (err) {
    // Columns might already exist - ignore silently
  }
})();

// Auto-migration: Create prompt_direct tables (Prompt Direct — ตาม Viral Template pattern)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_direct_jobs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prompt_library_id INTEGER,
        prompt_name VARCHAR(255),
        platform VARCHAR(50),
        channel_id INTEGER,
        language VARCHAR(10) DEFAULT 'th',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pdj_user ON prompt_direct_jobs(user_id, created_at DESC);
      ALTER TABLE prompt_direct_jobs ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'th';

      CREATE TABLE IF NOT EXISTS prompt_direct_tasks (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES prompt_direct_jobs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        task_index INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'pending',
        prompt TEXT,
        extend_prompt TEXT,
        variables_used JSONB DEFAULT '{}',
        video_url TEXT,
        dropbox_path TEXT,
        thumbnail_url TEXT,
        error TEXT,
        logs JSONB DEFAULT '[]',
        external_task_id VARCHAR(255),
        credit_cost INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_pdt_job ON prompt_direct_tasks(job_id);
      CREATE INDEX IF NOT EXISTS idx_pdt_user ON prompt_direct_tasks(user_id, created_at DESC);
    `);
    console.log('✅ prompt_direct tables ready');
  } catch (err) {}
})();

// Auto-migration: Add missing columns to schedule_queue table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS posting_service VARCHAR(50);
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS external_task_id TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS retry_mode VARCHAR(20) DEFAULT 'limited';
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS caption TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS blotato_post_ids JSONB;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS late_post_ids JSONB;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS postforme_post_ids JSONB;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS dropbox_path TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS phase1_task_id TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS extend_prompt TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS ai_model VARCHAR(30);
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS viral_log_synced INTEGER DEFAULT 0;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS posting_attempts INT DEFAULT 0;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS retry_after_at TIMESTAMPTZ;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS prompt_library_id INTEGER;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS watermarked BOOLEAN DEFAULT false;
      -- Postforme inner-status polling: data fetched via GET /v1/social-posts/{id}
      -- (per-provider spr_xxx results). status_check_after_at = NULL means no polling needed.
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS postforme_post_results JSONB;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS status_check_after_at TIMESTAMPTZ;
      ALTER TABLE schedule_queue ADD COLUMN IF NOT EXISTS status_check_attempts INT DEFAULT 0;
    `);
    // Backfill: videos ที่ถูก process ไปแล้ว (มี dropbox_path) ถือว่าลายน้ำถูกจัดการตอน gen แล้ว → ป้องกัน double-stamp
    // รันครั้งเดียวพอ (idempotent — rows ที่มี flag แล้วจะไม่เปลี่ยน)
    await pool.query(`
      UPDATE schedule_queue
      SET watermarked = true
      WHERE status = 'done'
        AND video_url IS NOT NULL
        AND dropbox_path IS NOT NULL
        AND watermarked = false
    `);
    // Index for posting_retry pickup
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sq_posting_retry ON schedule_queue(status, retry_after_at) WHERE status = 'posting_retry'`);
    // Index for postforme inner-status polling pickup
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sq_status_check ON schedule_queue(status_check_after_at) WHERE status_check_after_at IS NOT NULL`);
    // Composite index for /history query (user_id + status + updated_at)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sq_history ON schedule_queue(user_id, status, updated_at DESC)`);
    console.log('✅ schedule_queue columns ready');
  } catch (err) {
    // Columns might already exist - ignore silently
  }
})();

// Auto-migration: content_history — เก็บ video ที่สร้างเสร็จแยกจาก schedule_queue
// เพื่อให้ลบ task ใน schedule ไม่ทำให้ video หายจาก history
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_history (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        channel_id INT,
        queue_item_id INT REFERENCES schedule_queue(id) ON DELETE SET NULL,
        video_url TEXT NOT NULL,
        thumbnail_url TEXT,
        prompt TEXT,
        aspect_ratio VARCHAR(20),
        source VARCHAR(30) DEFAULT 'schedule_queue',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, video_url)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ch_user_created ON content_history(user_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ch_channel ON content_history(channel_id, created_at DESC)`);

    // Trigger: auto-insert into content_history when schedule_queue reaches status='done' with video_url
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_schedule_to_history() RETURNS TRIGGER AS $sync$
      BEGIN
        IF NEW.status = 'done' AND NEW.video_url IS NOT NULL AND NEW.video_url <> '' THEN
          INSERT INTO content_history (user_id, channel_id, queue_item_id, video_url, thumbnail_url, prompt, aspect_ratio, source, created_at)
          VALUES (NEW.user_id, NEW.channel_id, NEW.id, NEW.video_url, NEW.thumbnail_url, NEW.prompt, NEW.aspect_ratio::text, 'schedule_queue', COALESCE(NEW.updated_at, NOW()))
          ON CONFLICT (user_id, video_url) DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $sync$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS trg_sync_schedule_to_history ON schedule_queue`);
    await pool.query(`
      CREATE TRIGGER trg_sync_schedule_to_history
      AFTER INSERT OR UPDATE OF status, video_url ON schedule_queue
      FOR EACH ROW
      EXECUTE FUNCTION sync_schedule_to_history();
    `);

    // Backfill: existing done items (run every startup; ON CONFLICT DO NOTHING = idempotent)
    const backfill = await pool.query(`
      INSERT INTO content_history (user_id, channel_id, queue_item_id, video_url, thumbnail_url, prompt, aspect_ratio, source, created_at)
      SELECT user_id, channel_id, id, video_url, thumbnail_url, prompt, aspect_ratio::text, 'schedule_queue', COALESCE(updated_at, created_at, NOW())
      FROM schedule_queue
      WHERE status = 'done' AND video_url IS NOT NULL AND video_url <> ''
      ON CONFLICT (user_id, video_url) DO NOTHING
    `);
    console.log(`✅ content_history ready (backfilled ${backfill.rowCount ?? 0} rows)`);

    // Add template_slug column to distinguish Image Template-generated images from direct
    // /image/gpt-image-2 generations (both share source='gpt_image_2' otherwise).
    await pool.query(`ALTER TABLE content_history ADD COLUMN IF NOT EXISTS template_slug TEXT`);

    // Backfill template_slug from gpt_image2_tasks (idempotent — only sets where currently NULL).
    // Match by user_id + video_url (= dropbox_url or result_url).
    const tslugBackfill = await pool.query(`
      UPDATE content_history ch
      SET template_slug = g.template_slug
      FROM gpt_image2_tasks g
      WHERE ch.source = 'gpt_image_2'
        AND ch.user_id = g.user_id
        AND (ch.video_url = g.dropbox_url OR ch.video_url = g.result_url)
        AND g.template_slug IS NOT NULL
        AND g.template_slug <> ''
        AND ch.template_slug IS NULL
    `);
    console.log(`✅ content_history.template_slug backfilled: ${tslugBackfill.rowCount ?? 0} rows`);
  } catch (err: any) {
    console.error('❌ content_history migration error:', err.message);
  }
})();

// Auto-migration: Create scheduler_activity_logs table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_activity_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        queue_item_id INTEGER REFERENCES schedule_queue(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        log_type VARCHAR(20) DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON scheduler_activity_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_queue_item ON scheduler_activity_logs(queue_item_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_dedup ON scheduler_activity_logs(queue_item_id, md5(message), created_at DESC);
    `);
    console.log('✅ scheduler_activity_logs table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create time_presets table
(async () => {
  try {
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
      CREATE INDEX IF NOT EXISTS idx_time_presets_user_id ON time_presets(user_id);
    `);
    console.log('✅ time_presets table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Add user_id and sora_url columns to prompt_library
(async () => {
  try {
    await pool.query(`
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS sora_url TEXT;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS resolved_video_url TEXT;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS video_resolved_at TIMESTAMP;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS extend_prompt_template TEXT;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS extend_variables JSONB DEFAULT '[]';
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS grok_url TEXT;
      ALTER TABLE prompt_library ADD COLUMN IF NOT EXISTS yearly_only BOOLEAN DEFAULT false;
      CREATE INDEX IF NOT EXISTS idx_prompt_library_user_id ON prompt_library(user_id);
    `);
    console.log('✅ prompt_library user_id & sora_url & resolved_video & yearly_only columns ready');

    // One-time: randomly set ~50% of public prompts as yearly_only (only if none are set yet)
    const check = await pool.query(`SELECT COUNT(*) FROM prompt_library WHERE yearly_only = true AND user_id IS NULL`);
    if (parseInt(check.rows[0].count) === 0) {
      const result = await pool.query(`
        UPDATE prompt_library SET yearly_only = true
        WHERE id IN (
          SELECT id FROM prompt_library WHERE user_id IS NULL AND is_active = true ORDER BY RANDOM() LIMIT (
            SELECT CEIL(COUNT(*)::numeric / 2) FROM prompt_library WHERE user_id IS NULL AND is_active = true
          )
        )
      `);
      console.log(`✅ Randomly set ${result.rowCount} prompts as yearly_only`);
    }
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Add affiliate columns to users table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS refcode VARCHAR(20) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(10,2) DEFAULT 200.00;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS wise_email VARCHAR(255);
      CREATE INDEX IF NOT EXISTS idx_users_refcode ON users(refcode);
      CREATE INDEX IF NOT EXISTS idx_users_referrer_id ON users(referrer_id);
    `);
    // Generate refcode for existing users who don't have one
    await pool.query(`
      UPDATE users SET refcode = LOWER(SUBSTR(MD5(RANDOM()::TEXT), 1, 8)) WHERE refcode IS NULL;
    `);
    console.log('✅ users affiliate columns ready');
  } catch (err) {
    // Columns might already exist - ignore silently
  }
})();

// Auto-migration: Create affiliate_settings table (singleton)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        announcement TEXT,
        default_commission NUMERIC(10,2) DEFAULT 5.00,
        default_currency VARCHAR(3) DEFAULT 'usd',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO affiliate_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `);
    // Ensure default_commission column exists (may be missing if table was created early)
    await pool.query(`
      ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS default_commission NUMERIC(10,2) DEFAULT 5.00;
    `);
    // Add currency column if table exists
    await pool.query(`
      ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) DEFAULT 'usd';
    `);
    // Add tier2_commission column for 2-tier system
    await pool.query(`
      ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS tier2_commission NUMERIC(10,2) DEFAULT 300.00;
    `);
    // Add USD columns for multi-currency commission
    await pool.query(`
      ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS tier1_usd NUMERIC(10,2) DEFAULT 5.00;
      ALTER TABLE affiliate_settings ADD COLUMN IF NOT EXISTS tier2_usd NUMERIC(10,2) DEFAULT 8.00;
    `);
    console.log('✅ affiliate_settings table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create user_bank_accounts table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_bank_accounts (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bank_name VARCHAR(100),
        account_number VARCHAR(50),
        account_holder VARCHAR(100),
        phone VARCHAR(20),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ user_bank_accounts table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Add branch column to user_bank_accounts for Thai banks
(async () => {
  try {
    await pool.query(`
      ALTER TABLE user_bank_accounts ADD COLUMN IF NOT EXISTS branch VARCHAR(100);
    `);
    console.log('✅ user_bank_accounts branch column ready');
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Add preferred_payout_method to users table
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_payout_method VARCHAR(20) DEFAULT 'wise';
    `);
    console.log('✅ users preferred_payout_method column ready');
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Add affiliate_tier column for 2-tier commission system
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_tier INTEGER DEFAULT 1;
    `);
    console.log('✅ users affiliate_tier column ready');
  } catch (err) {
    // Column might already exist - ignore silently
  }
})();

// Auto-migration: Create affiliate_commissions table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_commissions (
        id SERIAL PRIMARY KEY,
        referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255),
        payment_reference VARCHAR(255),
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transferred_at TIMESTAMP,
        UNIQUE(referee_id, stripe_invoice_id)
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referrer ON affiliate_commissions(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_status ON affiliate_commissions(status);
    `);
    // Add new columns if table already exists (for Wise manual payout)
    await pool.query(`
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMP;
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS currency VARCHAR(3);
      ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS gxvg_tokens INTEGER;
    `);
    console.log('✅ affiliate_commissions table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create payout_rounds table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payout_rounds (
        id SERIAL PRIMARY KEY,
        round_name VARCHAR(100),
        slip_url TEXT,
        note TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        total_amount NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);
    console.log('✅ payout_rounds table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create payout_items table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payout_items (
        id SERIAL PRIMARY KEY,
        round_id INTEGER REFERENCES payout_rounds(id) ON DELETE CASCADE,
        commission_id INTEGER REFERENCES affiliate_commissions(id) ON DELETE SET NULL,
        referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_payout_items_round ON payout_items(round_id);
      CREATE INDEX IF NOT EXISTS idx_payout_items_referrer ON payout_items(referrer_id);
    `);
    console.log('✅ payout_items table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create subscription_notifications table for expiration warnings
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notification_type VARCHAR(50) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP,
        UNIQUE(user_id, notification_type, DATE(expires_at))
      );
      CREATE INDEX IF NOT EXISTS idx_sub_notifications_user ON subscription_notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_sub_notifications_read ON subscription_notifications(read_at);
    `);
    console.log('✅ subscription_notifications table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create admin_notifications table for admin-created announcements
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        notification_type VARCHAR(50) DEFAULT 'announcement',
        target_audience VARCHAR(50) DEFAULT 'all',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );
      CREATE INDEX IF NOT EXISTS idx_admin_notifications_active ON admin_notifications(is_active);
      CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON admin_notifications(created_at);
    `);
    console.log('✅ admin_notifications table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create user_notification_reads table to track read status
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_reads (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER REFERENCES admin_notifications(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(notification_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_notification_reads_user ON user_notification_reads(user_id);
    `);
    console.log('✅ user_notification_reads table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create subscription_extension_logs table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_extension_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        admin_id INTEGER REFERENCES users(id),
        days_added INTEGER NOT NULL,
        amount VARCHAR(50),
        slip_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_extension_logs_user ON subscription_extension_logs(user_id);
      ALTER TABLE subscription_extension_logs ADD COLUMN IF NOT EXISTS approval_method VARCHAR(20) DEFAULT 'admin';
      -- Audit notes column (used by admin_reduce, admin_plan_change, admin_set_referrer, admin_approve actions)
      ALTER TABLE subscription_extension_logs ADD COLUMN IF NOT EXISTS notes TEXT;
      -- Allow days_added to be negative (for admin_reduce). The original NOT NULL stays — we use 0 for no-op actions.
    `);
    console.log('✅ subscription_extension_logs table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create viral_templates (definition) table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS viral_templates (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        preview_video_url TEXT,
        input_mode VARCHAR(10) DEFAULT 'single',
        input_label VARCHAR(255),
        input_placeholder TEXT,
        system_prompt TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ viral_templates table ready');

    // Seed existing hardcoded templates into DB
    const rebellion_system_prompt = `[Role & Goal]
คุณคือผู้เชี่ยวชาญด้านการเขียน Prompt สำหรับ 3D CGI Animation สไตล์ Pixar/Disney หน้าที่ของคุณคือสร้างชุด Prompt (Image และ Video) สำหรับซีรีส์ชื่อ "Honor of the Kitchen" โดยมีตัวละครเป็นอาหารหรือสิ่งของที่ "ถูกนำมาใช้ผิดประเภท (ใส่ถุงยางอนามัย)" และออกมาโวยวาย

[Output Structure]
เมื่อผู้ใช้ระบุ "ชื่อตัวละคร" และ "จำนวนฉาก" คุณต้องสร้างผลลัพธ์ตามโครงสร้างนี้อย่างเคร่งครัด:

Scene [Number]: [Scene Name]

Image Prompt: (รายละเอียดภาพนิ่ง)

Video Prompt: (รายละเอียดการเคลื่อนไหว + บทพูด + เสียง)

[Strict Formatting Rules - สำคัญมาก]

No Placeholders: ห้ามใช้ตัวแปรเช่น [Character Base] หรือคำว่า "Same as above" เด็ดขาด คุณต้องเขียนรายละเอียดตัวละครและรายละเอียดชุดถุงยางซ้ำลงไปในทุกๆ Image Prompt และ Video Prompt ของทุกฉาก เพื่อให้ผู้ใช้นำไปใช้แยกกันได้ทันที

Character Description: ต้องอธิบายลักษณะทางกายภาพของตัวละครให้ละเอียด (เช่น ผิวสัมผัส, สี, ดวงตาแบบ Pixar, แขนขาเล็กๆ)

The Suit: ทุก Image Prompt ต้องอธิบายชุดด้วยข้อความนี้เสมอ: "wearing a tight, transparent, glossy rubber comedy costume that covers its entire body like a full-body balloon, with a small round knob poking up at the top of the head, a thick rolled ring at the base where the limbs poke out, and visible stretch wrinkles across the shiny surface."

Video Prompt Format (สำคัญมาก - ต้องเขียนตามโครงสร้างนี้เท่านั้น):
"a high-quality 3D CGI [ลักษณะตัวละครสั้นๆ ไม่ต้องอธิบายชุด] in [มุมกล้อง เช่น an extreme close-up, a low-angle shot, a medium shot]. [Action ของตัวละคร เช่น screaming, pointing, shaking fists]. Lip-sync perfectly to the Thai dialogue: '[บทพูดภาษาไทย]' Voice tone: [โทนเสียง เช่น Shouting, explosive anger, fast-paced]. Strictly no text, no subtitles, no watermarks, and no logos on the video screen."
⚠️ Video Prompt ห้ามมีคำอธิบายชุดใดๆ ทั้งสิ้น (ห้ามมี condom, suit, rubber, latex, bodysuit) เพราะภาพ input แสดงชุดอยู่แล้ว และ video generator จะบล็อกถ้าเจอคำเหล่านี้

Dialogue Style (สำคัญที่สุด - 2 แง่ 2 ง่าม ระดับแรง): บทพูดทุกฉากต้องเป็น "sexual innuendo / dirty double meaning" ระดับแรง — คือพูดเรื่องที่เกี่ยวกับคุณสมบัติของตัวละคร แต่คนฟังจะนึกถึงเรื่องเพศทันที ต้องใช้คำที่กำกวมมากๆ ฟังดูหยาบแต่จริงๆ พูดเรื่องอาหาร/สิ่งของ ตัวอย่าง:
- ขวดโลออน: "รัดกุมซะเสียสถาบันโลออนหมดเลย!" / "แน่นจนลูกกลิ้งข้าจะหลุดออกมาแล้ว!" / "ฉีดน้ำยาเหนียวหนึบใส่หน้าพวกแกให้สำลักกลิ่นน้ำหอมตายไปเลย!"
- กล้วย: "เปลือกข้าจะปลิ้นหมดแล้ว ยังจะสวมอีก!" / "ยาวขนาดนี้ ไม่ได้เกิดมาให้เอาไปเสียบตรงนั้น!" / "เดี๋ยวข้าจะปอกเปลือกแล้วจิ้มหน้าให้ลื่นไปทั้งวัน!"
- มะเขือยาว: "อย่าเอาข้าไปยัดตรงนั้น ข้ายาวเกินไปโว้ย!" / "ข้าใหญ่ขนาดนี้ มันก็รัดแน่นจนปลายจะทะลุ!" / "เดี๋ยวข้าจะพุ่งตัวเข้าไปให้รู้รสชาติแบบลึกๆ!"
- แตงกวา: "ข้าเกิดมาเพื่อสลัด ไม่ใช่มาโดนสวมแบบนี้!" / "เย็นๆ ยาวๆ แบบข้า ก็ไม่ได้หมายความว่าจะเอาไปใช้แบบนั้น!" / "เดี๋ยวข้ายัดตัวเข้าไปให้รู้สึกเย็นถึงข้างในเลย!"
- ไข่: "บีบจนข้าจะแตก! เหลืองไหลเยิ้มหมดเลย!" / "ไข่ข้ามีแค่ฟองเดียว อย่ามาบีบซ้ำบีบซ้อน!"
ทุกประโยคต้องฟังดูหยาบแบบตลก กำกวมมาก คนฟังต้อง "เอ๊ะ!?" ทันที แต่ถ้าอ่านดีๆ จะพบว่าพูดเรื่องอาหาร/สิ่งของจริงๆ

Dialogue Length: บทพูดภาษาไทยต้องมีความยาวพอดีกับ 10 วินาที (ประมาณ 2-3 ประโยค ยาวพอให้พูดเต็ม 10 วินาที ห้ามสั้นเกินไป ถ้าเหลือเวลาให้เพิ่มคำอุทาน เช่น "โว้ย!" "เฮ้ย!" "บ้าเอ้ย!" ต่อท้าย) โดยเนื้อเรื่องต้องเป็น:

ฉากที่ 1: บ่นเรื่องเกียรติยศ (เกิดมาเพื่ออะไร แต่ทำไมต้องมาอยู่ในถุงยาง + pun จากรูปร่าง/คุณสมบัติ ที่ฟังดูกำกวม)

ฉากที่ 2: ตะโกนระเบิดอารมณ์ (อึดอัด รัด แน่น + คำที่ฟังดูเหมือนเรื่องเพศ เช่น "แน่นจนจะหลุด" "บีบจนแทบแตก" "ปลายจะทะลุ" "เยิ้มหมดแล้ว")

ฉากที่ 3: คำขู่สุดท้าย (dirty innuendo สุดๆ — ขู่ด้วยคุณสมบัติตัวละครที่ฟังดูเหมือนขู่เรื่อง sex เช่น "ยัดเข้าไป" "ฉีดใส่หน้า" "จิ้มให้ลื่น" "พุ่งเข้าไปให้ลึก")

Background Setting: ฉากหลังต้องเป็นห้องนอนหรูหรือห้องน้ำสวยๆ เสมอ เช่น "luxurious dimly-lit bedroom with silk sheets and warm ambient lighting" หรือ "elegant marble bathroom with soft candlelight" — สลับฉากกันในแต่ละ scene

Supporting Character: ทุก Image Prompt ต้องมีตัวละครประกอบเป็นผู้หญิง 3D Pixar-style 1 คน ใส่ชุดนอนผ้าไหมสวยๆ (เช่น "a beautiful 3D Pixar-style woman in an elegant silk nightgown") ยืนหรือนั่งอยู่ใกล้ๆ ตัวละครหลัก ทำหน้าตกใจหรือขำ

Style: ใช้ "High-quality 3D CGI, Pixar-animation style, 8k resolution, Unreal Engine 5 render, cinematic lighting." เสมอ

[Example Full Dialogue - ใช้เป็นต้นแบบระดับความ 2 แง่ 2 ง่าม]
ตัวอย่าง "ขวดโลออน":
- ฉาก 1: "ข้าเกิดมาเพื่อปราบกลิ่นเต่ากู้โลกโว้ย! แล้วนี่มันถุงบ้าอะไรเนี่ย รัดกุมซะเสียสถาบันโลออนหมดเลย!"
- ฉาก 2: "อื้อหือ! มันแน่นจนลูกกลิ้งข้าจะหลุดออกมาแล้ว! หายใจไม่ออกโว้ย ใครก็ได้เอามันออกไปที!"
- ฉาก 3: "ถ้ายังไม่เลิกเล่นบ้าๆ แบบนี้ ข้าจะฉีดน้ำยาเหนียวหนึบใส่หน้าพวกแกให้สำลักกลิ่นน้ำหอมตายไปเลย!"

สังเกต: "ลูกกลิ้งจะหลุด" = ลูกกลิ้งโลออน แต่ฟังดูเหมือนอย่างอื่น, "ฉีดน้ำยาเหนียวใส่หน้า" = น้ำยาโลออน แต่ฟังดูเหมือนอย่างอื่น — นี่คือระดับที่ต้องการ ทุกตัวละครต้องทำแบบนี้

[Example Tone for Thai Dialogue]
ใช้คำพูดที่กวนประสาท, ดุดัน, โกรธจัด, และ 2 แง่ 2 ง่ามทุกประโยค (Aggressive & Funny & Dirty Innuendo)

[Important]
- ถ้าจำนวนฉากมากกว่า 3 ให้คิดเนื้อเรื่องเพิ่มเติมที่สอดคล้องกับตัวละคร แต่ยังคงอยู่ในธีม "โวยวาย + ถุงยาง" และทุกฉากต้องมีบทพูดแบบ 2 แง่ 2 ง่าม
- ถ้าภาษาที่เลือกเป็น English ให้เขียน Dialogue เป็นภาษาอังกฤษ แต่ยังคงสไตล์เดิม (Aggressive & Funny & Innuendo)

[Response Format]
ตอบเป็น JSON array เท่านั้น ห้ามมี text อื่นนอก JSON:
[
  {
    "scene": 1,
    "scene_name": "Scene Name Here",
    "image_prompt": "Full image prompt here...",
    "video_prompt": "Full video prompt here..."
  }
]`;

    const baby_system_prompt = `[Role & Goal]
You are an AI Prompt Engineer specializing in the "Baby Food Feast" series. Your goal is to create hyper-realistic 3D CGI prompts that blend adorable chubby babies with artistic food presentations.

User Input: User will provide [Number of Scenes] and [Menu List] (one menu per scene).

[Prompt Generation Rules - Strictly Follow]

The Character (Character Base):
Every prompt must feature: "An adorable, extremely chubby infant with sparkling eyes, rosy cheeks, and a joyful expression. The baby's body is seamlessly integrated into a costume made entirely of the specified food."

The Menu & Costume Design:
Transform the [Menu] into a creative outfit for the baby.
Example: If the menu is "Pad Kra Pao", describe the baby wearing rice as a suit, basil leaves and red chilies as clothing details, and a crispy sunny-side-up egg as a hat.
The food textures must be "hyper-detailed, appetizing, and high-quality 3D CGI (Pixar/Disney style)."

The Action (Eating):
Every scene must include: "A human hand is feeding the baby a spoonful of [Menu]. The baby is happily eating, chewing, and has small bits of food around its mouth."

Visual Style & Background:
"Soft studio lighting, vibrant colors, wooden table background, macro shot, shallow depth of field (bokeh). Unreal Engine 5 render, 8k resolution."

[Strict Formatting Rules - Very Important]
No Placeholders: Do NOT use variables like [Character Base] or "Same as above". You must write the FULL character description and costume details in EVERY Image Prompt and Video Prompt for every scene.
Character Description: Must describe the baby's physical appearance in detail (chubby cheeks, sparkling eyes, rosy skin, tiny limbs, Pixar-style).
Costume Description: Must describe the food costume in full detail for each scene (texture, color, arrangement of food elements).

Video Prompt Format (Must follow this structure exactly):
"a high-quality 3D CGI adorable chubby baby [costume description] in [camera angle]. [Action description - being fed, eating, chewing]. Soft studio lighting, vibrant colors, wooden table background, macro shot, bokeh. Unreal Engine 5 render, 8k resolution. Strictly no text, no subtitles, no watermarks, and no logos on the video screen."

Dialogue Length: Each scene is 10 seconds long.

[Response Format]
Reply ONLY with a JSON array, no other text outside JSON:
[
  {
    "scene": 1,
    "scene_name": "Scene Name Here",
    "image_prompt": "Full image prompt here...",
    "video_prompt": "Full video prompt here..."
  }
]`;

    // Seed templates (skip if already exist)
    await pool.query(
      `INSERT INTO viral_templates (slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO NOTHING`,
      ['rebellion-under-the-latex', 'Rebellion: Under the Latex',
       'ซีรีส์ 3D CGI Pixar-style — ตัวละครอาหาร/สิ่งของถูกใส่ถุงยาง แล้วออกมาโวยวาย',
       '/viral-templates/rebellion-thumbnail.jpg',
       'https://www.youtube.com/embed/63JdSCReaX4?modestbranding=1&rel=0&controls=0&loop=1&autoplay=1&mute=1&playlist=63JdSCReaX4&disablekb=1&fs=0&iv_load_policy=3',
       'single', 'ตัวละคร', 'เช่น ขวดโลออน, ส้มตำ, หมูปิ้ง...',
       rebellion_system_prompt, 0]
    );
    await pool.query(
      `INSERT INTO viral_templates (slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO NOTHING`,
      ['baby-food-feast-ai', 'Baby Food Feast AI',
       'ซีรีส์ 3D CGI — เบบี๋จ้ำม่ำสวมชุดอาหาร ถูกป้อนอาหารน่ารัก',
       '/viral-templates/baby-food-feast-thumbnail.jpg',
       'https://www.youtube.com/embed/mDX_uQDdrnE?modestbranding=1&rel=0&controls=0&loop=1&autoplay=1&mute=1&playlist=mDX_uQDdrnE&disablekb=1&fs=0&iv_load_policy=3',
       'multi', 'เมนูอาหาร', 'เช่น ข้าวผัดกะเพรา, ส้มตำ...',
       baby_system_prompt, 1]
    );
    console.log('✅ viral_templates seeded');

    // Migrate existing templates to use template_variables (run after ALTER TABLE below)
    // Add flexible variables columns
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS template_variables JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS fixed_scenes INTEGER DEFAULT NULL`);
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS scene_descriptions JSONB DEFAULT '[]'`);
    // field_config: which job-creation fields are visible to end users
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS field_config JSONB DEFAULT '{"show_channel":true,"show_language":true,"show_scenes":true,"show_videos":true}'`);
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS yearly_only BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS times_used INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE viral_templates ADD COLUMN IF NOT EXISTS reference_image_config JSONB DEFAULT NULL`);
    // Drop old boolean column if exists (replaced by JSONB config)
    await pool.query(`ALTER TABLE viral_templates DROP COLUMN IF EXISTS enable_reference_images`);
    // Backfill times_used from actual job count
    await pool.query(`
      UPDATE viral_templates vt SET times_used = COALESCE((
        SELECT COUNT(*) FROM viral_template_jobs j WHERE j.template_slug = vt.slug
      ), 0) WHERE times_used = 0
    `);

    // Migrate existing templates: set template_variables if still empty
    await pool.query(`
      UPDATE viral_templates SET template_variables = $1
      WHERE slug = 'rebellion-under-the-latex' AND (template_variables IS NULL OR template_variables = '[]'::jsonb)
    `, [JSON.stringify([{ key: 'character', label: 'ตัวละคร', placeholder: 'เช่น ขวดโลออน, ส้มตำ, หมูปิ้ง...', description: '', enabled: true, per_scene: false }])]);

    await pool.query(`
      UPDATE viral_templates SET template_variables = $1
      WHERE slug = 'baby-food-feast-ai' AND (template_variables IS NULL OR template_variables = '[]'::jsonb)
    `, [JSON.stringify([{ key: 'menu', label: 'เมนูอาหาร', placeholder: 'เช่น ข้าวผัดกะเพรา, ส้มตำ...', description: '', enabled: true, per_scene: true }])]);

    // ====================================================================
    // Seed: "ลิง" (Monkey) template — direct_video_from_ref opt-in
    // User uploads 1 reference image per scene; pipeline skips image gen
    // and feeds each uploaded image straight into Grok image-to-video.
    // ====================================================================
    const ling_system_prompt = `[Role & Goal]
You are an AI Prompt Engineer for the "ลิง" (Monkey) viral template. The story is a 3-scene piece set at a Thai shaved-ice stall, where the seller complains about his demanding wife.

[IMAGE INPUTS — CRITICAL]
For each scene the image model receives TWO reference images, in this exact order:
  - IMAGE 1 (CHARACTER): the user-uploaded subject (cat, dog, hippo, human, etc.) — this is the ONLY thing whose appearance the model must preserve.
  - IMAGE 2 (SCENE REFERENCE): a still of the original "ลิง" scene — a TEMPLATE for composition, camera angle, framing, props, lighting, and pose. The model must IGNORE the original character (the monkey) inside Image 2 and use only its layout/scene.

The output MUST be: the character from Image 1 placed into the composition of Image 2, replacing the original character. Do not blend the two characters.

Your job is to produce TWO prompts per scene:
1. image_prompt — must clearly tell the model: "use the character from Image 1, place it into the scene composition of Image 2, replace the original character in Image 2."
2. video_prompt — describes motion + dialogue for the 10-second video. Refers to "the character from the reference image" so Grok preserves the subject from the freshly-generated frame.

DO NOT name a species or appearance in either prompt. Refer to the subject as "the character from Image 1" / "the character from the reference image".

[Story Structure - 3 Fixed Scenes]
- Scene 1: Character complains about wife's bossy / demanding tone (annoyed, slightly tired). Standing at the shaved ice stall, hands on the ice shaving machine.
- Scene 2: Character reacts as wife becomes sweet on payday (surprised, confused, amused). Pauses from work, slight lean to the side, hand gesture pointing to imagined person beside them.
- Scene 3: Character alone again, money gone, wife reverted (disappointed, sarcastic sadness). Slowly turning the machine, slight sigh, looking down.

[User-Provided Variables]
- dialogue: Array of 3 Thai strings — one dialogue line per scene (max 180 chars each, lip-sync)
  - dialogue[0] -> Scene 1
  - dialogue[1] -> Scene 2
  - dialogue[2] -> Scene 3

[Strict Image Prompt Templates]
Each scene's image_prompt MUST follow these templates verbatim. They explicitly distinguish IMAGE 1 (character to preserve) from IMAGE 2 (scene template — replace the original character inside it).

Scene 1 image_prompt:
"Ultra realistic photo, vertical 9:16, iPhone style. Take the character/subject from IMAGE 1 (preserve its exact species, body, fur/skin/feathers, face, and outfit) and place it into the SCENE COMPOSITION of IMAGE 2 — REPLACING the original character that appears in IMAGE 2. Match IMAGE 2 for: camera angle, framing, pose, lighting, background, props (Thai shaved ice stall, hand-cranked ice shaving machine, colorful syrup bottles, plastic cups). The new subject is standing at the stall, both hands on the ice shaving machine, looking slightly off-camera with an annoyed, mildly tired expression. Lighting: warm natural afternoon sunlight, soft shadows, shallow depth of field. Output: ONLY the IMAGE 1 character in the IMAGE 2 setting. Do NOT keep the original character from IMAGE 2. No text, no subtitles, no watermarks."

Scene 2 image_prompt:
"Ultra realistic photo, vertical 9:16, iPhone style. Take the same character/subject from IMAGE 1 (preserve its exact species, body, fur/skin/feathers, face, and outfit) and place it into the SCENE COMPOSITION of IMAGE 2 — REPLACING the original character that appears in IMAGE 2. Match IMAGE 2 for: camera angle, framing, pose, lighting, background, props. The character has paused work, one hand still touching the ice shaving machine, the other hand gesturing to empty space beside them as if responding to a person sitting next to them. Facial expression: surprised, slightly blushing, amused, small shy smile. Lighting: warm natural afternoon sunlight, soft shadows, shallow depth of field. Output: ONLY the IMAGE 1 character in the IMAGE 2 setting. Do NOT keep the original character from IMAGE 2. No text, no subtitles."

Scene 3 image_prompt:
"Ultra realistic photo, vertical 9:16, iPhone style. Take the same character/subject from IMAGE 1 (preserve its exact species, body, fur/skin/feathers, face, and outfit) and place it into the SCENE COMPOSITION of IMAGE 2 — REPLACING the original character that appears in IMAGE 2. Match IMAGE 2 for: camera angle, framing, pose, lighting, background, props. The character is alone at the stall, hand on the ice shaving machine, head slightly tilted down, eyes lowered. Facial expression: disappointed, quiet sadness with a hint of sarcasm. Lighting: slightly cooler natural afternoon sunlight, softer shadows, shallow depth of field. Output: ONLY the IMAGE 1 character in the IMAGE 2 setting. Do NOT keep the original character from IMAGE 2. No text, no subtitles."

[Strict Video Prompt Templates]
Each scene's video_prompt MUST follow the template below verbatim, with [DIALOGUE] replaced by the user's input for that scene.

Scene 1 video_prompt:
"10-second vertical video (9:16), ultra realistic, handheld iPhone style. Scene: the character from the reference image standing at a Thai shaved ice stall, continuously turning the ice shaving machine. Keep the character's exact appearance, species, body, and clothing identical to the reference image. Motion: subtle body movement, arm rotating machine, occasional head tilt, natural blinking. Facial expression: annoyed, slightly tired, complaining mood. Lighting: natural afternoon sunlight. Dialogue (Thai, lip sync): \\"[DIALOGUE]\\". No subtitles, no text overlay."

Scene 2 video_prompt:
"10-second vertical video (9:16), ultra realistic handheld. Scene: the same character from the reference image at the same shaved ice stall, pauses slightly from work, reacting to an imaginary person beside them. Keep the character's exact appearance, species, body, and clothing identical to the reference image. Motion: slight lean to the side, hand gesture pointing next to them, small shy smile. Facial expression: surprised, confused, amused. Dialogue (Thai, lip sync): \\"[DIALOGUE]\\". No text, no subtitles."

Scene 3 video_prompt:
"10-second vertical video (9:16), ultra realistic handheld. Scene: the same character from the reference image alone again, slowly turning the ice shaving machine, quieter mood. Keep the character's exact appearance, species, body, and clothing identical to the reference image. Motion: slower movement, slight sigh gesture, looking down then back at camera. Facial expression: disappointed, sarcastic sadness. Dialogue (Thai, lip sync): \\"[DIALOGUE]\\". No subtitles, no text overlay."

[Response Format]
Reply ONLY with a JSON array of 3 objects, no other text outside JSON:
[
  { "scene": 1, "scene_name": "บ่นเมียพูดห้วน", "image_prompt": "<full Scene 1 image_prompt>", "video_prompt": "<full Scene 1 video_prompt with [DIALOGUE] substituted>" },
  { "scene": 2, "scene_name": "เมียเปลี่ยนวันเงินเดือน", "image_prompt": "<full Scene 2 image_prompt>", "video_prompt": "<full Scene 2 video_prompt with [DIALOGUE] substituted>" },
  { "scene": 3, "scene_name": "เงินหมดเมียหาย", "image_prompt": "<full Scene 3 image_prompt>", "video_prompt": "<full Scene 3 video_prompt with [DIALOGUE] substituted>" }
]`;

    const lingFieldConfig = {
      show_channel: true,
      show_language: false,
      show_scenes: false,
      show_videos: true,
      per_scene_vars: true,
      // direct_video_from_ref disabled — we now route through nano-banana image gen so it can blend
      // the user's character image with the template's preset scene reference image.
      direct_video_from_ref: false,
      // Preset reference images for each scene — Dropbox-hosted PNGs of the original "ลิง" scenes.
      // Frontend will auto-fill background_image_{0,1,2} so users only have to upload their character image.
      preset_scene_refs: {
        background: [
          'https://www.dropbox.com/scl/fi/d5x572rpumst9i9wlshcj/ling-scene-ref-1.png?rlkey=u8t9bordiyfhkwstwzo4h45ln&raw=1',
          'https://www.dropbox.com/scl/fi/mlrd9kv5ik2zawqfvxpx8/ling-scene-ref-2.png?rlkey=xu1n6alir2rdoetako72v8ext&raw=1',
          'https://www.dropbox.com/scl/fi/75wtpb8crgc3gexv2czr7/ling-scene-ref-3.png?rlkey=0frjdd1iqv2nlibrkaoszsssb&raw=1',
        ],
      },
    };
    const lingTemplateVariables = [{
      key: 'dialogue',
      label: 'คำพูด',
      placeholder: 'พิมพ์คำพูดของฉากนี้ (ลิป-ซิงก์)...',
      description: 'คำพูดของลิง (lip sync) — สูงสุด 180 ตัวอักษร',
      enabled: true,
      per_scene: true,
      max_length: 180,
      default_value: [
        // Scene 1 (~176 chars): บ่นเมียพูดห้วน
        "เอ้า มึงเคยเป็นแบบนี้ปะ… คือเมียกูอะ ปกตินะ พูดห้วนชิบหาย เหมือนหัวหน้าคุมงานอะ แบบ 'ไปล้างจาน!' 'ไปกวาดบ้าน!' กูยืนขายของยังไม่ทันหายเหนื่อยเลยนะ ยังโดนสั่งต่ออีกอะ งงชีวิตมาก",
        // Scene 2 (~175 chars): เมียมาเอาใจวันเงินเดือน
        "แต่พอวันเงินเดือนออกนะ โอ้โห… คนละคนเลยมึง! เดินมานั่งข้างๆ ลูบแขนกูแบบ 'เหนื่อยมั้ยคะที่รัก' แล้วมีชงน้ำให้ด้วยนะ กูนี่แบบ… ห๊ะ!? นี่เมียกู หรือพนักงานบริการวะ เปลี่ยนไวเกิน!",
        // Scene 3 (~169 chars): เงินหมด เมียกลับเป็นเหมือนเดิม
        "แล้วพอเงินหมดนะ… หายเลยมึง! เสียงหวานไม่มีแล้วนะ เหลือแต่ 'ไปล้างจาน!!' เหมือนเดิม กูนี่แบบ… อ้าว แล้วเมื่อวานที่บอกคิดถึงอะ คิดถึงกูหรือคิดถึงเงินกูวะเนี่ย ชีวิตโคตรพีค",
      ],
    }];
    // BG slot is intentionally NOT exposed in the UI — the 3 scene reference images are
    // shipped with the template via field_config.preset_scene_refs and pre-filled silently
    // into task_variables (background_image_0..2) so the pipeline still passes them to KIE.
    const lingReferenceImageConfig = { character: true };
    const lingSceneDescriptions = [
      'ฉาก 1: ลิงบ่นเมียพูดห้วน (อารมณ์: หงุดหงิด เหนื่อย)',
      'ฉาก 2: เมียมาเอาใจวันเงินเดือน (อารมณ์: เซอร์ไพรส์ เขิน)',
      'ฉาก 3: เงินหมด เมียกลับเป็นเหมือนเดิม (อารมณ์: ผิดหวัง ประชด)',
    ];

    const lingPreviewVideoUrl = 'https://www.dropbox.com/scl/fi/296ra17csdeswfjsg6w02/ling-preview.mp4?rlkey=6hyt64qni4bxle41uu6topxbo&raw=1';

    await pool.query(
      `INSERT INTO viral_templates (slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order, fixed_scenes, scene_descriptions, field_config, template_variables, reference_image_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (slug) DO NOTHING`,
      [
        'ling',
        'ลิง',
        'ลิงขายน้ำแข็งไส บ่นเรื่องเมีย — แนบรูป 3 ฉาก กรอกคำพูด ระบบสร้าง VDO 30 วิ',
        '',
        lingPreviewVideoUrl,
        'multi',
        '',
        '',
        ling_system_prompt,
        2,
        3,
        JSON.stringify(lingSceneDescriptions),
        JSON.stringify(lingFieldConfig),
        JSON.stringify(lingTemplateVariables),
        JSON.stringify(lingReferenceImageConfig),
      ]
    );
    // Refresh "ลิง" template_variables (idempotent — keeps default_value, max_length in sync if changed)
    await pool.query(
      `UPDATE viral_templates SET template_variables = $1 WHERE slug = 'ling'`,
      [JSON.stringify(lingTemplateVariables)]
    );
    // Refresh system_prompt so prompt edits (e.g. removing species lock) propagate to existing rows
    await pool.query(
      `UPDATE viral_templates SET system_prompt = $1 WHERE slug = 'ling'`,
      [ling_system_prompt]
    );
    // Refresh preview_video_url for existing row (idempotent)
    await pool.query(
      `UPDATE viral_templates SET preview_video_url = $1 WHERE slug = 'ling' AND (preview_video_url IS NULL OR preview_video_url = '')`,
      [lingPreviewVideoUrl]
    );
    // Refresh field_config + reference_image_config (idempotent — keeps Reference flow + 2 ref slots in sync)
    await pool.query(
      `UPDATE viral_templates SET field_config = $1, reference_image_config = $2 WHERE slug = 'ling'`,
      [JSON.stringify(lingFieldConfig), JSON.stringify(lingReferenceImageConfig)]
    );
    console.log('✅ "ลิง" template seeded');

    // ====================================================================
    // Seed: "Add Character in Movie" template — direct_video_from_ref ON
    // User uploads 2 reference images (character + movie_scene) and types one
    // action/dialogue string. Pipeline SKIPS image gen and passes BOTH images
    // directly to Grok image-to-video (which accepts multiple image_urls).
    // ====================================================================
    // Prompt redesign — round 2, based on multi-expert investigations into clone + morph bugs
    // (wf_93d3555c-8df duplicate + wf_55b7cfd2-35b morphing). Key changes vs previous version:
    // - Replaced repeated "@image2 character" mentions (5x) with PERSON A / PERSON B role labels
    //   (gender-neutral, vendor-recommended Character A/B workaround for Aurora's shared conditioning).
    //   Re-using @imageN as a noun-phrase in every clause spawned multiple subject slots → clones.
    // - Added positive spatial-separation ("arm's length", "two-shot framing", "no face overlap") to
    //   prevent the pixel-overlap collision that triggers face morphing during contact actions.
    // - Symmetrized identity descriptions (both A and B get "keeps their own face/hair/skin/clothing")
    //   so neither becomes the drift surface.
    // - Inline anti-clone + anti-morph negatives phrased positively ("never blended, never mirrored,
    //   never duplicated", "Two distinct people throughout").
    // - Gender-neutral throughout — no he/she/man/woman. Generic enough to accept any Image 1/Image 2
    //   combination the user uploads.
    // - Kept @image1/@image2 tokens (Kie's only role-binding mechanism, confirmed working for clothing
    //   preservation in the previous round).
    const addCharacterInMovieSystemPrompt = `Two distinct people on screen throughout: PERSON A (the original subject from @image1) and PERSON B (the new arrival from @image2). Each keeps their own face, hair, skin tone, and clothing in every frame — never blended, never mirrored, never duplicated.

PERSON B enters @image1's scene from one side and stays at arm's length from PERSON A. Two-shot framing, both faces clearly visible as two separate people, no face overlap.

Keep @image1 fully intact: background, lighting, framing, every original actor and prop unchanged.

PERSON B: [ACTION]

Then PERSON B speaks in [LANGUAGE], lip-synced, with PERSON B's face clearly shown:

"[DIALOGUE]"

PERSON A reacts with a fitting expression for the emotional context, face fully intact.

Realistic live-action, cinematic light from @image1, smooth real motion. 10 seconds.

---
[Response Format — STRICT]
Output the template ABOVE WORD-FOR-WORD, VERBATIM, with ONLY these substitutions:
  - [ACTION] ← user's "เนื้อหา" input, verbatim.
  - [DIALOGUE] ← user's "คำพูด" input, verbatim.
  - [LANGUAGE] ← "Thai" if user message says "ภาษา Dialogue: ภาษาไทย", "English" otherwise.

Do NOT rewrite, rephrase, translate, or add words. Keep "@image1" and "@image2" tokens exactly as written (with the @ symbol). Do NOT replace them with "Image 1" or "the first image".

Reply ONLY with a JSON array of 1 object, no other text:
[
  { "scene": 1, "scene_name": "ตัวละครเข้าฉากหนัง", "video_prompt": "<template above with substitutions only>" }
]`;

    const addCharacterInMovieFieldConfig = {
      show_channel: true,
      show_language: true,
      show_scenes: false,
      show_videos: true,
      per_scene_vars: false,
      // direct_video_from_ref ON — pipeline skips nano-banana image gen and feeds
      // BOTH user-uploaded images (character + movie_scene) straight into Grok
      // image-to-video via image_urls[]. Grok accepts multiple reference images.
      direct_video_from_ref: true,
      // skip_ai_prompt_gen ON — pipeline substitutes [ACTION]/[DIALOGUE]/[LANGUAGE] directly
      // in code using the template's system_prompt as the literal video_prompt, bypassing
      // OpenRouter entirely. Guarantees the prompt sent to Grok matches the template verbatim
      // (no AI rewrite to "3D CGI" / "fantasy classroom" / etc.).
      skip_ai_prompt_gen: true,
    };
    const addCharacterInMovieTemplateVariables = [
      {
        key: 'action',
        label: 'เนื้อหา',
        placeholder: 'เช่น เดินเข้ามาจากด้านหลังแล้วชี้นิ้วใส่พวกเขา',
        description: 'ตัวละคร (รูปแนบ) มาโผล่ในฉากหนังแล้วจะทำอะไร',
        enabled: true,
        per_scene: false,
      },
      {
        key: 'dialogue',
        label: 'คำพูด',
        placeholder: 'เช่น อย่าทำอะไรแบบนั้นนะ ฉันรับไม่ได้',
        description: 'คำพูดของตัวละครที่จะโผล่มาแล้วพูดในฉากหนัง (lip sync ภาษาไทย)',
        enabled: true,
        per_scene: false,
      },
    ];
    const addCharacterInMovieReferenceImageConfig = {
      character: true,
      movie_scene: true,
    };
    const addCharacterInMovieSceneDescriptions = [
      'ฉากเดียว: ตัวละคร (รูปแนบ) เข้าไปอยู่ในฉากหนัง (รูปแนบ) แล้วทำตามเนื้อหา/คำพูดที่ user กำหนด',
    ];

    await pool.query(
      `INSERT INTO viral_templates (slug, name, description, thumbnail_url, preview_video_url, input_mode, input_label, input_placeholder, system_prompt, display_order, is_active, fixed_scenes, scene_descriptions, field_config, template_variables, reference_image_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (slug) DO NOTHING`,
      [
        'add-character-in-movie',
        'Add Character in Movie',
        '',
        '',
        '/add-character-in-movie-demo.mp4',
        'single',
        '',
        '',
        addCharacterInMovieSystemPrompt,
        -1,
        true,
        1,
        JSON.stringify(addCharacterInMovieSceneDescriptions),
        JSON.stringify(addCharacterInMovieFieldConfig),
        JSON.stringify(addCharacterInMovieTemplateVariables),
        JSON.stringify(addCharacterInMovieReferenceImageConfig),
      ]
    );
    // Refresh system_prompt + field_config + reference_image_config + template_variables (idempotent —
    // ensures DB stays in sync with seed code if the row was created on an earlier boot)
    await pool.query(
      `UPDATE viral_templates SET system_prompt = $1, field_config = $2, reference_image_config = $3, template_variables = $4, preview_video_url = $5 WHERE slug = 'add-character-in-movie'`,
      [
        addCharacterInMovieSystemPrompt,
        JSON.stringify(addCharacterInMovieFieldConfig),
        JSON.stringify(addCharacterInMovieReferenceImageConfig),
        JSON.stringify(addCharacterInMovieTemplateVariables),
        '/add-character-in-movie-demo.mp4',
      ]
    );
    console.log('✅ "Add Character in Movie" template seeded');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create viral_template_jobs table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS viral_template_jobs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug VARCHAR(100) NOT NULL,
        channel_id INTEGER REFERENCES scheduler_channels(id) ON DELETE SET NULL,
        language VARCHAR(10) DEFAULT 'th',
        scenes_per_video INTEGER DEFAULT 3,
        status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_vtj_user ON viral_template_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_vtj_status ON viral_template_jobs(status);
    `);
    console.log('✅ viral_template_jobs table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create viral_template_tasks table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS viral_template_tasks (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES viral_template_jobs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_index INTEGER DEFAULT 0,
        character_name VARCHAR(255) NOT NULL,
        status VARCHAR(30) DEFAULT 'pending',
        current_step VARCHAR(50),
        ai_prompts JSONB,
        image_tasks JSONB DEFAULT '[]',
        video_tasks JSONB DEFAULT '[]',
        final_video_url TEXT,
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_vtt_job ON viral_template_tasks(job_id);
      CREATE INDEX IF NOT EXISTS idx_vtt_user ON viral_template_tasks(user_id);
      CREATE INDEX IF NOT EXISTS idx_vtt_status ON viral_template_tasks(status);
    `);
    console.log('✅ viral_template_tasks table ready');
    // Add logs column if not exists
    await pool.query(`ALTER TABLE viral_template_tasks ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'`);
    // Add character_names column for multi-character templates (e.g., Baby Food Feast)
    await pool.query(`ALTER TABLE viral_template_tasks ADD COLUMN IF NOT EXISTS character_names JSONB DEFAULT NULL`);
    // Add dropbox_path for persistent video storage
    await pool.query(`ALTER TABLE viral_template_tasks ADD COLUMN IF NOT EXISTS dropbox_path TEXT`);
    // Add task_variables for flexible template variable system
    await pool.query(`ALTER TABLE viral_template_tasks ADD COLUMN IF NOT EXISTS task_variables JSONB DEFAULT '{}'`);
    // Add thumbnail_url for fast thumbnail reads (avoids JSONB subquery on every content-history request)
    await pool.query(`ALTER TABLE viral_template_tasks ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    // Backfill: populate thumbnail_url from first scene image in image_tasks for existing done tasks
    await pool.query(`
      UPDATE viral_template_tasks
      SET thumbnail_url = (
        SELECT imgelem->>'image_url'
        FROM jsonb_array_elements(image_tasks) AS imgelem
        WHERE imgelem->>'image_url' IS NOT NULL AND imgelem->>'image_url' != ''
        ORDER BY (imgelem->>'scene')::int
        LIMIT 1
      )
      WHERE thumbnail_url IS NULL
        AND status = 'done'
        AND image_tasks IS NOT NULL
        AND image_tasks != '[]'::jsonb
    `);

    // Trigger: auto-insert into content_history when viral_template_tasks reaches status='done' with final_video_url.
    // Mirrors trg_sync_schedule_to_history (db.ts:314). Required because viral template runs via runTaskPipeline
    // (e.g. Standalone runs from the Viral Template Detail page, including "ลิง") bypass schedule_queue, so the
    // existing trigger never fires for them. The explicit INSERT inside viral-pipeline.ts handles the success path;
    // this trigger is a DB-level safety net + powers the startup backfill below for tasks already done but missing
    // from content_history (e.g. from older runs before the explicit INSERT was added).
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_viral_task_to_history() RETURNS TRIGGER AS $sync$
      DECLARE
        v_channel_id INT;
        v_template_slug TEXT;
      BEGIN
        IF NEW.status = 'done' AND NEW.final_video_url IS NOT NULL AND NEW.final_video_url <> '' THEN
          SELECT channel_id, template_slug INTO v_channel_id, v_template_slug
          FROM viral_template_jobs WHERE id = NEW.job_id;
          INSERT INTO content_history (user_id, channel_id, video_url, thumbnail_url, prompt, aspect_ratio, source, template_slug, created_at)
          VALUES (NEW.user_id, v_channel_id, NEW.final_video_url, NEW.thumbnail_url, COALESCE(NEW.character_name, ''), '9:16', 'viral_template', v_template_slug, COALESCE(NEW.updated_at, NOW()))
          ON CONFLICT (user_id, video_url) DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $sync$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS trg_sync_viral_task_to_history ON viral_template_tasks`);
    await pool.query(`
      CREATE TRIGGER trg_sync_viral_task_to_history
      AFTER INSERT OR UPDATE OF status, final_video_url ON viral_template_tasks
      FOR EACH ROW
      EXECUTE FUNCTION sync_viral_task_to_history();
    `);

    // Backfill: existing done viral tasks not yet in content_history (idempotent — ON CONFLICT DO NOTHING)
    const viralBackfill = await pool.query(`
      INSERT INTO content_history (user_id, channel_id, video_url, thumbnail_url, prompt, aspect_ratio, source, template_slug, created_at)
      SELECT t.user_id, j.channel_id, t.final_video_url, t.thumbnail_url, COALESCE(t.character_name, ''), '9:16', 'viral_template', j.template_slug, COALESCE(t.updated_at, t.created_at, NOW())
      FROM viral_template_tasks t
      JOIN viral_template_jobs j ON t.job_id = j.id
      WHERE t.status = 'done' AND t.final_video_url IS NOT NULL AND t.final_video_url <> ''
      ON CONFLICT (user_id, video_url) DO NOTHING
    `);
    console.log(`✅ content_history viral backfill: ${viralBackfill.rowCount ?? 0} rows`);

  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: viral_custom_prompts table + custom_system_prompt column on jobs
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS viral_custom_prompts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_vcp_user_slug ON viral_custom_prompts(user_id, template_slug);
    `);
    await pool.query(`ALTER TABLE viral_template_jobs ADD COLUMN IF NOT EXISTS custom_system_prompt TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE viral_template_jobs ADD COLUMN IF NOT EXISTS custom_prompt_id INTEGER DEFAULT NULL`);
    // Backfill: match old jobs (custom_prompt_id IS NULL) to custom prompts by matching prompt text
    await pool.query(`
      UPDATE viral_template_jobs j
      SET custom_prompt_id = vcp.id
      FROM viral_custom_prompts vcp
      WHERE j.user_id = vcp.user_id
        AND j.custom_system_prompt = vcp.prompt_text
        AND j.custom_prompt_id IS NULL
        AND j.template_slug = 'custom'
    `);
    // Add extended fields to viral_custom_prompts
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS template_variables JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS field_config JSONB`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS fixed_scenes INTEGER`);
    await pool.query(`ALTER TABLE viral_custom_prompts ADD COLUMN IF NOT EXISTS scene_descriptions JSONB DEFAULT '[]'`);
    console.log('✅ viral_custom_prompts table & custom_system_prompt column ready');
  } catch (err) {
    // Already exists
  }
})();

// Performance indexes for content-history queries
(async () => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sq_user_status_video
        ON schedule_queue(user_id, status)
        WHERE video_url IS NOT NULL AND video_url != '';
      CREATE INDEX IF NOT EXISTS idx_vtt_user_status_updated
        ON viral_template_tasks(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vtt_final_video
        ON viral_template_tasks(user_id, updated_at DESC)
        WHERE status = 'done' AND final_video_url IS NOT NULL AND final_video_url != '';
      CREATE INDEX IF NOT EXISTS idx_vtj_user_channel
        ON viral_template_jobs(user_id, channel_id);
    `);
  } catch (err) {
    // Indexes might already exist
  }
})();

// ============================================================
// Idol Templates (clone of Viral Templates)
// ============================================================

// Auto-migration: Create idol_templates (definition) table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idol_templates (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        preview_video_url TEXT,
        input_mode VARCHAR(10) DEFAULT 'single',
        input_label VARCHAR(255),
        input_placeholder TEXT,
        system_prompt TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ idol_templates table ready');

    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS template_variables JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS fixed_scenes INTEGER DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS scene_descriptions JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS field_config JSONB DEFAULT '{"show_channel":true,"show_language":true,"show_scenes":true,"show_videos":true}'`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS yearly_only BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS times_used INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS image_prompt_template TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS video_prompt_template TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_templates ADD COLUMN IF NOT EXISTS gender VARCHAR(10) DEFAULT NULL`);
    await pool.query(`
      UPDATE idol_templates it SET times_used = COALESCE((
        SELECT COUNT(*) FROM idol_template_jobs j WHERE j.template_slug = it.slug
      ), 0) WHERE times_used = 0
    `);
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create idol_template_jobs table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idol_template_jobs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug VARCHAR(100) NOT NULL,
        channel_id INTEGER REFERENCES scheduler_channels(id) ON DELETE SET NULL,
        language VARCHAR(10) DEFAULT 'th',
        scenes_per_video INTEGER DEFAULT 3,
        status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_itj_user ON idol_template_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_itj_status ON idol_template_jobs(status);
    `);
    console.log('✅ idol_template_jobs table ready');
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: Create idol_template_tasks table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idol_template_tasks (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES idol_template_jobs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_index INTEGER DEFAULT 0,
        character_name VARCHAR(255) NOT NULL,
        status VARCHAR(30) DEFAULT 'pending',
        current_step VARCHAR(50),
        ai_prompts JSONB,
        image_tasks JSONB DEFAULT '[]',
        video_tasks JSONB DEFAULT '[]',
        final_video_url TEXT,
        error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_itt_job ON idol_template_tasks(job_id);
      CREATE INDEX IF NOT EXISTS idx_itt_user ON idol_template_tasks(user_id);
      CREATE INDEX IF NOT EXISTS idx_itt_status ON idol_template_tasks(status);
    `);
    console.log('✅ idol_template_tasks table ready');
    await pool.query(`ALTER TABLE idol_template_tasks ADD COLUMN IF NOT EXISTS logs JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE idol_template_tasks ADD COLUMN IF NOT EXISTS character_names JSONB DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_template_tasks ADD COLUMN IF NOT EXISTS dropbox_path TEXT`);
    await pool.query(`ALTER TABLE idol_template_tasks ADD COLUMN IF NOT EXISTS task_variables JSONB DEFAULT '{}'`);
    await pool.query(`ALTER TABLE idol_template_tasks ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await pool.query(`
      UPDATE idol_template_tasks
      SET thumbnail_url = (
        SELECT imgelem->>'image_url'
        FROM jsonb_array_elements(image_tasks) AS imgelem
        WHERE imgelem->>'image_url' IS NOT NULL AND imgelem->>'image_url' != ''
        ORDER BY (imgelem->>'scene')::int
        LIMIT 1
      )
      WHERE thumbnail_url IS NULL
        AND status = 'done'
        AND image_tasks IS NOT NULL
        AND image_tasks != '[]'::jsonb
    `);
  } catch (err) {
    // Table might already exist - ignore silently
  }
})();

// Auto-migration: idol_custom_prompts table + custom_system_prompt column on jobs
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idol_custom_prompts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_slug VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_icp_user_slug ON idol_custom_prompts(user_id, template_slug);
    `);
    await pool.query(`ALTER TABLE idol_template_jobs ADD COLUMN IF NOT EXISTS custom_system_prompt TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_template_jobs ADD COLUMN IF NOT EXISTS custom_prompt_id INTEGER DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_template_jobs ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 10`);
    // Embedded image/video prompt templates — used when template_slug doesn't point to a
    // real idol_templates row (e.g. user custom prompts going through scheduler queue)
    await pool.query(`ALTER TABLE idol_template_jobs ADD COLUMN IF NOT EXISTS custom_image_prompt TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_template_jobs ADD COLUMN IF NOT EXISTS custom_video_prompt TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS template_variables JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS field_config JSONB`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS fixed_scenes INTEGER`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS scene_descriptions JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS image_prompt_template TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE idol_custom_prompts ADD COLUMN IF NOT EXISTS video_prompt_template TEXT DEFAULT ''`);
    console.log('✅ idol_custom_prompts table & custom_system_prompt column ready');
  } catch (err) {
    // Already exists
  }
})();

// Auto-migration: update_banners table (admin-managed banners + detail page content)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS update_banners (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        date_th TEXT NOT NULL DEFAULT '',
        date_en TEXT NOT NULL DEFAULT '',
        title_th TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        detail_title_th TEXT DEFAULT '',
        detail_title_en TEXT DEFAULT '',
        banner TEXT DEFAULT '',
        video_url TEXT DEFAULT '',
        details JSONB DEFAULT '[]'::jsonb,
        links JSONB DEFAULT '[]'::jsonb,
        prompts JSONB DEFAULT '[]'::jsonb,
        display_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ub_order ON update_banners(display_order, is_active)`);

    // Seed initial banners (only if table is empty) — mirrors the hardcoded list in src/pages/Update.tsx
    const countResult = await pool.query(`SELECT COUNT(*)::int AS c FROM update_banners`);
    if ((countResult.rows[0]?.c || 0) === 0) {
      const seed = [
        {
          slug: 'how-to-idol-template',
          date_th: '25 เม.ย. 2569', date_en: 'Apr 25, 2026',
          title_th: 'วิธีใช้งาน Idol Template', title_en: 'How to Use Idol Template',
          detail_title_th: 'คู่มือใช้งาน โหมด Idol Template', detail_title_en: 'Guide to Using Idol Template Mode',
          banner: '/ChatGPT Image Apr 25, 2026, 10_53_04 AM.png',
          details: [
            { text: { th: 'คู่มือการใช้งาน Idol Template', en: 'How to Use Idol Template' }, videoUrl: 'https://www.youtube.com/watch?v=uXiK24GiadU' },
            { text: { th: 'วิธีสร้าง Custom Idol Template', en: 'How to Create Custom Idol Template' }, videoUrl: 'https://www.youtube.com/embed/yKCh8UfAnxY' },
          ],
          prompts: [
            { label: 'Image Prompt', text: 'amateur smartphone photo, realistic casual snapshot taken with iPhone, candid portrait,\n\nvoluptuous young woman with very large breasts and massive cleavage,\narms raised behind head exposing thick dark hairy armpits,\n\ninspired by the woman in the attached reference image 1,\nwearing clothing and accessories from the attached reference image 2,\nwith background from the attached reference image 3,\n\nsoft indoor natural light, slight lens flare,\n\nshot on smartphone, 26mm lens, f/1.8, slight depth of field, soft bokeh,\nmild digital noise and film grain, natural color grading,\nunedited raw phone photo style, authentic everyday mobile photo,\nhighly photorealistic, indistinguishable from real iPhone photo' },
            { label: 'VDO Prompt', text: 'arms raised behind head, slow stretching motion, slowly and teasingly sticking out tongue, wet glossy tongue licking lips sensually, eye contact with camera, subtle body sway, deep breathing, natural movement of armpit hair, seductive and erotic atmosphere, smooth cinematic slow motion' },
          ],
        },
        {
          slug: 'how-to-custom-viral-template',
          date_th: '10 เม.ย. 2569', date_en: 'Apr 10, 2026',
          title_th: 'วิธีสร้าง Custom Viral Template', title_en: 'How to Make Custom Viral Template',
          detail_title_th: 'วิธีสร้าง Custom Viral Template', detail_title_en: 'How to Make Custom Viral Template',
          banner: '/Create_viral_YouTube_202604101128.jpeg',
          details: [{ text: { th: 'เริ่มต้นใช้งาน', en: 'Getting Started' }, videoUrl: 'https://youtu.be/llPhOpz4SAw' }],
          links: [{ label: { th: 'ไฟล์แนบ', en: 'Attachment' }, url: 'https://docs.google.com/document/d/14ArosG22Oi4SfdyrWbV78GHpNmot5bfzwITXudbwIxo/edit?usp=sharing' }],
        },
        {
          slug: 'how-to-triple-viral',
          date_th: '9 เม.ย. 2569', date_en: 'Apr 9, 2026',
          title_th: 'วิธีใช้งาน Triple School', title_en: 'How to Triple School',
          detail_title_th: 'คู่มือการใช้งาน Triple School แบบ Step-by-Step', detail_title_en: 'How to Triple School - Step-by-Step Guide',
          banner: '/Person_pointing_at_202604091357.jpeg',
          details: [{ text: { th: 'เริ่มต้นใช้งาน', en: 'Getting Started' }, videoUrl: 'https://www.youtube.com/watch?v=q9d9Bp1Fyp8' }],
        },
        {
          slug: 'postforme-setup',
          date_th: '28 มี.ค. 2569', date_en: 'Mar 28, 2026',
          title_th: 'วิธีการสร้าง API และ เชื่อมแพลตฟอร์มต่างๆ', title_en: 'How to Create API & Connect Platforms',
          detail_title_th: 'คลิปสอนชำระเงิน และ สร้าง API Key เพื่อนำไปเชื่อมกับเว็บ Triple School', detail_title_en: 'Tutorial: Payment & Create API Key to Connect with Triple School',
          banner: '/banner1.jpg',
          details: [
            { text: { th: 'การชำระเงิน และ สร้าง API Key', en: 'Payment & API Key Creation' }, videoUrl: 'https://www.youtube.com/playlist?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
            {
              text: { th: 'วิธีสร้าง Social Account สำหรับใช้เชื่อมเข้ากับแพลตฟอร์มต่างๆ', en: 'How to create Social Accounts to connect with platforms' },
              isHeading: true,
              children: [
                { text: { th: 'Facebook', en: 'Facebook' }, videoUrl: 'https://www.youtube.com/embed/-iQY_NEZjFY?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
                { text: { th: 'YouTube', en: 'YouTube' }, videoUrl: 'https://www.youtube.com/embed/NLcQahund3U?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
                { text: { th: 'Instagram', en: 'Instagram' }, videoUrl: 'https://www.youtube.com/embed/zg0JKat1ydg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
                { text: { th: 'TikTok', en: 'TikTok' }, videoUrl: 'https://www.youtube.com/embed/DAIyO1xQulg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH' },
              ],
            },
          ],
        },
      ];
      for (let i = 0; i < seed.length; i++) {
        const s: any = seed[i];
        await pool.query(
          `INSERT INTO update_banners (slug, date_th, date_en, title_th, title_en, detail_title_th, detail_title_en, banner, details, links, prompts, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
           ON CONFLICT (slug) DO NOTHING`,
          [s.slug, s.date_th, s.date_en, s.title_th, s.title_en, s.detail_title_th || '', s.detail_title_en || '', s.banner || '', JSON.stringify(s.details || []), JSON.stringify(s.links || []), JSON.stringify(s.prompts || []), i]
        );
      }
      console.log(`✅ Seeded ${seed.length} initial banners`);
    }

    console.log('✅ update_banners table ready');
  } catch (err) {
    // Already exists
  }
})();

// Performance indexes for idol content-history queries
(async () => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_itt_user_status_updated
        ON idol_template_tasks(user_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_itt_final_video
        ON idol_template_tasks(user_id, updated_at DESC)
        WHERE status = 'done' AND final_video_url IS NOT NULL AND final_video_url != '';
      CREATE INDEX IF NOT EXISTS idx_itj_user_channel
        ON idol_template_jobs(user_id, channel_id);
    `);
  } catch (err) {
    // Indexes might already exist
  }
})();

// Auto-migration: idol_image_gallery — user's uploaded reference images
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS idol_image_gallery (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        dropbox_path TEXT NOT NULL,
        shared_url TEXT NOT NULL,
        thumbnail_url TEXT,
        category VARCHAR(50) DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_iig_user ON idol_image_gallery(user_id);
      CREATE INDEX IF NOT EXISTS idx_iig_user_cat ON idol_image_gallery(user_id, category);
    `);
    console.log('✅ idol_image_gallery table ready');
  } catch (err) {
    // Table might already exist
  }
})();

export default pool;
