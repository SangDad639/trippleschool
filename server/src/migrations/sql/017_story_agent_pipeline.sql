-- 017_story_agent_pipeline.sql
-- AI Agent pipeline: idea → script → voice → storyboard → scene image → scene video → assemble → post
--
-- One parent row per user job (a "clip"), one child row per scene (1 line of script = 1 scene = ~6s video).
-- The orchestrator job (storyAgentRunnerJob.ts) reads parent.current_stage + scene statuses to advance.

CREATE TABLE IF NOT EXISTS story_agent_jobs (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      INT,

  -- User inputs
  topic           TEXT NOT NULL,
  duration_sec    INT NOT NULL,
  tone            TEXT,                       -- e.g. 'dramatic', 'inspirational', 'horror'
  language        TEXT NOT NULL DEFAULT 'th', -- 'th' | 'en'
  scene_count     INT NOT NULL,               -- round(duration_sec/6), clamped [5,30]

  -- Pipeline state machine
  current_stage   TEXT NOT NULL DEFAULT 'idea',
                  -- 'idea' | 'script' | 'voice' | 'storyboard' | 'scene_image'
                  -- | 'scene_video' | 'assemble' | 'post' | 'done' | 'failed'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'running' | 'success' | 'failed'

  -- Stage outputs (JSONB so we can evolve without migrations)
  idea_json       JSONB,                      -- { title, hook, premise, three_acts: {...} }
  script_json     JSONB,                      -- { lines: [{ scene, text }] }
  storyboard_json JSONB,                      -- { style_bible, scenes: [{ scene, prompt_en, panel_th }] }

  -- Final outputs
  final_video_url TEXT,                       -- assembled clip (Dropbox or KIE URL)
  caption_fb      TEXT,
  caption_tt      TEXT,
  post_results    JSONB,                      -- { facebook: { post_id, url }, tiktok: { ... } }

  -- Bookkeeping
  error           TEXT,
  logs            JSONB DEFAULT '[]'::jsonb,  -- [{ time, emoji, text }]
  retry_count     INT DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_agent_jobs_user
  ON story_agent_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_agent_jobs_status
  ON story_agent_jobs(status, current_stage)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS story_agent_scenes (
  id              SERIAL PRIMARY KEY,
  job_id          INT NOT NULL REFERENCES story_agent_jobs(id) ON DELETE CASCADE,
  scene_number    INT NOT NULL,             -- 1..scene_count
  script_text     TEXT NOT NULL,            -- the narration line for this scene
  image_prompt    TEXT,                     -- EN prompt for kie.ai gpt-image-2
  panel_desc_th   TEXT,                     -- TH description (for UI display)

  -- Voice (Stage 3)
  voice_url       TEXT,
  voice_duration  REAL,                     -- actual TTS duration in seconds

  -- Image (Stage 5)
  image_kie_task_id TEXT,
  image_url         TEXT,
  image_status      TEXT DEFAULT 'pending', -- 'pending' | 'running' | 'success' | 'failed'

  -- Video (Stage 6)
  video_kie_task_id TEXT,
  video_url         TEXT,
  video_status      TEXT DEFAULT 'pending',

  error           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(job_id, scene_number)
);

CREATE INDEX IF NOT EXISTS idx_story_agent_scenes_job
  ON story_agent_scenes(job_id, scene_number);

-- Per-user API keys (BYO model) for the AI Agent pipeline.
-- Anthropic = LLM brain. ElevenLabs = TTS. KIE + PostForMe already in users table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_voice_id_th TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS elevenlabs_voice_id_en TEXT;
