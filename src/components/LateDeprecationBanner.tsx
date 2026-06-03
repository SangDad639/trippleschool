import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '@/lib/api';

export const LateDeprecationBanner: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [hasLateKey, setHasLateKey] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('lateDeprecationDismissed') === 'true';
  });

  useEffect(() => {
    if (!user) return;
    api.getApiKeys().then((keys: any) => {
      setHasLateKey(!!keys.late?.hasKey);
    }).catch(() => {});
  }, [user]);

  if (!user || !hasLateKey || dismissed || new Date() >= new Date('2026-04-28T00:00:00.000Z')) return null;

  return (
    <div className="relative px-4 py-2.5 shadow-md" style={{ background: 'linear-gradient(to right, #FFA500, #FFD700)' }}>
      <div className="flex items-center justify-center gap-2 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
        <span className="text-black font-medium">ยกเลิกบริการโพสต์ผ่าน</span>
        <span className="inline-flex items-center bg-zinc-800 text-red-500 text-xs font-bold px-2 py-0.5 rounded-[5px] border border-zinc-700">Late</span>
        <span className="text-black font-medium">นำออกระบบใน</span>
        <span className="inline-flex items-center bg-white text-black text-xs font-bold px-2 py-0.5 rounded-[5px] border border-black/10">28 เมษายน 2569</span>
      </div>
      <button
        onClick={() => {
          sessionStorage.setItem('lateDeprecationDismissed', 'true');
          setDismissed(true);
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-black/50 hover:text-black"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
