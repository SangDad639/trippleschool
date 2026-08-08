// Shared pricing-card feature copy — consumed by Subscription.tsx (buy view) and
// the public Pricing page so both stay in sync. `highlight` is set only on the
// yearly-bonus rows (rendered with a tinted box + accent check icon).
export type FeatureItem = { title: string; desc: string; highlight?: boolean };

export const baseFeatures: FeatureItem[] = [
  { title: 'เข้าถึงทุกคอร์ส', desc: 'ปลดล็อกทุกบทเรียนที่เสียเงินทั้งหมด' },
  { title: 'วิดีโอความละเอียดสูง', desc: 'เรียนได้ทุกที่ทุกเวลา' },
  { title: 'อัปเดตเนื้อหาใหม่', desc: 'คอร์สใหม่เพิ่มเรื่อย ๆ ไม่มีค่าใช้จ่ายเพิ่ม' },
  { title: 'ติดตามความคืบหน้า', desc: 'บันทึกบทเรียนที่เรียนจบอัตโนมัติ' },
];

export const yearlyBonusFeatures: FeatureItem[] = [
  { title: 'คุ้มกว่ารายเดือน', desc: 'จ่ายครั้งเดียวใช้ได้ทั้งปี', highlight: true },
  { title: 'ราคาคงที่ทั้งปี', desc: 'ไม่ต้องต่ออายุทุกเดือน', highlight: true },
];
