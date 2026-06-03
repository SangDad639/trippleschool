import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';

const VIDEO_ID_REGEX = /(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoId(url: string): string | null {
  const match = url.match(VIDEO_ID_REGEX);
  return match ? match[1] : null;
}

function buildEmbedSrc(rawUrl: string, videoId: string): string {
  // Preserve any extra query params from the original URL (autoplay, mute, loop, etc.)
  // but ensure required ones are present.
  let url = rawUrl;
  if (!/youtube\.com\/embed\//.test(url)) {
    url = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&controls=0&showinfo=0&modestbranding=1&playsinline=1`;
  }
  if (!url.includes('enablejsapi=1')) url += (url.includes('?') ? '&' : '?') + 'enablejsapi=1';
  if (!url.includes('origin=')) url += `&origin=${encodeURIComponent(window.location.origin)}`;
  if (!url.includes('playsinline=')) url += '&playsinline=1';
  return url;
}

export interface LazyYouTubeIframeHandle {
  postMessage: (func: string, args?: any[]) => void;
}

interface Props {
  url: string;
  className?: string;
  /** When iframe is unmounted (out of view), show this placeholder image. Falls back to YouTube hqdefault thumbnail. */
  thumbnailUrl?: string | null;
  /** rootMargin for IntersectionObserver — how far before/after viewport to mount/unmount. Default: 200px. */
  rootMargin?: string;
  /** Disable pointer events on iframe (for cards where parent handles click) */
  pointerEventsNone?: boolean;
  /** Forward additional iframe props if needed. */
  iframeAllow?: string;
}

/**
 * Memory-safe lazy YouTube iframe.
 * - Renders only a <img> thumbnail when the element is out of viewport.
 * - Mounts the real <iframe> only when scrolled into view (IntersectionObserver).
 * - Unmounts the iframe when scrolled out → frees memory (critical for mobile OOM).
 *
 * Usage: drop-in replacement for `<iframe src={ytUrl} ... />` inside grids/lists.
 */
const LazyYouTubeIframe = forwardRef<LazyYouTubeIframeHandle, Props>(function LazyYouTubeIframe(
  { url, className = 'w-full h-full', thumbnailUrl, rootMargin = '200px', pointerEventsNone = true, iframeAllow = 'autoplay; encrypted-media' },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [inView, setInView] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);

  const videoId = extractVideoId(url);
  const placeholder = thumbnailUrl || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (!entry.isIntersecting) setIframeReady(false); // reset when out of view
      },
      { rootMargin, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  const handleIframeLoad = useCallback(() => {
    // Delay reveal to let YouTube splash + first frame settle behind the thumbnail
    setTimeout(() => setIframeReady(true), 1200);
  }, []);

  const postMessage = useCallback((func: string, args: any[] = []) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com'
      );
    }
  }, []);

  useImperativeHandle(ref, () => ({ postMessage }), [postMessage]);

  // Show thumbnail overlay until iframe is ready (hides YouTube splash logo)
  const showThumbnail = !inView || !iframeReady;

  return (
    <div ref={containerRef} className={`${className} relative overflow-hidden`}>
      {/* Iframe behind — autoplay running while covered by thumbnail */}
      {inView && videoId && (
        <iframe
          ref={iframeRef}
          src={buildEmbedSrc(url, videoId)}
          className={`absolute inset-0 w-full h-full ${pointerEventsNone ? 'pointer-events-none' : ''}`}
          allow={iframeAllow}
          loading="lazy"
          onLoad={handleIframeLoad}
        />
      )}
      {/* Thumbnail overlay — fades out when iframe ready */}
      {placeholder && (
        <img
          src={placeholder}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 pointer-events-none"
          style={{ opacity: showThumbnail ? 1 : 0 }}
          loading="lazy"
        />
      )}
      {/* Plain fallback when no thumbnail + no video */}
      {!placeholder && !inView && <div className="absolute inset-0 bg-zinc-800" />}
    </div>
  );
});

export default LazyYouTubeIframe;
