/**
 * InsufficientCreditsModal — shown when a generation route returns
 * `errorCode: 'insufficient_credits'`. Adapted from sora-spark-forge's
 * version; uses trippleviral's accent color (#FFB300) and Dialog primitives.
 */
import { AlertCircle, CircleDollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';

interface InsufficientCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Cost of the operation user tried to do. */
  required: number;
  /** User's current balance returned by the server (post-failed-deduct). */
  current: number;
}

export function InsufficientCreditsModal({
  isOpen,
  onClose,
  required,
  current,
}: InsufficientCreditsModalProps) {
  const navigate = useNavigate();

  const handleTopUp = () => {
    onClose();
    navigate('/credits/topup');
  };

  const needed = Math.max(0, required - current);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="border-destructive/40">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <DialogTitle>เครดิตไม่พอ</DialogTitle>
          </div>
          <DialogDescription className="pt-4 space-y-2 text-sm">
            <span className="block">เครดิตของคุณไม่พอสำหรับการทำงานนี้</span>
            <span className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-muted-foreground">เครดิตปัจจุบัน</span>
              <span className="font-bold text-base">{current.toLocaleString()} credits</span>
            </span>
            <span className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <span className="text-muted-foreground">ต้องการ</span>
              <span className="font-bold text-base text-destructive">
                {required.toLocaleString()} credits
              </span>
            </span>
            <span className="flex items-center justify-between p-3 rounded-lg bg-[#FFB300]/10 border border-[#FFB300]/20">
              <span className="text-muted-foreground">ต้องเติมเพิ่ม</span>
              <span className="font-bold text-base text-[#FFB300]">
                {needed.toLocaleString()} credits
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            ปิด
          </Button>
          <Button
            onClick={handleTopUp}
            className="bg-[#FFB300] hover:bg-[#FFB300]/85 text-black"
          >
            <CircleDollarSign className="mr-2 h-4 w-4" />
            เติมเครดิต
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
