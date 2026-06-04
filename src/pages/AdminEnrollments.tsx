import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
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
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Reject dialog
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
  }, [user]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadEnrollments();
  }, [statusFilter, courseFilter, page]);

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
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setEnrollments(data.enrollments);
      setTotal(data.total);
      setSelectedIds([]);
    } catch (error) {
      console.error('Failed to load enrollments:', error);
      toast.error('Error: Failed to load enrollments');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (enrollment: Enrollment) => {
    try {
      setProcessing(true);
      await api.approveEnrollment(enrollment.id);
      toast.success(`Success: Approved ${enrollment.user_email}`);
      loadData();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
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
      // Use revoke for approved enrollments, reject for pending
      if (rejectingEnrollment.status === 'approved') {
        await api.revokeEnrollment(rejectingEnrollment.id, rejectReason);
        toast.success(`Success: เพิกถอน ${rejectingEnrollment.user_email} สำเร็จ`);
      } else {
        await api.rejectEnrollment(rejectingEnrollment.id, rejectReason);
        toast.success(`Success: ปฏิเสธ ${rejectingEnrollment.user_email} สำเร็จ`);
      }
      setRejectDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;

    try {
      setProcessing(true);
      await api.bulkApproveEnrollments(selectedIds);
      toast.success(`Success: Approved ${selectedIds.length} enrollments`);
      loadData();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
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

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    pending: { color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', icon: <Clock className="h-3 w-3" /> },
    approved: { color: 'bg-green-500/10 text-green-500 border-green-500/20', icon: <CheckCircle className="h-3 w-3" /> },
    rejected: { color: 'bg-red-500/10 text-red-500 border-red-500/20', icon: <XCircle className="h-3 w-3" /> },
  };

  const totalPages = Math.ceil(total / pageSize);
  const pendingEnrollments = enrollments.filter((e) => e.status === 'pending');

  if (!user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate('/admin')} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับ
        </Button>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Button variant="ghost" onClick={() => navigate('/admin/courses')} className="mb-2 -ml-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              กลับไปจัดการคอร์ส
            </Button>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Users className="h-6 w-6 text-purple-400" />
              จัดการการลงทะเบียน
            </h1>
          </div>
          <Button variant="outline" onClick={loadData}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            รีเฟรช
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card
              className={`cursor-pointer ${statusFilter === 'pending' ? 'ring-2 ring-yellow-500' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-yellow-400">{stats.pending_count}</p>
                <p className="text-gray-400 text-sm">รออนุมัติ</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'approved' ? 'ring-2 ring-green-500' : ''}`}
              onClick={() => setStatusFilter('approved')}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-400">{stats.approved_count}</p>
                <p className="text-gray-400 text-sm">อนุมัติแล้ว</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'rejected' ? 'ring-2 ring-red-500' : ''}`}
              onClick={() => setStatusFilter('rejected')}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-400">{stats.rejected_count}</p>
                <p className="text-gray-400 text-sm">ปฏิเสธ</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer ${statusFilter === 'all' ? 'ring-2 ring-purple-500' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-white">{stats.total_count}</p>
                <p className="text-gray-400 text-sm">ทั้งหมด</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Course Filter */}
        <div className="mb-4 flex items-center gap-3">
          <span className="text-gray-400">กรองตามคอร์ส:</span>
          <Select value={courseFilter} onValueChange={(value) => { setCourseFilter(value); setPage(1); }}>
            <SelectTrigger className="w-64 bg-gray-800/50 border-gray-700 text-white">
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
            <Button variant="ghost" size="sm" onClick={() => setCourseFilter('all')}>
              ล้าง
            </Button>
          )}
        </div>

        {/* Bulk Actions */}
        {selectedIds.length > 0 && (
          <div className="mb-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg flex items-center justify-between">
            <span className="text-purple-400">เลือก {selectedIds.length} รายการ</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleBulkApprove} disabled={processing} className="bg-green-600">
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
                <p className="text-gray-400">ไม่มีการลงทะเบียน</p>
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
                    <TableHead>สลิป</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>วันที่ลงทะเบียน</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell>
                          <span className="text-white">{enrollment.user_email}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-gray-300">{enrollment.course_name}</span>
                        </TableCell>
                        <TableCell>
                          {enrollment.slip_url ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPreviewSlipUrl(enrollment.slip_url);
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
                          <span className="text-gray-400 text-sm">{formatDate(enrollment.enrolled_at)}</span>
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
          <div className="flex items-center justify-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              ก่อนหน้า
            </Button>
            <span className="text-gray-400">
              หน้า {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              ถัดไป
            </Button>
          </div>
        )}

        {/* Reject Dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {rejectingEnrollment?.status === 'approved' ? 'เพิกถอนการลงทะเบียน' : 'ปฏิเสธการลงทะเบียน'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-gray-400">
                {rejectingEnrollment?.status === 'approved'
                  ? `คุณต้องการเพิกถอนการลงทะเบียนของ ${rejectingEnrollment?.user_email} สำหรับคอร์ส "${rejectingEnrollment?.course_name}" หรือไม่?`
                  : `คุณต้องการปฏิเสธการลงทะเบียนของ ${rejectingEnrollment?.user_email} สำหรับคอร์ส "${rejectingEnrollment?.course_name}" หรือไม่?`
                }
              </p>
              <div>
                <Label>เหตุผล (ไม่บังคับ)</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="ระบุเหตุผลที่ปฏิเสธ..."
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
