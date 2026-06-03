import { useState, useEffect, useCallback } from 'react';
import { X, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface AdminNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  created_at: string;
}

export const AdminNotificationBanner: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const result = await api.getUserAdminNotifications();
      setNotifications(result.notifications || []);
    } catch (error) {
      // Silently fail - notifications are not critical
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleDismiss = async () => {
    const notification = notifications[currentIndex];
    if (!notification) return;

    try {
      await api.markAdminNotificationRead(notification.id);
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
      if (currentIndex >= notifications.length - 1) {
        setCurrentIndex(0);
      }
    } catch (error) {
      // Silently fail
    }
  };

  if (!user || notifications.length === 0) {
    return null;
  }

  const notification = notifications[currentIndex];

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[99] border-b px-4 py-3',
        'bg-blue-500/10 border-blue-500/50'
      )}
    >
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <Bell className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-blue-400">
              {notification.title}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {notification.message}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {notifications.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {currentIndex + 1}/{notifications.length}
            </span>
          )}
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-white/10 transition-colors text-blue-400"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminNotificationBanner;
