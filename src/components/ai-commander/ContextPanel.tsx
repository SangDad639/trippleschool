/**
 * ContextPanel — compact summary panel inside AgentDrawer.
 *
 * Shows credits + subscription + active video/image jobs. Polls every 30s,
 * faster (10s) when any job is in flight. Uses existing api methods —
 * doesn't introduce new endpoints.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Coins, Calendar, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface SubscriptionInfo {
  hasSubscription: boolean;
  subscription: {
    planType: string;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd?: boolean;
  } | null;
}

interface ActiveJob {
  kind: 'image' | 'video';
  source: string;
  task_id: string;
  prompt: string | null;
  status: string;
  result_url: string | null;
  created_at: string;
}

const ACTIVE_STATUSES = new Set(['pending', 'processing', 'running', 'queued']);

export function ContextPanel() {
  const { user, refreshUser } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [sub, images, videos] = await Promise.all([
        api.getSubscription() as Promise<SubscriptionInfo>,
        api.nanoBanana2History({ limit: 5 }).catch(() => ({ items: [], total: 0 })),
        api.kling3MotionControlHistory({ limit: 5 }).catch(() => ({ items: [], total: 0 })),
      ]);
      setSubscription(sub);
      await refreshUser();
      const merged: ActiveJob[] = [
        ...(images.items || []).map(
          (t: any): ActiveJob => ({
            kind: 'image',
            source: 'nano-banana-2',
            task_id: t.task_id,
            prompt: t.prompt,
            status: t.status,
            result_url: t.result_url,
            created_at: t.created_at,
          }),
        ),
        ...(videos.items || []).map(
          (t: any): ActiveJob => ({
            kind: 'video',
            source: 'kling-3',
            task_id: t.task_id,
            prompt: t.prompt,
            status: t.status,
            result_url: t.result_url || t.video_url,
            created_at: t.created_at,
          }),
        ),
      ];
      merged.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setActiveJobs(merged);
    } catch (err) {
      console.warn('[ContextPanel] load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const anyRunning = activeJobs.some((j) => ACTIVE_STATUSES.has(j.status));
    const handle = setInterval(load, anyRunning ? 10_000 : 30_000);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs.length > 0 && activeJobs.some((j) => ACTIVE_STATUSES.has(j.status))]);

  const credits = user?.credits ?? 0;
  const planLabel = subscription?.hasSubscription
    ? subscription.subscription?.planType === 'yearly'
      ? 'รายปี'
      : 'รายเดือน'
    : 'ยังไม่สมัคร';
  const expiryDate = subscription?.subscription?.currentPeriodEnd
    ? new Date(subscription.subscription.currentPeriodEnd)
    : null;
  const daysLeft = expiryDate
    ? Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="space-y-2 p-3">
      <Card className="p-3 bg-card/40 border-[#FFB300]/15">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins className="h-3.5 w-3.5" />
            Credits
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="text-xl font-semibold text-[#FFB300]">
          {credits.toLocaleString()}
        </div>
      </Card>

      <Card className="p-3 bg-card/40 border-[#FFB300]/15">
        <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Subscription
        </div>
        <div className="text-sm font-medium text-foreground">{planLabel}</div>
        {subscription?.hasSubscription && expiryDate && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            หมด {expiryDate.toLocaleDateString('th-TH')} ({daysLeft} วัน)
          </div>
        )}
      </Card>

      {activeJobs.length > 0 && (
        <Card className="p-3 bg-card/40 border-[#FFB300]/15">
          <div className="text-xs text-muted-foreground mb-1.5 flex items-center justify-between">
            <span>งานล่าสุด</span>
            <span className="text-[9px] text-muted-foreground">
              {activeJobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length} running
            </span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {activeJobs.slice(0, 6).map((j) => (
              <div
                key={`${j.kind}-${j.task_id}`}
                className="text-[11px] border-b border-border/40 pb-1 last:border-0"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1 py-px rounded text-[8px] uppercase shrink-0 ${
                      j.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : j.status === 'failed'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                    }`}
                  >
                    {j.status}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{j.source}</span>
                  {j.result_url && (
                    <a
                      href={j.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#FFB300] hover:underline ml-auto text-[9px]"
                    >
                      open
                    </a>
                  )}
                </div>
                <div className="text-[10px] text-foreground truncate" title={j.prompt || ''}>
                  {j.prompt || '(no prompt)'}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
