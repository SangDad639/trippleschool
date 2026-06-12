import { User } from 'lucide-react';
import StarRating from '@/components/StarRating';

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

/** Renders the reviews array returned by api.getCourseReviews(). */
const ReviewList = ({ reviews }: { reviews: Review[] }) => {
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
          </div>
        </div>
      ))}
    </div>
  );
};

export default ReviewList;
