import { useState } from 'react';
import { ClipboardList, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import CourseMultiSelect from '@/components/CourseMultiSelect';
import {
  PURCHASE_SURVEY_COURSES_MAX,
  PURCHASE_SURVEY_REASON_MAX,
  purchaseRefToInput,
  type PurchaseRef,
} from '@/types/purchaseSurvey';

/**
 * แบบสอบถามหลังซื้อ 2 ข้อ (079) — ใช้ร่วมกัน 2 จุด:
 *   · CheckoutComplete (สมาชิกรายเดือน/รายปี): การ์ดใต้หัว "สมัครสมาชิกสำเร็จ!" countdown หยุดรอ
 *   · CourseDetail (คอร์สเดี่ยว): ใน Dialog หลังส่งสลิป (embedded = ไม่มีกรอบ/หัวของตัวเอง)
 *   ข้อ 1 เหตุผลที่ซื้อ (ไม่บังคับ ≤ 500) · ข้อ 2 คอร์สที่สนใจ (CourseMultiSelect) · ว่างทั้งคู่ = ข้าม
 *   ส่ง/ข้ามเสร็จเรียก onDone() — ข้ามส่ง skipped=true ไว้กันถามซ้ำ (server ไม่ทับคำตอบที่เคยส่ง)
 */
interface PurchaseSurveyProps {
  purchase: PurchaseRef;
  onDone: () => void;
  /** true = ไม่มีกรอบการ์ด/หัวข้อ (ผู้เรียกมีหัวของตัวเองแล้ว เช่น Dialog) */
  embedded?: boolean;
}

const PurchaseSurvey = ({ purchase, onDone, embedded = false }: PurchaseSurveyProps) => {
  const [reason, setReason] = useState('');
  const [courseIds, setCourseIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const busy = submitting || skipping;
  const isEmpty = reason.trim() === '' && courseIds.length === 0;

  const skip = async () => {
    setSkipping(true);
    try {
      await api.submitPurchaseSurvey({ ...purchaseRefToInput(purchase), skipped: true });
    } catch (e) {
      // ข้ามไม่สำเร็จก็ปล่อยผ่าน — ห้ามขังผู้ใช้ไว้หน้านี้
      console.error('Purchase survey skip failed:', e);
    } finally {
      setSkipping(false);
      onDone();
    }
  };

  const submit = async () => {
    if (isEmpty) return skip();
    setSubmitting(true);
    try {
      await api.submitPurchaseSurvey({
        ...purchaseRefToInput(purchase),
        reason: reason.trim() || undefined,
        course_ids: courseIds,
      });
      toast.success('ขอบคุณสำหรับคำตอบ 🙏');
      onDone();
    } catch (e: any) {
      toast.error(e?.message || 'ส่งคำตอบไม่สำเร็จ ลองใหม่หรือกดข้ามได้');
    } finally {
      setSubmitting(false);
    }
  };

  const body = (
    <div className="space-y-4 text-left" data-testid="purchase-survey">
      {!embedded && (
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#FFB300]/15 flex items-center justify-center shrink-0">
            <ClipboardList className="h-5 w-5 text-[#FFB300]" />
          </div>
          <div>
            <div className="font-semibold text-base">ช่วยตอบ 2 ข้อสั้น ๆ ก่อนไปต่อ 🙏</div>
            <p className="text-xs text-muted-foreground mt-0.5">ใช้เวลาไม่ถึง 1 นาที — คำตอบช่วยให้เราทำคอร์สให้ตรงใจคุณมากขึ้น</p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="purchase-survey-reason" className="text-sm font-medium">
          1. เหตุผลที่ตัดสินใจซื้อ{purchase.type === 'course' ? 'คอร์สนี้' : 'ครั้งนี้'}
        </label>
        <Textarea
          id="purchase-survey-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, PURCHASE_SURVEY_REASON_MAX))}
          rows={3}
          maxLength={PURCHASE_SURVEY_REASON_MAX}
          disabled={busy}
          placeholder={
            purchase.type === 'course'
              ? 'เช่น อยากทำคลิปขายสินค้าของตัวเอง / ชอบตัวอย่างในคลิปโปรโมท…'
              : 'เช่น อยากทำคลิปขายของเอง / เห็นรีวิวจากเพื่อน / อยากเปลี่ยนสายงานมาทำคอนเทนต์…'
          }
          className="bg-gray-900/50 border-gray-700 resize-none"
          data-testid="purchase-survey-reason"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>ไม่บังคับ พิมพ์สั้น ๆ ได้เลย</span>
          <span>{reason.length} / {PURCHASE_SURVEY_REASON_MAX}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="purchase-survey-courses" className="text-sm font-medium">
          2. สนใจคอร์สไหนเป็นพิเศษ (เลือกได้หลายคอร์ส)
        </label>
        <CourseMultiSelect
          id="purchase-survey-courses"
          value={courseIds}
          onChange={setCourseIds}
          excludeIds={purchase.type === 'course' ? [purchase.courseId] : []}
          max={PURCHASE_SURVEY_COURSES_MAX}
          disabled={busy}
        />
        <div className="text-[11px] text-muted-foreground">
          เริ่มจากคอร์สล่าสุด เลื่อนลงเพื่อดูคอร์สอื่น ๆ{purchase.type === 'course' ? ' · คอร์สที่เพิ่งซื้อไม่อยู่ในรายการ' : ''}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={submit}
          disabled={busy}
          className="bg-[#FFB300] hover:bg-[#FF9D00] text-black font-semibold h-11 sm:h-10"
          data-testid="purchase-survey-submit"
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          ส่งคำตอบ 🙏
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={skip}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground h-11 sm:h-10"
          data-testid="purchase-survey-skip"
        >
          {skipping ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
          ข้ามไปก่อน
        </Button>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <div className="bg-card p-5 rounded-2xl border border-[#FFB300]/30">
      {body}
    </div>
  );
};

export default PurchaseSurvey;
