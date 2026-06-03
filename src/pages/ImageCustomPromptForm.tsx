import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';

const ImageCustomPromptForm = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  // Section 1: Basic info
  const [name, setName] = useState('');
  const [model, setModel] = useState('gpt-image-2');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [thumbnailLoadError, setThumbnailLoadError] = useState(false);

  // Map model id → display label (used in section heading)
  const MODEL_LABELS: Record<string, string> = {
    'gpt-image-2': 'GPT Image 2',
  };
  const modelLabel = MODEL_LABELS[model] || model;

  // Section 2: System prompt
  const [systemPrompt, setSystemPrompt] = useState('');

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/images')}
            className="text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> {l('กลับ', 'Back')}
          </Button>
          <h2 className="text-lg font-bold">{l('สร้าง Custom Prompt', 'Create Custom Prompt')}</h2>
        </div>

        {/* Section 1: ข้อมูลพื้นฐาน */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#FFB300] uppercase tracking-wide">
              {l('ข้อมูลพื้นฐาน', 'Basic Info')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">
                  {l('ชื่อ Prompt', 'Prompt Name')} *
                </label>
                <Input
                  className="bg-zinc-800 border-zinc-700"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={l('เช่น Anatomy Care AI', 'e.g. Anatomy Care AI')}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">
                  {l('เลือก Model', 'Select Model')} *
                </label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder={l('เลือก Model', 'Select Model')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-image-2">GPT Image 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                {l('URL รูปภาพ', 'Image URL')}
              </label>
              <Input
                className="bg-zinc-800 border-zinc-700"
                value={thumbnailUrl}
                onChange={(e) => {
                  setThumbnailUrl(e.target.value);
                  setThumbnailLoadError(false);
                }}
                placeholder="https://example.com/thumbnail.jpg"
              />
              <p className="text-[10px] text-zinc-500 mt-1">
                {l('รองรับ', 'Supported')}: .jpg, .jpeg, .png, .webp, .gif, .avif, .svg, .bmp
              </p>
            </div>

            {/* Thumbnail preview — shows when URL is entered */}
            {thumbnailUrl.trim() && (
              <div className="space-y-2">
                <label className="text-xs text-zinc-400 block">
                  {l('ตัวอย่างรูป', 'Image Preview')}
                </label>
                <div className="relative inline-block rounded-lg border border-zinc-700 overflow-hidden bg-zinc-950 max-w-xs">
                  {thumbnailLoadError ? (
                    <div className="aspect-video w-64 flex items-center justify-center text-xs text-red-400 px-3 text-center">
                      {l('ไม่สามารถโหลดรูปจาก URL นี้ได้', 'Cannot load image from this URL')}
                    </div>
                  ) : (
                    <img
                      src={thumbnailUrl}
                      alt="Thumbnail preview"
                      className="block max-w-full max-h-48 w-auto h-auto object-contain"
                      onError={() => setThumbnailLoadError(true)}
                      onLoad={() => setThumbnailLoadError(false)}
                    />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Prompt สำหรับสร้างภาพ */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#FFB300] uppercase tracking-wide">
              {l(`Prompt สำหรับสร้างภาพ ${modelLabel}`, `Prompt for ${modelLabel} Image Generation`)} *
            </h3>
            <Textarea
              className="bg-zinc-800 border-zinc-700 text-zinc-200 font-mono text-sm min-h-[240px] sm:min-h-[400px]"
              rows={10}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={l(
                'Prompt สำหรับสร้างภาพ เช่น a cinematic poster of...',
                'Prompt for image generation, e.g. a cinematic poster of...'
              )}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ImageCustomPromptForm;
