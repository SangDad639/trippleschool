import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Eye,
  EyeOff,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Video,
  Sparkles,
  Wand2,
  Send,
  BookOpen,
} from 'lucide-react';

interface ApiKeyState {
  hasKey: boolean;
  maskedKey: string | null;
}

interface ApiKeysData {
  openai: ApiKeyState;
  vidgo: ApiKeyState;
  kie: ApiKeyState;
  late: ApiKeyState;
  postforme: ApiKeyState;
  openrouter: ApiKeyState;
  anthropic: ApiKeyState;
  elevenlabs: ApiKeyState;
  elevenlabs_voice_id_th: string;
  elevenlabs_voice_id_en: string;
  ai_provider: string;
}

const Settings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeysData>({
    openai: { hasKey: false, maskedKey: null },
    vidgo: { hasKey: false, maskedKey: null },
    kie: { hasKey: false, maskedKey: null },
    late: { hasKey: false, maskedKey: null },
    postforme: { hasKey: false, maskedKey: null },
    openrouter: { hasKey: false, maskedKey: null },
    anthropic: { hasKey: false, maskedKey: null },
    elevenlabs: { hasKey: false, maskedKey: null },
    elevenlabs_voice_id_th: '',
    elevenlabs_voice_id_en: '',
    ai_provider: 'openai'
  });

  // Input states
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [vidgoKey, setVidgoKey] = useState('');
  const [kieKey, setKieKey] = useState('');
  const [lateKey, setLateKey] = useState('');
  const [postformeKey, setPostformeKey] = useState('');
  const [postformeKeyName, setPostformeKeyName] = useState('');
  const [postformeKeyExpiry, setPostformeKeyExpiry] = useState('');
  const [postformeKeys, setPostformeKeys] = useState<{ name: string; maskedKey: string }[]>([]);
  const [pfmSocialAccounts, setPfmSocialAccounts] = useState<any[]>([]);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showOpenrouter, setShowOpenrouter] = useState(false);
  const [showVidgo, setShowVidgo] = useState(false);
  const [showKie, setShowKie] = useState(false);
  const [showLate, setShowLate] = useState(false);
  const [showPostforme, setShowPostforme] = useState(false);
  const [aiProvider, setAiProvider] = useState('openai');

  // AI Agent feature keys
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [deletingAnthropic, setDeletingAnthropic] = useState(false);

  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [showElevenlabs, setShowElevenlabs] = useState(false);
  const [savingElevenlabs, setSavingElevenlabs] = useState(false);
  const [deletingElevenlabs, setDeletingElevenlabs] = useState(false);
  const [voiceIdTh, setVoiceIdTh] = useState('');
  const [voiceIdEn, setVoiceIdEn] = useState('');
  const [savingVoiceIds, setSavingVoiceIds] = useState(false);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [savingOpenrouter, setSavingOpenrouter] = useState(false);
  const [savingVidgo, setSavingVidgo] = useState(false);
  const [savingKie, setSavingKie] = useState(false);
  const [savingLate, setSavingLate] = useState(false);
  const [savingPostforme, setSavingPostforme] = useState(false);
  const [deletingOpenai, setDeletingOpenai] = useState(false);
  const [deletingOpenrouter, setDeletingOpenrouter] = useState(false);
  const [deletingVidgo, setDeletingVidgo] = useState(false);
  const [deletingKie, setDeletingKie] = useState(false);
  const [deletingLate, setDeletingLate] = useState(false);
  const [deletingPostforme, setDeletingPostforme] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  // Messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadApiKeys();
  }, []);

  // Scroll to hash element if present (e.g., /settings#postforme)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Highlight the section briefly
          element.classList.add('ring-2', 'ring-amber-500/50');
          setTimeout(() => element.classList.remove('ring-2', 'ring-amber-500/50'), 2000);
        }
      }, 500); // Wait for content to load
    }
  }, []);

  const loadApiKeys = async () => {
    try {
      setLoading(true);
      const result = await api.getApiKeys();
      setApiKeys(result);
      setAiProvider(result.ai_provider || 'openai');
      setVoiceIdTh(result.elevenlabs_voice_id_th || '');
      setVoiceIdEn(result.elevenlabs_voice_id_en || '');
      setPostformeKeys(result.postformeKeys || []);
      if (result.postformeSubscriptionExpiry) {
        const d = new Date(result.postformeSubscriptionExpiry);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          setPostformeKeyExpiry(`${y}-${m}-${day}`);
        }
      }
      // Load social accounts with expiration dates
      try {
        const accounts = await api.getPostformeSocialAccounts();
        setPfmSocialAccounts(Array.isArray(accounts) ? accounts : []);
      } catch { setPfmSocialAccounts([]); }
    } catch (error) {
      console.error('Failed to load API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOpenai = async () => {
    if (!openaiKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }

    if (!openaiKey.startsWith('sk-')) {
      setMessage({ type: 'error', text: t('settings.invalidOpenaiKey') });
      return;
    }

    try {
      setSavingOpenai(true);
      setMessage(null);
      await api.saveApiKeys({ openai_api_key: openaiKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setOpenaiKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingOpenai(false);
    }
  };

  const handleSaveOpenrouter = async () => {
    if (!openrouterKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }

    if (!openrouterKey.startsWith('sk-or-')) {
      setMessage({ type: 'error', text: t('settings.invalidOpenrouterKey') });
      return;
    }

    try {
      setSavingOpenrouter(true);
      setMessage(null);
      await api.saveApiKeys({ openrouter_api_key: openrouterKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setOpenrouterKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingOpenrouter(false);
    }
  };

  const handleDeleteOpenrouter = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setDeletingOpenrouter(true);
      setMessage(null);
      await api.deleteApiKeyByType('openrouter');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingOpenrouter(false);
    }
  };

  const handleSaveAnthropic = async () => {
    if (!anthropicKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }
    if (!anthropicKey.startsWith('sk-ant-')) {
      setMessage({ type: 'error', text: language === 'th' ? 'รูปแบบ Anthropic API key ไม่ถูกต้อง (ขึ้นต้นด้วย sk-ant-)' : 'Invalid Anthropic API key format (must start with sk-ant-)' });
      return;
    }
    try {
      setSavingAnthropic(true);
      setMessage(null);
      await api.saveApiKeys({ anthropic_api_key: anthropicKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setAnthropicKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingAnthropic(false);
    }
  };

  const handleDeleteAnthropic = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;
    try {
      setDeletingAnthropic(true);
      setMessage(null);
      await api.deleteApiKeyByType('anthropic');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingAnthropic(false);
    }
  };

  const handleSaveElevenlabs = async () => {
    if (!elevenlabsKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }
    try {
      setSavingElevenlabs(true);
      setMessage(null);
      await api.saveApiKeys({ elevenlabs_api_key: elevenlabsKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setElevenlabsKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingElevenlabs(false);
    }
  };

  const handleDeleteElevenlabs = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;
    try {
      setDeletingElevenlabs(true);
      setMessage(null);
      await api.deleteApiKeyByType('elevenlabs');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingElevenlabs(false);
    }
  };

  const handleSaveVoiceIds = async () => {
    try {
      setSavingVoiceIds(true);
      setMessage(null);
      await api.saveApiKeys({
        elevenlabs_voice_id_th: voiceIdTh.trim(),
        elevenlabs_voice_id_en: voiceIdEn.trim(),
      });
      setMessage({ type: 'success', text: language === 'th' ? 'บันทึก Voice ID แล้ว' : 'Voice IDs saved' });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingVoiceIds(false);
    }
  };

  const handleChangeProvider = async (provider: string) => {
    try {
      setSavingProvider(true);
      setAiProvider(provider);
      await api.saveApiKeys({ ai_provider: provider });
      setMessage({ type: 'success', text: `${t('settings.providerChanged')} ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'}` });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.changeProviderFailed') });
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSaveVidgo = async () => {
    if (!vidgoKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }

    try {
      setSavingVidgo(true);
      setMessage(null);
      await api.saveApiKeys({ vidgo_api_key: vidgoKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setVidgoKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingVidgo(false);
    }
  };

  const handleSaveKie = async () => {
    if (!kieKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }

    try {
      setSavingKie(true);
      setMessage(null);
      await api.saveApiKeys({ kie_api_key: kieKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setKieKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingKie(false);
    }
  };

  const handleDeleteOpenai = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setDeletingOpenai(true);
      setMessage(null);
      await api.deleteApiKeyByType('openai');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingOpenai(false);
    }
  };

  const handleDeleteVidgo = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setDeletingVidgo(true);
      setMessage(null);
      await api.deleteApiKeyByType('vidgo');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingVidgo(false);
    }
  };

  const handleDeleteKie = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setDeletingKie(true);
      setMessage(null);
      await api.deleteApiKeyByType('kie');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingKie(false);
    }
  };

  const handleSaveLate = async () => {
    if (!lateKey.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKey') });
      return;
    }

    if (!lateKey.startsWith('sk_')) {
      setMessage({ type: 'error', text: t('settings.invalidLateKey') });
      return;
    }

    try {
      setSavingLate(true);
      setMessage(null);
      await api.saveApiKeys({ late_api_key: lateKey });
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setLateKey('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingLate(false);
    }
  };

  const handleDeleteLate = async () => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setDeletingLate(true);
      setMessage(null);
      await api.deleteApiKeyByType('late');
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    } finally {
      setDeletingLate(false);
    }
  };

  const handleSavePostforme = async () => {
    if (!postformeKey.trim() || !postformeKeyName.trim()) {
      setMessage({ type: 'error', text: t('settings.enterKeyAndName') });
      return;
    }

    try {
      setSavingPostforme(true);
      setMessage(null);
      await api.addPostformeKey(postformeKeyName.trim(), postformeKey.trim(), postformeKeyExpiry || undefined);
      setMessage({ type: 'success', text: t('settings.keySaved') });
      setPostformeKey('');
      setPostformeKeyName('');
      setPostformeKeyExpiry('');
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.saveKeyFailed') });
    } finally {
      setSavingPostforme(false);
    }
  };

  const handleDeletePostformeKey = async (name: string) => {
    if (!confirm(t('settings.confirmRemoveKey'))) return;

    try {
      setMessage(null);
      await api.deletePostformeKey(name);
      setMessage({ type: 'success', text: t('settings.keyRemoved') });
      await loadApiKeys();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || t('settings.removeKeyFailed') });
    }
  };

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

          {/* Message */}
          {message && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              message.type === 'success'
                ? 'bg-[#FFB300]/10 text-[#FFB300] border border-[#FFB300]/30'
                : 'bg-red-500/10 text-red-500 border border-red-500/30'
            }`}>
              {message.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span className="text-sm">{message.text}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* AI Provider Selection */}
              <div className="bg-card p-5 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Sparkles className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{t('settings.aiProvider')}</h2>
                    <p className="text-xs text-muted-foreground">{t('settings.aiProviderDesc')}</p>
                  </div>
                </div>

                {/* Provider Dropdown */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">{t('settings.selectProvider')}</label>
                  <select
                    value={aiProvider}
                    onChange={(e) => handleChangeProvider(e.target.value)}
                    disabled={savingProvider}
                    className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </div>

                {/* OpenAI API Key */}
                {aiProvider === 'openai' && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t('settings.openaiKey')}</span>
                      {apiKeys.openai.hasKey && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                      )}
                    </div>

                    {apiKeys.openai.hasKey && apiKeys.openai.maskedKey && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <code className="text-xs">{apiKeys.openai.maskedKey}</code>
                        <Button variant="ghost" size="sm" onClick={handleDeleteOpenai} disabled={deletingOpenai} className="h-7 text-red-500">
                          {deletingOpenai ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showOpenai ? 'text' : 'password'}
                          value={openaiKey}
                          onChange={(e) => setOpenaiKey(e.target.value)}
                          placeholder="sk-..."
                          className="pr-8 font-mono text-xs h-9"
                        />
                        <button type="button" onClick={() => setShowOpenai(!showOpenai)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                          {showOpenai ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <Button onClick={handleSaveOpenai} disabled={savingOpenai || !openaiKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                        {savingOpenai ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate('/guide')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFB300]/20 text-[#FFB300] hover:bg-[#FFB300]/30 transition-colors"
                      >
                        <BookOpen className="h-3 w-3" />
                        {t('settings.guide')}
                      </button>
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                        {t('settings.getKeyFrom')} OpenAI <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}

                {/* OpenRouter API Key */}
                {aiProvider === 'openrouter' && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t('settings.openrouterKey')}</span>
                      {apiKeys.openrouter?.hasKey && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                      )}
                    </div>

                    {apiKeys.openrouter?.hasKey && apiKeys.openrouter?.maskedKey && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <code className="text-xs">{apiKeys.openrouter.maskedKey}</code>
                        <Button variant="ghost" size="sm" onClick={handleDeleteOpenrouter} disabled={deletingOpenrouter} className="h-7 text-red-500">
                          {deletingOpenrouter ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showOpenrouter ? 'text' : 'password'}
                          value={openrouterKey}
                          onChange={(e) => setOpenrouterKey(e.target.value)}
                          placeholder="sk-or-..."
                          className="pr-8 font-mono text-xs h-9"
                        />
                        <button type="button" onClick={() => setShowOpenrouter(!showOpenrouter)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                          {showOpenrouter ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <Button onClick={handleSaveOpenrouter} disabled={savingOpenrouter || !openrouterKey.trim()} className="h-9 bg-blue-600 hover:bg-blue-700">
                        {savingOpenrouter ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigate('/guide')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFB300]/20 text-[#FFB300] hover:bg-[#FFB300]/30 transition-colors"
                      >
                        <BookOpen className="h-3 w-3" />
                        {t('settings.guide')}
                      </button>
                      <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                        {t('settings.getKeyFrom')} OpenRouter <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* ============ AI Agent feature keys ============ */}

              {/* Anthropic API Key (for AI Agent pipeline LLM brain) */}
              <div id="anthropic" className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Sparkles className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{language === 'th' ? 'Anthropic API Key' : 'Anthropic API Key'}</h2>
                    <p className="text-xs text-muted-foreground">
                      {language === 'th'
                        ? 'ใช้กับ AI Agent — Claude คิดไอเดีย + เขียนบท + สตอรีบอร์ด (มี prompt caching ลดค่าใช้จ่าย)'
                        : 'Used by AI Agent — Claude writes ideas, scripts, storyboards (with prompt caching to cut cost)'}
                    </p>
                  </div>
                  {apiKeys.anthropic?.hasKey && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                  )}
                </div>
                {apiKeys.anthropic?.hasKey && apiKeys.anthropic?.maskedKey && (
                  <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <code className="text-xs">{apiKeys.anthropic.maskedKey}</code>
                    <Button variant="ghost" size="sm" onClick={handleDeleteAnthropic} disabled={deletingAnthropic} className="h-7 text-red-500">
                      {deletingAnthropic ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showAnthropic ? 'text' : 'password'}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="pr-8 font-mono text-xs h-9"
                    />
                    <button type="button" onClick={() => setShowAnthropic(!showAnthropic)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showAnthropic ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button onClick={handleSaveAnthropic} disabled={savingAnthropic || !anthropicKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                    {savingAnthropic ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                    {t('settings.getKeyFrom')} console.anthropic.com → API Keys <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2">
                  {language === 'th'
                    ? '💡 ถ้าใช้ OpenRouter อยู่แล้ว ไม่ต้องตั้งอันนี้ — AI Agent จะใช้ OpenRouter อัตโนมัติ'
                    : '💡 If you already use OpenRouter, you can skip this — AI Agent will route through OpenRouter automatically'}
                </div>
              </div>

              {/* ElevenLabs API Key + Voice IDs */}
              <div id="elevenlabs" className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Wand2 className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{language === 'th' ? 'ElevenLabs API Key + Voice ID' : 'ElevenLabs API Key + Voice IDs'}</h2>
                    <p className="text-xs text-muted-foreground">
                      {language === 'th'
                        ? 'ใช้กับ AI Agent — สร้างเสียงพากย์รายฉาก (ไทย/อังกฤษ)'
                        : 'Used by AI Agent — per-scene voice narration (Thai / English)'}
                    </p>
                  </div>
                  {apiKeys.elevenlabs?.hasKey && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                  )}
                </div>
                {apiKeys.elevenlabs?.hasKey && apiKeys.elevenlabs?.maskedKey && (
                  <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <code className="text-xs">{apiKeys.elevenlabs.maskedKey}</code>
                    <Button variant="ghost" size="sm" onClick={handleDeleteElevenlabs} disabled={deletingElevenlabs} className="h-7 text-red-500">
                      {deletingElevenlabs ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showElevenlabs ? 'text' : 'password'}
                      value={elevenlabsKey}
                      onChange={(e) => setElevenlabsKey(e.target.value)}
                      placeholder="xi-..."
                      className="pr-8 font-mono text-xs h-9"
                    />
                    <button type="button" onClick={() => setShowElevenlabs(!showElevenlabs)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showElevenlabs ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button onClick={handleSaveElevenlabs} disabled={savingElevenlabs || !elevenlabsKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                    {savingElevenlabs ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>

                {/* Voice ID inputs */}
                <div className="pt-3 border-t border-border space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {language === 'th' ? 'Voice ID (ใส่ของ voice clone ที่ฝึกไว้)' : 'Voice IDs (paste from your cloned voices)'}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">🇹🇭 {language === 'th' ? 'เสียงไทย' : 'Thai voice'}</label>
                      <Input
                        value={voiceIdTh}
                        onChange={(e) => setVoiceIdTh(e.target.value)}
                        placeholder="21m00Tcm4TlvDq8ikWAM"
                        className="font-mono text-xs h-9"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-muted-foreground mb-1">🇺🇸 {language === 'th' ? 'เสียงอังกฤษ' : 'English voice'}</label>
                      <Input
                        value={voiceIdEn}
                        onChange={(e) => setVoiceIdEn(e.target.value)}
                        placeholder="21m00Tcm4TlvDq8ikWAM"
                        className="font-mono text-xs h-9"
                      />
                    </div>
                  </div>
                  <Button onClick={handleSaveVoiceIds} disabled={savingVoiceIds} size="sm" className="h-8 bg-muted hover:bg-muted/80">
                    {savingVoiceIds ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    {language === 'th' ? 'บันทึก Voice IDs' : 'Save Voice IDs'}
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <a href="https://elevenlabs.io/app/voice-lab" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                    {t('settings.getKeyFrom')} elevenlabs.io → Voice Lab <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {/* VidGo API Key - hidden for users registered after 2026-03-28, hidden for all after 2026-04-28 */}
              {new Date() < new Date('2026-04-28T00:00:00.000Z') && (!user?.createdAt || new Date(user.createdAt) < new Date('2026-03-28T00:00:00.000Z')) && (
              <div className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Video className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{t('settings.vidgoKey')}</h2>
                    <p className="text-xs text-muted-foreground">{t('settings.vidgoDesc')}</p>
                  </div>
                  {apiKeys.vidgo.hasKey && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                  )}
                </div>

                <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-500 space-y-1">
                    <p>{t('settings.vidgoWarning1')}</p>
                    <p className="font-semibold">{t('settings.vidgoWarning2')}</p>
                  </div>
                </div>

                {apiKeys.vidgo.hasKey && apiKeys.vidgo.maskedKey && (
                  <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <code className="text-xs">{apiKeys.vidgo.maskedKey}</code>
                    <Button variant="ghost" size="sm" onClick={handleDeleteVidgo} disabled={deletingVidgo} className="h-7 text-red-500">
                      {deletingVidgo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showVidgo ? 'text' : 'password'}
                      value={vidgoKey}
                      onChange={(e) => setVidgoKey(e.target.value)}
                      placeholder={t('settings.vidgoPlaceholder')}
                      className="pr-8 font-mono text-xs h-9"
                    />
                    <button type="button" onClick={() => setShowVidgo(!showVidgo)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showVidgo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button onClick={handleSaveVidgo} disabled={savingVidgo || !vidgoKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                    {savingVidgo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate('/guide')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFB300]/20 text-[#FFB300] hover:bg-[#FFB300]/30 transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {t('settings.guide')}
                  </button>
                  <a href="https://vidgo.ai/apis/dashboard/api-key" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                    {t('settings.getKeyFrom')} VidGo.ai <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              )}

              {/* KIE API Key */}
              <div className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Video className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{t('settings.kieKey')}</h2>
                    <p className="text-xs text-muted-foreground">{t('settings.kieDesc')}</p>
                  </div>
                  {apiKeys.kie.hasKey && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                  )}
                </div>

                {apiKeys.kie.hasKey && apiKeys.kie.maskedKey && (
                  <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <code className="text-xs">{apiKeys.kie.maskedKey}</code>
                    <Button variant="ghost" size="sm" onClick={handleDeleteKie} disabled={deletingKie} className="h-7 text-red-500">
                      {deletingKie ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKie ? 'text' : 'password'}
                      value={kieKey}
                      onChange={(e) => setKieKey(e.target.value)}
                      placeholder={t('settings.kiePlaceholder')}
                      className="pr-8 font-mono text-xs h-9"
                    />
                    <button type="button" onClick={() => setShowKie(!showKie)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showKie ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button onClick={handleSaveKie} disabled={savingKie || !kieKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                    {savingKie ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate('/guide?open=kie')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFB300]/20 text-[#FFB300] hover:bg-[#FFB300]/30 transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {t('settings.guide')}
                  </button>
                  <a href="https://kie.ai/api-key" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                    {t('settings.getKeyFrom')} KIE.ai <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {/* Late API Key - hidden for users registered after 2026-03-28 */}
              {new Date() < new Date('2026-04-28T00:00:00.000Z') && (!user?.createdAt || new Date(user.createdAt) < new Date('2026-03-28T00:00:00.000Z')) && (
              <div id="late" className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Send className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{t('settings.lateKey')}</h2>
                    <p className="text-xs text-muted-foreground">{t('settings.lateDesc')}</p>
                  </div>
                  {apiKeys.late.hasKey && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{t('common.active')}</span>
                  )}
                </div>

                <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-500 space-y-1">
                    <p>{t('settings.lateWarning1')}</p>
                    <p className="font-semibold">{t('settings.lateWarning2')}</p>
                  </div>
                </div>

                {apiKeys.late.hasKey && apiKeys.late.maskedKey && (
                  <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <code className="text-xs">{apiKeys.late.maskedKey}</code>
                    <Button variant="ghost" size="sm" onClick={handleDeleteLate} disabled={deletingLate} className="h-7 text-red-500">
                      {deletingLate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showLate ? 'text' : 'password'}
                      value={lateKey}
                      onChange={(e) => setLateKey(e.target.value)}
                      placeholder="sk_..."
                      className="pr-8 font-mono text-xs h-9"
                    />
                    <button type="button" onClick={() => setShowLate(!showLate)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showLate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button onClick={handleSaveLate} disabled={savingLate || !lateKey.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                    {savingLate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate('/guide')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {t('settings.guide')}
                  </button>
                  <a href="https://zernio.com/dashboard/api-keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-orange-500">
                    {t('settings.getKeyFrom')} Late (Settings → API Keys) <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              )}

              {/* Post for Me API Keys (Multiple) */}
              <div id="postforme" className="bg-card p-5 rounded-xl border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-[#FFB300]/20">
                    <Send className="h-5 w-5 text-[#FFB300]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-semibold">{t('settings.postformeKey')}</h2>
                    <p className="text-xs text-muted-foreground">{t('settings.postformeDesc')}</p>
                  </div>
                  {postformeKeys.length > 0 && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[#FFB300]/20 text-[#FFB300]">{postformeKeys.length} keys</span>
                  )}
                </div>
                {postformeKeyExpiry && (() => {
                  const exp = new Date(postformeKeyExpiry + 'T00:00:00');
                  const diffDays = Math.floor((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  const isExpired = diffDays < 0;
                  const isExpiringSoon = diffDays >= 0 && diffDays <= 7;
                  return (
                    <div className={`text-xs px-3 py-1.5 rounded-lg ${
                      isExpired ? 'bg-red-500/10 text-red-400' :
                      isExpiringSoon ? 'bg-amber-500/10 text-amber-400' :
                      'bg-[#FFB300]/10 text-[#FFB300]'
                    }`}>
                      {isExpired
                        ? `${t('settings.pfmSubExpired')} (${exp.toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })})`
                        : t('settings.pfmSubExpiresOn', { date: exp.toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }), days: diffDays })
                      }
                    </div>
                  );
                })()}

                {/* Existing keys list */}
                {postformeKeys.length > 0 && (
                  <div className="space-y-2">
                    {postformeKeys.map((k: any) => {
                      return (
                        <div key={k.name} className="p-2 rounded bg-muted/50 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-[#FFB300]">{k.name}</span>
                              <code className="text-xs text-muted-foreground ml-2">{k.maskedKey}</code>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleDeletePostformeKey(k.name)} className="h-7 text-red-500">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}


                {/* Add new key */}
                <div className="space-y-2">
                  <Input
                    value={postformeKeyName}
                    onChange={(e) => setPostformeKeyName(e.target.value)}
                    placeholder={language === 'th' ? 'แนะนำให้ใส่ชื่อ Project ที่ตั้งใน Post for Me' : 'Use the project name from Post for Me'}
                    className="font-mono text-xs h-9"
                  />
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showPostforme ? 'text' : 'password'}
                        value={postformeKey}
                        onChange={(e) => setPostformeKey(e.target.value)}
                        placeholder={t('settings.pfmPlaceholder')}
                        className="pr-8 font-mono text-xs h-9"
                      />
                      <button type="button" onClick={() => setShowPostforme(!showPostforme)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPostforme ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button onClick={handleSavePostforme} disabled={savingPostforme || !postformeKey.trim() || !postformeKeyName.trim()} className="h-9 bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
                      {savingPostforme ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{t('settings.pfmSubExpiry')}</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="flex-1 h-9 justify-start text-xs font-normal text-muted-foreground">
                          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                          {postformeKeyExpiry
                            ? new Date(postformeKeyExpiry + 'T00:00:00').toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                            : t('settings.pfmSelectExpiry')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={postformeKeyExpiry ? new Date(postformeKeyExpiry + 'T00:00:00') : undefined}
                          onSelect={async (date) => {
                            if (date) {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, '0');
                              const d = String(date.getDate()).padStart(2, '0');
                              const val = `${y}-${m}-${d}`;
                              setPostformeKeyExpiry(val);
                              try {
                                await api.saveApiKeys({ postforme_subscription_expiry: val });
                                setMessage({ type: 'success', text: t('settings.pfmExpirySaved') });
                              } catch {
                                setMessage({ type: 'error', text: t('settings.pfmExpirySaveFailed') });
                              }
                            } else {
                              setPostformeKeyExpiry('');
                            }
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigate('/guide')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFB300]/20 text-[#FFB300] hover:bg-[#FFB300]/30 transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {t('settings.guide')}
                  </button>
                  <a href="https://postforme.dev/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#FFB300]">
                    {t('settings.getKeyFrom')} postforme.dev (Dashboard → API Keys) <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
