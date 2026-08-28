import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Check,
  X,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  ArrowLeft,
  RefreshCcw,
  Image as ImageIcon,
  Eye,
  Search,
} from 'lucide-react';

interface Enrollment {
  id: number;
  user_id: number;
  user_email: string;
  course_id: number;
  course_name: string;
  course_slug: string;
  status: string;
  rejection_reason: string;
  slip_url: string;
  price: number;
  discount_price: number | null;
  paid_amount: number | string | null;
  refcode: string | null;
  progress_percent: number;
  enrolled_at: string;
  approved_at: string;
  approved_by_email: string;
}

interface Stats {
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  total_count: number;
}

interface Course {
  id: number;
  name: string;
  slug: string;
}

const AdminEnrollments = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('pending');
  const [courseFilter, setCourseFilter] = useState('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Reject / revoke dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingEnrollment, setRejectingEnrollment] = useState<Enrollment | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Slip preview dialog
  const [slipPreviewOpen, setSlipPreviewOpen] = useState(false);
  const [previewSlipUrl, setPreviewSlipUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadEnrollments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, courseFilter, page, debouncedSearch]);

  // Debounce the email search box → server-side search across ALL pages.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(emailSearch.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [emailSearch]);

  const loadData = async () => {
    await Promise.all([loadEnrollments(), loadStats(), loadCourses()]);
  };

  const loadCourses = async () => {
    try {
      const data = await api.getAdminCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadStats = async () => {
    try {
      const data = await api.getEnrollmentStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadEnrollments = async () => {
    try {
      setLoading(true);
      const data = await api.getAdminEnrollments({
        status: statusFilter === 'all' ? undefined : statusFilter,
        course_id: courseFilter === 'all' ? undefined : parseInt(courseFilter),
        search: debouncedSearch || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setEnrollments(data.enrollments);
      setTotal(data.total);
      setSelectedIds([]);
    } catch (error) {
      console.error('Failed to load enrollments:', error);
      toast.error('โหลดข้อมูลการสมัครเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (enrollment: Enrollment) => {
    try {
      setProcessing(true);
      await api.approveEnrollment(enrollment.id);
      toast.success(`อนุมัติ ${enrollment.user_email} สำเร็จ`);
      loadData();
    } catch (error: any) {
      toast.error(error?.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenRejectDialog = (enrollment: Enrollment) => {
    setRejectingEnrollment(enrollment);
    setRejectReason('');
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectingEnrollment) return;

    try {
      setProcessing(true);
      // Revoke for approved enrollments, reject for pending ones.
      if (rejectingEnrollment.status === 'approved') {
        await api.revokeEnrollment(rejectingEnrollment.id, rejectReason);
        toast.success(`เพิกถอน ${rejectingEnrollment.user_email} สำเร็จ`);
      } else {
        await api.rejectEnrollment(rejectingEnrollment.id, rejectReason);
        toast.success(`ปฏิเสธ ${rejectingEnrollment.user_email} สำเร็จ`);
      }
      setRejectDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(error?.message || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;

    try {
      setProcessing(true);
      await api.bulkApproveEnrollments(selectedIds);
      toast.success(`อนุมัติ ${selectedIds.length} รายการสำเร็จ`);
      loadData();
    } catch (error: any) {
      toast.error(error?.message || 'อนุมัติไม่สำเร็จ');
    } finally {
      setProcessing(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(enrollments.filter((e) => e.status === 'pending').map((e) => e.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('th-TH');
  };

  const formatPrice = (e: Enrollment) => {
    // ยอดที่ต้องโอนจริง — ถ้าซื้อพร้อมโค้ดผู้แนะนำ paid_amount = ราคาหลังส่วนลด
    const effective = e.paid_amount != null
      ? Number(e.paid_amount)
      : (e.discount_price != null && e.discount_price < e.price ? e.discount_price : e.price);
    if (Number(effective) === 0) return 'ฟรี';
    return `฿${Number(effective).toLocaleString()}`;
  };

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    pending: { color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', icon: <Clock className="h-3 w-3" /> },
    approved: { color: 'bg-green-500/10 text-green-500 border-green-500/20', icon: <CheckCircle className="h-3 w-3" /> },
    rejected: { color: 'bg-red-500/10 text-red-500 border-red-500/20', icon: <XCircle className="h-3 w-3" /> },
  };

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ไม่มีสิทธิ์เข้าถึง</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / pageSize);
  const pendingEnrollments = enrollments.filter((e) => e.status === 'pending');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" onClick={() => navigate('/admin')} className="mb-2 -ml-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              กลับ
            </Button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-purple-400" />
              อนุมัติสมัครเรียน
            </h1>
          </div>
          <Button variant="outline" onClick={loadData}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            รีเฟรช
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card
              className={`cursor-pointer ${statusFilter === 'pending' ? 'ring-2 ring-yellow-500' : ''}`}
              onClick={() => { setStatusFilter('pending'); setPage(1); }}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-400">{stats.pending_count}</p>
                <p className="text-muted-foreground text-sm">รออนุมัติ</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'approved' ? 'ring-2 ring-green-500' : ''}`}
              onClick={() => { setStatusFilter('approved'); setPage(1); }}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-400">{stats.approved_count}</p>
                <p className="text-muted-foreground text-sm">อนุมัติแล้ว</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'rejected' ? 'ring-2 ring-red-500' : ''}`}
              onClick={() => { setStatusFilter('rejected'); setPage(1); }}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-400">{stats.rejected_count}</p>
                <p className="text-muted-foreground text-sm">ปฏิเสธ</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'all' ? 'ring-2 ring-purple-500' : ''}`}
              onClick={() => { setStatusFilter('all'); setPage(1); }}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{stats.total_count}</p>
                <p className="text-muted-foreground text-sm">ทั้งหมด</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters: course + email search on one row */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {/* Course Filter */}
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">กรองตามคอร์ส:</span>
          <Select value={courseFilter} onValueChange={(value) => { setCourseFilter(value); setPage(1); }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="เลือกคอร์ส" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกคอร์ส</SelectItem>
              {courses.map((course) => (
                <SelectItem key={course.id} value={course.id.toString()}>
                  {course.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {courseFilter !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => { setCourseFilter('all'); setPage(1); }}>
              ล้าง
            </Button>
          )}
        </div>

        {/* Email search (server-side, across all pages) */}
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">ค้นหาอีเมล:</span>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={emailSearch}
              onChange={(e) => setEmailSearch(e.target.value)}
              placeholder="พิมพ์อีเมล..."
              className="pl-8"
            />
          </div>
          {emailSearch && (
            <Button variant="ghost" size="sm" onClick={() => setEmailSearch('')}>
              ล้าง
            </Button>
          )}
        </div>
        </div>

        {/* Bulk Actions */}
        {selectedIds.length > 0 && (
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg flex items-center justify-between">
            <span className="text-purple-400">เลือก {selectedIds.length} รายการ</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleBulkApprove} disabled={processing} className="bg-green-600 hover:bg-green-700">
                {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Check className="h-4 w-4 mr-1" />
                อนุมัติทั้งหมด
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedIds([])}>
                ยกเลิก
              </Button>
            </div>
          </div>
        )}

        {/* Enrollments Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              </div>
            ) : enrollments.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <p className="text-muted-foreground">ไม่มีรายการสมัครเรียน</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {statusFilter === 'pending' && (
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedIds.length === pendingEnrollments.length && pendingEnrollments.length > 0}
                          onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                        />
                      </TableHead>
                    )}
                    <TableHead>ผู้ใช้</TableHead>
                    <TableHead>คอร์ส</TableHead>
                    <TableHead>ราคา</TableHead>
                    <TableHead>สลิป</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>วันที่สมัคร</TableHead>
                    <TableHead className="text-right">จัดการ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.map((enrollment) => {
                    const config = statusConfig[enrollment.status] ?? statusConfig.pending!;
                    const isPending = enrollment.status === 'pending';

                    return (
                      <TableRow key={enrollment.id}>
                        {statusFilter === 'pending' && (
                          <TableCell>
                            {isPending && (
                              <Checkbox
                                checked={selectedIds.includes(enrollment.id)}
                                onCheckedChange={(checked) => handleSelectOne(enrollment.id, checked as boolean)}
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell>{enrollment.user_email}</TableCell>
                        <TableCell className="text-muted-foreground">{enrollment.course_name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatPrice(enrollment)}
                          {enrollment.refcode && (
                            <span className="block text-[10px] text-green-500">🎟️ {enrollment.refcode}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {enrollment.slip_url ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPreviewSlipUrl(api.mediaUrl(enrollment.slip_url));
                                setSlipPreviewOpen(true);
                              }}
                              className="text-blue-400 border-blue-400/50 hover:bg-blue-400/10"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              ดูสลิป
                            </Button>
                          ) : (
                            <span className="text-gray-500 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${config.color} border`}>
                            {config.icon}
                            <span className="ml-1">
                              {enrollment.status === 'pending' && 'รออนุมัติ'}
                              {enrollment.status === 'approved' && 'อนุมัติแล้ว'}
                              {enrollment.status === 'rejected' && 'ปฏิเสธ'}
                            </span>
                          </Badge>
                          {enrollment.rejection_reason && (
                            <p className="text-red-400 text-xs mt-1">{enrollment.rejection_reason}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-sm">{formatDate(enrollment.enrolled_at)}</span>
                          {enrollment.approved_at && (
                            <p className="text-green-400 text-xs">
                              อนุมัติ: {formatDate(enrollment.approved_at)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isPending && (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleApprove(enrollment)}
                                disabled={processing}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleOpenRejectDialog(enrollment)}
                                disabled={processing}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {enrollment.status === 'approved' && (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenRejectDialog(enrollment)}
                                disabled={processing}
                                className="text-red-400 border-red-400/50"
                              >
                                เพิกถอน
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1}>
              ก่อนหน้า
            </Button>
            <span className="text-muted-foreground">
              หน้า {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
              ถัดไป
            </Button>
          </div>
        )}

        {/* Reject / Revoke Dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {rejectingEnrollment?.status === 'approved' ? 'เพิกถอนการสมัครเรียน' : 'ปฏิเสธการสมัครเรียน'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                {rejectingEnrollment?.status === 'approved'
                  ? `คุณต้องการเพิกถอนการสมัครเรียนของ ${rejectingEnrollment?.user_email} สำหรับคอร์ส "${rejectingEnrollment?.course_name}" หรือไม่?`
                  : `คุณต้องการปฏิเสธการสมัครเรียนของ ${rejectingEnrollment?.user_email} สำหรับคอร์ส "${rejectingEnrollment?.course_name}" หรือไม่?`}
              </p>
              <div>
                <Label>เหตุผล (ไม่บังคับ)</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="ระบุเหตุผล..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={processing}>
                {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {rejectingEnrollment?.status === 'approved' ? 'เพิกถอน' : 'ปฏิเสธ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Slip Preview Dialog */}
        <Dialog open={slipPreviewOpen} onOpenChange={setSlipPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-purple-400" />
                สลิปการโอนเงิน
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center bg-gray-900 rounded-lg p-4 min-h-[300px]">
              {previewSlipUrl ? (
                <img
                  src={previewSlipUrl}
                  alt="Payment Slip"
                  className="max-w-full max-h-[500px] object-contain rounded"
                />
              ) : (
                <div className="text-gray-500">ไม่มีรูปสลิป</div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSlipPreviewOpen(false)}>
                ปิด
              </Button>
              {previewSlipUrl && (
                <Button
                  onClick={() => window.open(previewSlipUrl, '_blank')}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  เปิดในแท็บใหม่
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default AdminEnrollments;
