import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api';
import StarRating from '@/components/StarRating';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface WriteReviewFormProps {
  courseId: number | string;
  /** Existing rating to prefill the picker (e.g. user's previous review). */
  initialRating?: number;
  /** Existing comment to prefill. */
  initialComment?: string;
  /** Called after a successful submit so the parent can refresh the list. */
  onSubmitted?: () => void;
}

/** Star picker + comment textarea → POST review (auth + approved enrollment). */
const WriteReviewForm = ({ courseId, initialRating = 0, initialComment = '', onSubmitted }: WriteReviewFormProps) => {
  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) {
      toast.error('กรุณาให้คะแนนดาว ⭐');
      return;
    }
    try {
      setSubmitting(true);
      await api.submitReview(courseId, { rating, comment: comment.trim() || undefined });
      toast.success('ขอบคุณสำหรับรีวิว 🙏');
      onSubmitted?.();
    } catch (error: any) {
      // On 403 (no approved enrollment) the BE returns a Thai message; show it.
      toast.error(error?.message || 'ส่งรีวิวไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-md bg-gray-800/40 border border-gray-700/60 p-4 space-y-3">
      <div>
        <p className="text-white text-sm font-medium mb-2">เขียนรีวิวคอร์สนี้ ✍️</p>
        <StarRating value={rating} editable onChange={setRating} size={24} />
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="บอกเล่าประสบการณ์การเรียนของคุณ (ไม่บังคับ)"
        className="bg-gray-900/50 border-gray-700 text-white text-sm"
      />
      <Button onClick={handleSubmit} disabled={submitting} className="bg-purple-600 hover:bg-purple-700 h-8 text-sm">
        {submitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
        ส่งรีวิว
      </Button>
    </div>
  );
};

export default WriteReviewForm;
