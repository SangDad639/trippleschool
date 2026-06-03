import { parseVideoUrl } from '@/lib/parseVideoUrl';
import LazyYouTubeIframe from '@/components/ui/LazyYouTubeIframe';

interface Props {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  name?: string;
  /** Fallback when no video and no thumbnail available */
  fallback?: React.ReactNode;
}

/**
 * Auto-play video preview for template cards.
 * - Direct mp4 (Grok/Sora resolved) → <video autoplay muted loop>
 * - YouTube → LazyYouTubeIframe (auto-mount on viewport, thumbnail overlay hides YouTube splash)
 * - Else → thumbnail image or fallback
 *
 * Matches /app/prompts visual: autoplay video preview, no play button, no YouTube logo.
 */
export function ClickToPlayVideo({ videoUrl, thumbnailUrl, name = '', fallback = null }: Props) {
  const videoInfo = videoUrl ? parseVideoUrl(videoUrl) : null;

  if (videoInfo?.type === 'direct') {
    return <video src={videoInfo.embedUrl || ''} className="w-full h-full object-cover" autoPlay muted loop playsInline />;
  }

  if (videoInfo?.type === 'youtube' && videoInfo.videoId) {
    return <LazyYouTubeIframe url={videoInfo.embedUrl || `https://www.youtube.com/embed/${videoInfo.videoId}`} thumbnailUrl={thumbnailUrl} />;
  }

  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt={name} className="w-full h-full object-cover" loading="lazy" />;
  }

  return <>{fallback}</>;
}

export default ClickToPlayVideo;
