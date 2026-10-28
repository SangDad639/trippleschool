import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Crown, BookOpen, Loader2, RefreshCw, Search, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminPurchaseSurvey, AdminPurchaseSurveyList } from '@/types/purchaseSurvey';

/**
 * /admin/purchase-surveys — คำตอบแบบสอบถามหลังซื้อทุกคน (079 · GET /api/purchase-surveys/admin/all)
 *   เรียงใหม่ → เก่า · กรอง ทั้งหมด/สมาชิก/คอร์สเดี่ยว + ค้นหาอีเมล/เหตุผล/ชื่อคอร์ส
 *   การ์ดสรุป ตอบแล้ว/ข้าม/อัตราการตอบ + กล่อง "คอร์สที่คนสนใจมากสุด" (นับจากข้อ 2)
 */
type TypeFilter = 'all' | 'subscription' | 'course';

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const planLabel = (slug: string | null) => (slug === 'yearly' ? 'สมาชิกรายปี' : slug === 'monthly' ? 'สมาชิกรายเดือน' : 'สมาชิก');

export default function AdminPurchaseSurveys() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<AdminPurchaseSurveyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.listAdminPurchaseSurveys());
    } catch (err: any) {
      toast.error(err?.message || 'โหลดแบบสอบถามไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const surveys = data?.surveys ?? [];
  const totals = data?.totals ?? { answered: 0, skipped: 0, subscription: 0, course: 0 };
  const total = totals.answered + totals.skipped;
  const rate = total ? Math.round((totals.answered / total) * 100) : 0;
  const topMax = data?.top_courses[0]?.n ?? 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return surveys.filter((s) => {
      if (typeFilter !== 'all' && s.purchase_type !== typeFilter) return false;
      if (needle) {
        const hay = `${s.user_email} ${s.reason || ''} ${s.course_name || ''} ${s.interested.map((c) => c.name).join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [surveys, typeFilter, q]);
  const isFiltering = typeFilter !== 'all' || q.trim() !== '';

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  const purchaseCell = (s: AdminPurchaseSurvey) =>
    s.purchase_type === 'subscription' ? (
      <span className="inline-flex items-center gap-1.5 text-[#FFB300] whitespace-nowrap"><Crown className="h-3.5 w-3.5" /> {planLabel(s.plan_slug)}</span>
    ) : s.course_slug ? (
      <Link to={`/courses/${s.course_slug}`} className="inline-flex items-center gap-1.5 hover:text-[#FFB300] hover:underline" title={s.course_name || ''}>
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> <span className="line-clamp-2">{s.course_name}</span>
      </Link>
    ) : (
      <span className="text-muted-foreground">คอร์ส #{s.course_id ?? '—'} (ถูกลบ)</span>
    );

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6 text-yellow-400" /> 📋 แบบสอบถามหลังซื้อ</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading} title="โหลดใหม่">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        คำตอบจากผู้ซื้อสมาชิกและคอร์สเดี่ยว <b>เรียงจากใหม่ไปเก่า</b> · ข้อ 1 เหตุผลที่ซื้อ · ข้อ 2 คอร์สที่สนใจ · แถวที่ข้าม = ผู้ซื้อกดข้ามหรือปิดกล่อง
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-[#FFB300] tabular-nums" data-testid="admin-surveys-answered">{totals.answered}</div>
          <div className="text-xs text-muted-foreground">ตอบแล้ว</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-muted-foreground tabular-nums">{totals.skipped}</div>
          <div className="text-xs text-muted-foreground">ข้าม · อัตราการตอบ {total ? `${rate}%` : '—'}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold tabular-nums">{total}</div>
          <div className="text-xs text-muted-foreground">ทั้งหมด · สมาชิก {totals.subscription} · คอร์ส {totals.course}</div>
        </div>
      </div>

      {/* คอร์สที่คนสนใจมากสุด — เต็มความกว้างเหนือตาราง (วางข้างกันแล้วตารางล้นต้องเลื่อนแนวนอนบนจอ 1366) */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3 mb-5" data-testid="admin-surveys-top">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="font-semibold">คอร์สที่คนสนใจมากสุด</div>
          <div className="text-xs text-muted-foreground">นับจากข้อ 2 ของทุกคำตอบ (10 อันดับ)</div>
        </div>
        {!data?.top_courses.length ? (
          <div className="text-sm text-muted-foreground py-3 text-center">ยังไม่มีข้อมูล</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
            {data.top_courses.map((c) => (
              <div key={c.id} className="space-y-1 min-w-0">
                <div className="flex justify-between gap-2">
                  <Link to={`/courses/${c.slug}`} className="truncate hover:text-[#FFB300] hover:underline" title={c.name}>{c.name}</Link>
                  <span className="text-[#FFB300] font-semibold tabular-nums shrink-0">{c.n}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-2 rounded-full bg-[#FFB300]" style={{ width: `${topMax ? Math.max(6, Math.round((c.n / topMax) * 100)) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-sm shrink-0">
              {([
                { key: 'all', label: `ทั้งหมด (${total})` },
                { key: 'subscription', label: `สมาชิก (${totals.subscription})` },
                { key: 'course', label: `คอร์สเดี่ยว (${totals.course})` },
              ] as { key: TypeFilter; label: string }[]).map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTypeFilter(t.key)}
                  className={`h-10 px-3 ${i ? 'border-l border-border' : ''} ${typeFilter === t.key ? 'bg-[#FFB300] text-black font-semibold' : 'hover:bg-muted'}`}
                  data-testid={`admin-surveys-filter-${t.key}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาอีเมล / เหตุผล / ชื่อคอร์ส" className="pl-9" data-testid="admin-surveys-search" />
            </div>
          </div>

          {loading && !data ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
          ) : surveys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              ยังไม่มีคำตอบ — แบบสอบถามจะถามทันทีหลังสมัครสมาชิกหรือส่งสลิปซื้อคอร์ส
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              ไม่พบรายการที่ตรงกับตัวกรอง —{' '}
              <button type="button" className="underline hover:text-foreground" onClick={() => { setTypeFilter('all'); setQ(''); }}>ล้างตัวกรอง</button>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm" data-testid="admin-surveys-table">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium whitespace-nowrap">วันที่ (ใหม่ → เก่า)</th>
                    <th className="px-4 py-3 font-medium min-w-[160px]">ผู้ซื้อ</th>
                    <th className="px-4 py-3 font-medium min-w-[170px]">ซื้ออะไร</th>
                    <th className="px-4 py-3 font-medium min-w-[220px]">เหตุผลที่ซื้อ</th>
                    <th className="px-4 py-3 font-medium min-w-[200px]">สนใจคอร์ส</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className={`border-b border-border/60 align-top ${s.skipped ? 'opacity-55' : ''}`} data-testid={`admin-survey-row-${s.id}`}>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fmtDateTime(s.created_at)}</td>
                      <td className="px-4 py-3 break-all">{s.user_email}</td>
                      <td className="px-4 py-3 max-w-[260px]">{purchaseCell(s)}</td>
                      {s.skipped ? (
                        <td className="px-4 py-3" colSpan={2}>
                          <span className="inline-block rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs">ข้ามแบบสอบถาม</span>
                        </td>
                      ) : (
                        <>
                          <td className="px-4 py-3 max-w-[360px]">
                            {s.reason ? (
                              <p className="whitespace-pre-wrap break-words">{s.reason}</p>
                            ) : (
                              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs"><MessageSquareText className="h-3.5 w-3.5" /> ไม่ได้พิมพ์เหตุผล</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {s.interested.length ? (
                              <div className="flex flex-wrap gap-1.5">
                                {s.interested.map((c) => (
                                  <Link key={c.id} to={`/courses/${c.slug}`} className="rounded-full border border-purple-500/50 bg-purple-900/30 text-purple-100 px-2.5 py-0.5 text-xs hover:bg-purple-900/60" title={c.name}>
                                    {c.name}
                                  </Link>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">ไม่ได้เลือก</span>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 font-medium">
                    <td className="px-4 py-3" colSpan={5}>
                      {isFiltering ? `แสดง ${filtered.length} จาก ${total} รายการ` : `รวม ${total} รายการ · ตอบ ${totals.answered} · ข้าม ${totals.skipped}`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
