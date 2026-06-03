import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

// Hardcoded fallbacks — used when the API call fails (offline / 500 / etc).
// The "active" banner is normally fetched from /api/subscription/welcome-banner/active
// and managed by admin via /admin/banners → "Welcome popup" tab.
const FALLBACK_IMAGE = '/new-image-template.png';
const FALLBACK_LINK = '/app/image-templates';

// localStorage — "don't show again" toggle (cross-session). Key has the
// active image_url suffix so swapping banners re-prompts users who had
// dismissed an older image. This is the ONLY dedup — the checkbox in the
// popup is the user's tool for opting out. The per-mount `dismissed` state
// also prevents re-opening within the same component instance.
const STORAGE_KEY_PREFIX = 'welcome_popup_hidden_image:';

export default function WelcomePopup() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // `link_url` is null when admin configures a display-only banner — clicking
  // the image just dismisses the popup, no navigation.
  const [banner, setBanner] = useState<{ image_url: string; link_url: string | null } | null>(null);

  // Whitelist: only inside the app shell (/app/*). Auth, landing, subscription,
  // profile, tutorials, etc. are deliberately excluded so the popup never
  // appears during a registration/transition flow — that was a primary
  // contributor to the refresh-loop perceived on slow devices.
  const inAppShell = location.pathname.startsWith('/app');

  // Lazy fetch — only call the welcome-banner API when the user has actually
  // reached the app shell. Avoids firing the request mid-transition (which
  // could race with SPA navigation and surface as "popup tries to show before
  // the user even reaches home"). Fetches at most once per mount via the
  // `banner !== null` guard.
  useEffect(() => {
    if (!user || !inAppShell || banner !== null) return;
    let cancelled = false;
    api.getActiveWelcomeBanner()
      .then((b) => {
        if (cancelled) return;
        setBanner(b ?? { image_url: FALLBACK_IMAGE, link_url: FALLBACK_LINK });
      })
      .catch(() => {
        if (cancelled) return;
        setBanner({ image_url: FALLBACK_IMAGE, link_url: FALLBACK_LINK });
      });
    return () => { cancelled = true; };
  }, [user, inAppShell, banner]);

  useEffect(() => {
    if (dismissed || !banner) return;
    const storageKey = STORAGE_KEY_PREFIX + banner.image_url;
    // Cross-session "don't show again" wins first.
    if (localStorage.getItem(storageKey) === '1') return;
    if (user && inAppShell) {
      setOpen(true);
    }
  }, [user, inAppShell, dismissed, banner]);

  const handleClose = () => {
    if (dontShowAgain && banner) {
      localStorage.setItem(STORAGE_KEY_PREFIX + banner.image_url, '1');
    }
    setDismissed(true);
    setOpen(false);
  };

  if (!banner) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl w-[85vw] p-0 overflow-hidden border border-[#FFB300]/30 [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Welcome</DialogTitle>
        <button
          onClick={handleClose}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1.5 text-white shadow-lg transition-colors hover:bg-black"
        >
          <X className="h-6 w-6" />
        </button>
        <img
          src={banner.image_url}
          alt="Welcome"
          className={`w-full h-auto ${banner.link_url ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={() => {
            setDismissed(true);
            setOpen(false);
            // Empty / null link_url → display-only banner. Click just closes.
            const target = banner.link_url?.trim();
            if (!target) return;
            // External URL → window.location; internal route → navigate
            if (/^https?:\/\//i.test(target)) {
              setTimeout(() => { window.location.href = target; }, 150);
            } else {
              setTimeout(() => navigate(target), 150);
            }
          }}
        />
        <label className="group flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-zinc-950 via-[#1a1200] to-zinc-950 border-t border-[#FFB300]/30 text-zinc-300 text-sm cursor-pointer select-none hover:text-[#FFB300] transition-all duration-300">
          <span className={`relative flex items-center justify-center h-4 w-4 rounded-full border-2 transition-all duration-200 ${dontShowAgain ? 'bg-gradient-to-br from-[#FFB300] to-[#FF8C00] border-[#FFB300] shadow-md shadow-[#FFB300]/30' : 'border-zinc-500 bg-zinc-900/50 group-hover:border-[#FFB300]/60'}`}>
            {dontShowAgain && (
              <svg className="h-3 w-3 text-black animate-in zoom-in-50 duration-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="sr-only"
          />
          <span className="font-medium">ไม่ต้องแสดงอีก</span>
        </label>
      </DialogContent>
    </Dialog>
  );
}
