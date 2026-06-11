import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";

const PendingApproval = () => {
  const { user, logout, refreshUser } = useAuth();
  const { t } = useLanguage();
  const [checking, setChecking] = useState(false);

  const handleCheckStatus = async () => {
    setChecking(true);
    await refreshUser();
    setChecking(false);
  };

  return (
    <div className="page-wrapper flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">Triple School</h1>
          <p className="text-muted-foreground mt-2">คอร์สเรียนออนไลน์</p>
        </div>

        <div className="bg-card p-8 rounded-lg border text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center">
              <Clock className="w-8 h-8 text-yellow-500" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">
              {t('auth.pendingApprovalTitle') || 'รอการอนุมัติ'}
            </h2>
            <p className="text-muted-foreground">
              {t('auth.pendingApprovalMessage') || 'บัญชีของคุณกำลังรอการอนุมัติจากผู้ดูแลระบบ กรุณารอสักครู่'}
            </p>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-sm text-yellow-500">
              {user?.email}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleCheckStatus}
              disabled={checking}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground p-3 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสถานะ'}
            </button>

            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 bg-secondary text-secondary-foreground p-3 rounded-lg font-medium hover:opacity-90"
            >
              <LogOut className="w-4 h-4" />
              {t('auth.logout') || 'ออกจากระบบ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
