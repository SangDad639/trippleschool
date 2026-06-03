export type VideoType = 'youtube' | 'sora' | 'direct' | 'grok' | null;

export interface VideoInfo {
  type: VideoType;
  embedUrl: string | null;
  videoId: string | null;
}

export function parseVideoUrl(url: string): VideoInfo {
  if (!url) return { type: null, embedUrl: null, videoId: null };

  if (url.includes('videos.openai.com')) return { type: 'direct', embedUrl: url, videoId: null };
  if (url.includes('imagine-public.x.ai')) return { type: 'direct', embedUrl: url, videoId: null };

  const grokMatch = url.match(/grok\.com\/imagine\/post\/([a-f0-9-]+)/);
  if (grokMatch) {
    return { type: 'direct', embedUrl: `https://imagine-public.x.ai/imagine-public/share-videos/${grokMatch[1]}.mp4`, videoId: null };
  }

  const soraMatch = url.match(/sora\.chatgpt\.com\/p\/(s_[a-zA-Z0-9]+)/);
  if (soraMatch) return { type: 'sora', embedUrl: url, videoId: null };

  const youtubePatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of youtubePatterns) {
    const match = url.match(pattern);
    if (match) {
      const videoId = match[1];
      return {
        type: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${videoId}?loop=1&playlist=${videoId}&mute=1&autoplay=1`,
        videoId,
      };
    }
  }

  // Dropbox shared mp4 — force ?raw=1 so the file streams inline (?dl=1 forces download).
  if (/dropbox\.com\/.+\.(mp4|webm|mov)/i.test(url)) {
    const streamable = url.includes('raw=1')
      ? url
      : url.replace(/[?&]dl=1/, m => m.startsWith('?') ? '?raw=1' : '&raw=1');
    return { type: 'direct', embedUrl: streamable, videoId: null };
  }

  // Generic direct video file (e.g. S3/CloudFront/CDN serving .mp4 / .webm / .mov)
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    return { type: 'direct', embedUrl: url, videoId: null };
  }

  return { type: null, embedUrl: null, videoId: null };
}
