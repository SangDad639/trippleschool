import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Loader2, ExternalLink, CheckCircle2, XCircle, Clock, Copy,
  Facebook, Instagram, Youtube,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PostForMeProviderResult } from '@/types/scheduler';

// Postforme dashboard URL pattern — used as the deep-link target when a provider
// result is failed so the user can jump straight to Postforme's Post Result page
// for debugging. If the actual dashboard URL differs, just adjust this constant.
const POSTFORME_POST_URL = (postId: string) =>
  `https://postforme.dev/posts/${encodeURIComponent(postId)}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;                                    // sp_xxx
  postAt?: string | null;                            // formatted "MM/DD/YYYY HH:mm"
  results: PostForMeProviderResult[] | undefined;    // populated by backend polling
}

const PlatformIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className }) => {
  const p = platform.toLowerCase();
  if (p === 'facebook') return <Facebook className={cn('text-blue-500', className)} />;
  if (p === 'instagram') return <Instagram className={cn('text-pink-500', className)} />;
  if (p === 'youtube') return <Youtube className={cn('text-red-500', className)} />;
  if (p === 'tiktok') return (
    <svg className={cn('text-cyan-400', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-.88-.07A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/>
    </svg>
  );
  if (p === 'twitter' || p === 'x') return (
    <svg className={cn('text-white', className)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
  return <div className={cn('rounded bg-zinc-700', className)} />;
};

const overallStatus = (results: PostForMeProviderResult[] | undefined) => {
  if (!results || results.length === 0) return { text: 'Awaiting status', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  if (results.every(r => r.status === 'success')) return { text: 'Successfully posted', cls: 'bg-green-500/15 text-green-400 border-green-500/30' };
  if (results.every(r => r.status === 'failed')) return { text: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' };
  if (results.some(r => r.status === 'pending')) return { text: 'Pending', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  return { text: 'Partially posted', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
};

export const PostStatusDialog: React.FC<Props> = ({ open, onOpenChange, postId, postAt, results }) => {
  const status = overallStatus(results);
  const hasResults = !!results && results.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle>สถานะการโพสต์</DialogTitle>
          <DialogDescription className="sr-only">Per-platform status of this Postforme post</DialogDescription>
        </DialogHeader>

        {/* Post-level metadata */}
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <span className="w-20 shrink-0 text-zinc-500">Post ID</span>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <code className="text-xs font-mono text-zinc-200 break-all">{postId}</code>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(postId).catch(() => {}); }}
                className="text-zinc-500 hover:text-zinc-200 shrink-0"
                title="Copy Post ID"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-zinc-500">Status</span>
            <span className={cn('inline-flex items-center text-xs px-2 py-0.5 rounded border', status.cls)}>
              {status.text}
            </span>
          </div>
          {postAt && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-zinc-500">Post At</span>
              <span className="text-zinc-200 text-xs font-mono">{postAt}</span>
            </div>
          )}
        </div>

        {/* Per-provider results section — only after Postforme returns spr_xxx data */}
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Providers</div>

          {!hasResults ? (
            <div className="text-center py-4 text-zinc-400 text-sm">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-amber-400" />
              ยังไม่มีข้อมูล provider — ระบบจะดึงสถานะหลังถึงเวลา Post At
            </div>
          ) : (
            <div className="space-y-2">
              {results!.map((r, i) => {
                // Failed → deep-link to Postforme's Post Result page (entire row clickable).
                // Success with platform_url → click opens the actual post on the provider.
                // Pending → not clickable.
                const isFailed = r.status === 'failed';
                const targetHref =
                  isFailed ? POSTFORME_POST_URL(postId) :
                  (r.status === 'success' && r.platform_url) ? r.platform_url :
                  null;

                const Wrapper: React.ElementType = targetHref ? 'a' : 'div';
                const wrapperProps = targetHref
                  ? { href: targetHref, target: '_blank', rel: 'noopener noreferrer' }
                  : {};

                return (
                  <Wrapper
                    key={r.spr_id || `${r.platform}-${i}`}
                    {...wrapperProps}
                    className={cn(
                      'flex items-start gap-3 p-3 bg-zinc-800/50 rounded-md border border-transparent',
                      targetHref && 'hover:bg-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors'
                    )}
                  >
                    <div className="shrink-0 mt-0.5">
                      <PlatformIcon platform={r.platform} className="h-5 w-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium capitalize">{r.platform}</span>
                        {r.status === 'success' && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 className="h-3 w-3" /> Successfully posted
                          </span>
                        )}
                        {r.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-xs text-red-400">
                            <XCircle className="h-3 w-3" /> Failed
                          </span>
                        )}
                        {r.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                            <Clock className="h-3 w-3 animate-pulse" /> Pending
                          </span>
                        )}
                      </div>

                      {r.spr_id && (
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5 break-all">{r.spr_id}</div>
                      )}

                      {isFailed && r.error && (
                        <div className="text-xs text-red-300/80 mt-1 break-words">{r.error}</div>
                      )}

                      {targetHref && (
                        <div className="inline-flex items-center gap-1 text-xs text-blue-400 mt-1.5">
                          <ExternalLink className="h-3 w-3" />
                          {isFailed ? 'View Post Result on Postforme' : 'View on platform'}
                        </div>
                      )}
                    </div>
                  </Wrapper>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PostStatusDialog;
