import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicHeader from '@/components/PublicHeader';
import { api, type GuideGroupDto } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Loader2, Search, PlayCircle, BookOpen } from 'lucide-react';

/**
 * /guide - the manual catalog, laid out like /courses: a group here plays the
 * part a course plays there, and its clips are the lessons inside.
 *
 * Hidden route: not in PublicHeader's NAV_ITEMS, no auth gate, no subscription
 * gate. The Triple Bot desktop app links here from its LOGIN screen, where the
 * reader has no session yet, so anything gated would be a dead end.
 *
 * Groups are managed at /admin/guide and come from the API - publishing a clip
 * needs no deploy.
 */
const Guide = () => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GuideGroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .getGuideGroups()
      .then((rows) => setGroups(Array.isArray(rows) ? rows : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const term = query.trim().toLowerCase();
  const visible = term
    ? groups.filter(
        (g) => g.title.toLowerCase().includes(term) || (g.description || '').toLowerCase().includes(term)
      )
    : groups;

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <PublicHeader />

      {/* หัวหน้า + ค้นหา — เลย์เอาต์ชุดเดียวกับหน้า /courses */}
      <div className="flex flex-col gap-3 px-4 pb-5 pt-8 sm:flex-row sm:items-center md:px-12">
        <div className="flex-1">
          <h1 className="text-2xl font-bold md:text-3xl">คู่มือการใช้งาน</h1>
          <p className="mt-1 text-sm text-gray-400">คลิปสอนใช้งาน เปิดดูได้ทุกคน ไม่ต้องสมัครสมาชิก</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาคู่มือ..."
            className="h-9 border-gray-700 bg-gray-800/50 pl-10 text-sm text-white"
          />
        </div>
      </div>

      <div className="px-4 pb-16 md:px-12">
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
          </div>
        ) : failed ? (
          <p className="py-20 text-center text-gray-400">โหลดคู่มือไม่สำเร็จ — ลองรีเฟรชหน้าอีกครั้ง</p>
        ) : visible.length === 0 ? (
          <p className="py-20 text-center text-gray-400">
            {term ? 'ไม่พบคู่มือที่ค้นหา ลองคำอื่นดูนะ' : 'ยังไม่มีคู่มือในขณะนี้'}
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="flex-1 text-base font-semibold md:text-lg">
                {term ? `ผลการค้นหา "${query.trim()}"` : 'คู่มือทั้งหมด'}
              </h2>
              <span className="whitespace-nowrap text-sm text-gray-400">{visible.length} ชุด</span>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {visible.map((group) => (
                <GuideGroupCard key={group.id} group={group} onClick={() => navigate(`/guide/${group.slug}`)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/** การ์ดกลุ่มคู่มือ — ทรง 16:9 + ไล่เฉดดำท้ายการ์ด แบบเดียวกับการ์ดคอร์ส */
const GuideGroupCard = ({ group, onClick }: { group: GuideGroupDto; onClick: () => void }) => {
  const count = Number(group.clip_count) || 0;

  return (
    <div
      onClick={onClick}
      className="group/card relative aspect-video w-full cursor-pointer overflow-hidden rounded-md bg-gray-800 transition-transform duration-300 hover:z-10 hover:scale-105 hover:shadow-2xl hover:shadow-black/60"
    >
      {group.cover_url ? (
        <img
          src={api.mediaUrl(group.cover_url, 'card')}
          alt={group.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
          <BookOpen className="h-8 w-8 text-zinc-600" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">{group.title}</p>
        <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-300">
          <PlayCircle className="h-3 w-3" />
          {count} คลิป
        </p>
      </div>
    </div>
  );
};

export default Guide;
