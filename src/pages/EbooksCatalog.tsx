import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import PublicHeader from '@/components/PublicHeader';
import { Badge } from '@/components/ui/badge';
import EbookCard from '@/components/ebooks/EbookCard';
import { api, type EbookDto } from '@/lib/api';
import { Download, Loader2, BookMarked } from 'lucide-react';

// คลัง Ebook ฟรี — วางเลย์เอาต์ชุดเดียวกับหน้า /programs แต่ไม่มีป้าย/แถบชวนสมัคร
// สมาชิกใดๆ เพราะดาวน์โหลดได้ฟรีทุกคน ไม่ต้องล็อกอิน
const EbooksCatalog = () => {
  const [ebooks, setEbooks] = useState<EbookDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setEbooks(await api.getEbooks());
      } catch (e: any) {
        toast.error(e?.message || 'โหลด Ebook ไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <PublicHeader />

      {/* Top bar: title + free badge */}
      <div className="px-4 md:px-12 pt-8 pb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-bold">Ebook ฟรี</h1>
          <p className="text-gray-400 text-sm mt-1">ดาวน์โหลดได้ทันที ไม่ต้องเป็นสมาชิกและไม่มีค่าใช้จ่าย</p>
        </div>
        <Badge className="self-start sm:self-auto bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
          <Download className="h-3.5 w-3.5 mr-1" /> ดาวน์โหลดฟรี ไม่ต้องเป็นสมาชิก
        </Badge>
      </div>

      <div className="px-4 md:px-12 pb-16">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        ) : ebooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <BookMarked className="h-12 w-12 text-gray-600" />
            <p className="text-gray-400">ยังไม่มี Ebook ให้ดาวน์โหลดตอนนี้</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base md:text-lg font-semibold flex-1">Ebook ทั้งหมด</h2>
              <span className="text-gray-400 text-sm whitespace-nowrap">{ebooks.length} เล่ม</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ebooks.map((ebook) => (
                <EbookCard key={ebook.slug} ebook={ebook} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EbooksCatalog;
