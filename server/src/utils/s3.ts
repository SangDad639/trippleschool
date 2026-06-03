import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy initialize S3 client to ensure env vars are loaded
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: false,
      // HWC OBS does not understand the `x-amz-checksum-mode=ENABLED` query
      // parameter that AWS SDK v3 (≥ 3.729) adds automatically — the param is
      // included in the canonical request the client signs, but OBS strips/
      // ignores it when verifying → SignatureDoesNotMatch → 403 on signed
      // GETs. Browsers then fall back to "download" (or blank iframe) instead
      // of rendering the PDF/image. Forcing WHEN_REQUIRED disables the
      // automatic checksum-mode injection. Matches the AWS v2 behaviour OBS
      // was built against.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3Client;
}

export function getBucketName(): string {
  return process.env.S3_BUCKET || '';
}

/**
 * Upload a file to S3
 * @param buffer File buffer
 * @param key S3 key (path)
 * @param contentType MIME type
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
  opts: { contentDisposition?: 'inline' | 'attachment' } = {},
): Promise<void> {
  await getS3Client().send(new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // HWC OBS ignores `ResponseContentDisposition` query-time override on
    // signed URLs — Content-Disposition must be baked into object metadata
    // at upload time. Pass 'inline' for files we want browsers to render
    // (preview <iframe>/<img>) rather than download.
    ...(opts.contentDisposition ? { ContentDisposition: opts.contentDisposition } : {}),
  }));
}

/**
 * Get a signed URL for accessing a file
 * @param key The S3 key of the file
 * @param expiresIn Expiration time in seconds (default: 1 hour)
 * @param opts.inline Force `Content-Disposition: inline` so the browser
 *                    renders the file directly (image/PDF) instead of
 *                    downloading. Use this when embedding via <img>/<iframe>.
 * @returns A signed URL for accessing the file
 */
export async function getSignedFileUrl(
  key: string,
  expiresIn: number = 3600,
  _opts: { inline?: boolean } = {},
): Promise<string> {
  // HWC OBS quirk: setting `ResponseContentDisposition: 'inline'` here actually
  // **overrides the object's stored disposition WITH `attachment`** instead of
  // honouring the request. To preview inline we instead bake
  // `Content-Disposition: inline` into object metadata at upload time
  // (see `uploadFile` + the upload-id-card route) and **omit** the query
  // override here. `_opts.inline` is accepted for API back-compat but ignored.
  void _opts;
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn });
}

/**
 * Delete a file from S3
 * @param key The S3 key of the file to delete
 */
export async function deleteFile(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  }));
}

/**
 * Get file from S3 (for proxy endpoints)
 * @param key The S3 key
 */
export async function getFile(key: string) {
  return getS3Client().send(new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  }));
}

/**
 * Extract the S3 key from a value that may be a key, our S3 URL, or an external URL.
 * Used on writes: if the frontend round-trips a fresh signed URL, store just the key.
 */
export function extractS3Key(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
  const bucket = getBucketName();
  if (endpoint && bucket) {
    // Strip query string first for matching
    const qIdx = v.indexOf('?');
    const baseUrl = qIdx >= 0 ? v.slice(0, qIdx) : v;

    // Path-style: https://obs.../bucket/key
    const pathPrefix = `${endpoint}/${bucket}/`;
    if (baseUrl.startsWith(pathPrefix)) {
      return baseUrl.slice(pathPrefix.length);
    }

    // Virtual-host style: https://bucket.obs.../key
    const proto = endpoint.match(/^(https?:\/\/)/)?.[1] || 'https://';
    const host = endpoint.replace(/^https?:\/\//, '');
    const vhostPrefix = `${proto}${bucket}.${host}/`;
    if (baseUrl.startsWith(vhostPrefix)) {
      return baseUrl.slice(vhostPrefix.length);
    }
  }
  return v;
}

/**
 * Resolve a stored value to a viewable URL.
 * - http(s) URLs (external or pre-signed) → returned as-is
 * - bare keys → freshly signed URL (24h)
 */
export async function resolveS3Value(value: string | null | undefined, expiresIn: number = 86400): Promise<string | null> {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  try {
    return await getSignedFileUrl(v, expiresIn);
  } catch {
    return v;
  }
}
