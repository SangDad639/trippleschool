-- 071: ถอด "จุดแทรกรายบท" (pre-roll/mid-roll ต่อบทเรียน) ทิ้ง — user เคาะ 10 ก.ย. 2026 ว่าโฆษณามีแค่ก่อนเริ่มคลิป
--      และผูกกับทุกคลิปอัตโนมัติจาก promo_settings (070) เท่านั้น · แถวค้าง 3 แถว (ทดสอบ + ที่ผูกเองวันนี้) หายไปพร้อมตาราง
--      idempotent: DROP IF EXISTS · index/constraint หายตามตาราง · promo_videos / promo_views / promo_settings คงเดิม
DROP TABLE IF EXISTS lesson_promos;
