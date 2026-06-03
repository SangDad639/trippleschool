// Late/Zernio API Integration
// API Documentation: https://docs.zernio.com
// Base URL: https://zernio.com/api/v1

const LATE_BASE_URL = 'https://zernio.com/api/v1';

// Timeouts in milliseconds
const PRESIGN_TIMEOUT = 30000;      // 30 seconds for presigned URL
const DOWNLOAD_TIMEOUT = 120000;    // 2 minutes for video download
const UPLOAD_TIMEOUT = 300000;      // 5 minutes for video upload
const POST_TIMEOUT = 60000;         // 1 minute for post creation

/**
 * Helper to create fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  description: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`${description} timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }
}

export interface LateAccountMapping {
  platform: string;
  accountId: string;
}

export interface LatePostResult {
  platform: string;
  postId?: string;
  status: 'success' | 'failed';
  error?: string;
}

interface LatePostRequest {
  apiKey: string;
  content: string;
  mediaUrls: string[];
  platforms: Array<{ platform: string; accountId: string }>;
  scheduledFor?: string;
  timezone?: string;
}

/**
 * Upload media to Late via presigned URL
 * API Docs: https://docs.zernio.com/guides/media-uploads
 * Returns the public URL for use in posts
 */
async function uploadMediaToLate(
  apiKey: string,
  videoUrl: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  try {
    // Step 1: Request presigned URL (POST /v1/media/presign)
    console.log(`📤 [Late] Step 1: Requesting presigned URL...`);
    const presignedRes = await fetchWithTimeout(
      `${LATE_BASE_URL}/media/presign`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          fileName: `video_${Date.now()}.mp4`,
          fileType: 'video/mp4',
        }),
      },
      PRESIGN_TIMEOUT,
      'Presigned URL request'
    );

    if (!presignedRes.ok) {
      const errorText = await presignedRes.text();
      console.error(`[Late] Presign failed: ${presignedRes.status} - ${errorText}`);
      return { success: false, error: `Failed to get presigned URL: ${presignedRes.status} - ${errorText}` };
    }

    const presignedData = await presignedRes.json() as { uploadUrl?: string; publicUrl?: string };
    console.log(`✅ [Late] Got presigned URL: ${presignedData.publicUrl?.substring(0, 50)}...`);

    if (!presignedData.uploadUrl || !presignedData.publicUrl) {
      return { success: false, error: 'Invalid presigned URL response' };
    }

    // Step 2: Download video from source URL
    console.log(`📥 [Late] Step 2: Downloading video from source...`);
    const videoRes = await fetchWithTimeout(videoUrl, {}, DOWNLOAD_TIMEOUT, 'Video download');
    if (!videoRes.ok) {
      return { success: false, error: `Failed to download video: ${videoRes.status}` };
    }
    const videoBuffer = await videoRes.arrayBuffer();
    console.log(`✅ [Late] Downloaded video: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // Step 3: Upload to presigned URL (PUT, no auth needed)
    console.log(`📤 [Late] Step 3: Uploading to Late storage...`);
    const uploadRes = await fetchWithTimeout(
      presignedData.uploadUrl,
      {
        method: 'PUT',
        body: videoBuffer,
        headers: {
          'Content-Type': 'video/mp4',
        },
      },
      UPLOAD_TIMEOUT,
      'Video upload to Late storage'
    );

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error(`[Late] Upload failed: ${uploadRes.status} - ${errorText}`);
      return { success: false, error: `Failed to upload video: ${uploadRes.status} - ${errorText}` };
    }

    console.log(`✅ [Late] Video uploaded successfully!`);
    return { success: true, publicUrl: presignedData.publicUrl };
  } catch (error: any) {
    console.error(`[Late] Upload error:`, error);
    return { success: false, error: error.message || 'Upload failed' };
  }
}

/**
 * Post to Late API - sends to all configured platforms in a single request
 * API Docs: https://docs.zernio.com
 */
async function createLatePost(request: LatePostRequest): Promise<{
  success: boolean;
  postId?: string;
  error?: string;
}> {
  try {
    // Build request body according to Late API docs
    // Use "mediaItems" instead of "media" (per docs)
    const body: Record<string, any> = {
      content: request.content,
      mediaItems: request.mediaUrls.map(url => ({
        url,
        type: 'video'
      })),
      platforms: request.platforms.map(p => ({
        platform: p.platform,
        accountId: p.accountId,
      })),
      publishNow: !request.scheduledFor,
    };

    if (request.scheduledFor) {
      body.scheduledFor = request.scheduledFor;
      body.timezone = request.timezone || 'UTC';
    }

    console.log(`📤 [Late] Creating post:`, JSON.stringify(body, null, 2));

    const response = await fetchWithTimeout(
      `${LATE_BASE_URL}/posts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      POST_TIMEOUT,
      'Late post creation'
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[Late] Post failed: ${response.status} - ${responseText}`);
      return {
        success: false,
        error: `API error: ${response.status} - ${responseText}`,
      };
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = {};
    }

    console.log(`✅ [Late] Post created:`, data);

    return {
      success: true,
      postId: data.post?._id || data._id,
    };
  } catch (error: any) {
    console.error('[Late] Post error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Schedule video to all configured platforms via Late API
 */
export async function scheduleToAllPlatformsViaLate(
  apiKey: string,
  accounts: LateAccountMapping[],
  videoUrl: string,
  caption: string,
  scheduledTime?: Date,
  timezone?: string
): Promise<LatePostResult[]> {
  const results: LatePostResult[] = [];

  // Filter accounts that have an accountId
  const activeAccounts = accounts.filter(a => a.accountId && a.accountId.trim() !== '');

  if (activeAccounts.length === 0) {
    return [{
      platform: 'none',
      status: 'failed',
      error: 'No platform accounts configured for Late',
    }];
  }

  console.log(`\n========================================`);
  console.log(`[Late] Starting post to ${activeAccounts.length} platform(s)`);
  console.log(`[Late] Video URL: ${videoUrl.substring(0, 80)}...`);
  console.log(`[Late] Platforms: ${activeAccounts.map(a => a.platform).join(', ')}`);
  console.log(`========================================\n`);

  // Upload video to Late first (get a Late-hosted URL)
  console.log(`📤 [Late] Uploading video to Late storage...`);
  const uploadResult = await uploadMediaToLate(apiKey, videoUrl);

  // Use the uploaded URL if successful, otherwise try with original URL
  const mediaUrl = uploadResult.success && uploadResult.publicUrl
    ? uploadResult.publicUrl
    : videoUrl;

  if (!uploadResult.success) {
    console.log(`⚠️ [Late] Upload failed (${uploadResult.error}), trying with original URL...`);
  } else {
    console.log(`✅ [Late] Using Late-hosted URL: ${mediaUrl.substring(0, 60)}...`);
  }

  // Validate scheduledTime
  const validScheduledTime = scheduledTime && !isNaN(scheduledTime.getTime()) ? scheduledTime : undefined;

  // Late supports posting to multiple platforms in a single request
  // But we post per-platform for granular error tracking (retry logic)
  const maxRetries = 3;

  for (const account of activeAccounts) {
    let response: { success: boolean; postId?: string; error?: string } = { success: false, error: '' };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const scheduleInfo = validScheduledTime ? ` (scheduled: ${validScheduledTime.toISOString()})` : ' (immediate)';
      console.log(`📤 [Late] Posting to ${account.platform} (attempt ${attempt}/${maxRetries})...${scheduleInfo}`);

      response = await createLatePost({
        apiKey,
        content: caption,
        mediaUrls: [mediaUrl],
        platforms: [{ platform: account.platform, accountId: account.accountId }],
        scheduledFor: validScheduledTime?.toISOString(),
        timezone: timezone || 'UTC',
      });

      if (response.success) {
        console.log(`✅ [Late] ${account.platform} posted successfully! Post ID: ${response.postId}`);
        break;
      }

      if (attempt < maxRetries) {
        console.log(`⚠️ [Late] ${account.platform} failed (attempt ${attempt}): ${response.error}. Retrying in 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log(`❌ [Late] ${account.platform} failed after ${maxRetries} attempts: ${response.error}`);
      }
    }

    results.push({
      platform: account.platform,
      postId: response.postId,
      status: response.success ? 'success' : 'failed',
      error: response.error,
    });

    // Small delay between posts to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n========================================`);
  console.log(`[Late] Finished posting. Results:`);
  results.forEach(r => console.log(`  - ${r.platform}: ${r.status}${r.error ? ` (${r.error})` : ''}`));
  console.log(`========================================\n`);

  return results;
}

export default {
  scheduleToAllPlatformsViaLate,
  uploadMediaToLate,
};
