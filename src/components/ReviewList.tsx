import { useState } from 'react';
import { User, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import StarRating from '@/components/StarRating';
import { Button } from '@/components/ui/button';
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

export interface Review {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: string;
}

const formatThaiDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

interface ReviewListProps {
  reviews: Review[];
  /**
   * แอดมินเท่านั้น — ส่งมาเมื่อผู้ใช้ปัจจุบันเป็นแอดมิน จะโชว์ปุ่ม 🗑 ท้ายรีวิวทุกใบ
   * กดแล้วมีกล่องยืนยันก่อน ค่อยเรียก onDelete (ผู้เรียกจัดการเรียก API + โหลดรายการใหม่)
   * ไม่ส่ง = หน้าตาเดิมทุกประการ
   */
  onDelete?: (review: Review) => Promise<void>;
}

/** Renders the reviews array returned by api.getCourseReviews(). */
const ReviewList = ({ reviews, onDelete }: ReviewListProps) => {
  const [deleting, setDeleting] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    if (!deleting || !onDelete) return;
    setBusy(true);
    try {
      await onDelete(deleting);
      toast.success('ลบรีวิวแล้ว 🗑️');
      setDeleting(null);
    } catch (e: any) {
      toast.error(e?.message || 'ลบรีวิวไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  if (!reviews || reviews.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-6">ยังไม่มีรีวิว</p>;
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <div key={review.id} className="rounded-md bg-gray-800/40 border border-gray-700/60 p-3">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
              <User className="h-4 w-4 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white text-sm font-medium">{review.reviewer}</span>
                <StarRating value={review.rating} size={14} hideValue />
                <span className="text-gray-500 text-xs">{formatThaiDate(review.created_at)}</span>
              </div>
              {review.comment && (
                <p className="text-gray-300 text-sm mt-1.5 whitespace-pre-wrap break-words">{review.comment}</p>
              )}
            </div>
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                title="ลบรีวิวนี้ (แอดมิน)"
                aria-label="ลบรีวิวนี้"
                onClick={() => setDeleting(review)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ))}

      {onDelete && (
        <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !busy) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>🗑️ ลบรีวิวของ "{deleting?.reviewer}"?</AlertDialogTitle>
              <AlertDialogDescription>
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
      )}
    </div>
  );
};

export default ReviewList;
