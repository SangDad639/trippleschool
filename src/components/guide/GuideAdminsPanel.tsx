import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, type GuideAdminDto } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, ShieldCheck, UserPlus, KeyRound, X } from 'lucide-react';

/** ตรงกับ PASSWORD_MIN ฝั่ง server (routes/guide.ts) */
const PASSWORD_MIN = 8;
const SUGGESTED_EMAIL = 'adminguide@triple-school.com';

/**
 * ผู้ดูแลคู่มือ — บัญชีที่แก้ได้เฉพาะคลิปในหน้า /guide เท่านั้น
 * ไม่เห็นแดชบอร์ด ไม่เห็นผู้ใช้ รายได้ การอนุมัติ หรือค่าคอมมิชชั่น
 *
 * แผงนี้แสดงเฉพาะแอดมินเต็มระบบ (ฝั่ง API ก็ล็อกด้วย requireAdmin อีกชั้น)
 * ผู้ดูแลคู่มือจึงตั้งสิทธิ์ให้ตัวเองหรือคนอื่นไม่ได้
 *
 * รหัสผ่านถูกพิมพ์ในหน้านี้แล้วส่งไปเข้ารหัสที่เซิร์ฟเวอร์ — ไม่มีการเก็บรหัสผ่าน
 * ไว้ในโค้ดหรือไฟล์ config ที่ไหนเลย
 */
const GuideAdminsPanel = () => {
  const [admins, setAdmins] = useState<GuideAdminDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(SUGGESTED_EMAIL);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<GuideAdminDto | null>(null);
  const [resetTarget, setResetTarget] = useState<GuideAdminDto | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = async () => {
    try {
      setAdmins(await api.getGuideAdmins());
    } catch (err: any) {
      toast.error(err?.message || 'โหลดรายชื่อผู้ดูแลคู่มือไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grant = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('ใส่อีเมลก่อน');
      return;
    }
    setSaving(true);
    try {
      const result = await api.grantGuideAdmin(trimmed, password || undefined);
      toast.success(result.created ? 'สร้างบัญชีผู้ดูแลคู่มือแล้ว' : 'ให้สิทธิ์บัญชีเดิมแล้ว');
      setPassword('');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ให้สิทธิ์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.revokeGuideAdmin(revokeTarget.id);
      toast.success('ถอนสิทธิ์แล้ว');
      setAdmins((prev) => prev.filter((a) => a.id !== revokeTarget.id));
    } catch (err: any) {
      toast.error(err?.message || 'ถอนสิทธิ์ไม่สำเร็จ');
    } finally {
      setRevokeTarget(null);
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    if (newPassword.length < PASSWORD_MIN) {
      toast.error(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`);
      return;
    }
    try {
      await api.resetGuideAdminPassword(resetTarget.id, newPassword);
      toast.success('เปลี่ยนรหัสผ่านแล้ว');
      setResetTarget(null);
      setNewPassword('');
    } catch (err: any) {
      toast.error(err?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    }
  };

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#FFB300]" />
        <h2 className="text-sm font-semibold">ผู้ดูแลคู่มือ</h2>
        <span className="text-xs text-muted-foreground">— บัญชีที่แก้ได้เฉพาะคลิปหน้านี้</span>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          {/* เพิ่มสิทธิ์ / สร้างบัญชีใหม่ */}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <Label className="text-xs">อีเมล</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="adminguide@triple-school.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">รหัสผ่าน (เฉพาะตอนสร้างบัญชีใหม่)</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`อย่างน้อย ${PASSWORD_MIN} ตัวอักษร`}
                className="mt-1"
              />
            </div>
            <Button onClick={grant} disabled={saving} className="gap-1.5 bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              ให้สิทธิ์
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            อีเมลที่มีบัญชีอยู่แล้ว → ให้สิทธิ์บัญชีเดิม (ไม่ต้องใส่รหัสผ่าน) · อีเมลใหม่ → สร้างบัญชีให้พร้อมรหัสผ่านที่ตั้งไว้
            <br />
            สิทธิ์ติดอยู่กับ token ผู้ใช้ต้อง<b>ออกจากระบบแล้วเข้าใหม่</b>ถึงจะเห็นเมนูจัดการคลิปคู่มือ
          </p>

          {/* รายชื่อปัจจุบัน */}
          <div className="border-t border-border pt-3">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : admins.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">ยังไม่มีผู้ดูแลคู่มือ</p>
            ) : (
              <ul className="space-y-2">
                {admins.map((admin) => (
                  <li key={admin.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{admin.email}</span>
                    {admin.is_admin && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        แอดมินเต็มระบบอยู่แล้ว
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => {
                        setResetTarget(admin);
                        setNewPassword('');
                      }}
                    >
                      <KeyRound className="h-3 w-3" /> ตั้งรหัสผ่านใหม่
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-red-400 hover:text-red-400"
                      onClick={() => setRevokeTarget(admin)}
                    >
                      <X className="h-3 w-3" /> ถอนสิทธิ์
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ถอนสิทธิ์ผู้ดูแลคู่มือ?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.email} จะแก้คลิปคู่มือไม่ได้อีก — บัญชียังอยู่และใช้งานเป็นสมาชิกทั่วไปได้ตามปกติ
              (มีผลหลังผู้ใช้ออกจากระบบแล้วเข้าใหม่)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={revoke} className="bg-red-600 hover:bg-red-700">
              ถอนสิทธิ์
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ตั้งรหัสผ่านใหม่</AlertDialogTitle>
            <AlertDialogDescription>
              ตั้งรหัสผ่านใหม่ให้ {resetTarget?.email} แล้วแจ้งเจ้าตัวเอง — ระบบยังไม่มีหน้ารีเซ็ตรหัสผ่านด้วยตัวเอง
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`อย่างน้อย ${PASSWORD_MIN} ตัวอักษร`}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={resetPassword} className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90">
              บันทึก
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default GuideAdminsPanel;
