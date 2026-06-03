import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

const VideoGallery = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const l = (th: string, en: string) => (language === 'th' ? th : en);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">{l('วิดีโอ', 'Videos')}</h2>
        <p className="text-sm text-muted-foreground">
          {l('คลังวิดีโอของคุณ', 'Your video library')}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => navigate('/app/videos/kling-3-motion-control')}
          className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:border-[#FFB300]/50 hover:shadow-xl hover:shadow-[#FFB300]/10 hover:-translate-y-0.5"
        >
          <span className="absolute right-3 top-3 z-10 inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-[#FFB300] text-black shadow">
            NEW
          </span>

          <div className="relative aspect-[3/4] overflow-hidden bg-black">
            <video
              src="/kling-3-demo.mp4"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          <div className="p-3">
            <div className="text-sm font-bold text-foreground truncate">Kling 3.0 Motion Control</div>
            <div className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {l('ถ่ายโอนการเคลื่อนไหวจากวิดีโอสู่ภาพ', 'Transfer motion from video to image')}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default VideoGallery;
