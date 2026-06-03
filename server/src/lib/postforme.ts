// Post for Me API Integration (postforme.dev)
// API Documentation: https://api.postforme.dev
// Base URL: https://api.postforme.dev/v1

import { detectMediaTypeFromUrl } from '../utils/mediaType.js';

const POSTFORME_BASE_URL = 'https://api.postforme.dev/v1';

/**
 * Fetch social accounts with full details (including expiration dates)
 */
export async function getPostFormeSocialAccountsFull(apiKey: string): Promise<any[]> {
  try {
    const response = await fetch(`${POSTFORME_BASE_URL}/social-accounts`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as any;
    const items = Array.isArray(data) ? data : (data.data || data.items || []);
    return items.map((a: any) => ({
      id: a.id,
      platform: a.platform,
      username: a.username,
      status: a.status,
      profile_photo_url: a.profile_photo_url,
      access_token_expires_at: a.access_token_expires_at,
      refresh_token_expires_at: a.refresh_token_expires_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch social accounts associated with a PostForMe API key
 */
export async function getPostFormeSocialAccounts(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${POSTFORME_BASE_URL}/social-accounts`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    console.log(`[PostForMe] social-accounts API status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[PostForMe] social-accounts error: ${errorText}`);
      return [];
    }
    const data = await response.json() as any;
    console.log(`[PostForMe] social-accounts response:`, JSON.stringify(data));
    const items = Array.isArray(data) ? data : (data.data || data.items || []);
    return items.map((a: any) => a.id).filter((id: string) => id && id.startsWith('spc_'));
  } catch (e: any) {
    console.log(`[PostForMe] social-accounts fetch error:`, e.message);
    return [];
  }
}

export interface PostForMePostResult {
  platform: string;
  postId?: string;
  status: 'success' | 'failed';
  error?: string;
}

/**
 * Per-provider result returned by GET /v1/social-posts/{id}.
 * Each entry corresponds to one social account (spc_xxx) targeted by the post,
 * carrying its own provider-side spr_xxx ID and final status.
 */
export interface PostForMeProviderResult {
  spr_id: string;            // Postforme provider-result ID (spr_xxx)
  platform: string;          // 'facebook' | 'instagram' | 'tiktok' | ...
  account_id?: string;       // spc_xxx social account ID
  status: 'success' | 'failed' | 'pending';
  error?: string | null;
  platform_url?: string | null;  // Public URL on the provider (FB/IG/TikTok post link)
  checked_at: string;        // ISO timestamp when this snapshot was fetched
}

/**
 * Fetch a single social post by ID (sp_xxx) and normalise per-provider results.
 * Returns null if the API call fails or the response shape is unexpected — callers
 * should treat null as "still unknown, try again later".
 */
export async function getPostFormePostStatus(
  apiKey: string,
  postId: string
): Promise<{ post_status: string; scheduled_at: string | null; results: PostForMeProviderResult[] } | null> {
  try {
    // 1) Post-level metadata: status, scheduled_at, and the social_accounts list we need
    //    to map social_account_id (spc_xxx) → platform (per-result endpoint omits this).
    const postRes = await fetch(`${POSTFORME_BASE_URL}/social-posts/${encodeURIComponent(postId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!postRes.ok) {
      const errorText = await postRes.text();
      console.log(`[PostForMe] GET /social-posts/${postId} failed: ${postRes.status} - ${errorText}`);
      return null;
    }
    const postData = await postRes.json() as any;
    console.log(`[PostForMe] GET /social-posts/${postId} response:`, JSON.stringify(postData));

    // Build spc_xxx → platform map from social_accounts
    const accountToPlatform = new Map<string, string>();
    const socialAccounts: any[] = postData.social_accounts || [];
    for (const acc of socialAccounts) {
      if (acc?.id && acc?.platform) accountToPlatform.set(acc.id, acc.platform);
    }

    // 2) Per-provider results: spr_xxx + success boolean + platform_data.url + error.
    //    Postforme's dashboard pulls this exact endpoint to render the "Post Result" card.
    const resultsRes = await fetch(
      `${POSTFORME_BASE_URL}/social-post-results?post_id=${encodeURIComponent(postId)}`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    let rawResults: any[] = [];
    if (resultsRes.ok) {
      const resultsData = await resultsRes.json() as any;
      console.log(`[PostForMe] GET /social-post-results?post_id=${postId} response:`, JSON.stringify(resultsData));
      rawResults = Array.isArray(resultsData)
        ? resultsData
        : (resultsData?.data || resultsData?.items || resultsData?.results || []);
    } else {
      const errorText = await resultsRes.text();
      console.log(`[PostForMe] GET /social-post-results?post_id=${postId} failed: ${resultsRes.status} - ${errorText}`);
    }

    // Normalise per-provider results
    const checkedAt = new Date().toISOString();
    const seenAccounts = new Set<string>();
    const results: PostForMeProviderResult[] = rawResults.map((r: any) => {
      const accId: string = r.social_account_id || '';
      if (accId) seenAccounts.add(accId);
      const status: 'success' | 'failed' | 'pending' =
        r.success === true ? 'success' :
        r.success === false ? 'failed' :
        'pending';
      return {
        spr_id: r.id || '',
        platform: accountToPlatform.get(accId) || r.platform || 'unknown',
        account_id: accId || undefined,
        status,
        error: typeof r.error === 'string'
          ? r.error
          : (r.error && typeof r.error === 'object' ? JSON.stringify(r.error) : null),
        platform_url: r.platform_data?.url || null,
        checked_at: checkedAt,
      };
    });

    // Synthesise pending entries for any social account that hasn't produced a
    // result yet (Postforme only lists results once they exist).
    for (const acc of socialAccounts) {
      if (acc?.id && !seenAccounts.has(acc.id)) {
        results.push({
          spr_id: '',
          platform: acc.platform || 'unknown',
          account_id: acc.id,
          status: 'pending',
          error: null,
          platform_url: null,
          checked_at: checkedAt,
        });
      }
    }

    return {
      post_status: String(postData.status || 'unknown'),
      scheduled_at: postData.scheduled_at || postData.scheduledAt || postData.post_at || null,
      results,
    };
  } catch (e: any) {
    console.log(`[PostForMe] getPostFormePostStatus error:`, e.message);
    return null;
  }
}


/**
 * Upload media to Post for Me via presigned URL
 * Returns the media_url for use in posts
 */
async function uploadMediaToPostForMe(
  apiKey: string,
  videoUrl: string
): Promise<{ success: boolean; mediaUrl?: string; error?: string }> {
  try {
    // Detect actual media type from URL — videoUrl can hold either video or image
    // (image when user pulls Image Template result into a slot). Hardcoded video/mp4
    // would upload images with wrong content-type → corrupted/rejected by Post for Me.
    const media = detectMediaTypeFromUrl(videoUrl);

    // Step 1: Get upload URL
    const uploadUrlRes = await fetch(`${POSTFORME_BASE_URL}/media/create-upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!uploadUrlRes.ok) {
      const errorText = await uploadUrlRes.text();
      return { success: false, error: `Failed to get upload URL: ${uploadUrlRes.status} - ${errorText}` };
    }

    const uploadData = await uploadUrlRes.json() as { upload_url?: string; media_url?: string };
    if (!uploadData.upload_url || !uploadData.media_url) {
      return { success: false, error: 'Invalid upload URL response' };
    }

    // Step 2: Download media from source URL
    const mediaRes = await fetch(videoUrl);
    if (!mediaRes.ok) {
      return { success: false, error: `Failed to download media: ${mediaRes.status}` };
    }
    const mediaBuffer = await mediaRes.arrayBuffer();

    // Step 3: Upload to signed URL with correct Content-Type for the actual media kind
    const uploadRes = await fetch(uploadData.upload_url, {
      method: 'PUT',
      body: mediaBuffer,
      headers: {
        'Content-Type': media.mimeType,
      },
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      return { success: false, error: `Failed to upload media: ${uploadRes.status} - ${errorText}` };
    }

    return { success: true, mediaUrl: uploadData.media_url };
  } catch (error: any) {
    return { success: false, error: error.message || 'Upload failed' };
  }
}

/**
 * Create a post via Post for Me API
 */
async function createPostForMePost(request: {
  apiKey: string;
  caption: string;
  mediaUrls: string[];
  socialAccounts: string[];  // Array of spc_... IDs
  scheduledAt?: string;      // ISO 8601
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const body: Record<string, any> = {
      caption: request.caption,
      social_accounts: request.socialAccounts,
      platform_configurations: {
        tiktok: {
          is_ai_generated: true,
        },
      },
    };

    if (request.mediaUrls.length > 0) {
      body.media = request.mediaUrls.map(url => ({ url }));
    }

    if (request.scheduledAt) {
      body.scheduled_at = request.scheduledAt;
    }

    console.log(`[PostForMe] API request:`, JSON.stringify(body, null, 2));

    const response = await fetch(`${POSTFORME_BASE_URL}/social-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PostForMe] API error:`, errorText);
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json() as { id?: string };
    console.log(`[PostForMe] API response:`, data);

    return {
      success: true,
      postId: data.id,
    };
  } catch (error: any) {
    console.error('[PostForMe] Error creating post:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Schedule video to all configured accounts via Post for Me API
 * Post for Me sends to all accounts in a single request
 */
export async function scheduleViaPostForMe(
  apiKey: string,
  socialAccountIds: string[],  // Array of spc_... IDs
  videoUrl: string,
  caption: string,
  scheduledTime?: Date
): Promise<PostForMePostResult[]> {
  // Filter empty account IDs
  const activeAccounts = socialAccountIds.filter(id => id && id.trim() !== '');

  if (activeAccounts.length === 0) {
    return [{
      platform: 'postforme',
      status: 'failed',
      error: 'No social accounts configured for Post for Me',
    }];
  }

  // Upload video to Post for Me first
  console.log(`[PostForMe] Uploading video...`);
  const uploadResult = await uploadMediaToPostForMe(apiKey, videoUrl);

  // Use the uploaded URL if successful, otherwise try with original URL
  const mediaUrl = uploadResult.success && uploadResult.mediaUrl
    ? uploadResult.mediaUrl
    : videoUrl;

  if (!uploadResult.success) {
    console.log(`[PostForMe] Upload failed (${uploadResult.error}), trying with original URL...`);
  }

  // Validate scheduledTime
  const validScheduledTime = scheduledTime && !isNaN(scheduledTime.getTime()) ? scheduledTime : undefined;

  // Post for Me supports all accounts in a single request
  const maxRetries = 3;
  let response: { success: boolean; postId?: string; error?: string } = { success: false, error: '' };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const scheduleInfo = validScheduledTime ? ` (scheduled: ${validScheduledTime.toISOString()})` : ' (immediate)';
    console.log(`[PostForMe] Creating post (attempt ${attempt}/${maxRetries}) to ${activeAccounts.length} accounts...${scheduleInfo}`);

    response = await createPostForMePost({
      apiKey,
      caption,
      mediaUrls: [mediaUrl],
      socialAccounts: activeAccounts,
      scheduledAt: validScheduledTime?.toISOString(),
    });

    if (response.success) break;

    if (attempt < maxRetries) {
      console.log(`[PostForMe] Failed (attempt ${attempt}): ${response.error}. Retrying in 3s...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log(`[PostForMe] Failed after ${maxRetries} attempts: ${response.error}`);
    }
  }

  return [{
    platform: 'postforme',
    postId: response.postId,
    status: response.success ? 'success' : 'failed',
    error: response.error,
  }];
}

export default {
  scheduleViaPostForMe,
  uploadMediaToPostForMe,
  getPostFormePostStatus,
};
