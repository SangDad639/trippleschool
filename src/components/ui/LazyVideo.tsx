import React, { useRef, useState, useEffect, useCallback } from 'react';

// In-memory cache: video src → captured frame data URL
const frameCache = new Map<string, string>();

/**
 * Performance-optimized lazy video:
 * - If thumbnailUrl is provided: shows it immediately as a lazy <img> (YouTube-style)
 * - If no thumbnailUrl but cached frame exists: shows cached frame instantly
 * - autoCapture: renders a hidden <video preload=auto> in the DOM to grab a frame automatically
 * - Otherwise: shows dark placeholder + play icon until hover
 * On first hover, captures a frame via canvas and caches it for future visits.
 */
const LazyVideo: React.FC<{
  src: string;
  thumbnailUrl?: string | null;
  className?: string;
  autoCapture?: boolean;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
}> = ({ src, thumbnailUrl, className = 'w-full h-full object-cover', autoCapture = false, onError }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [cachedFrame, setCachedFrame] = useState<string | null>(() => frameCache.get(src) || null);
  const [autoCapturing, setAutoCapturing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '50px', threshold: 0.01 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Capture frame from video element and cache it
  const frameCaptured = useRef(false);
  const captureFrame = useCallback((video: HTMLVideoElement) => {
    if (frameCaptured.current || frameCache.has(src) || thumbnailUrl) return;
    if (!video.videoWidth || !video.videoHeight) return; // Not ready yet
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      if (dataUrl && dataUrl.length > 100) { // Valid capture
        frameCache.set(src, dataUrl);
        setCachedFrame(dataUrl);
        frameCaptured.current = true;
      }
    } catch {}
  }, [src, thumbnailUrl]);

  // Whether we need auto-capture (no thumbnail, no cached frame, autoCapture enabled)
  const needsAutoCapture = autoCapture && inView && !thumbnailUrl && !cachedFrame && !frameCache.has(src) && !frameCaptured.current;

  // Track auto-capture state
  const autoCaptureStarted = useRef(false);
  useEffect(() => {
    if (needsAutoCapture && !autoCaptureStarted.current) {
      autoCaptureStarted.current = true;
      setAutoCapturing(true);
    }
  }, [needsAutoCapture]);

  // Auto-capture timeout — stop spinner after 10s if frame wasn't captured
  useEffect(() => {
    if (!autoCapturing) return;
    const timer = setTimeout(() => { setAutoCapturing(false); }, 10000);
    return () => clearTimeout(timer);
  }, [autoCapturing]);

  // Handle auto-capture video events
  const handleAutoCaptureLoaded = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.currentTime = 0.1;
  }, []);

  const handleAutoCaptureSeeked = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    captureFrame(video);
    setAutoCapturing(false);
  }, [captureFrame]);

  const handleAutoCaptureError = useCallback(() => {
    setAutoCapturing(false);
  }, []);

  const displayThumb = thumbnailUrl || cachedFrame;

  return (
    <div
      ref={ref}
      className="w-full h-full relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail: server thumbnail > cached frame > placeholder */}
      {displayThumb ? (
        !hovered ? (
          <img
            src={displayThumb}
            className={className}
            loading="lazy"
            alt=""
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : null
      ) : (
        !hovered && (
          <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
            {inView && (
              autoCapturing ? (
                <svg className="h-6 w-6 text-white/40 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <div className="p-2 rounded-full bg-white/10 group-hover:bg-white/20 transition-colors">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-7 w-7 text-white/60"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )
            )}
          </div>
        )
      )}

      {/* Hidden video for auto-capture — rendered in DOM to avoid CORS issues */}
      {needsAutoCapture && !hovered && (
        <video
          src={src}
          className="absolute w-0 h-0 opacity-0 pointer-events-none"
          muted
          playsInline
          preload="auto"
          onLoadedData={handleAutoCaptureLoaded}
          onSeeked={handleAutoCaptureSeeked}
          onError={handleAutoCaptureError}
        />
      )}

      {/* Video — only rendered (and loaded) on hover */}
      {hovered && inView && (
        <video
          src={src}
          className={className}
          muted
          preload="auto"
          playsInline
          autoPlay
          onError={onError}
          onTimeUpdate={(e) => captureFrame(e.currentTarget)}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
      )}
    </div>
  );
};

export default LazyVideo;
