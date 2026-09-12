import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Copy, Check, Eye, EyeOff, Tag, ListOrdered, Dices } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminCode, AdminCodeUsage } from '@/types/adminCode';

/**
 * /admin/codes — โค้ดส่วนลดของแอดมิน (migration 069 · routes/adminCodes.ts)
 *   ลดราคาเท่าโค้ดผู้แนะนำ · ไม่มีค่าคอม · ผูกกับบทเรียน (Video) หรือคอร์ส = ป้าย funnel
 *   ตาราง Video | Code | Count (user สั่ง) — Count = คนที่ชำระสำเร็จผ่านโค้ด (คอร์สอนุมัติแล้ว + สมัครสมาชิกผ่านสลิปแล้ว)
 *   โค้ดไม่มีวันหมดอายุ แค่เปิด/ปิดใช้งาน · โค้ดเปลี่ยนไม่ได้หลังสร้าง (กัน funnel เพี้ยน) · ลบได้เฉพาะโค้ดที่ยังไม่เคยใช้
 */
interface Form {
  id?: number;
  code: string;
  label: string;
  course_id: string;   // '' = ไม่ผูก
  lesson_id: string;   // '' = ทั้งคอร์ส
  is_active: boolean;
}
interface CourseOpt { id: number; name: string; is_active: boolean }
interface LessonOpt { id: number; title: string; lesson_order: number }

const emptyForm: Form = { code: '', label: '', course_id: '', lesson_id: '', is_active: true };
const CODE_RE = /^[a-z0-9](?:[a-z0-9_-]{2,18})[a-z0-9]$/;
const cleanCode = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
/** สุ่ม 6 ตัว ตัวแรกเป็นอักษร ไม่มี 0/o/1/l/i (แบบ share code) — server กันซ้ำอีกชั้น */
function randomCode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
const fmtBaht = (n: number) => `฿${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');
const fmtDateTime = (s: string) => new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminCodes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [codes, setCodes] = useState<AdminCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AdminCode | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [lessons, setLessons] = useState<LessonOpt[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [usageFor, setUsageFor] = useState<AdminCode | null>(null);
  const [usage, setUsage] = useState<AdminCodeUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.listAdminCodes();
      setCodes(r.codes);
    } catch (err: any) {
      toast.error(err?.message || 'โหลดรายการโค้ดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.getAdminCourses()
      .then((rows: any[]) => setCourses(rows.map((c) => ({ id: c.id, name: c.name, is_active: !!c.is_active }))))
      .catch(() => {});
  }, []);
  // เลือกคอร์ส → โหลดบทเรียนของคอร์สนั้น (ไม่มี endpoint บทเรียนรวม)
  const courseIdInForm = form?.course_id || '';
  useEffect(() => {
    if (!courseIdInForm) { setLessons([]); return; }
    let alive = true;
    setLessonsLoading(true);
    api.getCourseLessons(Number(courseIdInForm))
      .then((rows: any[]) => { if (alive) setLessons(rows.map((l) => ({ id: l.id, title: l.title, lesson_order: l.lesson_order }))); })
      .catch(() => { if (alive) setLessons([]); })
      .finally(() => { if (alive) setLessonsLoading(false); });
    return () => { alive = false; };
  }, [courseIdInForm]);

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  const openCreate = () => setForm({ ...emptyForm, code: randomCode() });
  const openEdit = (c: AdminCode) => setForm({
    id: c.id,
    code: c.code,
    label: c.label || '',
    course_id: c.course_id ? String(c.course_id) : '',
    lesson_id: c.lesson_id ? String(c.lesson_id) : '',
    is_active: c.is_active,
  });

  const handleSave = async () => {
    if (!form) return;
    const code = cleanCode(form.code);
    if (!form.id && (!CODE_RE.test(code) || !/[a-z]/.test(code))) {
      return toast.error('โค้ดต้องยาว 4-20 ตัว ใช้ได้เฉพาะ a-z, 0-9 และ - หรือ _ คั่นกลาง และต้องมีตัวอักษรอย่างน้อย 1 ตัว');
    }
    const body = {
      label: form.label.trim() || null,
      course_id: form.course_id ? Number(form.course_id) : null,
      lesson_id: form.lesson_id ? Number(form.lesson_id) : null,
      is_active: form.is_active,
    };
    setSaving(true);
    try {
      if (form.id) {
        await api.updateAdminCode(form.id, body);
        toast.success('บันทึกโค้ดแล้ว');
      } else {
        const r = await api.createAdminCode({ ...body, code });
        toast.success(`สร้างโค้ด ${r.code.code} แล้ว — เอาไปใส่ในคลิป/โพสต์ได้เลย`, { duration: 6000 });
      }
      setForm(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: AdminCode) => {
    setBusyId(c.id);
    try {
      await api.updateAdminCode(c.id, { is_active: !c.is_active });
      toast.success(c.is_active ? 'ปิดใช้แล้ว — ลูกค้ากรอกโค้ดนี้จะขึ้น "ปิดใช้งานแล้ว"' : 'เปิดใช้แล้ว');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.deleteAdminCode(deleting.id);
      toast.success(`ลบโค้ด ${deleting.code} แล้ว`);
      setDeleting(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ลบไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };
  const copyCode = async (c: AdminCode) => {
    try {
      await navigator.clipboard.writeText(c.code);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 1500);
    } catch {
      toast.error('คัดลอกไม่สำเร็จ');
    }
  };
  const openUsage = async (c: AdminCode) => {
    setUsageFor(c);
    setUsage([]);
    setUsageLoading(true);
    try {
      const r = await api.getAdminCodeUsage(c.id, 100);
      setUsage(r.usage);
    } catch (err: any) {
      toast.error(err?.message || 'โหลดรายการใช้ไม่สำเร็จ');
    } finally {
      setUsageLoading(false);
    }
  };

  const totalSuccess = codes.reduce((s, c) => s + c.count_success, 0);
  const totalRevenue = codes.reduce((s, c) => s + c.revenue, 0);
  const totalPending = codes.reduce((s, c) => s + c.count_pending, 0);
  const usedCount = (c: AdminCode) => c.count_success + c.count_pending + Math.max(0, c.count_course + c.count_sub - c.count_success);

  const videoCell = (c: AdminCode) => {
    if (c.lesson_id) {
      return (
        <div className="min-w-0">
          <div className="font-medium truncate">🎬 {c.lesson_order != null ? `EP.${c.lesson_order} ` : ''}{c.lesson_title || `บท #${c.lesson_id}`}</div>
          <div className="text-xs text-muted-foreground truncate">
            {c.course_name || ''}{c.lesson_share_code ? <span className="font-mono"> · /{c.lesson_share_code}</span> : null}
          </div>
        </div>
      );
    }
    if (c.course_id) return <div className="font-medium truncate">📚 {c.course_name || `คอร์ส #${c.course_id}`}</div>;
    return <span className="text-muted-foreground">— ไม่ผูก —</span>;
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Tag className="h-6 w-6 text-yellow-400" /> 🏷️ โค้ดส่วนลด</h1>
        <Button onClick={openCreate} className="ml-auto bg-[#FFB300] hover:bg-[#FF9D00] text-black" data-testid="admin-code-create">
          <Plus className="h-4 w-4 mr-1" /> สร้างโค้ด
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        โค้ดของแอดมินสำหรับใส่ในคลิป/โพสต์ — ลูกค้ากรอกตอนชำระเงิน (ซื้อคอร์สหรือสมัครสมาชิก) ได้ส่วนลดเท่าโค้ดผู้แนะนำ · <b>ไม่มีค่าคอมมิชชั่น</b> · ผูกกับบทเรียนหรือคอร์สเพื่อดูว่าลูกค้ามาจากคลิปไหน · ไม่มีวันหมดอายุ แค่เปิด/ปิด
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-5">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-[#FFB300] tabular-nums">{codes.length}</div>
          <div className="text-xs text-muted-foreground">โค้ดทั้งหมด</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold text-green-400 tabular-nums">{totalSuccess}</div>
          <div className="text-xs text-muted-foreground">สมัครสำเร็จผ่านโค้ด{totalPending ? <span className="text-yellow-400"> · รอ {totalPending}</span> : null}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 text-center">
          <div className="text-xl sm:text-2xl font-bold tabular-nums">{fmtBaht(totalRevenue)}</div>
          <div className="text-xs text-muted-foreground">ยอดชำระผ่านโค้ด</div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" /></div>
      ) : codes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          ยังไม่มีโค้ดส่วนลด — กด "สร้างโค้ด" แล้วผูกกับคลิป/คอร์สที่จะโปรโมท
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-codes-table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium min-w-[220px]">Video / คอร์สที่ผูก</th>
                <th className="px-4 py-3 font-medium min-w-[150px]">Code</th>
                <th className="px-4 py-3 font-medium text-right">Count<div className="font-normal">สมัครสำเร็จ</div></th>
                <th className="px-4 py-3 font-medium text-right">ยอดชำระ</th>
                <th className="px-4 py-3 font-medium">สถานะ</th>
                <th className="px-4 py-3 font-medium text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className={`border-b border-border/60 ${c.is_active ? '' : 'opacity-60'}`} data-testid={`admin-code-row-${c.id}`}>
                  <td className="px-4 py-3 max-w-[320px]">{videoCell(c)}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => copyCode(c)} className="inline-flex items-center gap-1.5 group" title="คัดลอกโค้ด">
                      <span className="font-mono font-bold text-[#FFB300] text-base">{c.code}</span>
                      {copiedId === c.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />}
                    </button>
                    {c.label && <div className="text-xs text-muted-foreground truncate max-w-[220px]">{c.label}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className={`text-xl font-bold tabular-nums ${c.count_success ? 'text-green-400' : ''}`} data-testid={`admin-code-count-${c.id}`}>{c.count_success}</div>
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                      คอร์ส {c.count_course} · สมาชิก {c.count_sub}
                      {c.count_pending ? <span className="text-yellow-400"> · รออนุมัติ {c.count_pending}</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div>{fmtBaht(c.revenue)}</div>
                    <div className="text-[11px] text-muted-foreground">ล่าสุด {fmtDate(c.last_used_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.is_active ? 'bg-green-500/15 text-green-400' : 'bg-muted text-muted-foreground'}`}>
                      {c.is_active ? <><Eye className="h-3 w-3" /> เปิดใช้</> : <><EyeOff className="h-3 w-3" /> ปิดอยู่</>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => openUsage(c)} title="รายการใช้โค้ด">
                        <ListOrdered className="h-3.5 w-3.5 mr-1" /> รายการใช้
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5 mr-1" /> แก้ไข</Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(c)} disabled={busyId === c.id}>
                        {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="text-red-400 hover:text-red-500"
                        onClick={() => setDeleting(c)}
                        disabled={usedCount(c) > 0}
                        title={usedCount(c) > 0 ? 'โค้ดนี้ถูกใช้แล้ว ลบไม่ได้ — ปิดใช้งานแทน' : 'ลบโค้ด'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 font-medium">
                <td className="px-4 py-3" colSpan={2}>รวม {codes.length} โค้ด</td>
                <td className="px-4 py-3 text-right tabular-nums text-green-400">{totalSuccess}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtBaht(totalRevenue)}</td>
                <td className="px-4 py-3" colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ===== สร้าง/แก้ไข ===== */}
      <Dialog open={!!form} onOpenChange={(o) => { if (!o && !saving) setForm(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>{form?.id ? '✏️ แก้ไขโค้ดส่วนลด' : '🏷️ สร้างโค้ดส่วนลด'}</DialogTitle>
            <DialogDescription className="text-xs">
              ส่วนลดเท่าโค้ดผู้แนะนำ · ไม่มีค่าคอมมิชชั่น · ไม่มีวันหมดอายุ · โค้ดเปลี่ยนไม่ได้หลังสร้าง
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <Label>โค้ด *</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: cleanCode(e.target.value) })}
                    placeholder="เช่น tiktok-gemini"
                    className="font-mono tracking-wider h-11"
                    maxLength={20}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={!!form.id}
                    data-testid="admin-code-input"
                  />
                  {!form.id && (
                    <Button type="button" variant="outline" className="h-11" onClick={() => setForm({ ...form, code: randomCode() })} title="สุ่มโค้ดใหม่">
                      <Dices className="h-4 w-4 mr-1" /> สุ่ม
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {form.id ? 'เปลี่ยนตัวโค้ดไม่ได้ (กันสถิติเพี้ยน) — ต้องการโค้ดใหม่ให้สร้างใหม่' : 'a-z 0-9 ยาว 4-20 ตัว (- _ คั่นกลางได้) · ลูกค้าพิมพ์ตัวใหญ่/เล็กก็ใช้ได้ · ห้ามซ้ำกับโค้ดผู้แนะนำของสมาชิก'}
                </p>
              </div>

              <div>
                <Label>ชื่อแคมเปญ / คลิป (ไว้ดูเอง)</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="เช่น TikTok รีวิว Gemini 10 ก.ย." className="mt-1" />
              </div>

              <div className="space-y-2">
                <Label>ผูกกับ (funnel)</Label>
                <Select value={form.course_id || 'none'} onValueChange={(v) => setForm({ ...form, course_id: v === 'none' ? '' : v, lesson_id: '' })}>
                  <SelectTrigger><SelectValue placeholder="เลือกคอร์ส" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— ไม่ผูก —</SelectItem>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.is_active ? '' : ' (ปิดอยู่)'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.course_id && (
                  <Select value={form.lesson_id || 'all'} onValueChange={(v) => setForm({ ...form, lesson_id: v === 'all' ? '' : v })}>
                    <SelectTrigger>
                      <SelectValue placeholder={lessonsLoading ? 'กำลังโหลดบทเรียน…' : 'เลือกบทเรียน (Video)'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">📚 ทั้งคอร์ส (ไม่ระบุบท)</SelectItem>
                      {lessons.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>🎬 EP.{l.lesson_order} {l.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  ใช้บอกว่าโค้ดนี้แปะอยู่กับคลิป/คอร์สไหน — ไม่ได้จำกัดว่าต้องซื้อคอร์สนั้น ลูกค้าใช้ได้ทั้งซื้อคอร์สและสมัครสมาชิก
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c === true })} />
                เปิดใช้งาน (ปิด = ลูกค้ากรอกแล้วขึ้น "โค้ดนี้ปิดใช้งานแล้ว" สถิติเดิมยังอยู่)
              </label>
            </div>
          )}
          <DialogFooter className="px-6 py-4 border-t border-border">
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-[#FFB300] hover:bg-[#FF9D00] text-black" data-testid="admin-code-save">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {form?.id ? 'บันทึก' : 'สร้างโค้ด'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== รายการใช้ ===== */}
      <Dialog open={!!usageFor} onOpenChange={(o) => { if (!o) setUsageFor(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
            <DialogTitle>📋 รายการใช้โค้ด <span className="font-mono text-[#FFB300]">{usageFor?.code}</span></DialogTitle>
            <DialogDescription className="text-xs">
              {usageFor ? `สมัครสำเร็จ ${usageFor.count_success} คน (คอร์ส ${usageFor.count_course} · สมาชิก ${usageFor.count_sub})${usageFor.count_pending ? ` · รออนุมัติ ${usageFor.count_pending}` : ''} · ยอด ${fmtBaht(usageFor.revenue)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {usageLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[#FFB300]" /></div>
            ) : usage.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">ยังไม่มีใครใช้โค้ดนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3">วันที่</th>
                      <th className="py-2 pr-3">ประเภท</th>
                      <th className="py-2 pr-3">รายการ</th>
                      <th className="py-2 pr-3">ลูกค้า</th>
                      <th className="py-2 pr-3 text-right">ยอด</th>
                      <th className="py-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((u) => (
                      <tr key={`${u.type}-${u.ref_id}`} className="border-b border-border/50">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(u.created_at)}</td>
                        <td className="py-2 pr-3">{u.type === 'course' ? '📚 คอร์ส' : '⭐ สมาชิก'}</td>
                        <td className="py-2 pr-3 max-w-[220px] truncate">{u.item}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{u.user_email}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{u.amount == null ? '—' : fmtBaht(u.amount)}</td>
                        <td className="py-2">
                          <span className={`text-[11px] rounded-full px-2 py-0.5 ${u.status === 'approved' || u.status === 'autoapprove' || u.status === 'admin' || u.status === 'stripe' ? 'bg-green-500/15 text-green-400' : u.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400' : 'bg-muted text-muted-foreground'}`}>
                            {u.status === 'approved' ? 'อนุมัติแล้ว' : u.status === 'pending' ? 'รออนุมัติ' : u.status === 'rejected' ? 'ปฏิเสธ' : u.status === 'autoapprove' ? 'ชำระแล้ว' : u.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== ลบ ===== */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบโค้ด "{deleting?.code}"?</AlertDialogTitle>
            <AlertDialogDescription>โค้ดนี้ยังไม่เคยถูกใช้ — ลบแล้วลูกค้าจะกรอกโค้ดนี้ไม่ได้อีก</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId != null}>เก็บไว้</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={busyId != null} className="bg-red-600 text-destructive-foreground hover:bg-red-700">
              {busyId != null ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} ยืนยันลบ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
