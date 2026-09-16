-- 073: ความยาวคลิปจริงจาก YouTube (videoDetails.lengthSeconds) ไว้ตรวจ "บทในคลิป" ไม่เกินความยาว
--      (ซับมักจบก่อนท้ายคลิป ใช้เวลาจบซับแทนไม่ได้) · เพิ่มคอลัมน์อย่างเดียว idempotent
ALTER TABLE lesson_subtitles ADD COLUMN IF NOT EXISTS length_seconds INTEGER;
