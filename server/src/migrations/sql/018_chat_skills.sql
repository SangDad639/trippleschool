-- 018_chat_skills.sql
-- Chat-based AI Agent: per-user skills (markdown recipes) + chat threads.
--
-- Skills are markdown documents (frontmatter + body) that encode a clip style:
--   - frontmatter = structured pipeline parameters (scene_count, voice settings, etc.)
--   - body        = LLM-readable instructions injected as system prompt prefix
--
-- A chat thread holds the conversation between user and the AI agent, with
-- a set of active skills that shape the agent's behavior.

CREATE TABLE IF NOT EXISTS skill_templates (
  id              SERIAL PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,
  category        TEXT NOT NULL,                 -- 'storytelling' | 'product' | 'general' | ...
  description     TEXT NOT NULL,
  content_md      TEXT NOT NULL,                 -- full markdown (frontmatter + body)
  preview_image_url TEXT,
  is_featured     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_skills (
  id                 SERIAL PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  content_md         TEXT NOT NULL,
  frontmatter        JSONB,                       -- parsed cache for fast query
  trigger_keywords   TEXT[],                      -- for suggest-skill matching
  source_template_id INT REFERENCES skill_templates(id),
  is_default         BOOLEAN DEFAULT FALSE,       -- auto-active when starting a new thread
  use_count          INT DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_skills_keywords ON user_skills USING GIN (trigger_keywords);

CREATE TABLE IF NOT EXISTS chat_threads (
  id                SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,                          -- auto-gen from first user message
  active_skill_ids  INT[] DEFAULT '{}',            -- skills loaded into system prompt
  messages          JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_job_id     INT REFERENCES story_agent_jobs(id) ON DELETE SET NULL,
  total_input_tokens  INT DEFAULT 0,
  total_output_tokens INT DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id, updated_at DESC);

-- ============================================================================
-- Seed 3 starter templates (idempotent via ON CONFLICT DO NOTHING).
-- ============================================================================

INSERT INTO skill_templates (name, category, description, content_md, is_featured) VALUES
('มหาพุทธคุณ-style', 'storytelling',
 'คลิปตำนานพระเครื่อง 90 วินาที — Hook 3 ชั้น + เคสปาฏิหาริย์ 3 + วลีติดหู repeat',
$SKILLMD$---
name: มหาพุทธคุณ-style
description: คลิปตำนานพระเครื่อง 90 วินาที — Hook 3 ชั้น + เคสปาฏิหาริย์ 3 + วลีติดหู repeat
trigger_keywords:
  - ตำนาน
  - หลวงพ่อ
  - หลวงปู่
  - ตะกรุด
  - เครื่องราง
  - ยันต์
  - คาถา
  - พระเครื่อง

scene_count: 15
scene_duration_sec: 6
aspect_ratio: 9:16
language: th

stages:
  voice:
    timing_gate_max_sec: 6
    max_rewrites_per_line: 3
  scene_image:
    style: cinematic-realistic
    resolution: 1K
  scene_video:
    duration_sec: 6

gates:
  min_specifics: 3
  require_catchphrase: true
  require_direct_quote: true
  require_disclaimer_line: true
---

# คำแนะนำการเขียนบท (15 ฉาก × 6 วินาที = ~90 วินาที)

## โครงสร้างบังคับ 15 ฉาก

| ส่วน | ฉาก | หน้าที่ |
|------|-----|---------|
| HOOK 3 ชั้น | 1 | ภาพช็อกที่ 1 — quote/ภาพปาฏิหาริย์ที่เห็นภาพชัดสุด |
|              | 2 | ภาพช็อกที่ 2 — เคสซ้ำ คนละมุม (ตอกย้ำว่าไม่บังเอิญ) |
|              | 3 | วลีติดหู — สรุปพุทธคุณเป็นวลีติดปาก |
| เฉลย + Setup | 4 | เฉลยตัวเอก (ชื่อพระ + วัตถุมงคล + วัด) |
|              | 5 | ยุค/สถานที่/บริบทประวัติศาสตร์ (ระบุปี-สงคราม-จังหวัด) |
|              | 6 | ขนาด/วัสดุ/พิธีปลุกเสก/คาถา (ใส่ตัวเลขเฉพาะ) |
| เคสปาฏิหาริย์ 1 | 7 | เปิดเคส 1 + sensory detail |
|              | 8 | จุดพีคเคส 1 — direct quote หรือคาถา |
| เคสปาฏิหาริย์ 2 | 9 | Stack เคส 2 — เหตุการณ์คนละแบบ (เชื่อมด้วย "อีกเรื่องเล่ากันว่า...") |
|              | 10 | พีคเคส 2 |
| เคสปาฏิหาริย์ 3 / Climax | 11 | Stack เคส 3 หรือ climax (เชื่อมด้วย "ที่น่าขนลุกที่สุด...") |
|              | 12 | วลีติดหู repeat + ปิดวงล้อม |
| คำถามเปิด | 13 | "บังเอิญ หรือพุทธคุณคุ้มครองจริง?" |
| ปิด CTA | 14 | ล่อคอมเมนต์เป็นโพล + "โปรดใช้วิจารณญาณ" |
|              | 15 | กดติดตามช่อง |

## Checklist บังคับ 8 ข้อ (ต้องผ่านครบก่อนส่งต่อ voice stage)

### ปังเช็ค 5 ข้อ
1. Hook 3 ชั้น — บรรทัด 1-3 ซ้อนชั้น ไม่ใช่ hook บรรทัดเดียว
2. เคสปาฏิหาริย์ ≥ 2 เคส — stack เหตุการณ์คนละแบบ
3. Direct quote ≥ 1 — คำพูดของพระ พยาน หรือคาถา ในเครื่องหมายอัญประกาศ
4. ชื่อเฉพาะ/ตัวเลข ≥ 3 จุด (เช่น "หน้าตัก 5 นิ้ว" "สงครามอินโดจีน")
5. วลีติดหู repeat — มี 1 วลีที่ปรากฏ 2 ครั้ง (บรรทัด 3 + 12)

### ฟลูเช็ค 3 ข้อ (สำคัญมาก — ป้องกัน "ฟังแล้วขัดๆ ติดๆ")
6. Run-on across line breaks ≥ 1 คู่ — บรรทัด N จบไม่สมบูรณ์ → บรรทัด N+1 ต่อเป็นประโยคเดียวกัน
7. Temporal/causal connectives ระหว่างเคส — "ในเวลาไล่เลี่ยกัน" / "ไม่กี่วันถัดมา" / "ที่น่าขนลุกที่สุด"
8. ห้ามขึ้นต้นด้วยประธานใหม่ทุกบรรทัด — ใช้สรรพนามหรือ anaphora ("ท่าน" / "เขา" แทน "หลวงพ่อทบ")

## ความยาวแต่ละบรรทัด

- เป้าหมาย ~50-62 ตัวอักษรไทย/บรรทัด (~4.5-5.3 วินาที)
- ห้ามเกิน 70 ตัวอักษร (เพดาน ~6 วินาที)
- อัตราพูด ภาษาไทย ≈ 12 ตัวอักษร/วินาที

## ตัวอย่าง Hook 3 ชั้น

**ลิงจับหลัก หลวงพ่อดิ่ง วัดบางวัว:**
1. "กระสุนเจาะเสื้อ แต่เนื้อหนังกลับไม่มีแม้รอยขีด"
2. ระเบิดตกห่างไม่กี่ก้าว ทุกคนรอบตัวสิ้นชีพ เหลือคนเดียวเดินออกมา
3. "แมลงวันไม่ได้กินเลือด มัจจุราชยังเมิน" — วลีของผู้พกเครื่องรางนี้

## หลักการเขียน

- เขียนเพื่อ **"ฟัง"** ไม่ใช่ "อ่าน" — ประโยคสั้น พูดแล้วลื่น
- ใช้คำที่ **เห็นภาพ** — sensory: เสียง / ภาพ / สัมผัส
- จังหวะสลับ เร็ว-ช้า เพื่อสร้าง tension
- เล่าในฐานะ **"เรื่องเล่า / ตำนาน"** — "เล่ากันว่า" "ตามตำนาน"
- บรรทัด 14 ต้องมี **"โปรดใช้วิจารณญาณ"** เสมอ

# คำแนะนำสร้างภาพสตอรีบอร์ด

- สไตล์ภาพ: cinematic semi-realistic digital painting, ฉากสมัยเก่า (ไทยโบราณ / สงครามเวียดนาม / วัดเก่าแก่)
- โทนสี: dark warm tones, candlelight + dust particles, slight film grain
- บังคับมี character continuity — พระเถระคนเดิม, วัตถุมงคลชิ้นเดิม ในทุกฉากที่เกี่ยวข้อง
- ห้ามมีตัวอักษร/watermark ในภาพ
- ภาพแนวตั้ง 9:16 — focal subject ชัด 1 จุดต่อฉาก

# คำแนะนำเขียน Caption

- Facebook: 2-3 ประโยค hook + emoji 1-2 ตัว + CTA + hashtag 3-5 ตัว
- TikTok: 1 ประโยคปัง + hashtag inline 5-7 ตัว
- หลีกเลี่ยงคำการันตี ("รวยแน่นอน" "รักษาโรคได้") — ใช้ "เล่ากันว่า" / "ตามตำนาน" แทน
$SKILLMD$,
TRUE),

('general-storyteller', 'general',
 'คลิปเล่าเรื่องสั้น universal — ใช้ได้ทุกหัวข้อ ไม่ผูก genre',
$SKILLMD$---
name: general-storyteller
description: คลิปเล่าเรื่องสั้น universal — ใช้ได้ทุกหัวข้อ
trigger_keywords: []

scene_count: 10
scene_duration_sec: 6
aspect_ratio: 9:16
language: th

stages:
  voice:
    timing_gate_max_sec: 6
    max_rewrites_per_line: 2
  scene_image:
    style: cinematic
    resolution: 1K
  scene_video:
    duration_sec: 6

gates:
  require_catchphrase: false
  require_direct_quote: false
---

# คำแนะนำการเขียนบท

## โครงสร้างทั่วไป (10 ฉาก)

| ส่วน | ฉาก | หน้าที่ |
|------|-----|---------|
| Hook | 1-2 | เปิดด้วยภาพ/ประโยคที่ตรึงคนดูใน 5 วินาที |
| Setup | 3-4 | ปูบริบท — ใคร ที่ไหน เกิดอะไร |
| Build-up | 5-7 | ไต่ระดับ — เพิ่ม tension หรือ curiosity |
| Climax / Reveal | 8 | จุดพีค — เฉลย / หักมุม / จุดสะเทือนอารมณ์ |
| Closing | 9 | สรุป / take-away |
| CTA | 10 | กดติดตาม / comment / share |

## หลักการเขียน

- เขียนภาษาไทยลื่น ประโยคสั้น
- ~50-62 ตัวอักษรไทย/บรรทัด (~4.5-5.3 วินาที)
- ห้ามเกิน 70 ตัวอักษร
- แต่ละบรรทัดวาดเป็นฉากเดียวได้
- ใช้ภาษาเห็นภาพ มี sensory detail
- จบบรรทัดให้ "จบความ" ในตัว ไม่ห้อยค้าง
$SKILLMD$,
TRUE),

('product-showcase', 'product',
 'คลิปแนะนำสินค้า 30-45 วินาที — ไม่มี narrator ใช้ text overlay + energetic music',
$SKILLMD$---
name: product-showcase
description: คลิปแนะนำสินค้า 30-45 วินาที — text overlay, no narrator, energetic
trigger_keywords:
  - สินค้า
  - product
  - แนะนำ
  - รีวิว
  - ขาย

scene_count: 6
scene_duration_sec: 5
aspect_ratio: 9:16
language: th

stages:
  voice:
    enabled: false
  scene_image:
    style: clean-product-shot
    resolution: 1K
  scene_video:
    duration_sec: 5
  assemble:
    overlay_text_per_scene: true
    background_music: energetic

gates:
  require_product_name: true
  require_cta: true
---

# คำแนะนำการเขียนสคริปต์

## โครงสร้าง (6 ฉาก × 5 วินาที = 30 วินาที)

| ฉาก | หน้าที่ |
|-----|---------|
| 1 | Hook: ปัญหาที่สินค้าแก้ได้ (เห็นภาพชัด — ก่อนใช้) |
| 2 | แนะนำสินค้า — ชื่อ + close-up |
| 3 | Feature เด่น 1 (visual demo) |
| 4 | Feature เด่น 2 หรือ benefit |
| 5 | Social proof / use case |
| 6 | CTA — ราคา + ลิงก์ / โค้ดส่วนลด |

## หลักการ

- ไม่มี narrator — ใช้ **text overlay** สั้นๆ ต่อฉาก (≤8 คำ)
- ภาพชัด สว่าง — product-shot style
- ตัดเร็ว (5 วินาที/ฉาก)
- ดนตรี energetic ตลอด
- ห้ามแนะนำเกินจริง (ไม่ใช่คำว่า "ดีที่สุด" "อันดับ 1")

## ตัวอย่าง text overlay

ฉาก 1: "เหนื่อยมั้ย? นั่งหน้าคอมทั้งวัน"
ฉาก 2: "หูฟัง XYZ ใหม่"
ฉาก 3: "Noise cancel ระดับเรือดำน้ำ"
ฉาก 4: "แบต 30 ชั่วโมง"
ฉาก 5: "5,000+ คนใช้แล้ว"
ฉาก 6: "ลด 30% — กดลิงก์ใต้คลิป"

# คำแนะนำสร้างภาพ

- product-shot สะอาด พื้นหลังสีพาสเทล / studio lighting
- close-up เน้นรายละเอียดสินค้า
- ห้ามมี text/logo ในภาพ (text จะ overlay ตอน assemble)
$SKILLMD$,
TRUE)
ON CONFLICT (name) DO NOTHING;
