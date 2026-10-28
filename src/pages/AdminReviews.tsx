import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Loader2, Star, Search, RefreshCw, MessageSquareText, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import StarRating from '@/components/StarRating';
import type { AdminReview } from '@/types/review';

/**
 * /admin/reviews — รีวิวจากผู้เรียน "ทุกคอร์ส" รวมในหน้าเดียว เรียงใหม่ → เก่า (GET /api/courses/admin/reviews)
 *   กรองตามคอร์ส / จำนวนดาว / ค้นหาชื่อผู้รีวิว-ข้อความ · ลบได้ทันที (DELETE /api/courses/reviews/:id ของเดิม)
 *   ปุ่มลบในหน้าคอร์ส (ReviewList + onDelete) ยังอยู่เหมือนเดิม — หน้านี้แค่รวมไว้ให้แอดมินไล่ดู/ลบได้ง่าย
 */
const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
/** ผู้เรียนกดรีวิวซ้ำ = แก้ของเดิม (upsert) — โชว์ป้าย "แก้ไข" ถ้า updated_at ห่างจาก created_at เกิน 1 นาที */
const wasEdited = (r: AdminReview) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000;
const sortNewestFirst = (a: AdminReview, b: AdminReview) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || b.id - a.id;

export default function AdminReviews() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<AdminReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.listAdminReviews();
      // server เรียงใหม่ → เก่าให้แล้ว แต่เรียงซ้ำฝั่งนี้กันเพี้ยน
      setReviews([...r.reviews].sort(sortNewestFirst));
    } catch (err: any) {
      toast.error(err?.message || 'โหลดรีวิวไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // ตัวเลือกคอร์สในตัวกรอง = เฉพาะคอร์สที่มีรีวิว (พร้อมจำนวน) เรียงตามจำนวนมาก → น้อย
  const courseOptions = useMemo(() => {
    const m = new Map<number, { id: number; name: string; n: number }>();
    for (const r of reviews) {
      const cur = m.get(r.course_id);
      if (cur) cur.n += 1; else m.set(r.course_id, { id: r.course_id, name: r.course_name, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th'));
  }, [reviews]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reviews.filter((r) => {
      if (courseFilter !== 'all' && String(r.course_id) !== courseFilter) return false;
      if (ratingFilter !== 'all' && r.rating !== Number(ratingFilter)) return false;
      if (needle) {
        const hay = `${r.reviewer} ${r.reviewer_email} ${r.comment || ''} ${r.course_name}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [reviews, courseFilter, ratingFilter, q]);

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const withComment = reviews.filter((r) => (r.comment || '').trim()).length;
  const isFiltering = courseFilter !== 'all' || ratingFilter !== 'all' || q.trim() !== '';

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.deleteReview(deleting.id);
      toast.success('ลบรีวิวแล้ว 🗑️');
      setDeleting(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ลบรีวิวไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Star className="h-6 w-6 text-yellow-400" /> ⭐ รีวิวจากผู้เรียน</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading} title="โหลดใหม่">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        รีวิวทุกคอร์สรวมในหน้าเดียว <b>เรียงจากใหม่ไปเก่า</b> · กดชื่อคอร์สเพื่อเปิดหน้าคอร์ส · ลบแล้วรีวิวหายจากหน้าคอร์สทันทีและคะแนนเฉลี่ยคำนวณใหม่ (กู้คืนไม่ได้)
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-[#FFB300] tabular-nums" data-testid="admin-reviews-total">{reviews.length}</div>
          <div className="text-xs text-muted-foreground">รีวิวทั้งหมด</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-yellow-400 tabular-nums">{reviews.length ? avg.toFixed(2) : '—'}</div>
          <div className="text-xs text-muted-foreground">คะแนนเฉลี่ย (เต็ม 5)</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold tabular-nums">{courseOptions.length}</div>
          <div className="text-xs text-muted-foreground">คอร์สที่มีรีวิว{withComment ? <span> · มีข้อความ {withComment}</span> : null}</div>
        </div>
      </div>

      {/* ตัวกรอง */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="sm:w-[320px]" data-testid="admin-reviews-course-filter"><SelectValue placeholder="ทุกคอร์ส" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">📚 ทุกคอร์ส ({reviews.length})</SelectItem>
            {courseOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.n})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="sm:w-[170px]" data-testid="admin-reviews-rating-filter"><SelectValue placeholder="ทุกคะแนน" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกคะแนน</SelectItem>
            {[5, 4, 3, 2, 1].map((n) => (
              <SelectItem key={n} value={String(n)}>{'⭐'.repeat(n)} {n} ดาว</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อผู้รีวิว / อีเมล / ข้อความ"
            className="pl-9"
            data-testid="admin-reviews-search"
          />
        </div>
      </div>

      {loading && reviews.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          ยังไม่มีรีวิวจากผู้เรียน
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          ไม่พบรีวิวที่ตรงกับตัวกรอง —{' '}
          <button type="button" className="underline hover:text-foreground" onClick={() => { setCourseFilter('all'); setRatingFilter('all'); setQ(''); }}>
            ล้างตัวกรอง
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-reviews-table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium whitespace-nowrap">วันที่ (ใหม่ → เก่า)</th>
                <th className="px-4 py-3 font-medium min-w-[200px]">คอร์ส</th>
                <th className="px-4 py-3 font-medium min-w-[150px]">ผู้รีวิว</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">คะแนน</th>
                <th className="px-4 py-3 font-medium min-w-[240px]">ความเห็น</th>
                <th className="px-4 py-3 font-medium text-right">ลบ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/60 align-top" data-testid={`admin-review-row-${r.id}`}>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    <div>{fmtDateTime(r.created_at)}</div>
                    {wasEdited(r) && (
                      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1" title={`แก้ไขล่าสุด ${fmtDateTime(r.updated_at)}`}>
                        <Pencil className="h-3 w-3" /> แก้ไข {fmtDateTime(r.updated_at)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[320px]">
                    <Link to={`/courses/${r.course_slug}`} className="font-medium hover:text-[#FFB300] hover:underline line-clamp-2" title={r.course_name}>
                      📚 {r.course_name}
                    </Link>
                    {!r.course_is_active && <span className="text-[11px] text-muted-foreground">(คอร์สปิดอยู่)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.reviewer}</div>
                    <div className="text-[11px] text-muted-foreground break-all">{r.reviewer_email}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <StarRating value={r.rating} size={14} hideValue />
                      <span className="tabular-nums text-xs text-muted-foreground">{r.rating}/5</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[420px]">
                    {(r.comment || '').trim() ? (
                      <p className="whitespace-pre-wrap break-words">{r.comment}</p>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs"><MessageSquareText className="h-3.5 w-3.5" /> ให้ดาวอย่างเดียว ไม่มีข้อความ</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                      title="ลบรีวิวนี้"
                      aria-label="ลบรีวิวนี้"
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 font-medium">
                <td className="px-4 py-3" colSpan={6}>
                  {isFiltering ? `แสดง ${filtered.length} จาก ${reviews.length} รีวิว` : `รวม ${reviews.length} รีวิว`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ===== ยืนยันลบ ===== */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !busy) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🗑️ ลบรีวิวของ "{deleting?.reviewer}"?</AlertDialogTitle>
            <AlertDialogDescription>
              คอร์ส: {deleting?.course_name} · {deleting?.rating} ดาว
              {deleting?.comment?.trim() ? ` · "${deleting.comment.trim().slice(0, 80)}${deleting.comment.trim().length > 80 ? '…' : ''}"` : ''}
              <br />
              ลบแล้วรีวิวนี้จะหายจากหน้าคอร์สทันที และคะแนนเฉลี่ยจะคำนวณใหม่ — กู้คืนไม่ได้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>เก็บไว้</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={busy}
              className="bg-red-600 text-destructive-foreground hover:bg-red-700"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} ยืนยันลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
