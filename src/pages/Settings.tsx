import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLeft, User } from 'lucide-react';

const Settings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();

  return (
    <div className="page-wrapper">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
              <p className="text-muted-foreground">{t('settings.subtitle')}</p>
            </div>
          </div>

          {/* Account info */}
          <div className="bg-card p-5 rounded-xl border border-border space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                <User className="h-5 w-5 text-[#FFB300]" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold">{language === 'th' ? 'บัญชีผู้ใช้' : 'Account'}</h2>
                <p className="text-xs text-muted-foreground">
                  {language === 'th' ? 'ข้อมูลบัญชีของคุณ' : 'Your account information'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {language === 'th' ? 'อีเมล' : 'Email'}
              </label>
              <div className="p-2 rounded bg-muted/50">
                <code className="text-sm">{user?.email}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
