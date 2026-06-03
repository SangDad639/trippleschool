import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { PRICING } from '@/lib/pricing';
import { api } from '@/lib/api';
import {
  Calendar,
  Sparkles,
  Zap,
  Video,
  Check,
  ArrowRight,
  Star,
  Globe,
  MessageSquare,
  Library,
  Send,
} from 'lucide-react';

const Landing = () => {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();

  const features = [
    {
      icon: <Video className="h-8 w-8" />,
      title: t('landing.feat1Title'),
      description: t('landing.feat1Desc'),
    },
    {
      icon: <Sparkles className="h-8 w-8" />,
      title: t('landing.feat2Title'),
      description: t('landing.feat2Desc'),
    },
    {
      icon: <Globe className="h-8 w-8" />,
      title: t('landing.feat3Title'),
      description: t('landing.feat3Desc'),
    },
    {
      icon: <Calendar className="h-8 w-8" />,
      title: t('landing.feat4Title'),
      description: t('landing.feat4Desc'),
    },
    {
      icon: <MessageSquare className="h-8 w-8" />,
      title: t('landing.feat5Title'),
      description: t('landing.feat5Desc'),
    },
    {
      icon: <Library className="h-8 w-8" />,
      title: t('landing.feat6Title'),
      description: t('landing.feat6Desc'),
    },
  ];

  // Pricing-card feature entry. `highlight` is optional — only the yearly-bonus
  // features set it (renders with a colored background). Annotated explicitly
  // so that spreading baseFeatures + yearlyBonusFeatures doesn't widen the
  // union and lose the highlight field.
  type FeatureItem = { title: string; desc: string; highlight?: boolean };
  const baseFeatures: FeatureItem[] = [
    { title: t('landing.feat.channels'), desc: t('landing.feat.channelsDesc') },
    { title: t('landing.feat.aiPrompt'), desc: t('landing.feat.aiPromptDesc') },
    { title: t('landing.feat.variable'), desc: t('landing.feat.variableDesc') },
    { title: t('landing.feat.caption'), desc: t('landing.feat.captionDesc') },
    { title: t('landing.feat.schedule'), desc: t('landing.feat.scheduleDesc') },
    { title: t('landing.feat.bulk'), desc: t('landing.feat.bulkDesc') },
    { title: t('landing.feat.retry'), desc: t('landing.feat.retryDesc') },
    { title: t('landing.feat.videoApi'), desc: t('landing.feat.videoApiDesc') },
    { title: t('landing.feat.postApi'), desc: t('landing.feat.postApiDesc') },
  ];

  const yearlyBonusFeatures: FeatureItem[] = [
    { title: t('landing.bonus.prompts'), desc: t('landing.bonus.promptsDesc'), highlight: true },
    { title: t('landing.bonus.custom'), desc: t('landing.bonus.customDesc'), highlight: true },
    { title: t('landing.bonus.save'), desc: t('landing.bonus.saveDesc'), highlight: true },
    { title: t('landing.bonus.lock'), desc: t('landing.bonus.lockDesc'), highlight: true },
  ];

  // Marketing pricing — display subtotal only (VAT disclosure hidden per
  // business preference).

  // Fetch active plans from the dynamic subscription_plans table. Falls back
  // to the hardcoded monthly/yearly constants if the API is unreachable so
  // the marketing page doesn't go blank.
  type ApiPlan = Awaited<ReturnType<typeof api.getSubscriptionPlans>>['plans'][number];
  const [apiPlans, setApiPlans] = useState<ApiPlan[] | null>(null);
  useEffect(() => {
    api.getSubscriptionPlans()
      .then((res) => setApiPlans(res.plans))
      .catch(() => {/* fall back to hardcoded plans */});
  }, []);

  // Map plans to the shape consumed by the pricing cards. Highlight the
  // longest-duration plan as "popular" so the yearly card stays featured
  // (and any future "lifetime" plan automatically gets the highlight).
  const planSource: Array<{ slug: string; name: string; subtotal: number; vat: number; total: number; days: number; description: string | null }> =
    apiPlans
      ? apiPlans.map((p) => ({
          slug: p.slug,
          name: p.name,
          subtotal: p.subtotal,
          vat: p.vat,
          total: p.total,
          days: p.days,
          description: p.description,
        }))
      : [
          { slug: 'monthly', name: t('landing.monthly'), subtotal: PRICING.monthly.subtotal, vat: PRICING.monthly.vat, total: PRICING.monthly.total, days: 30,  description: t('landing.monthlyDesc') },
          { slug: 'yearly',  name: t('landing.yearly'),  subtotal: PRICING.yearly.subtotal,  vat: PRICING.yearly.vat,  total: PRICING.yearly.total,  days: 365, description: t('landing.yearlyDesc') },
        ];
  const longestDays = Math.max(...planSource.map((p) => p.days));

  const pricingPlans = planSource.map((p) => {
    const isLongest = p.days === longestDays && planSource.length > 1;
    return {
      name: p.name,
      price: `฿${p.subtotal.toLocaleString()}`,
      period: p.days === 30 ? t('landing.perMonth') : p.days === 365 ? t('landing.perYear') : `/${p.days}d`,
      description: p.description || '',
      // Yearly (or longest plan) gets the bonus features list; others see base only.
      features: isLongest ? [...baseFeatures, ...yearlyBonusFeatures] : baseFeatures,
      popular: isLongest,
    };
  });

  const platforms = [
    { name: 'TikTok', color: 'bg-pink-500/20 text-pink-400' },
    { name: 'YouTube Shorts', color: 'bg-red-500/20 text-red-400' },
    { name: 'Instagram Reels', color: 'bg-purple-500/20 text-purple-400' },
    { name: 'Facebook Reels', color: 'bg-blue-500/20 text-blue-400' },
    { name: 'X (Twitter)', color: 'bg-gray-500/20 text-gray-400' },
  ];

  return (
    <div className="page-wrapper">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-[12px] flex items-center justify-center shadow-lg" style={{ background: 'radial-gradient(circle farthest-corner at 35% 90%, #fec564, transparent 50%), radial-gradient(circle farthest-corner at 0 140%, #fec564, transparent 50%), radial-gradient(ellipse farthest-corner at 0 -25%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 20% -50%, #5258cf, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 0, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 60% -20%, #893dc2, transparent 50%), radial-gradient(ellipse farthest-corner at 100% 100%, #d9317a, transparent), linear-gradient(#6559ca, #bc318f 30%, #e33f5f 50%, #f77638 70%, #fec66d 100%)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 2L4.5 13.5H11.5L11 22L19.5 10.5H12.5L13 2Z" fill="#FFD700" stroke="#FFD700" strokeWidth="0.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-xl font-bold">Triple Viral</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
              {t('landing.features')}
            </a>
            <a href="/tutorials" className="text-muted-foreground hover:text-foreground transition-colors">
              {language === 'th' ? 'เรียน' : 'Learn'}
            </a>
            <a href="/affiliate-info" className="text-muted-foreground hover:text-foreground transition-colors">
              {language === 'th' ? 'ตัวแทนจำหน่าย' : 'Reseller'}
            </a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">
              {t('landing.pricing')}
            </a>
            <a href="/update" className="text-muted-foreground hover:text-foreground transition-colors">
              {language === 'th' ? 'อัปเดต' : 'Updates'}
            </a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
              className="px-2 py-1 text-sm rounded-md border border-border hover:bg-muted transition-colors"
            >
              {language === 'th' ? '🇹🇭 TH' : '🇺🇸 EN'}
            </button>
            <Button variant="ghost" onClick={() => navigate('/login')}>
              {t('landing.login')}
            </Button>
            <Button onClick={() => navigate('/register')} className="gap-2">
              {t('landing.getStarted')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 px-4 py-1.5">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {t('landing.badge')}
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            {t('landing.heroTitle1')}
            <span className="text-primary block mt-2">{t('landing.heroTitle2')}</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            {t('landing.heroDesc')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" onClick={() => navigate('/register')} className="gap-2 text-lg px-8 py-6">
              {t('landing.startTrial')}
              <ArrowRight className="h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="gap-2 text-lg px-8 py-6" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
              <Sparkles className="h-5 w-5" />
              {t('landing.features')}
            </Button>
          </div>

          {/* Supported Platforms */}
          <div className="mt-16 mb-8">
            <p className="text-sm text-muted-foreground mb-4">{t('landing.supportedPlatforms')}</p>
            <div className="flex flex-wrap justify-center gap-3">
              {platforms.map((platform) => (
                <span key={platform.name} className={`px-4 py-2 rounded-full text-sm font-medium ${platform.color}`}>
                  {platform.name}
                </span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-12">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">5+</div>
              <div className="text-muted-foreground mt-1">{t('landing.statPlatforms')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">Grok</div>
              <div className="text-muted-foreground mt-1">{t('landing.statAiModel')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">24/7</div>
              <div className="text-muted-foreground mt-1">{t('landing.statAutoPost')}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">Auto</div>
              <div className="text-muted-foreground mt-1">{t('landing.statCaption')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 bg-card/50">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">{t('landing.features')}</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t('landing.featuresTitle')}
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {t('landing.featuresDesc')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="bg-card border-border hover:border-primary/50 transition-colors">
                <CardContent className="pt-6">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    {feature.title}
                    {index === 5 && (
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        Yearly
                      </span>
                    )}
                  </h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">{t('landing.howItWorks')}</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t('landing.threeSteps')}
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              {
                step: '01',
                icon: <Zap className="h-6 w-6" />,
                title: t('landing.step1Title'),
                description: t('landing.step1Desc'),
              },
              {
                step: '02',
                icon: <Calendar className="h-6 w-6" />,
                title: t('landing.step2Title'),
                description: t('landing.step2Desc'),
              },
              {
                step: '03',
                icon: <Video className="h-6 w-6" />,
                title: t('landing.step3Title'),
                description: t('landing.step3Desc'),
              },
              {
                step: '04',
                icon: <Send className="h-6 w-6" />,
                title: t('landing.step4Title'),
                description: t('landing.step4Desc'),
              },
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="text-5xl font-bold text-primary/20 mb-3">{item.step}</div>
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
                  {item.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm">{item.description}</p>
                {index < 3 && (
                  <div className="hidden md:block absolute top-6 -right-4 text-primary/30">
                    <ArrowRight className="h-6 w-6" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 bg-card/50">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-16">
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">{t('landing.pricing')}</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t('landing.pricingTitle')}
            </h2>
            <p className="text-muted-foreground text-lg">
              {t('landing.pricingDesc')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {pricingPlans.map((plan, index) => (
              <div
                key={index}
                className={`relative bg-card p-8 rounded-2xl border transition-all hover:scale-[1.02] ${
                  plan.popular
                    ? 'border-yellow-500/60 shadow-2xl shadow-yellow-500/30 bg-gradient-to-b from-yellow-500/5 to-transparent'
                    : 'border-border/50'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                    <span className="px-6 py-2 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] text-white text-base font-bold shadow-lg shadow-yellow-500/50 flex items-center gap-2">
                      <Star className="h-5 w-5" />
                      {t('landing.mostPopular')}
                    </span>
                  </div>
                )}

                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${
                      plan.popular
                        ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                        : 'bg-gradient-to-r from-[#FFB300]/20 to-[#FFB300]/10'
                    }`}>
                      {plan.popular ? (
                        <Star className={`h-6 w-6 ${plan.popular ? 'text-black' : 'text-[#FFB300]'}`} />
                      ) : (
                        <Calendar className="h-6 w-6 text-[#FFB300]" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">{plan.name}</h2>
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    </div>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className={`text-5xl font-bold bg-gradient-to-r ${
                      plan.popular
                        ? 'from-[#FFD700] via-[#FFB300] to-[#FFA500]'
                        : 'from-[#FFB300] via-[#FFC233] to-[#FF9D00]'
                    } bg-clip-text text-transparent`}>
                      {plan.price}
                    </span>
                    <span className="text-xs text-gray-500 ml-0.5">THB</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                    {plan.popular && (
                      <span className="ml-2 px-2 py-1 rounded-md bg-green-500/20 text-green-500 text-sm font-medium">
                        -58%
                      </span>
                    )}
                  </div>

                  <ul className="space-y-2">
                    {plan.features.map((feature, fIndex) => (
                      <li
                        key={fIndex}
                        className={`flex items-start gap-2 text-sm ${
                          feature.highlight
                            ? 'bg-primary/10 -mx-2 px-2 py-1.5 rounded-lg border border-primary/20'
                            : ''
                        }`}
                      >
                        <Check className={`h-4 w-4 flex-shrink-0 mt-0.5 ${plan.popular ? 'text-yellow-500' : 'text-green-500'}`} />
                        <div>
                          <span className="font-bold text-foreground">{feature.title}</span>
                          {feature.desc && (
                            <span className="text-muted-foreground/60 text-xs"> - {feature.desc}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="text-[11px] text-red-400/90 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                    <p className="font-semibold mb-1.5">*หมายเหตุ — ไม่รวมค่าบริการ API</p>
                    <ul className="space-y-1 list-none">
                      <li>• <span className="font-medium text-red-300">Openrouter</span> — คิด Caption เริ่มต้น ~1xx บาท/เดือน</li>
                      <li>• <span className="font-medium text-red-300">KIE AI</span> — สร้างภาพและ VDO เริ่มต้น ~1xx บาท</li>
                      <li>• <span className="font-medium text-red-300">Post for ME</span> — โพสต์ Platform ต่างๆ 0.4 บาท/โพสต์</li>
                    </ul>
                  </div>

                  <Button
                    onClick={() => navigate('/register')}
                    className={`w-full h-14 text-lg font-bold ${
                      plan.popular
                        ? 'bg-gradient-to-r from-[#FFD700] via-[#FFB300] to-[#FFA500] hover:opacity-90 text-black shadow-lg shadow-yellow-500/50'
                        : 'bg-gradient-to-r from-[#FFB300] via-[#FFC233] to-[#FF9D00] hover:opacity-90'
                    }`}
                  >
                    {t('landing.getStarted')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="py-12 text-center">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {t('landing.ctaTitle')}
              </h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
                {t('landing.ctaDesc')}
              </p>
              <Button size="lg" onClick={() => navigate('/register')} className="gap-2 text-lg px-8">
                {t('landing.startYourTrial')}
                <ArrowRight className="h-5 w-5" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="container mx-auto text-center text-muted-foreground">
          <p>&copy; 2025 Triple Viral. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
