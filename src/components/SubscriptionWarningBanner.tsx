import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const SubscriptionWarningBanner: React.FC = () => {
  const { expirationWarning, daysUntilExpiry, warningDismissed, dismissWarning, hasSubscription } = useSubscription();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Don't show if:
  // - No user
  // - User is admin
  // - No expiration warning
  // - Warning has been dismissed
  // - No subscription (will show SubscriptionWall instead)
  if (!user || user.isAdmin || !expirationWarning || warningDismissed || !hasSubscription) {
    return null;
  }

  const getWarningConfig = () => {
    const days = daysUntilExpiry ?? (expirationWarning === 'expiring_1d' ? 1 : expirationWarning === 'expiring_3d' ? 3 : 7);
    const message = t('subscription.expiringIn', { days: String(days) });

    switch (expirationWarning) {
      case 'expiring_1d':
        return {
          bgColor: 'bg-red-500/10 border-red-500/50',
          textColor: 'text-red-400',
          iconColor: 'text-red-500',
          message,
          urgent: true,
        };
      case 'expiring_3d':
        return {
          bgColor: 'bg-orange-500/10 border-orange-500/50',
          textColor: 'text-orange-400',
          iconColor: 'text-orange-500',
          message,
          urgent: false,
        };
      case 'expiring_7d':
      default:
        return {
          bgColor: 'bg-yellow-500/10 border-yellow-500/50',
          textColor: 'text-yellow-400',
          iconColor: 'text-yellow-500',
          message,
          urgent: false,
        };
    }
  };

  const config = getWarningConfig();

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100] border-b px-4 py-2',
        config.bgColor
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className={cn('h-5 w-5', config.iconColor)} />
          <span className={cn('text-sm font-medium', config.textColor)}>
            {config.message}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate('/subscription')}
            className="h-7 text-xs"
          >
            {t('subscription.renewNow')}
          </Button>
          <button
            onClick={dismissWarning}
            className={cn(
              'p-1 rounded hover:bg-white/10 transition-colors',
              config.textColor
            )}
            aria-label="ปิด"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionWarningBanner;
