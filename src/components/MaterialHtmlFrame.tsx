import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface MaterialHtmlFrameProps {
  /** Already-sanitized HTML (see sanitizeMaterialHtml). */
  html: string;
  className?: string;
  /** Cap on how tall the frame can grow before it scrolls internally. */
  maxHeight?: number;
}

/**
 * Renders an uploaded material's HTML in its own isolated document so it
 * looks exactly like opening the exported file directly in a browser —
 * its <style> block and inline colors/fonts apply only inside the frame,
 * never bleeding into the surrounding page. No `allow-scripts` in the
 * sandbox, so any embedded <script> that survives sanitization can't run.
 */
export function MaterialHtmlFrame({ html, className, maxHeight = 600 }: MaterialHtmlFrameProps) {
  // Start SMALL and grow to fit. Starting at maxHeight breaks the measurement:
  // scrollHeight can never be less than the frame's own viewport, so a short
  // document inside an already-huge frame "measures" as huge and never shrinks
  // (a 2-line article once rendered as a 20,000px white void this way).
  const [height, setHeight] = useState(80);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const handleLoad = () => {
    const doc = frameRef.current?.contentWindow?.document;
    if (!doc) return;
    const contentHeight = doc.documentElement.scrollHeight;
    setHeight(Math.min(Math.max(contentHeight, 80), maxHeight));
  };

  return (
    <iframe
      ref={frameRef}
      srcDoc={html}
      onLoad={handleLoad}
      sandbox="allow-same-origin"
      title="เอกสารประกอบ"
      className={cn('w-full border-0 bg-white', className)}
      style={{ height, maxHeight }}
    />
  );
}
