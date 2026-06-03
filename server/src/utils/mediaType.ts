/**
 * Media-type detection from URL — used by posting services (Late, Postforme) to upload
 * with the correct Content-Type/extension instead of hardcoding 'video/mp4'.
 *
 * The schedule_queue.video_url field carries either a video or an image URL (the latter
 * happens when user pulls an image from Image Template history into a slot). Posting code
 * must adapt: presign with image MIME, upload with image content-type, etc.
 */

export interface MediaTypeInfo {
  /** "video/mp4", "image/png", … (lowercase MIME). Falls back to "video/mp4" for unknown. */
  mimeType: string;
  /** Canonical file extension WITHOUT the dot ("mp4", "png", "jpg", "webp", …). */
  extension: string;
  /** true when the URL points to an image asset. */
  isImage: boolean;
  /** true when the URL points to a video asset. */
  isVideo: boolean;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
};

/**
 * Detect media type from a URL by inspecting its extension. Query strings (?dl=1) and
 * fragments are stripped before matching. Unknown / extension-less URLs fall back to
 * video/mp4 to preserve legacy behaviour for video posting flows.
 */
export function detectMediaTypeFromUrl(url: string): MediaTypeInfo {
  // Strip query + fragment, lowercase, take last path segment, then last extension
  const cleanPath = (url || '').split('?')[0]!.split('#')[0]!.toLowerCase();
  const lastDot = cleanPath.lastIndexOf('.');
  const ext = lastDot > 0 && lastDot > cleanPath.lastIndexOf('/')
    ? cleanPath.slice(lastDot + 1)
    : '';

  if (ext && IMAGE_EXTENSIONS[ext]) {
    return {
      mimeType: IMAGE_EXTENSIONS[ext],
      extension: ext === 'jpeg' ? 'jpg' : ext,
      isImage: true,
      isVideo: false,
    };
  }
  if (ext && VIDEO_EXTENSIONS[ext]) {
    return {
      mimeType: VIDEO_EXTENSIONS[ext],
      extension: ext,
      isImage: false,
      isVideo: true,
    };
  }
  // Fallback — assume video/mp4 (legacy default; matches how all current posting code behaves)
  return {
    mimeType: 'video/mp4',
    extension: 'mp4',
    isImage: false,
    isVideo: true,
  };
}
