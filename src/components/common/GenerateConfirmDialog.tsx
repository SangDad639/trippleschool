import { useCallback, useState } from 'react';
import { Loader2, Coins, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { Quote } from '@/lib/generationPricing';

type KieBalance = number | 'loading' | 'error' | 'no-key';

interface GenerateConfirmDialogProps {
  open: boolean;
  quote: Quote | null;
  kieBalance: KieBalance;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function GenerateConfirmDialog({
  open,
  quote,
  kieBalance,
  confirming,
  onClose,
  onConfirm,
}: GenerateConfirmDialogProps) {
  const isMulti = (quote?.tasks.length || 0) > 1;
  const insufficient =
    typeof kieBalance === 'number' && quote != null && !quote.hasUnknown && kieBalance < quote.total;
  const remainingAfter =
    typeof kieBalance === 'number' && quote != null ? kieBalance - quote.total : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !confirming) onClose(); }}>
      <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-[#FFB300]" />
            ยืนยันการสร้าง
          </DialogTitle>
        </DialogHeader>

        {quote && (
          <div className="space-y-3">
            {/* Breakdown */}
            {isMulti ? (
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                {quote.tasks.map((task, i) => (
                  <div key={i} className="rounded-md border border-zinc-800 bg-zinc-800/40 px-3 py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">{task.taskLabel}</span>
                      <span className={`font-semibold ${task.unknown ? 'text-zinc-500' : 'text-[#FFC233]'}`}>
                        {task.unknown ? '—' : `${task.subtotal} เครดิต`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {task.lines.map((l) => `${l.label} ${l.detail}`).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {quote.tasks[0]?.lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="text-zinc-300">
                      {l.label}
                      <span className="ml-2 text-[11px] text-zinc-500">{l.detail}</span>
                    </div>
                    <span className="font-medium text-zinc-200">
                      {quote.tasks[0]?.unknown ? '—' : `${l.credits} เครดิต`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Total */}
            <div className="flex items-center justify-between border-t border-zinc-800 pt-2.5">
              <span className="text-sm font-medium text-zinc-300">
                ยอดรวม{isMulti ? ` (${quote.tasks.length} task)` : ''}
              </span>
              <span className="text-lg font-bold text-[#FFB300]">
                {quote.hasUnknown && quote.total === 0 ? '—' : `${quote.total} เครดิต`}
              </span>
            </div>

            {quote.hasUnknown && (
              <p className="text-[11px] text-zinc-500">
                * บาง task ใช้โมเดลที่ยังไม่มีราคา — ยอดรวมอาจไม่ครบ
              </p>
            )}

            {/* KIE balance */}
            <div className="rounded-md bg-zinc-800/60 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">ยอดคงเหลือ KIE</span>
                <span className="text-zinc-200">
                  {kieBalance === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
                  {kieBalance === 'error' && <span className="text-zinc-500">เช็คไม่ได้</span>}
                  {kieBalance === 'no-key' && <span className="text-zinc-500">ยังไม่ตั้งค่า key</span>}
                  {typeof kieBalance === 'number' && (
                    <span className="font-semibold text-zinc-200">
                      {kieBalance.toLocaleString()} เครดิต
                    </span>
                  )}
                </span>
              </div>
              {remainingAfter !== null && !quote?.hasUnknown && (
                <div className="mt-1.5 flex items-center justify-between border-t border-zinc-700/60 pt-1.5 text-[13px]">
                  <span className="text-zinc-400">คงเหลือหลังสร้าง</span>
                  <span className={`font-semibold ${remainingAfter < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {remainingAfter.toLocaleString()} เครดิต
                  </span>
                </div>
              )}
              {insufficient && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  กรุณาเติมเครดิตก่อนกดสร้าง
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={confirming} className="text-zinc-400">
            ยกเลิก
          </Button>
          <Button
            onClick={() => {
              if (insufficient) {
                toast.error('กรุณาเติมเครดิตก่อนกดสร้าง', {
                  position: 'top-center',
                  duration: 4000,
                  className: 'text-base font-semibold',
                });
                return;
              }
              onConfirm();
            }}
            disabled={confirming}
            className={
              insufficient
                ? 'bg-none bg-zinc-700 text-zinc-400 font-semibold cursor-not-allowed shadow-none hover:bg-zinc-700 hover:shadow-none hover:opacity-100'
                : 'bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] text-black font-semibold hover:opacity-90'
            }
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            ยืนยันสร้าง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook ที่จัดการ popup ยืนยันการสร้าง + ดึงยอดคงเหลือ KIE.
 *
 * วิธีใช้:
 *   const { requestConfirm, dialog } = useGenerateConfirm();
 *   // เปลี่ยน onClick เดิมให้เรียก: requestConfirm(quote, () => doGenerate())
 *   // แล้ว render {dialog} ใน JSX
 */
export function useGenerateConfirm() {
  const [pending, setPending] = useState<{ quote: Quote; action: () => void | Promise<void> } | null>(null);
  const [kieBalance, setKieBalance] = useState<KieBalance>('loading');
  const [confirming, setConfirming] = useState(false);

  const requestConfirm = useCallback((quote: Quote, action: () => void | Promise<void>) => {
    setPending({ quote, action });
    setKieBalance('loading');
    api
      .getKieCredit()
      .then((res) => setKieBalance(res.hasKey && typeof res.credit === 'number' ? res.credit : 'no-key'))
      .catch(() => setKieBalance('error'));
  }, []);

  const handleClose = useCallback(() => {
    setPending(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setConfirming(true);
    try {
      await pending.action();
    } finally {
      setConfirming(false);
      setPending(null);
    }
  }, [pending]);

  const dialog = (
    <GenerateConfirmDialog
      open={!!pending}
      quote={pending?.quote ?? null}
      kieBalance={kieBalance}
      confirming={confirming}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />
  );

  return { requestConfirm, dialog };
}

export default GenerateConfirmDialog;
