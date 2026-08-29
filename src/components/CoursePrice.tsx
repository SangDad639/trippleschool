// Shared per-course price display. Used by the catalog card (Courses.tsx) and
// the course detail page (CourseDetail.tsx) so the styling stays consistent.
//
// Rules:
//   - isFree flag ส่งมา → flag ชนะราคาเสมอ (สิทธิ์เข้าเรียนใช้ courses.is_free ไม่ใช่ราคา
//     — ป้าย "ฟรี" ต้องตรงกับสิทธิ์จริง ไม่ใช่ตรงกับราคา 0 ที่บทอาจล็อกอยู่)
//   - ไม่ส่ง flag (caller เก่า) → fallback เกณฑ์ราคาเดิม: effective === 0 → "ฟรี"
//   - discount_price < price → discounted price + strikethrough original
//   - otherwise              → plain price

interface CoursePriceProps {
  price: number;
  discountPrice?: number | null;
  /** courses.is_free — ส่งมาเมื่อไรป้าย "ฟรี" ตามนี้เท่านั้น */
  isFree?: boolean;
  /** 'sm' for the catalog card, 'lg' for the detail page CTA block. */
  size?: 'sm' | 'lg';
  className?: string;
}

const fmt = (n: number) => `฿${Number(n).toLocaleString()}`;

const CoursePrice = ({ price, discountPrice, isFree: isFreeFlag, size = 'sm', className = '' }: CoursePriceProps) => {
  const hasDiscount = discountPrice != null && discountPrice < price;
  const effective = hasDiscount ? discountPrice! : price;
  const isFree = isFreeFlag !== undefined ? isFreeFlag : effective === 0;

  const mainCls = size === 'lg' ? 'text-2xl font-bold' : 'text-sm font-bold';
  const strikeCls = size === 'lg' ? 'text-sm' : 'text-xs';

  if (isFree) {
    return <span className={`${mainCls} text-green-400 ${className}`}>ฟรี</span>;
  }

  return (
    <span className={`flex items-baseline gap-1.5 ${className}`}>
      <span className={`${mainCls} text-purple-400`}>{fmt(effective)}</span>
      {hasDiscount && (
        <span className={`${strikeCls} text-gray-500 line-through`}>{fmt(price)}</span>
      )}
    </span>
  );
};

export default CoursePrice;
