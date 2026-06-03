-- Migration 004: Revert v0.0.8 data changes
--
-- v0.0.8 (commit fa55200) — กลับไปสู่ state เดิมก่อน v0.0.8:
--   * ลบ banner 'image-templates-launch' (ที่ migration 002 INSERT ไว้)
--   * Restore 4 legacy banners (ที่ migration 003 DELETE ออก)
--
-- หมายเหตุ:
--   - Column `link_url` ที่ migration 002 เพิ่มไว้ — ไม่ลบ (harmless extra column,
--     code revert แล้วไม่อ้างอิง column นี้)
--   - Migration 002 + 003 ยังถูก mark applied ใน _migrations table — ไม่รัน
--     ซ้ำเมื่อ deploy
--   - Idempotent: DELETE WHERE + INSERT ON CONFLICT DO NOTHING — รันซ้ำได้ปลอดภัย

-- 1. Remove image-templates-launch banner
DELETE FROM update_banners WHERE slug = 'image-templates-launch';

-- 2. Restore 4 legacy banners (mirrors auto-seed in db.ts)

-- 2.1 how-to-idol-template (display_order=0 was 1 originally — pre-v0.0.8 numbering)
INSERT INTO update_banners
  (slug, date_th, date_en, title_th, title_en,
   detail_title_th, detail_title_en, banner, video_url,
   details, links, prompts, display_order, is_active)
VALUES (
  'how-to-idol-template',
  '25 เม.ย. 2569', 'Apr 25, 2026',
  'วิธีใช้งาน Idol Template', 'How to Use Idol Template',
  'คู่มือใช้งาน โหมด Idol Template', 'Guide to Using Idol Template Mode',
  '/ChatGPT Image Apr 25, 2026, 10_53_04 AM.png', '',
  $details_idol$[
    {"text":{"th":"คู่มือการใช้งาน Idol Template","en":"How to Use Idol Template"},"videoUrl":"https://www.youtube.com/watch?v=uXiK24GiadU"},
    {"text":{"th":"วิธีสร้าง Custom Idol Template","en":"How to Create Custom Idol Template"},"videoUrl":"https://www.youtube.com/embed/yKCh8UfAnxY"}
  ]$details_idol$::jsonb,
  '[]'::jsonb,
  $prompts_idol$[
    {"label":"Image Prompt","text":"amateur smartphone photo, realistic casual snapshot taken with iPhone, candid portrait,\n\nvoluptuous young woman with very large breasts and massive cleavage,\narms raised behind head exposing thick dark hairy armpits,\n\ninspired by the woman in the attached reference image 1,\nwearing clothing and accessories from the attached reference image 2,\nwith background from the attached reference image 3,\n\nsoft indoor natural light, slight lens flare,\n\nshot on smartphone, 26mm lens, f/1.8, slight depth of field, soft bokeh,\nmild digital noise and film grain, natural color grading,\nunedited raw phone photo style, authentic everyday mobile photo,\nhighly photorealistic, indistinguishable from real iPhone photo"},
    {"label":"VDO Prompt","text":"arms raised behind head, slow stretching motion, slowly and teasingly sticking out tongue, wet glossy tongue licking lips sensually, eye contact with camera, subtle body sway, deep breathing, natural movement of armpit hair, seductive and erotic atmosphere, smooth cinematic slow motion"}
  ]$prompts_idol$::jsonb,
  0, true
)
ON CONFLICT (slug) DO NOTHING;

-- 2.2 how-to-custom-viral-template
INSERT INTO update_banners
  (slug, date_th, date_en, title_th, title_en,
   detail_title_th, detail_title_en, banner, video_url,
   details, links, prompts, display_order, is_active)
VALUES (
  'how-to-custom-viral-template',
  '10 เม.ย. 2569', 'Apr 10, 2026',
  'วิธีสร้าง Custom Viral Template', 'How to Make Custom Viral Template',
  'วิธีสร้าง Custom Viral Template', 'How to Make Custom Viral Template',
  '/Create_viral_YouTube_202604101128.jpeg', '',
  $details_cvt$[
    {"text":{"th":"เริ่มต้นใช้งาน","en":"Getting Started"},"videoUrl":"https://youtu.be/llPhOpz4SAw"}
  ]$details_cvt$::jsonb,
  $links_cvt$[
    {"label":{"th":"ไฟล์แนบ","en":"Attachment"},"url":"https://docs.google.com/document/d/14ArosG22Oi4SfdyrWbV78GHpNmot5bfzwITXudbwIxo/edit?usp=sharing"}
  ]$links_cvt$::jsonb,
  '[]'::jsonb,
  1, true
)
ON CONFLICT (slug) DO NOTHING;

-- 2.3 how-to-triple-viral
INSERT INTO update_banners
  (slug, date_th, date_en, title_th, title_en,
   detail_title_th, detail_title_en, banner, video_url,
   details, links, prompts, display_order, is_active)
VALUES (
  'how-to-triple-viral',
  '9 เม.ย. 2569', 'Apr 9, 2026',
  'วิธีใช้งาน Triple Viral', 'How to Triple Viral',
  'คู่มือการใช้งาน Triple Viral แบบ Step-by-Step', 'How to Triple Viral - Step-by-Step Guide',
  '/Person_pointing_at_202604091357.jpeg', '',
  $details_tv$[
    {"text":{"th":"เริ่มต้นใช้งาน","en":"Getting Started"},"videoUrl":"https://www.youtube.com/watch?v=q9d9Bp1Fyp8"}
  ]$details_tv$::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  2, true
)
ON CONFLICT (slug) DO NOTHING;

-- 2.4 postforme-setup
INSERT INTO update_banners
  (slug, date_th, date_en, title_th, title_en,
   detail_title_th, detail_title_en, banner, video_url,
   details, links, prompts, display_order, is_active)
VALUES (
  'postforme-setup',
  '28 มี.ค. 2569', 'Mar 28, 2026',
  'วิธีการสร้าง API และ เชื่อมแพลตฟอร์มต่างๆ', 'How to Create API & Connect Platforms',
  'คลิปสอนชำระเงิน และ สร้าง API Key เพื่อนำไปเชื่อมกับเว็บ Triple Viral', 'Tutorial: Payment & Create API Key to Connect with Triple Viral',
  '/banner1.jpg', '',
  $details_pfm$[
    {"text":{"th":"การชำระเงิน และ สร้าง API Key","en":"Payment & API Key Creation"},"videoUrl":"https://www.youtube.com/playlist?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH"},
    {"text":{"th":"วิธีสร้าง Social Account สำหรับใช้เชื่อมเข้ากับแพลตฟอร์มต่างๆ","en":"How to create Social Accounts to connect with platforms"},"isHeading":true,"children":[
      {"text":{"th":"Facebook","en":"Facebook"},"videoUrl":"https://www.youtube.com/embed/-iQY_NEZjFY?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH"},
      {"text":{"th":"YouTube","en":"YouTube"},"videoUrl":"https://www.youtube.com/embed/NLcQahund3U?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH"},
      {"text":{"th":"Instagram","en":"Instagram"},"videoUrl":"https://www.youtube.com/embed/zg0JKat1ydg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH"},
      {"text":{"th":"TikTok","en":"TikTok"},"videoUrl":"https://www.youtube.com/embed/DAIyO1xQulg?list=PLpp3Sum6WE9gyI4X3BQjmi9KBsST3zhzH"}
    ]}
  ]$details_pfm$::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  3, true
)
ON CONFLICT (slug) DO NOTHING;
