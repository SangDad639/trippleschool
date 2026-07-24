import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import type { AffiliateStats } from '@/types/affiliate';
import {
  ArrowLeft,
  Crown,
  User as UserIcon,
  Users,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import TaxInfoSection from '@/components/profile/TaxInfoSection';
import BankInfoSection from '@/components/profile/BankInfoSection';

const Profile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, t } = useLanguage();

  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refcodeCopied, setRefcodeCopied] = useState(false);

  // Fetch affiliate tier + commission % to render the Tier card.
  // Uses the existing /api/affiliate/my-stats endpoint (single SELECT) so we
  // don't add a new round-trip just for tier display.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setStatsLoading(true);
    (api.getAffiliateStats() as Promise<AffiliateStats>)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((err) => console.error('Failed to load affiliate stats:', err))
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const handleCopyRefcode = () => {
    if (!stats?.refcode) return;
    navigator.clipboard.writeText(stats.refcode);
    setRefcodeCopied(true);
    toast.success(language === 'th' ? 'คัดลอกรหัสแนะนำแล้ว' : 'Refcode copied');
    setTimeout(() => setRefcodeCopied(false), 2000);
  };

  // Resolve tier display. Preferred source is the new `stats.tier` (joined
  // from affiliate_tiers — supports N tiers). Falls back to the legacy
  // `affiliate_tier` integer when stats.tier is missing (e.g. user pre-dates
  // the migration).
  const tierId = stats?.tier?.id ?? stats?.affiliate_tier ?? 1;
  const tierName = stats?.tier?.name || `Tier ${tierId}`;
  const tierBadge = stats?.tier?.badge_color || 'gray';
  // Treat any non-gray badge as "VIP-styled" (gold/diamond). Specifically the
  // pre-N-tier code used `isTier2` to mean "fancy gradient". Keep that visual.
  const isVipStyled = tierBadge !== 'gray';

  return (
    <div className="page-wrapper">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/app')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
              <p className="text-muted-foreground">{t('profile.subtitle')}</p>
            </div>
          </div>

          {/* Account Info */}
          <div className="bg-card p-6 rounded-xl border border-border space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-[#FFB300]/20 flex items-center justify-center">
                <UserIcon className="h-7 w-7 text-[#FFB300]" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{user?.email?.split('@')[0]}</h2>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
              {user?.isSuperAdmin ? (
                <span className="px-3 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-500 font-medium border border-yellow-500/30 flex items-center gap-1">
                  <Crown className="h-3 w-3" />
                  Super Admin
                </span>
              ) : user?.isAdmin ? (
                <span className="px-3 py-1 text-xs rounded-full bg-purple-500/20 text-purple-500 font-medium">{t('profile.admin')}</span>
              ) : null}
            </div>
          </div>

          {/* Affiliate Tier section moved to /affiliate — single home for
              affiliate-related info (tier, refcode, commissions, payouts). */}

          {/* Bank Account section moved to /affiliate — managed alongside
              "วิธีรับเงินค่าคอมมิชชั่น" since it's the same payout target.
              Uncomment to restore inline form here. */}
          {/* <BankInfoSection
            stats={stats}
            onSaved={() => {
              (api.getAffiliateStats() as Promise<AffiliateStats>)
                .then((s) => setStats(s))
                .catch((err) => console.error('Failed to refresh stats:', err));
            }}
          /> */}

          {/* Tax Information section hidden — VAT invoices are issued manually
              by admin via LINE (see notice on /subscription/transfer-v2).
              Uncomment to restore self-service tax info form. */}
          {/* <TaxInfoSection
            bankInfo={stats?.thai_bank_info ?? null}
            onSaved={() => {
              (api.getAffiliateStats() as Promise<AffiliateStats>)
                .then((s) => setStats(s))
                .catch((err) => console.error('Failed to refresh stats:', err));
            }}
          /> */}

        </div>
      </div>
    </div>
  );
};

export default Profile;
