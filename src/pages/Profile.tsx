import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PRICING } from '@/lib/pricing';
import { api } from '@/lib/api';
import type { AffiliateStats } from '@/types/affiliate';
import {
  ArrowLeft,
  Crown,
  CreditCard,
  Clock,
  User as UserIcon,
  AlertCircle,
  Sparkles,
  Settings2,
  Loader2,
  Users,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import TaxInfoSection from '@/components/profile/TaxInfoSection';
import BankInfoSection from '@/components/profile/BankInfoSection';
import CouponSection from '@/components/profile/CouponSection';
import PaymentHistorySection from '@/components/profile/PaymentHistorySection';

// Stripe is currently disabled (manual-transfer only). When VITE_PAYMENT_MODE
// is anything other than 'stripe' the "จัดการการชำระเงิน" button is hidden —
// the existing /subscription page (Stripe billing portal) isn't useful in
// transfer mode. Flip the env var back to 'stripe' to restore it.
const PAYMENT_MODE = import.meta.env.VITE_PAYMENT_MODE || 'stripe';

const Profile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscription, hasSubscription, loading, refreshSubscription } = useSubscription();
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

  const daysLeft = subscription?.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const dateLang = language === 'th' ? 'th-TH' : 'en-US';

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

          {/* Subscription */}
          <div className="bg-card p-6 rounded-xl border border-border space-y-5">
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-[#FFB300]" />
              <h2 className="text-lg font-semibold">{t('profile.subscription')}</h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : hasSubscription && subscription ? (
              <div className="space-y-4">
                {/* Plan & Status */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                      subscription.planType === 'yearly'
                        ? 'bg-gradient-to-r from-[#FFD700] to-[#FFA500]'
                        : 'bg-blue-500/20'
                    }`}>
                      <Crown className={`h-5 w-5 ${subscription.planType === 'yearly' ? 'text-black' : 'text-blue-500'}`} />
                    </div>
                    <div>
                      <div className="font-semibold">{subscription.planType === 'monthly' ? t('profile.monthlyPlan') : t('profile.yearlyPlan')}</div>
                      <div className="text-xs text-muted-foreground">
                        {subscription.planType === 'monthly'
                          ? `฿${PRICING.monthly.total.toLocaleString()}/เดือน`
                          : `฿${PRICING.yearly.total.toLocaleString()}/ปี`}{' '}
                        <span className="opacity-70">(รวมภาษีมูลค่าเพิ่ม)</span>
                      </div>
                    </div>
                  </div>
                  <span className={`px-3 py-1 text-xs rounded-full font-medium ${
                    subscription.status === 'active' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'
                  }`}>
                    {subscription.status === 'active' ? t('common.active') : subscription.status}
                  </span>
                </div>

                {/* Days Left */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-lg border border-border">
                  <Clock className="h-5 w-5 text-muted-foreground hidden sm:block" />
                  <div className="flex-1">
                    <div className="text-sm text-muted-foreground">{t('profile.remaining')}</div>
                    <div className={`text-xl sm:text-2xl font-bold ${daysLeft <= 7 ? 'text-red-400' : 'text-green-400'}`}>
                      {daysLeft} {t('common.days')}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-sm text-muted-foreground">
                      {subscription.cancelAtPeriodEnd ? t('profile.expires') : t('profile.autoRenew')}
                    </div>
                    <div className="text-sm font-medium">
                      {subscription.currentPeriodEnd
                        ? new Date(subscription.currentPeriodEnd).toLocaleDateString(dateLang, { year: 'numeric', month: 'long', day: 'numeric' })
                        : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Cancel Warning */}
                {subscription.cancelAtPeriodEnd && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                    <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-yellow-500">{t('profile.canceled')}</div>
                      <div className="text-xs text-yellow-500/80">{t('profile.canceledDesc')}</div>
                    </div>
                  </div>
                )}

                {/* Manage Billing — Stripe-only. Hidden in transfer mode
                    because the Stripe billing portal isn't reachable. */}
                {PAYMENT_MODE === 'stripe' && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate('/subscription')}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    {t('profile.manageBilling')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center py-6 space-y-4">
                <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                  <Crown className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{t('profile.noSubscription')}</p>
                  <p className="text-sm text-muted-foreground">{t('profile.noSubscriptionDesc')}</p>
                </div>
                <Button
                  className="bg-gradient-to-r from-[#FFB300] to-[#FF9D00] hover:opacity-90"
                  onClick={() => navigate('/subscription')}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t('profile.subscribe')}
                </Button>
              </div>
            )}
          </div>

          {/* Payment history — list of paid extensions + per-row "ขอใบกำกับ
              ภาษี" button. Lives right after Subscription card so users see
              their payment ledger immediately. Excludes coupon/promo rows
              server-side (no money = no invoice). */}
          <PaymentHistorySection />

          {/* Coupon redemption — hidden per business decision (2026-05-15).
              Re-enable by un-commenting the block below.
          <CouponSection
            onRedeemed={async () => {
              await refreshSubscription();
            }}
          />
          */}

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

          {/* Quick Link to Settings */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/settings')}
          >
            <Settings2 className="h-4 w-4 mr-2" />
            {t('profile.apiKeys')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profile;
