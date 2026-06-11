// Shared per-course price display. Used by the catalog card (Courses.tsx) and
// the course detail page (CourseDetail.tsx) so the styling stays consistent.
//
// Rules:
//   - price === 0            → "ฟรี" (green)
//   - discount_price < price → discounted price + strikethrough original
//   - otherwise              → plain price

interface CoursePriceProps {
  price: number;
  discountPrice?: number | null;
  /** 'sm' for the catalog card, 'lg' for the detail page CTA block. */
  size?: 'sm' | 'lg';
  className?: string;
}

const fmt = (n: number) => `฿${Number(n).toLocaleString()}`;

const CoursePrice = ({ price, discountPrice, size = 'sm', className = '' }: CoursePriceProps) => {
  const hasDiscount = discountPrice != null && discountPrice < price;
  const effective = hasDiscount ? discountPrice! : price;
  const isFree = effective === 0;

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
