import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';

const SubscriptionSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshSubscription } = useSubscription();
  const { t } = useLanguage();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    // Refresh subscription status after successful payment
    if (sessionId) {
      refreshSubscription();
    }
  }, [sessionId, refreshSubscription]);

  return (
    <div className="page-wrapper">
      <div>
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-2xl mx-auto text-center space-y-8">
            <div className="animate-scale-in">
              <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-r from-green-500 to-emerald-600 flex items-center justify-center mb-6 shadow-2xl shadow-green-500/50">
                <CheckCircle2 className="h-12 w-12 text-white" />
              </div>

              <h1 className="text-4xl font-bold mb-4">{t('subsuccess.welcome')}</h1>
              <p className="text-xl text-muted-foreground">
                {t('subsuccess.activeDesc')}
              </p>
            </div>

            <div className="bg-card p-8 rounded-2xl border border-green-500/30 animate-scale-in" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center justify-center gap-3 mb-6">
                <Sparkles className="h-6 w-6 text-[#FFB300]" />
                <h2 className="text-2xl font-bold">{t('subsuccess.whatsIncluded')}</h2>
              </div>

              <ul className="text-left space-y-4 max-w-md mx-auto">
                {[
                  t('subsuccess.feat1'),
                  t('subsuccess.feat2'),
                  t('subsuccess.feat3'),
                  t('subsuccess.feat4'),
                  t('subsuccess.feat5'),
                ].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center animate-scale-in" style={{ animationDelay: '200ms' }}>
              <Button
                onClick={() => navigate('/')}
                className="h-14 px-8 text-lg font-bold bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] hover:opacity-90"
              >
                {t('subsuccess.startUsing')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>

              <Button
                onClick={() => navigate('/subscription')}
                variant="outline"
                className="h-14 px-8 text-lg"
              >
                {t('subsuccess.viewDetails')}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default SubscriptionSuccess;
