import { Hammer } from 'lucide-react';

// ช่องว่างในตะแกรงที่ตั้งใจให้เห็นว่า "ยังมีของมาเพิ่ม" — ขนาด 16:9 เท่าการ์ดจริง
// แต่ใช้ขอบประ + พื้นจุด ให้อ่านออกทันทีว่ากดไม่ได้ ไม่ต้องมี badge มาบอกซ้ำ
const ComingSoonCard = () => (
  <div
    className="aspect-video rounded-md border border-dashed border-gray-700/80 bg-gray-900/20 flex flex-col items-center justify-center text-center px-4"
    style={{
      backgroundImage: 'radial-gradient(circle, rgba(255,179,0,0.07) 1px, transparent 1px)',
      backgroundSize: '18px 18px',
    }}
  >
    <Hammer className="h-6 w-6 text-[#FFB300] mb-2" />
    <p className="text-sm font-semibold text-gray-300">เร็วๆ นี้</p>
    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
      โปรแกรมตัวถัดไปสำหรับสมาชิกกำลังพัฒนาอยู่
    </p>
  </div>
);

export default ComingSoonCard;
