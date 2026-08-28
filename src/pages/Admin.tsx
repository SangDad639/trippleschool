import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/currency';
import { PRICING, VAT_RATE } from '@/lib/pricing';
import {
  Users, CheckCircle, Clock, AlertCircle,
  Calendar, Loader2, ArrowLeft, Shield,
  Filter, Crown,
  Trash2, Minus, ChevronDown, MoreVertical,
  Bell, Plus, Pencil, Send, ImageIcon,
  ArrowUp, ArrowDown, Wallet, Building2, Globe, Search,
  Package, Percent, FileText,
} from 'lucide-react';
import AdminPackagesPanel from '@/components/admin/AdminPackagesPanel';
import AdminTiersPanel from '@/components/admin/AdminTiersPanel';
import AdminTaxInvoicesPanel from '@/components/admin/AdminTaxInvoicesPanel';
import UserCommissionDialog from '@/components/admin/UserCommissionDialog';
import type { AffiliateTierRecord } from '@/types/affiliate';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AdminUser {
  id: number;
  email: string;
  credits: number;
  isAdmin: boolean;
  joinDate: string;
  isApproved: boolean;
  subscriptionExpiresAt: string | null;
  planType: 'monthly' | 'yearly' | null;
  status: 'pending' | 'no_subscription' | 'expired' | 'active';
  paymentSlipUrl: string | null;
  paymentSlipUploadedAt: string | null;
  paymentSlipPlan: 'monthly' | 'yearly' | null;
  // Affiliate fields
  refcode: string | null;
  commissionPercent: number;
  wiseEmail: string | null;
  preferredPayoutMethod: 'wise' | 'thai_bank';
  affiliateTier: 1 | 2;
  bankInfo: {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
  } | null;
  totalReferrals: number;
  totalTransferred: number;
  pendingAmount: number;
  latestExtendSlipUrl: string | null;
  latestExtendSlipAt: string | null;
  latestPaymentDays: number | null;
  latestPaymentAmount: string | null;
  latestPaymentAt: string | null;
  latestApprovalMethod: 'admin' | 'autoapprove' | 'stripe' | null;
}

type FilterType =
  | 'all'
  | 'active'
  | 'monthly'
  | 'yearly'
  | 'no_sub'
  | 'expired'
  | 'referrers'
  | 'new_payment';

interface UserCounts {
  all: number;
  active: number;
  monthly: number;
  yearly: number;
  no_sub: number;
  expired: number;
  referrers: number;
  new_payment: number;
  pending: number;
}


interface ExtensionLog {
  id: number;
  days_added: number;
  amount: string | null;
  slip_url: string | null;
  created_at: string;
  approval_method:
    | 'admin'
    | 'autoapprove'
    | 'stripe'
    | 'admin_reduce'
    | 'admin_plan_change'
    | 'admin_approve'
    | 'admin_set_referrer'
    | string;
  notes: string | null;
  admin_id: number | null;
  admin_email: string | null;
  admin_is_super: boolean;
}

interface AdminNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  target_audience: string;
  created_at: string;
  is_active: boolean;
  created_by_email: string | null;
  read_count: number;
}

interface ReportDataPoint {
  label: string;
  periodStart: string;
  adminCount: number;
  webDirectCount: number;
  webAffCount: number;
  stripeCount: number;
  monthlyCount: number;
  yearlyCount: number;
  adminRevenue: number;
  webDirectRevenue: number;
  webAffRevenue: number;
  stripeRevenue: number;
  totalRevenue: number;
  monthlyRevenue: number;
  yearlyRevenue: number;
}

interface ReportSummary {
  totalTransactions: number;
  totalAdmin: number;
  totalWebDirect: number;
  totalWebAff: number;
  totalStripe: number;
  totalMonthly: number;
  totalYearly: number;
  totalRevenue: number;
  totalAdminRevenue: number;
  totalWebDirectRevenue: number;
  totalWebAffRevenue: number;
  totalStripeRevenue: number;
  totalMonthlyRevenue: number;
  totalYearlyRevenue: number;
}

interface ReportTransaction {
  id: number;
  email: string;
  daysAdded: number;
  amount: string;
  slipUrl: string | null;
  source: 'admin' | 'autoapprove' | 'stripe';
  createdAt: string;
  fromAffiliate: boolean;
  referrerEmail: string | null;
  adminId: number | null;
  adminEmail: string | null;
  adminIsSuper: boolean;
}

type ReportRange = 'today' | 'yesterday' | '7d' | '30d' | '90d' | '1y';

type AdminTab = 'revenue' | 'users' | 'notifications' | 'packages' | 'tiers' | 'tax-invoices';

// Dynamic plan shape from /api/admin/packages — returns ALL plans
// (active + inactive + admin_only). The public /subscription/plans endpoint
// hides admin_only=true rows, so admin Users-view buttons must use this
// admin-scoped endpoint to surface Premium and any other hidden packages.
type AdminPlan = Awaited<ReturnType<typeof api.getAdminPackages>>['packages'][number];

// Deterministic color palette for plan buttons. Cycled by display_order so a
// given plan keeps the same color across renders. 5 colors → covers up to 5
// plans without repeating; >5 plans cycle (acceptable since admin rarely
// creates that many).
const PLAN_COLORS = [
  { border: 'border-blue-500/30',    text: 'text-blue-400',    hoverBg: 'hover:bg-blue-500/10',    badgeBg: 'bg-blue-500/20',    badgeText: 'text-blue-400' },
  { border: 'border-yellow-500/30',  text: 'text-yellow-400',  hoverBg: 'hover:bg-yellow-500/10',  badgeBg: 'bg-yellow-500/20',  badgeText: 'text-yellow-400' },
  { border: 'border-purple-500/30',  text: 'text-purple-400',  hoverBg: 'hover:bg-purple-500/10',  badgeBg: 'bg-purple-500/20',  badgeText: 'text-purple-400' },
  { border: 'border-emerald-500/30', text: 'text-emerald-400', hoverBg: 'hover:bg-emerald-500/10', badgeBg: 'bg-emerald-500/20', badgeText: 'text-emerald-400' },
  { border: 'border-pink-500/30',    text: 'text-pink-400',    hoverBg: 'hover:bg-pink-500/10',    badgeBg: 'bg-pink-500/20',    badgeText: 'text-pink-400' },
];

const Admin = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  // Paginated, server-filtered list (current tab)
  const [users, setUsers] = useState<AdminUser[]>([]);
  // Pending box (always shown at top, loaded once on mount + after relevant actions)
  const [pendingUsers, setPendingUsers] = useState<AdminUser[]>([]);
  // Tier list — populates the Promote/Demote dropdown. Loaded once on mount.
  const [allTiers, setAllTiers] = useState<AffiliateTierRecord[]>([]);
  // Global counts for tab badges + stats cards (does not depend on search)
  const [counts, setCounts] = useState<UserCounts | null>(null);
  // Pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingUsers, setProcessingUsers] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [changePlanUser, setChangePlanUser] = useState<AdminUser | null>(null);
  // Per-(user × plan) commission override dialog (super admin only)
  const [commissionUser, setCommissionUser] = useState<AdminUser | null>(null);
  const [viewSlipUrl, setViewSlipUrl] = useState<string | null>(null);
  // Build a slip image URL. The payment-slip proxy (/api/subscription/slips/*) is
  // now admin-protected and reads the JWT from a `?token=` query param (an <img>
  // can't send an Authorization header). Presigned S3 / other URLs are untouched.
  const slipSrc = (raw: string) => {
    if (!raw) return raw;
    const full = raw.startsWith('/') ? `${api.getApiUrl()}${raw}` : raw;
    if (!full.includes('/api/subscription/slips/')) return full;
    const token = localStorage.getItem('auth_token');
    return token ? `${full}${full.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : full;
  };
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced search — drives the actual server query (300ms after user stops typing)
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const PAGE_SIZE = 50;

  // Revenue Report state
  const [reportRange, setReportRange] = useState<ReportRange>('7d');
  const [reportData, setReportData] = useState<ReportDataPoint[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [reportTransactions, setReportTransactions] = useState<ReportTransaction[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  // Extend subscription dialog state. `plan` is the chosen admin-defined
  // package row (from /api/subscription/plans). Used so the dialog + confirm
  // step show the right name / amount / slug — supports Premium and any
  // future packages without code changes.
  const [extendDialog, setExtendDialog] = useState<{ user: AdminUser; days: number; plan?: AdminPlan } | null>(null);
  const [extendForm, setExtendForm] = useState({ amount: '', bypassCode: '', slipFile: null as File | null, slipPreview: '' });

  // Dynamic subscription plans (from admin "แพ็กเกจสมาชิก" config).
  // Used to render quick-action buttons per active plan instead of hardcoding
  // monthly/yearly. Empty array on initial render / fetch failure — the
  // existing extend dialog still works via the legacy days-based flow.
  const [adminPlans, setAdminPlans] = useState<AdminPlan[]>([]);

  // Extension history dialog state
  const [extensionHistory, setExtensionHistory] = useState<{ user: AdminUser; history: ExtensionLog[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [adjustDaysUser, setAdjustDaysUser] = useState<AdminUser | null>(null);
  const [adjustDaysValue, setAdjustDaysValue] = useState(30);
  const [adjustDaysMode, setAdjustDaysMode] = useState<'add' | 'reduce'>('add');

  // Notifications state
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [showNotificationDialog, setShowNotificationDialog] = useState(false);
  const [editingNotification, setEditingNotification] = useState<AdminNotification | null>(null);
  const [notificationForm, setNotificationForm] = useState({
    title: '',
    message: '',
    notificationType: 'announcement',
    targetAudience: 'all',
  });
  const [savingNotification, setSavingNotification] = useState(false);


  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
      return;
    }
  }, [user, navigate]);

  // Load a page of users for the current filter + search.
  // - reset=true: replace list and reset to page 1 (filter/search changed)
  // - reset=false: append next page (Load more)
  const loadUsers = useCallback(
    async (opts: { reset?: boolean; pageOverride?: number } = {}) => {
      const reset = !!opts.reset;
      const targetPage = opts.pageOverride ?? (reset ? 1 : page);
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const data = await api.getAdminUsers({
          status: filter,
          search: debouncedSearch || undefined,
          page: targetPage,
          limit: PAGE_SIZE,
        });
        setUsers((prev) =>
          reset ? (data.users as AdminUser[]) : [...prev, ...(data.users as AdminUser[])]
        );
        setHasMore(!!data.pagination?.hasMore);
        setPage(targetPage);
      } catch (error) {
        toast.error('Failed to load users');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, debouncedSearch, page]
  );

  // Pending box (always small set, loaded independently). Refetched after actions
  // that may change pending status (approve/delete).
  const loadPending = useCallback(async () => {
    try {
      const data = await api.getAdminUsers({ status: 'pending', limit: 100 });
      setPendingUsers(data.users as AdminUser[]);
    } catch {
      // Non-fatal — pending box is a soft feature
    }
  }, []);

  // Global counts for tab badges + stats cards. Does NOT take search; the
  // numbers in (parentheses) must reflect overall totals always.
  const loadCounts = useCallback(async () => {
    try {
      const data = await api.getAdminUserCounts();
      setCounts(data.counts);
    } catch {
      // Non-fatal
    }
  }, []);

  // Debounce the search input by 300ms before triggering a server query.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  // Reload list when filter or debounced search changes.
  useEffect(() => {
    if (!user?.isAdmin) return;
    loadUsers({ reset: true, pageOverride: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debouncedSearch, user]);

  // One-shot loads on mount: pending box + global counts + tiers list.
  useEffect(() => {
    if (!user?.isAdmin) return;
    loadPending();
    loadCounts();
    // Tiers list — feeds the Promote/Demote dropdown (N-tier support).
    api.getAdminTiersV2()
      .then((res: any) => setAllTiers(res.tiers || []))
      .catch(() => {/* non-fatal — falls back to no dropdown options */});
  }, [user, loadPending, loadCounts]);

  const loadReport = useCallback(async (range: ReportRange) => {
    setReportLoading(true);
    try {
      const data = await api.getAdminRevenueReport(range);
      setReportData(data.data);
      setReportSummary(data.summary);
      setReportTransactions(data.transactions || []);
      setExpandedPeriod(null);
    } catch {
      toast.error('Failed to load revenue report');
    } finally {
      setReportLoading(false);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const data = await api.getAdminNotifications();
      setNotifications(data.notifications);
    } catch {
      toast.error(t('admin.failedLoadNotifications'));
    } finally {
      setNotificationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user?.isAdmin) {
      loadReport(reportRange);
    }
  }, [reportRange, user, loadReport]);

  useEffect(() => {
    if (user?.isAdmin) {
      loadNotifications();
    }
  }, [user, loadNotifications]);

  // Fetch dynamic subscription plans for the quick-action buttons.
  // Uses /api/admin/packages (NOT the public /subscription/plans) so we get
  // ALL plans including admin_only=true ones like Premium — admin needs to
  // grant those from the Users list. Filter to is_active=true so deactivated
  // packages don't pollute the buttons. Soft-fail: on error the buttons just
  // don't render and the extend dialog still works via legacy paths.
  useEffect(() => {
    if (!user?.isAdmin) return;
    api.getAdminPackages()
      .then((res) => setAdminPlans(res.packages.filter((p) => p.is_active)))
      .catch((err) => console.warn('[Admin] failed to load packages:', err));
  }, [user]);

  const handleOpenNotificationDialog = (notification?: AdminNotification) => {
    if (notification) {
      setEditingNotification(notification);
      setNotificationForm({
        title: notification.title,
        message: notification.message,
        notificationType: notification.notification_type,
        targetAudience: notification.target_audience,
      });
    } else {
      setEditingNotification(null);
      setNotificationForm({
        title: '',
        message: '',
        notificationType: 'announcement',
        targetAudience: 'all',
      });
    }
    setShowNotificationDialog(true);
  };

  const handleSaveNotification = async () => {
    if (!notificationForm.title || !notificationForm.message) {
      toast.error(t('admin.titleMessageRequired'));
      return;
    }

    setSavingNotification(true);
    try {
      if (editingNotification) {
        await api.updateAdminNotification(editingNotification.id, notificationForm);
        toast.success(t('admin.notificationUpdated'));
      } else {
        await api.createAdminNotification(notificationForm);
        toast.success(t('admin.notificationCreated'));
      }
      setShowNotificationDialog(false);
      loadNotifications();
    } catch {
      toast.error(t('admin.failedSaveNotification'));
    } finally {
      setSavingNotification(false);
    }
  };

  const handleToggleNotification = async (notification: AdminNotification) => {
    try {
      await api.updateAdminNotification(notification.id, { isActive: !notification.is_active });
      toast.success(notification.is_active ? t('admin.notificationDeactivated') : t('admin.notificationActivated'));
      loadNotifications();
    } catch {
      toast.error(t('admin.failedUpdateNotification'));
    }
  };

  const handleDeleteNotification = async (id: number) => {
    if (!confirm(t('admin.confirmDelete'))) return;
    try {
      await api.deleteAdminNotification(id);
      toast.success(t('admin.notificationDeleted'));
      loadNotifications();
    } catch {
      toast.error(t('admin.failedDeleteNotification'));
    }
  };

  const handleApprove = async (userId: number) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      await api.approveUser(userId);

      // Auto-extend subscription based on payment slip plan.
      // Pass the user's existing payment_slip_url so the BE accepts the
      // extend (it requires either a slipUrl or super-admin privileges).
      const target = pendingUsers.find(u => u.id === userId) || users.find(u => u.id === userId);
      let newExpiry: string | null = null;
      if (target?.paymentSlipUrl) {
        const days = target.paymentSlipPlan === 'yearly' ? 365 : 30;
        // VAT-inclusive total (matches what user transferred)
        const amount = days === 365 ? String(PRICING.yearly.total) : String(PRICING.monthly.total);
        const ext: any = await api.extendUserSubscription(
          userId,
          days,
          undefined,
          amount,
          target.paymentSlipUrl
        );
        newExpiry = ext?.user?.subscriptionExpiresAt ?? null;
        toast.success(`User approved + ${days} days added (${target.paymentSlipPlan || 'monthly'})`);
      } else {
        toast.success('User approved successfully');
      }

      // Optimistic: remove from pending, update list row if currently visible
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      setUsers(prev =>
        prev.map(u =>
          u.id === userId
            ? {
                ...u,
                isApproved: true,
                subscriptionExpiresAt: newExpiry ?? u.subscriptionExpiresAt,
                status: newExpiry ? 'active' : u.status,
              }
            : u
        )
      );
      loadCounts();
    } catch (error) {
      toast.error('Failed to approve user');
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  // Open the extend dialog. Accepts either:
  //   • a full AdminPlan from /api/subscription/plans (preferred — supports
  //     admin-defined custom packages like Premium), or
  //   • a legacy days literal (30 | 365) — kept for back-compat with the
  //     "Approve user" + slip auto-extend path.
  const handleExtend = (user: AdminUser, planOrDays: AdminPlan | 30 | 365) => {
    if (typeof planOrDays === 'number') {
      const days = planOrDays;
      const defaultAmount = days === 365 ? String(PRICING.yearly.total) : String(PRICING.monthly.total);
      setExtendForm({ amount: defaultAmount, bypassCode: '', slipFile: null, slipPreview: '' });
      setExtendDialog({ user, days });
      return;
    }
    const plan = planOrDays;
    setExtendForm({
      amount: String(plan.total),
      bypassCode: '',
      slipFile: null,
      slipPreview: '',
    });
    setExtendDialog({ user, days: plan.days, plan });
  };

  const handleConfirmExtend = async () => {
    if (!extendDialog) return;

    const { user: targetUser, days, plan } = extendDialog;
    const { bypassCode, slipFile } = extendForm;
    const isSuperAdmin = !!user?.isSuperAdmin;

    // Bypass code is now restricted to super admins.
    const usingBypass = isSuperAdmin && bypassCode === '24862';

    if (!usingBypass) {
      if (!slipFile) {
        toast.error('กรุณาอัปโหลดสลิป');
        return;
      }
    }

    setProcessingUsers(prev => new Set(prev).add(targetUser.id));
    setExtendDialog(null);

    try {
      let verifiedSlipUrl: string | undefined;
      let verifiedAmount: string | undefined;

      // Default amount for the slip-upload step. Prefer the dynamic plan
      // total (so Premium ฿18,900 / future packages work); fall back to the
      // hardcoded monthly/yearly PRICING for back-compat.
      const defaultAmount = plan
        ? String(plan.total)
        : days === 365 ? String(PRICING.yearly.total) : String(PRICING.monthly.total);

      // Path 1 — slip provided: upload + Thunder-verify (bank, account, amount, age, no dup).
      if (slipFile) {
        const uploadResult: any = await api.adminUploadExtendSlip(
          targetUser.id,
          slipFile,
          // amount is the vat-inclusive total — BE re-derives + validates anyway
          defaultAmount,
          days
        );
        verifiedSlipUrl = uploadResult.slipUrl;
        verifiedAmount = uploadResult.amount;
      }
      // Path 2 — super-admin bypass: no slipUrl, BE accepts because of isSuperAdmin

      const ext: any = await api.extendUserSubscription(
        targetUser.id,
        days,
        undefined,
        verifiedAmount ?? defaultAmount,
        verifiedSlipUrl,
        plan?.slug,
      );
      const newExpiry: string | null = ext?.user?.subscriptionExpiresAt ?? null;
      const planLabel = plan ? (language === 'th' ? (plan.name_th || plan.name) : plan.name) : '';
      toast.success(`เพิ่ม ${days} วันเรียบร้อย${planLabel ? ` (${planLabel})` : ''}`);
      setUsers(prev =>
        prev.map(u =>
          u.id === targetUser.id
            ? {
                ...u,
                subscriptionExpiresAt: newExpiry ?? u.subscriptionExpiresAt,
                status: 'active',
                planType: u.planType ?? (days >= 365 ? 'yearly' : 'monthly'),
              }
            : u
        )
      );
      setPendingUsers(prev => prev.filter(u => u.id !== targetUser.id));
      loadCounts();
    } catch (error: any) {
      console.error('[Admin Extend] Error:', error);
      const code = error?.errorCode as string | undefined;
      // Yearly accepts ฿4,269.30 (full) or ฿2,996 (admin promo: 2,800 + VAT). Monthly fixed at ฿642.
      const yearlyPromoTotal = +(2800 * (1 + VAT_RATE / 100)).toFixed(2);
      const expectedAmt =
        days >= 365
          ? `฿${PRICING.yearly.total.toLocaleString()} / ฿${yearlyPromoTotal.toLocaleString()}`
          : `฿${PRICING.monthly.total.toLocaleString()}`;
      const codeMessages: Record<string, { th: string; en: string }> = {
        DUPLICATE_SLIP: {
          th: 'สลิปนี้เคยถูกใช้ยืนยันแล้ว ไม่สามารถใช้ซ้ำได้',
          en: 'This slip has already been used for verification.',
        },
        INVALID_BANK: {
          th: 'สลิปนี้ไม่ใช่การโอนเข้าธนาคารกสิกรไทย (KBank)',
          en: 'This slip is not a transfer to Kasikorn Bank (KBank).',
        },
        INVALID_ACCOUNT: {
          th: 'บัญชีปลายทางในสลิปไม่ตรงกับบัญชีที่กำหนด (หรือ Thunder ตรวจสอบบัญชีไม่ผ่าน)',
          en: 'Recipient account on the slip does not match the configured account (or Thunder could not verify it).',
        },
        INVALID_AMOUNT: {
          th: `จำนวนเงินในสลิปไม่ตรงกับแพ็กเกจ (ต้อง ${expectedAmt})`,
          en: `The amount on the slip does not match the package (must be ${expectedAmt}).`,
        },
        EXPIRED_SLIP: {
          th: 'สลิปนี้เก่าเกิน 24 ชั่วโมง',
          en: 'This slip is older than 24 hours.',
        },
        SLIP_REQUIRED: {
          th: 'ต้องอัปโหลดสลิปก่อน (หรือใช้บัญชี super admin)',
          en: 'A verified slip is required (or use a super-admin account).',
        },
        NO_FILE: {
          th: 'ยังไม่ได้เลือกไฟล์สลิป',
          en: 'No slip file selected.',
        },
        qrcode_not_found: {
          th: 'อ่าน QR Code จากสลิปไม่ได้ — ลองภาพชัดขึ้น',
          en: 'Could not read QR code from the slip — try a clearer image.',
        },
        slip_not_found: {
          th: 'ไม่พบข้อมูลสลิป สลิปอาจหมดอายุหรือถูกลบแล้ว',
          en: 'Slip not found — it may have expired or been deleted.',
        },
        slip_expired: {
          th: 'สลิปหมดอายุแล้ว กรุณาโอนเงินใหม่',
          en: 'Slip has expired. Please make a new transfer.',
        },
        duplicate_slip: {
          th: 'สลิปนี้เคยถูกใช้ยืนยันแล้ว',
          en: 'This slip has already been used.',
        },
      };
      const m = code ? codeMessages[code] : undefined;
      const msg = m ? (language === 'en' ? m.en : m.th) : (error?.message || 'Failed to extend');
      toast.error(msg);
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(targetUser.id);
        return next;
      });
    }
  };

  const handleViewExtensionHistory = async (user: AdminUser) => {
    setHistoryLoading(true);
    try {
      const data = await api.getExtensionHistory(user.id);
      setExtensionHistory({ user, history: data.history });
    } catch (error) {
      toast.error('Failed to load extension history');
    } finally {
      setHistoryLoading(false);
    }
  };

  // Direct add days (no slip/password) — used by the adjust-days dialog
  const handleAdjustAdd = async (userId: number, days: number) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      const ext: any = await api.extendUserSubscription(userId, days as any);
      const newExpiry: string | null = ext?.user?.subscriptionExpiresAt ?? null;
      toast.success(`Added ${days} days to subscription`);
      setUsers(prev =>
        prev.map(u =>
          u.id === userId
            ? {
                ...u,
                subscriptionExpiresAt: newExpiry ?? u.subscriptionExpiresAt,
                status: 'active',
              }
            : u
        )
      );
      loadCounts();
    } catch (error: any) {
      console.error('[Admin AdjustAdd] Error:', error);
      toast.error(`Failed to add days: ${error?.message || 'unknown error'}`);
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleReduce = async (userId: number, days: number) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      const res: any = await api.reduceUserSubscription(userId, days);
      const newExpiry: string | null = res?.user?.subscriptionExpiresAt ?? null;
      toast.success(`Reduced ${days} days from subscription`);
      setUsers(prev =>
        prev.map(u =>
          u.id === userId
            ? { ...u, subscriptionExpiresAt: newExpiry ?? u.subscriptionExpiresAt }
            : u
        )
      );
      loadCounts();
    } catch (error) {
      toast.error('Failed to reduce subscription');
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleChangePlan = async (userId: number, plan: 'monthly' | 'yearly') => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      await api.changeUserPlan(userId, plan);
      toast.success(`Changed to ${plan === 'monthly' ? 'Monthly' : 'Yearly'}`);
      setUsers(prev => prev.map(u => (u.id === userId ? { ...u, planType: plan } : u)));
      loadCounts();
    } catch (error) {
      toast.error('Failed to change plan');
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleDeleteUser = async (userId: number, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      await api.deleteUser(userId);
      toast.success(`Deleted ${email}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setPendingUsers(prev => prev.filter(u => u.id !== userId));
      loadCounts();
    } catch (error) {
      toast.error('Failed to delete user');
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleUpdateTier = async (userId: number, newTierId: number, tierName?: string) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    try {
      await api.updateUserTier(userId, newTierId);
      toast.success(`Assigned to ${tierName || `Tier ${newTierId}`}`);
      // Patch local row — BE already updated users.commission_percent server-side
      // (see /admin/user-tier handler), so we mirror that here so the "Commission: N%"
      // label refreshes immediately without a full users reload.
      const newTier = allTiers.find((t) => t.id === newTierId);
      const newCommission = newTier?.commission_percent;
      setUsers(prev => prev.map(u => (u.id === userId
        ? {
            ...u,
            affiliateTier: newTierId as 1 | 2,
            commissionPercent: newCommission != null ? Number(newCommission) : u.commissionPercent,
          }
        : u)));
      // Tier change may affect aggregate counts shown in tabs/badges.
      loadCounts();
    } catch (error) {
      toast.error('Failed to update tier');
    } finally {
      setProcessingUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'No subscription';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  const getRemainingDays = (dateStr: string | null) => {
    if (!dateStr) return null;
    const now = new Date();
    const expires = new Date(dateStr);
    const diff = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const getStatusBadge = (status: AdminUser['status']) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/50">Pending Approval</Badge>;
      case 'no_subscription':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/50">No Subscription</Badge>;
      case 'expired':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/50">Expired</Badge>;
      case 'active':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/50">Active</Badge>;
    }
  };

  const getPlanBadge = (planType: AdminUser['planType']) => {
    if (!planType) return null;
    if (planType === 'monthly') {
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50">Monthly</Badge>;
    }
    return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/50">Yearly</Badge>;
  };

  // List comes pre-filtered + paginated from the server; no client-side filter.
  // Pagination is via Load more (appended to `users`).

  // Currency formatter for THB
  const fmt = (amount: number) => formatCurrency(amount, 'THB');

  if (loading) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
      </div>
    );
  }

  // Tab badge counts come from the dedicated /counts endpoint (global totals,
  // independent of the current search query).
  const filterButtons: { key: FilterType; label: string; count: number }[] = [
    { key: 'all',         label: 'All',       count: counts?.all         ?? 0 },
    { key: 'active',      label: 'Active',    count: counts?.active      ?? 0 },
    { key: 'monthly',     label: 'Monthly',   count: counts?.monthly     ?? 0 },
    { key: 'yearly',      label: 'Yearly',    count: counts?.yearly      ?? 0 },
    { key: 'no_sub',      label: 'No Sub',    count: counts?.no_sub      ?? 0 },
    { key: 'expired',     label: 'Expired',   count: counts?.expired     ?? 0 },
    { key: 'referrers',   label: 'Referrers', count: counts?.referrers   ?? 0 },
    { key: 'new_payment', label: '🆕 New',    count: counts?.new_payment ?? 0 },
  ];

  return (
    <div className="page-wrapper">
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl sm:text-3xl font-bold flex items-center gap-2">
                  <Shield className="h-6 w-6 sm:h-8 sm:w-8 text-[#FFB300]" />
                  Admin Panel
                </h1>
                <p className="text-muted-foreground">Manage users and subscriptions</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => navigate('/admin/affiliate')}
              >
                Affiliate
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/banners')}
              >
                Manage Banners
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/courses')}
              >
                คอร์สเรียน
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/articles')}
              >
                บทความ
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/ebooks')}
              >
                Ebook
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/guide')}
              >
                คลิปคู่มือ
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/enrollments')}
              >
                อนุมัติสมัครเรียน
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/admin/chats')}
              >
                แชทลูกค้า
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0">
            {([
              { key: 'users' as AdminTab, label: 'Users', icon: <Users className="h-4 w-4" /> },
              { key: 'revenue' as AdminTab, label: 'รายงานรายได้', icon: <Wallet className="h-4 w-4" /> },
              { key: 'notifications' as AdminTab, label: 'การแจ้งเตือน', icon: <Bell className="h-4 w-4" /> },
              { key: 'packages' as AdminTab, label: language === 'th' ? 'แพ็กเกจ' : 'Packages', icon: <Package className="h-4 w-4" /> },
              { key: 'tiers' as AdminTab, label: language === 'th' ? 'ระดับ' : 'Tiers', icon: <Crown className="h-4 w-4" /> },
              { key: 'tax-invoices' as AdminTab, label: language === 'th' ? 'ใบกำกับภาษี' : 'Tax Invoices', icon: <FileText className="h-4 w-4" /> },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#FFB300]/10 text-[#FFB300] border-b-2 border-[#FFB300]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* === Users Tab === */}
          {activeTab === 'users' && (<>

          {/* Stats Cards (global counts) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  <span className="text-2xl font-bold">{counts?.pending ?? 0}</span>
                </div>
                <p className="text-sm text-muted-foreground">Pending Approval</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">{counts?.active ?? 0}</span>
                </div>
                <p className="text-sm text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <span className="text-2xl font-bold">{counts?.expired ?? 0}</span>
                </div>
                <p className="text-sm text-muted-foreground">Expired</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-400" />
                  <span className="text-2xl font-bold">{(counts?.all ?? 0) + (counts?.pending ?? 0)}</span>
                </div>
                <p className="text-sm text-muted-foreground">Total Users</p>
              </CardContent>
            </Card>
          </div>

          {/* Pending Approval */}
          {pendingUsers.length > 0 && (
            <Card className="border-yellow-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  Pending Approval ({pendingUsers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingUsers.map(u => (
                  <div key={u.id} className="p-4 bg-card border rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{u.email}</p>
                        <p className="text-sm text-muted-foreground">
                          Joined: {formatDate(u.joinDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {u.paymentSlipPlan && (
                          <Badge className={u.paymentSlipPlan === 'yearly'
                            ? 'bg-purple-500/20 text-purple-400 border-purple-500/50'
                            : 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                          }>
                            {u.paymentSlipPlan === 'yearly' ? 'Yearly' : 'Monthly'}
                          </Badge>
                        )}
                        <Button
                          onClick={() => handleApprove(u.id)}
                          disabled={processingUsers.has(u.id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {processingUsers.has(u.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Approve
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDeleteUser(u.id, u.email)}
                          disabled={processingUsers.has(u.id)}
                          className="border-red-500/30 text-red-500 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {u.paymentSlipUrl && (
                      <div className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <img
                          src={slipSrc(u.paymentSlipUrl)}
                          alt="Payment slip"
                          className="w-16 h-16 object-cover rounded-lg cursor-pointer border border-border hover:opacity-80 transition-opacity"
                          onClick={() => setViewSlipUrl(slipSrc(u.paymentSlipUrl))}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-blue-400">
                            {u.paymentSlipPlan === 'yearly'
                              ? `฿${PRICING.yearly.total.toLocaleString()} (Yearly)`
                              : `฿${PRICING.monthly.total.toLocaleString()} (Monthly)`}
                          </p>
                          {u.paymentSlipUploadedAt && (
                            <p className="text-xs text-muted-foreground">
                              Uploaded: {formatDate(u.paymentSlipUploadedAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* All Users Table */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Filter className="h-5 w-5" />
                    Users
                  </CardTitle>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    {/*
                      autoComplete="off" + non-email type prevents browser
                      password managers from autofilling the admin's saved
                      email/username here when the bypass-code dialog opens.
                    */}
                    <input
                      type="search"
                      placeholder="ค้นหา email..."
                      autoComplete="off"
                      name="admin-user-search"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 w-64 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#FFB300]/50"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {filterButtons.map(fb => (
                    <Button
                      key={fb.key}
                      variant={filter === fb.key ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilter(fb.key)}
                      className={filter === fb.key ? 'bg-[#FFB300] text-black hover:bg-[#FFB300]/90' : ''}
                    >
                      {fb.label} ({fb.count})
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {users.map(u => (
                  <div key={u.id} className="p-4 bg-card border rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {u.paymentSlipUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewSlipUrl(slipSrc(u.paymentSlipUrl))}
                            className="text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          >
                            <ImageIcon className="h-3.5 w-3.5 mr-1" />
                            View Slip
                          </Button>
                        )}
                        {filter !== 'new_payment' && u.latestExtendSlipUrl && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewExtensionHistory(u)}
                            disabled={historyLoading}
                            className="text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                          >
                            <Clock className="h-3.5 w-3.5 mr-1" />
                            ประวัติ
                          </Button>
                        )}
                        {filter !== 'new_payment' && (
                          <button
                            onClick={() => handleDeleteUser(u.id, u.email)}
                            disabled={processingUsers.has(u.id)}
                            className="text-gray-600 hover:text-red-400 transition-colors"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{u.email}</p>
                            {u.isAdmin && <Badge variant="outline">Admin</Badge>}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {getStatusBadge(u.status)}
                            {getPlanBadge(u.planType)}
                            {filter !== 'new_payment' && (
                              <>
                                <span className="text-sm text-muted-foreground">
                                  Expires: {formatDate(u.subscriptionExpiresAt)}
                                </span>
                                {u.status === 'active' && getRemainingDays(u.subscriptionExpiresAt) !== null && (
                                  <span className={`text-sm font-medium ${
                                    getRemainingDays(u.subscriptionExpiresAt)! <= 7 ? 'text-red-400' :
                                    getRemainingDays(u.subscriptionExpiresAt)! <= 30 ? 'text-yellow-400' : 'text-green-400'
                                  }`}>
                                    ({getRemainingDays(u.subscriptionExpiresAt)} days left)
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          {u.latestPaymentAt && (
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {u.latestPaymentAmount && (
                                <span className="text-xs text-[#FFB300] font-medium">฿{u.latestPaymentAmount}</span>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(u.latestPaymentAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}{' '}
                                {new Date(u.latestPaymentAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${u.latestApprovalMethod === 'autoapprove' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                {u.latestApprovalMethod === 'autoapprove' ? 'Auto' : 'Manual'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {filter === 'new_payment' ? (
                          <Button variant="outline" size="sm" onClick={() => handleViewExtensionHistory(u)} disabled={historyLoading} className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10">
                            <Clock className="h-3.5 w-3.5 mr-1" />
                            ประวัติ
                          </Button>
                        ) : (
                          /* Top-right: keep only the overflow menu (⋮) — the
                             quick-action plan buttons now live on their own
                             row directly below this one (always left-aligned
                             per UX request 2026-05-14). */
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="px-2">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* Adjust days — super admin only (no slip verification) */}
                              {user?.isSuperAdmin && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setAdjustDaysUser(u);
                                    setAdjustDaysValue(30);
                                    setAdjustDaysMode('add');
                                  }}
                                  className="text-blue-400"
                                >
                                  <Calendar className="h-4 w-4 mr-2" />
                                  Adjust days...
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setChangePlanUser(u)} className="text-purple-400">
                                <Crown className="h-4 w-4 mr-2" />
                                Change package
                              </DropdownMenuItem>
                              {/* Per-(user × plan) commission overrides — super admin only.
                                  The backend PUT/DELETE also enforce super-admin so this is UX. */}
                              {user?.isSuperAdmin && (
                                <DropdownMenuItem
                                  onClick={() => setCommissionUser(u)}
                                  className="text-yellow-400"
                                >
                                  <Percent className="h-4 w-4 mr-2" />
                                  {language === 'th' ? 'Commission ต่อ package…' : 'Commission per package…'}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Quick-action plan buttons — own row, always left-aligned
                        (UX request 2026-05-14: ปุ่ม quick-action อยู่ซ้ายมือตลอดเวลา).
                        1 button per active plan, sorted by display_order. Label =
                        plan.name (admin-defined in /admin → แพ็กเกจสมาชิก).
                        Includes admin_only plans like Premium. Hidden in the
                        "new_payment" filter view where the top-right "ประวัติ"
                        button replaces the standard actions. */}
                    {filter !== 'new_payment' && adminPlans.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {adminPlans
                          .slice()
                          .sort((a, b) => a.display_order - b.display_order)
                          .map((plan, i) => {
                            const palette = PLAN_COLORS[i % PLAN_COLORS.length];
                            const label = language === 'th' ? (plan.name_th || plan.name) : plan.name;
                            return (
                              <Button
                                key={plan.slug}
                                variant="outline"
                                size="sm"
                                onClick={() => handleExtend(u, plan)}
                                disabled={processingUsers.has(u.id)}
                                className={`${palette.border} ${palette.text} ${palette.hoverBg}`}
                                title={`+${plan.days} ${language === 'th' ? 'วัน' : 'days'} · ฿${plan.total.toLocaleString()}`}
                              >
                                {processingUsers.has(u.id) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Calendar className="h-4 w-4 mr-1" />
                                    +{plan.days}d
                                    <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${palette.badgeBg} ${palette.badgeText}`}>
                                      {label}
                                    </span>
                                  </>
                                )}
                              </Button>
                            );
                          })}
                      </div>
                    )}

                    {filter !== 'new_payment' && (u.totalReferrals > 0 || u.refcode) && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge className={u.affiliateTier === 2
                              ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50'
                              : 'bg-gray-500/20 text-gray-400 border-gray-500/50'
                            }>
                              {u.affiliateTier === 2 && <Crown className="h-3 w-3 mr-1" />}
                              Tier {u.affiliateTier}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              Refcode: <span className="text-foreground font-mono">{u.refcode}</span>
                            </span>
                            <span className="text-sm text-muted-foreground">
                              Commission: <span className="text-foreground">{u.commissionPercent}%</span>
                            </span>
                            {u.preferredPayoutMethod === 'thai_bank' && u.bankInfo ? (
                              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50">
                                <Building2 className="h-3 w-3 mr-1" />
                                {u.bankInfo.bankName}
                              </Badge>
                            ) : u.wiseEmail ? (
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                                <Globe className="h-3 w-3 mr-1" />
                                Wise
                              </Badge>
                            ) : (
                              <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/50">
                                ยังไม่ได้ตั้งค่า
                              </Badge>
                            )}
                            <span className="text-sm">
                              <Users className="h-3 w-3 inline mr-1" />
                              {u.totalReferrals} referrals
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-green-500 font-semibold">{fmt(u.totalTransferred)}</span>
                              <span className="text-xs text-muted-foreground ml-1">โอนแล้ว</span>
                              {u.pendingAmount > 0 && (
                                <span className="text-yellow-500 text-sm ml-2">+ {fmt(u.pendingAmount)} รอ</span>
                              )}
                            </div>
                            {/* Tier assignment — super admin only.
                                N-tier dropdown of every active affiliate_tier
                                (fetched once on mount). Backend also enforces
                                requireSuperAdmin so the UI hide is just UX. */}
                            {user?.isSuperAdmin && (
                              processingUsers.has(u.id) ? (
                                <Button variant="outline" size="sm" disabled>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                </Button>
                              ) : (
                                <select
                                  value={u.affiliateTier ?? ''}
                                  onChange={(e) => {
                                    const newId = Number(e.target.value);
                                    if (!Number.isFinite(newId) || newId === u.affiliateTier) return;
                                    const target = allTiers.find((t) => t.id === newId);
                                    handleUpdateTier(u.id, newId, target?.name);
                                  }}
                                  className="text-xs px-2 py-1.5 rounded-md border border-yellow-500/30 bg-background text-yellow-400 hover:bg-yellow-500/10 cursor-pointer"
                                  title="เลือก Tier"
                                >
                                  {/* If current tier is not in active list, show placeholder so the user sees it */}
                                  {!allTiers.some((t) => t.id === u.affiliateTier) && u.affiliateTier != null && (
                                    <option value={u.affiliateTier}>Tier {u.affiliateTier}</option>
                                  )}
                                  {allTiers.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({t.commission_percent}%)
                                    </option>
                                  ))}
                                </select>
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {users.length === 0 && !loading && (
                  <div className="text-center py-8 text-muted-foreground">
                    No users match this filter
                  </div>
                )}
                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={() => loadUsers({ pageOverride: page + 1 })}
                      disabled={loadingMore || loading}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          กำลังโหลด...
                        </>
                      ) : (
                        <>
                          โหลดเพิ่ม ({users.length} / {counts?.[filter] ?? '?'})
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          </>)}

          {/* === Revenue Tab === */}
          {activeTab === 'revenue' && (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-[#FFB300]" />
                    รายงานรายได้
                  </CardTitle>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: 'today' as ReportRange, label: 'วันนี้' },
                    { key: 'yesterday' as ReportRange, label: 'เมื่อวาน' },
                    { key: '7d' as ReportRange, label: '7 วัน' },
                    { key: '30d' as ReportRange, label: '30 วัน' },
                    { key: '90d' as ReportRange, label: '90 วัน' },
                    { key: '1y' as ReportRange, label: '1 ปี' },
                  ]).map(r => (
                    <Button
                      key={r.key}
                      variant={reportRange === r.key ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReportRange(r.key)}
                      className={reportRange === r.key ? 'bg-[#FFB300] text-black hover:bg-[#FFB300]/90' : ''}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {reportLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  {reportSummary && (
                    <div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                          <p className="text-2xl font-bold text-green-500">{fmt(reportSummary.totalRevenue)}</p>
                          <p className="text-xs text-muted-foreground">รายได้รวม ({reportSummary.totalTransactions} รายการ)</p>
                        </div>
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                          <p className="text-lg font-bold text-blue-400">{fmt(reportSummary.totalWebDirectRevenue)}</p>
                          <p className="text-xs text-muted-foreground">ซื้อตรง ({reportSummary.totalWebDirect} คน)</p>
                        </div>
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                          <p className="text-lg font-bold text-yellow-400">{fmt(reportSummary.totalWebAffRevenue)}</p>
                          <p className="text-xs text-muted-foreground">ซื้อผ่าน Aff ({reportSummary.totalWebAff} คน)</p>
                        </div>
                        <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                          <p className="text-lg font-bold text-purple-400">{fmt(reportSummary.totalAdminRevenue)}</p>
                          <p className="text-xs text-muted-foreground">Admin เพิ่มให้ ({reportSummary.totalAdmin} คน)</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div className="p-3 bg-card border rounded-lg flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-blue-400">Monthly</p>
                            <p className="text-xs text-muted-foreground">{reportSummary.totalMonthly} คน</p>
                          </div>
                          <p className="text-lg font-bold text-blue-400">{fmt(reportSummary.totalMonthlyRevenue)}</p>
                        </div>
                        <div className="p-3 bg-card border rounded-lg flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-purple-400">Yearly</p>
                            <p className="text-xs text-muted-foreground">{reportSummary.totalYearly} คน</p>
                          </div>
                          <p className="text-lg font-bold text-purple-400">{fmt(reportSummary.totalYearlyRevenue)}</p>
                        </div>
                      </div>
                      {reportSummary.totalStripe > 0 && (
                        <div className="mt-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-indigo-400">Stripe</p>
                            <p className="text-xs text-muted-foreground">{reportSummary.totalStripe} คน</p>
                          </div>
                          <p className="text-lg font-bold text-indigo-400">{fmt(reportSummary.totalStripeRevenue)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Detail Table */}
                  {reportData.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      ไม่มีข้อมูลในช่วงนี้
                    </div>
                  ) : (
                    <div className="border rounded-lg overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left p-2 font-medium">
                              {reportRange === 'today' || reportRange === 'yesterday' ? 'เวลา' :
                               reportRange === '1y' ? 'เดือน' :
                               reportRange === '90d' ? 'สัปดาห์' : 'วันที่'}
                            </th>
                            <th className="text-right p-2 font-medium">
                              <span className="text-blue-400">ซื้อตรง</span>
                            </th>
                            <th className="text-right p-2 font-medium">
                              <span className="text-yellow-400">ซื้อ(Aff)</span>
                            </th>
                            <th className="text-right p-2 font-medium">
                              <span className="text-purple-400">Admin</span>
                            </th>
                            <th className="text-right p-2 font-medium">
                              <span className="text-blue-400">Monthly</span>
                            </th>
                            <th className="text-right p-2 font-medium">
                              <span className="text-purple-400">Yearly</span>
                            </th>
                            <th className="text-right p-2 font-medium text-green-500">รายได้</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((d, i) => {
                            const isExpanded = expandedPeriod === d.label;
                            const periodTxs = reportTransactions.filter(tx => {
                              const txDate = new Date(tx.createdAt);
                              if (reportRange === 'today' || reportRange === 'yesterday') {
                                // Group by hour in Bangkok TZ. Use 'en-GB' to avoid the
                                // en-US 24-hour quirk where midnight returns "24" — BE
                                // labels midnight as "00:00" via TO_CHAR(HH24).
                                const h = txDate.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
                                return `${h}:00` === d.label;
                              } else if (reportRange === '1y') {
                                // Group by month YYYY-MM (Bangkok)
                                const m = txDate.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Bangkok' }).slice(0, 7);
                                return m === d.label;
                              } else if (reportRange === '90d') {
                                // Group by week — periodStart is the Monday 00:00 Bangkok
                                // returned as a real timestamptz from BE.
                                const pStart = new Date(d.periodStart).getTime();
                                const pEnd = pStart + 7 * 24 * 60 * 60 * 1000;
                                return txDate.getTime() >= pStart && txDate.getTime() < pEnd;
                              } else {
                                // Group by Bangkok calendar day YYYY-MM-DD
                                const day = txDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
                                return day === d.label;
                              }
                            });
                            return (
                              <React.Fragment key={i}>
                                <tr
                                  className={`border-b last:border-0 cursor-pointer transition-colors ${isExpanded ? 'bg-muted/40' : 'hover:bg-muted/30'}`}
                                  onClick={() => setExpandedPeriod(isExpanded ? null : d.label)}
                                >
                                  <td className="p-2 text-muted-foreground whitespace-nowrap">
                                    <span className="flex items-center gap-1">
                                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                                      {d.label}
                                    </span>
                                  </td>
                                  <td className="p-2 text-right">
                                    {d.webDirectCount > 0 && (
                                      <span className="text-blue-400">{d.webDirectCount} <span className="text-xs text-muted-foreground">({fmt(d.webDirectRevenue)})</span></span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right">
                                    {d.webAffCount > 0 && (
                                      <span className="text-yellow-400">{d.webAffCount} <span className="text-xs text-muted-foreground">({fmt(d.webAffRevenue)})</span></span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right">
                                    {d.adminCount > 0 && (
                                      <span className="text-purple-400">{d.adminCount} <span className="text-xs text-muted-foreground">({fmt(d.adminRevenue)})</span></span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right">
                                    {d.monthlyCount > 0 && (
                                      <span className="text-blue-400">{d.monthlyCount} <span className="text-xs text-muted-foreground">({fmt(d.monthlyRevenue)})</span></span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right">
                                    {d.yearlyCount > 0 && (
                                      <span className="text-purple-400">{d.yearlyCount} <span className="text-xs text-muted-foreground">({fmt(d.yearlyRevenue)})</span></span>
                                    )}
                                  </td>
                                  <td className="p-2 text-right font-medium text-green-500">{fmt(d.totalRevenue)}</td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td colSpan={7} className="p-0">
                                      <div className="bg-muted/20 border-t border-b border-border/50 px-4 py-3 space-y-2">
                                        {periodTxs.length === 0 ? (
                                          <p className="text-xs text-muted-foreground text-center py-2">ไม่พบรายการ</p>
                                        ) : (
                                          periodTxs.map(tx => (
                                            <div key={tx.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
                                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
                                                  tx.source === 'autoapprove' && !tx.fromAffiliate ? 'bg-blue-500/20 text-blue-400' :
                                                  tx.source === 'autoapprove' && tx.fromAffiliate ? 'bg-yellow-500/20 text-yellow-400' :
                                                  tx.source === 'stripe' ? 'bg-indigo-500/20 text-indigo-400' :
                                                  'bg-purple-500/20 text-purple-400'
                                                }`}>
                                                  {tx.source === 'autoapprove' && !tx.fromAffiliate ? 'ซื้อตรง' :
                                                   tx.source === 'autoapprove' && tx.fromAffiliate ? 'Aff' :
                                                   tx.source === 'stripe' ? 'Stripe' : 'Admin'}
                                                </span>
                                                <div className="min-w-0">
                                                  <p className="text-sm truncate">{tx.email}</p>
                                                  <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[11px] text-muted-foreground">
                                                      {new Date(tx.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground">
                                                      +{tx.daysAdded}d ({tx.daysAdded >= 365 ? 'Yearly' : 'Monthly'})
                                                    </span>
                                                    {tx.fromAffiliate && tx.referrerEmail && (
                                                      <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                                                        ref: {tx.referrerEmail}
                                                      </span>
                                                    )}
                                                    {tx.source === 'admin' && tx.adminEmail && (
                                                      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 inline-flex items-center gap-0.5">
                                                        {tx.adminIsSuper && <Crown className="h-2.5 w-2.5" />}
                                                        by: {tx.adminEmail}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-green-500 whitespace-nowrap">
                                                  {tx.amount ? `฿${tx.amount}` : '-'}
                                                </span>
                                                {tx.slipUrl && (
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => { e.stopPropagation(); setViewSlipUrl(slipSrc(tx.slipUrl!)); }}
                                                    className="h-6 text-[10px] border-green-500/30 text-green-400 hover:bg-green-500/10 px-2"
                                                  >
                                                    <ImageIcon className="h-3 w-3 mr-1" />
                                                    สลิป
                                                  </Button>
                                                )}
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                          <tr className="bg-muted/50 font-medium">
                            <td className="p-2">รวม</td>
                            <td className="p-2 text-right text-blue-400">
                              {reportData.reduce((s, d) => s + d.webDirectCount, 0)}
                            </td>
                            <td className="p-2 text-right text-yellow-400">
                              {reportData.reduce((s, d) => s + d.webAffCount, 0)}
                            </td>
                            <td className="p-2 text-right text-purple-400">
                              {reportData.reduce((s, d) => s + d.adminCount, 0)}
                            </td>
                            <td className="p-2 text-right text-blue-400">
                              {reportData.reduce((s, d) => s + d.monthlyCount, 0)}
                            </td>
                            <td className="p-2 text-right text-purple-400">
                              {reportData.reduce((s, d) => s + d.yearlyCount, 0)}
                            </td>
                            <td className="p-2 text-right text-green-500">
                              {fmt(reportData.reduce((s, d) => s + d.totalRevenue, 0))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* === Notifications Tab === */}
          {activeTab === 'notifications' && (<>

          {/* Admin Notifications Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-blue-500" />
                  {t('admin.notifications')}
                </CardTitle>
                <Button
                  onClick={() => handleOpenNotificationDialog()}
                  className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('admin.createNotification')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-[#FFB300]" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t('admin.noNotifications')}
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map(n => (
                    <div key={n.id} className="flex items-start justify-between p-4 bg-card border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{n.title}</p>
                          <Badge className={n.is_active ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-400'}>
                            {n.is_active ? t('admin.active') : t('admin.inactive')}
                          </Badge>
                          <Badge variant="outline">{n.target_audience}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {t('admin.readCount')}: {n.read_count}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{n.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('admin.created')}: {new Date(n.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleNotification(n)}
                          title={n.is_active ? t('admin.inactive') : t('admin.active')}
                        >
                          <Send className={`h-4 w-4 ${n.is_active ? 'text-green-500' : 'text-gray-400'}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenNotificationDialog(n)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteNotification(n.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notification Dialog */}
          <Dialog open={showNotificationDialog} onOpenChange={setShowNotificationDialog}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {editingNotification ? t('admin.editNotification') : t('admin.createNotification')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">{t('admin.notificationTitle')}</Label>
                  <Input
                    id="title"
                    value={notificationForm.title}
                    onChange={(e) => setNotificationForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder={t('admin.notificationTitlePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">{t('admin.notificationMessage')}</Label>
                  <Textarea
                    id="message"
                    value={notificationForm.message}
                    onChange={(e) => setNotificationForm(prev => ({ ...prev, message: e.target.value }))}
                    placeholder={t('admin.notificationMessagePlaceholder')}
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetAudience">{t('admin.targetAudience')}</Label>
                  <Select
                    value={notificationForm.targetAudience}
                    onValueChange={(value) => setNotificationForm(prev => ({ ...prev, targetAudience: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('admin.selectAudience')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('admin.allUsers')}</SelectItem>
                      <SelectItem value="active">{t('admin.activeSubscribers')}</SelectItem>
                      <SelectItem value="expired">{t('admin.expiredSubscribers')}</SelectItem>
                      <SelectItem value="no_subscription">{t('admin.noSubscription')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNotificationDialog(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleSaveNotification}
                  disabled={savingNotification}
                  className="bg-[#FFB300] text-black hover:bg-[#FFB300]/90"
                >
                  {savingNotification ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    editingNotification ? t('common.save') : t('common.create')
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          </>)}

          {/* === Packages Tab === */}
          {activeTab === 'packages' && (
            <Card>
              <CardContent className="pt-6">
                <AdminPackagesPanel />
              </CardContent>
            </Card>
          )}

          {/* === Tiers Tab === */}
          {activeTab === 'tiers' && (
            <Card>
              <CardContent className="pt-6">
                <AdminTiersPanel />
              </CardContent>
            </Card>
          )}

          {/* === Tax Invoices Tab === */}
          {activeTab === 'tax-invoices' && (
            <Card>
              <CardContent className="pt-6">
                <AdminTaxInvoicesPanel />
              </CardContent>
            </Card>
          )}

        </div>
      </main>

      {/* Adjust Days Dialog */}
      <Dialog open={!!adjustDaysUser} onOpenChange={(open) => !open && setAdjustDaysUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Subscription Days</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{adjustDaysUser?.email}</p>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setAdjustDaysMode('add')}
                className={`h-12 ${adjustDaysMode === 'add' ? 'border-green-500 bg-green-500/10 text-green-400' : 'text-muted-foreground'}`}
              >
                <Plus className="h-4 w-4 mr-2" />
                เพิ่มวัน
              </Button>
              <Button
                variant="outline"
                onClick={() => setAdjustDaysMode('reduce')}
                className={`h-12 ${adjustDaysMode === 'reduce' ? 'border-red-500 bg-red-500/10 text-red-400' : 'text-muted-foreground'}`}
              >
                <Minus className="h-4 w-4 mr-2" />
                ลดวัน
              </Button>
            </div>
            <div>
              <Label>จำนวนวัน</Label>
              <Input
                type="number"
                min={1}
                value={adjustDaysValue}
                onChange={(e) => setAdjustDaysValue(parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              {[7, 15, 30, 90, 365].map(d => (
                <Button
                  key={d}
                  variant="outline"
                  size="sm"
                  onClick={() => setAdjustDaysValue(d)}
                  className={`flex-1 text-xs ${adjustDaysValue === d ? 'border-primary bg-primary/10' : ''}`}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjustDaysUser(null)}>ยกเลิก</Button>
            <Button
              onClick={() => {
                if (adjustDaysUser && adjustDaysValue > 0) {
                  if (adjustDaysMode === 'add') {
                    handleAdjustAdd(adjustDaysUser.id, adjustDaysValue);
                  } else {
                    handleReduce(adjustDaysUser.id, adjustDaysValue);
                  }
                  setAdjustDaysUser(null);
                  setAdjustDaysUser(null);
                }
              }}
              className={adjustDaysMode === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {adjustDaysMode === 'add' ? `+ เพิ่ม ${adjustDaysValue} วัน` : `- ลด ${adjustDaysValue} วัน`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Package Dialog */}
      <Dialog open={!!changePlanUser} onOpenChange={(open) => !open && setChangePlanUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Package</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">{changePlanUser?.email}</p>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              onClick={() => {
                if (changePlanUser) {
                  handleChangePlan(changePlanUser.id, 'monthly');
                  setChangePlanUser(null);
                }
              }}
              variant="outline"
              className={`h-20 flex flex-col gap-1 ${
                changePlanUser?.planType === 'monthly'
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10'
              }`}
            >
              <Calendar className="h-5 w-5" />
              <span className="font-bold">Monthly</span>
              {changePlanUser?.planType === 'monthly' && <span className="text-[10px]">current</span>}
            </Button>
            <Button
              onClick={() => {
                if (changePlanUser) {
                  handleChangePlan(changePlanUser.id, 'yearly');
                  setChangePlanUser(null);
                }
              }}
              variant="outline"
              className={`h-20 flex flex-col gap-1 ${
                changePlanUser?.planType === 'yearly'
                  ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400'
                  : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10'
              }`}
            >
              <Crown className="h-5 w-5" />
              <span className="font-bold">Yearly</span>
              {changePlanUser?.planType === 'yearly' && <span className="text-[10px]">current</span>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Per-(user × plan) commission overrides dialog (super admin only).
          Renders into a portal so it's outside the user row layout. */}
      <UserCommissionDialog
        userId={commissionUser?.id ?? null}
        userEmail={commissionUser?.email}
        open={!!commissionUser}
        onOpenChange={(o) => !o && setCommissionUser(null)}
      />

      {/* Slip Preview Dialog */}
      <Dialog open={!!viewSlipUrl} onOpenChange={() => setViewSlipUrl(null)}>
        <DialogContent className="max-w-lg p-2">
          <DialogHeader>
            <DialogTitle>Payment Slip</DialogTitle>
          </DialogHeader>
          {viewSlipUrl && (
            <img
              src={viewSlipUrl}
              alt="Payment slip"
              className="w-full h-auto rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Extend Subscription Dialog */}
      <Dialog open={!!extendDialog} onOpenChange={(open) => !open && setExtendDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>เพิ่มวัน Subscription</DialogTitle>
          </DialogHeader>
          {extendDialog && (
            <div className="space-y-4">
              <div className="p-3 bg-card border rounded-lg">
                <p className="text-sm text-gray-400">ผู้ใช้</p>
                <p className="font-medium">{extendDialog.user.email}</p>
                {(() => {
                  // Prefer the dynamic plan (covers Premium + future packages).
                  // Fall back to the legacy monthly/yearly labels when called
                  // from the approval auto-extend path which doesn't pass a plan.
                  const plan = extendDialog.plan;
                  const yearlyPromoTotal = +(2800 * (1 + VAT_RATE / 100)).toFixed(2);
                  if (plan) {
                    const planLabel = language === 'th' ? (plan.name_th || plan.name) : plan.name;
                    // Build a "accepted prices" hint from the plan's admin_alt_prices
                    // (e.g. Yearly Promo ฿2,996) if any are configured.
                    const altTotals = plan.admin_alt_prices_computed?.map((a) => `฿${a.total.toLocaleString()}`) ?? [];
                    const allTotals = [`฿${plan.total.toLocaleString()}`, ...altTotals];
                    return (
                      <>
                        <p className="text-sm text-[#FFB300] mt-1">
                          +{plan.days} {language === 'th' ? 'วัน' : 'days'} ({planLabel}) — {allTotals.join(language === 'th' ? ' หรือ ' : ' or ')}
                        </p>
                        {altTotals.length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            {language === 'en'
                              ? `${planLabel} accepts ${allTotals.join(' or ')} — VAT-inclusive`
                              : `แพ็กเกจ ${planLabel} รับชำระ ${allTotals.join(' หรือ ')} — รวมภาษีมูลค่าเพิ่มแล้ว`}
                          </p>
                        )}
                      </>
                    );
                  }
                  // Legacy fallback (no plan) — keep the original monthly/yearly UI.
                  const yearlyLabel = `฿${PRICING.yearly.total.toLocaleString()} หรือ ฿${yearlyPromoTotal.toLocaleString()}`;
                  const monthlyLabel = `฿${PRICING.monthly.total.toLocaleString()}`;
                  return (
                    <>
                      <p className="text-sm text-[#FFB300] mt-1">
                        +{extendDialog.days} วัน ({extendDialog.days === 365 ? 'Yearly' : 'Monthly'}) — {extendDialog.days === 365 ? yearlyLabel : monthlyLabel}
                      </p>
                      {extendDialog.days === 365 && (
                        <p className="text-xs text-gray-500 mt-1">
                          {language === 'en'
                            ? `Yearly accepts ฿${PRICING.yearly.total.toLocaleString()} (full) or ฿${yearlyPromoTotal.toLocaleString()} (admin promo) — VAT-inclusive`
                            : `แพ็กเกจรายปีรับชำระ ฿${PRICING.yearly.total.toLocaleString()} หรือ ฿${yearlyPromoTotal.toLocaleString()} (โปรโมชั่น) — รวมภาษีมูลค่าเพิ่มแล้ว`}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">อัปโหลดสลิป</label>
                <p className="text-xs text-gray-500 mb-2">
                  สลิปจะถูกตรวจสอบอัตโนมัติ (ธนาคาร / เลขบัญชี / ยอด / อายุ ≤ 24 ชม. / ไม่ซ้ำ)
                </p>
                {extendForm.slipPreview ? (
                  <div className="relative">
                    <img src={extendForm.slipPreview} alt="Slip preview" className="w-full h-32 object-cover rounded-lg border border-border" />
                    <button
                      type="button"
                      onClick={() => setExtendForm(prev => ({ ...prev, slipFile: null, slipPreview: '' }))}
                      className="absolute top-1 right-1 p-1 bg-red-500 rounded-full text-white text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-[#FFB300]/50 transition-colors">
                    <div className="text-center">
                      <ImageIcon className="h-6 w-6 mx-auto text-gray-500" />
                      <span className="text-xs text-gray-500">คลิกเพื่อเลือกสลิป</span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setExtendForm(prev => ({
                            ...prev,
                            slipFile: file,
                            slipPreview: URL.createObjectURL(file)
                          }));
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Bypass code — super admin only */}
              {user?.isSuperAdmin && (
                <>
                  <div className="text-center text-xs text-gray-500">— หรือ (Super Admin) —</div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      <Crown className="h-3.5 w-3.5 inline text-[#FFB300] mr-1" />
                      รหัสผ่านข้ามการตรวจสลิป
                    </label>
                    {/*
                      type="text" + autoComplete="new-password" — avoids
                      Chrome's password manager hijacking the dialog as a
                      login form and autofilling the closest text field on
                      the page (the Users-tab email Search box) with the
                      saved username. data-lpignore / data-1p-ignore tell
                      LastPass / 1Password to leave this field alone too.
                    */}
                    <input
                      type="text"
                      placeholder="bypass code"
                      autoComplete="new-password"
                      name="extend-bypass-code"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      value={extendForm.bypassCode}
                      onChange={(e) => setExtendForm(prev => ({ ...prev, bypassCode: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#FFB300]/50"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setExtendDialog(null)}
                >
                  ยกเลิก
                </Button>
                <Button
                  className="flex-1 bg-[#FFB300] hover:bg-[#FFB300]/90 text-black"
                  onClick={handleConfirmExtend}
                  disabled={processingUsers.has(extendDialog.user.id)}
                >
                  {processingUsers.has(extendDialog.user.id) ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      กำลังตรวจสลิป...
                    </>
                  ) : (
                    'ยืนยัน'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Extension History Dialog (full audit timeline) */}
      <Dialog open={!!extensionHistory} onOpenChange={(open) => !open && setExtensionHistory(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>ประวัติการดำเนินการ</DialogTitle>
          </DialogHeader>
          {extensionHistory && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <p className="text-sm text-gray-400">{extensionHistory.user.email}</p>
              {extensionHistory.history.length === 0 ? (
                <p className="text-center text-gray-500 py-4">ไม่มีประวัติ</p>
              ) : (
                extensionHistory.history.map((log) => {
                  // Map approval_method → human-friendly label + color.
                  const action = (() => {
                    switch (log.approval_method) {
                      case 'admin':
                        return { label: `+${log.days_added} วัน`, cls: 'text-[#FFB300]' };
                      case 'autoapprove':
                        return { label: `+${log.days_added} วัน (auto)`, cls: 'text-blue-400' };
                      case 'stripe':
                        return { label: `+${log.days_added} วัน (Stripe)`, cls: 'text-indigo-400' };
                      case 'admin_reduce':
                        return { label: `${log.days_added} วัน (ลด)`, cls: 'text-red-400' };
                      case 'admin_plan_change':
                        return { label: 'เปลี่ยนแพ็กเกจ', cls: 'text-purple-400' };
                      case 'admin_approve':
                        return { label: 'อนุมัติบัญชี', cls: 'text-green-400' };
                      case 'admin_set_referrer':
                        return { label: 'ตั้งผู้แนะนำ', cls: 'text-yellow-400' };
                      default:
                        return { label: log.approval_method, cls: 'text-gray-400' };
                    }
                  })();
                  return (
                    <div key={log.id} className="p-3 bg-card border rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${action.cls}`}>{action.label}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(log.created_at).toLocaleDateString('th-TH', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="text-xs text-gray-400 italic">{log.notes}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          {log.amount && (
                            <span className="text-gray-400">฿{log.amount}</span>
                          )}
                          {log.admin_email ? (
                            <span className="flex items-center gap-1 text-gray-500">
                              <Shield className="h-3 w-3" />
                              {log.admin_is_super && <Crown className="h-3 w-3 text-yellow-500" />}
                              {log.admin_email}
                            </span>
                          ) : log.approval_method === 'autoapprove' ? (
                            <span className="text-gray-500 italic">user (auto)</span>
                          ) : null}
                        </div>
                        {log.slip_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewSlipUrl(slipSrc(log.slip_url!))}
                            className="h-6 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                          >
                            <ImageIcon className="h-3 w-3 mr-1" />
                            ดูสลิป
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;
