import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from './AuthContext';
import { PRICING } from '@/lib/pricing';

interface Subscription {
  planType: 'monthly' | 'yearly';
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

type ExpirationWarningType = 'expiring_7d' | 'expiring_3d' | 'expiring_1d' | null;

interface SubscriptionContextType {
  subscription: Subscription | null;
  hasSubscription: boolean;
  loading: boolean;
  error: string | null;
  expirationWarning: ExpirationWarningType;
  daysUntilExpiry: number | null;
  warningDismissed: boolean;
  refreshSubscription: () => Promise<void>;
  createCheckout: (planType: 'monthly' | 'yearly') => Promise<void>;
  changePlan: (planType: 'monthly' | 'yearly') => Promise<boolean>;
  changePlanPortal: (planType: 'monthly' | 'yearly') => Promise<void>;
  cancelSubscription: () => Promise<boolean>;
  reactivateSubscription: () => Promise<boolean>;
  openBillingPortal: () => Promise<void>;
  dismissWarning: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [fetchingForUserId, setFetchingForUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Consider loading if: auth is loading, or we haven't fetched for current user yet
  const loading = authLoading || (user ? fetchingForUserId !== user.id : false);
  const [expirationWarning, setExpirationWarning] = useState<ExpirationWarningType>(null);
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null);
  const [warningDismissed, setWarningDismissed] = useState(false);

  const refreshSubscription = useCallback(async () => {
    if (!user) {
      setSubscription(null);
      setHasSubscription(false);
      setExpirationWarning(null);
      setDaysUntilExpiry(null);
      setFetchingForUserId(null);
      return;
    }

    try {
      const result = await api.getSubscription();
      setSubscription(result.subscription);
      setHasSubscription(result.hasSubscription === true);

      // Calculate days until expiry
      if (result.subscription?.currentPeriodEnd) {
        const expiryDate = new Date(result.subscription.currentPeriodEnd);
        const now = new Date();
        const diffTime = expiryDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setDaysUntilExpiry(diffDays > 0 ? diffDays : 0);
      } else {
        setDaysUntilExpiry(null);
      }

      // Fetch expiration notifications
      try {
        const notifResult = await api.getSubscriptionNotifications();
        if (notifResult.notifications && notifResult.notifications.length > 0) {
          // Get the most urgent notification (1d > 3d > 7d)
          const sortedNotifs = notifResult.notifications.sort((a, b) => {
            const priority: Record<string, number> = { expiring_1d: 3, expiring_3d: 2, expiring_7d: 1 };
            return (priority[b.notification_type] || 0) - (priority[a.notification_type] || 0);
          });
          setExpirationWarning(sortedNotifs[0].notification_type);
        } else {
          setExpirationWarning(null);
        }
      } catch {
        // Notifications not critical, ignore errors
        setExpirationWarning(null);
      }
    } catch (err) {
      console.log('Subscription info not available');
      setSubscription(null);
      setHasSubscription(false);
      setExpirationWarning(null);
      setDaysUntilExpiry(null);
    } finally {
      // Mark that we've fetched for this user
      setFetchingForUserId(user.id);
    }
  }, [user]);

  // Load subscription whenever the user changes.
  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription, user]);

  // Stripe removed — "checkout" now routes the user to the manual bank-transfer
  // / PromptPay slip-upload page. Kept on the context so existing callers keep
  // working without a Stripe dependency.
  const createCheckout = async (planType: 'monthly' | 'yearly') => {
    const checkoutValue = planType === 'monthly' ? PRICING.monthly.total : PRICING.yearly.total;
    window.ttq?.track('InitiateCheckout', { value: checkoutValue, currency: 'THB' });
    window.fbq?.('track', 'InitiateCheckout', { value: checkoutValue, currency: 'THB' });
    window.gtag?.('event', 'begin_checkout', { value: checkoutValue, currency: 'THB' });
    window.location.href = `/subscription/transfer-v2?plan=${planType}`;
  };

  const changePlan = async (planType: 'monthly' | 'yearly'): Promise<boolean> => {
    try {
      setError(null);
      await api.changePlan(planType);
      await refreshSubscription();
      return true;
    } catch (err) {
      console.error('Failed to change plan:', err);
      setError('Failed to change plan');
      return false;
    }
  };

  const changePlanPortal = async (planType: 'monthly' | 'yearly') => {
    try {
      setError(null);
      const result = await api.changePlanPortal(planType);
      window.location.href = result.url;
    } catch (err: any) {
      // If already on this plan (DB was out of sync), refresh to show correct state
      if (err?.message === 'ALREADY_ON_PLAN') {
        await refreshSubscription();
        return;
      }
      console.error('Failed to open plan change portal:', err);
      setError('Failed to open plan change page');
      throw err;
    }
  };

  const cancelSubscription = async (): Promise<boolean> => {
    try {
      setError(null);
      await api.cancelSubscription();
      await refreshSubscription();
      return true;
    } catch (err) {
      console.error('Failed to cancel subscription:', err);
      setError('Failed to cancel subscription');
      return false;
    }
  };

  const reactivateSubscription = async (): Promise<boolean> => {
    try {
      setError(null);
      await api.reactivateSubscription();
      await refreshSubscription();
      return true;
    } catch (err) {
      console.error('Failed to reactivate subscription:', err);
      setError('Failed to reactivate subscription');
      return false;
    }
  };

  const openBillingPortal = async () => {
    try {
      setError(null);
      const result = await api.getBillingPortalUrl();
      window.location.href = result.url;
    } catch (err) {
      console.error('Failed to open billing portal:', err);
      setError('Failed to open billing portal');
      throw err;
    }
  };

  const dismissWarning = useCallback(() => {
    setWarningDismissed(true);
    // Mark all notifications as read
    api.markAllNotificationsRead().catch(() => {});
  }, []);

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        hasSubscription,
        loading,
        error,
        expirationWarning,
        daysUntilExpiry,
        warningDismissed,
        refreshSubscription,
        createCheckout,
        changePlan,
        changePlanPortal,
        cancelSubscription,
        reactivateSubscription,
        openBillingPortal,
        dismissWarning,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
};
