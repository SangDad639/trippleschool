/**
 * YouTube IFrame Player API — โหลดครั้งเดียว (singleton) แบบ lazy
 * ใช้เฉพาะ (1) ตัวเล่นโฆษณาแบบ YouTube และ (2) บทเรียนที่มีจุดแทรกกลางคลิป (mid-roll)
 * บทที่ไม่มีโฆษณาต้องไม่โหลด script นี้เลย · โหลดไม่ได้/ช้าเกิน → reject ให้ผู้เรียก fail-open
 *
 * type ขั้นต่ำเขียนเองแทน @types/youtube (ใช้แค่ไม่กี่ method)
 */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
export interface YTStateEvent { data: number; target: YTPlayer }
export interface YTPlayerOptions {
  videoId?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: YTStateEvent) => void;
    onError?: (e: { data: number }) => void;
  };
}
export interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';
let loading: Promise<YTNamespace> | null = null;

export function loadYouTubeIframeApi(timeoutMs = 8000): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(() => {
      loading = null;
      reject(new Error('YouTube IFrame API timeout'));
    }, timeoutMs);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      try { prev?.(); } catch { /* ของคนอื่น */ }
      if (window.YT?.Player) resolve(window.YT);
      else { loading = null; reject(new Error('YouTube IFrame API missing YT.Player')); }
    };
    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = API_SRC;
      s.async = true;
      s.onerror = () => {
        window.clearTimeout(timer);
        loading = null;
        reject(new Error('YouTube IFrame API failed to load'));
      };
      document.head.appendChild(s);
    }
  });
  return loading;
}
