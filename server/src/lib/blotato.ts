// Blotato API Integration
// API Documentation: https://backend.blotato.com/v2
// Updated to match v2 API specification

const BLOTATO_BASE_URL = 'https://backend.blotato.com/v2';

export interface PageIds {
  facebook: string;
  instagram: string;
  tiktok: string;
  twitter: string;
  youtube: string;
}

export interface BlotatoPostResult {
  platform: string;
  postSubmissionId?: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface BlotatoScheduleRequest {
  accountId: string;
  pageId: string;
  platform: 'facebook' | 'instagram' | 'tiktok' | 'twitter' | 'youtube';
  videoUrl: string;
  caption: string;
  scheduledTime?: Date;
  apiKey?: string;
}

/**
 * Build target object based on platform
 * Each platform has different target requirements
 */
function buildTarget(platform: string, pageId: string): Record<string, any> {
  switch (platform) {
    case 'facebook':
      return {
        targetType: 'facebook',
        pageId: pageId,
        mediaType: 'reel', // Default to reel for videos
      };

    case 'instagram':
      return {
        targetType: 'instagram',
        mediaType: 'reel', // Instagram videos are reels
      };

    case 'tiktok':
      return {
        targetType: 'tiktok',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true, // Our videos are AI-generated
      };

    case 'twitter':
      return {
        targetType: 'twitter',
      };

    case 'youtube':
      // YouTube: accountId IS the channel, no separate channelId needed
      return {
        targetType: 'youtube',
        title: 'AI Generated Video', // Will be updated with actual title
        privacyStatus: 'public',
        shouldNotifySubscribers: true,
        isMadeForKids: false,
        containsSyntheticMedia: true, // AI-generated
      };

    default:
      return { targetType: platform };
  }
}

/**
 * Post video to a single platform via Blotato API v2
 */
export async function postToPlatform(
  request: BlotatoScheduleRequest
): Promise<{ success: boolean; postSubmissionId?: string; error?: string }> {
  try {
    const { accountId, pageId, platform, videoUrl, caption, scheduledTime, apiKey } = request;

    if (!accountId) {
      return {
        success: false,
        error: `Missing account ID for ${platform}`,
      };
    }

    if (!apiKey) {
      return {
        success: false,
        error: `Missing Blotato API key for ${platform}. Please configure it in channel settings.`,
      };
    }

    // Facebook requires pageId
    if (platform === 'facebook' && !pageId) {
      return {
        success: false,
        error: 'Facebook requires a page ID',
      };
    }

    // Build the target object based on platform
    const target = buildTarget(platform, pageId);

    // For YouTube, use caption as title (first 100 chars)
    if (platform === 'youtube') {
      target.title = caption.substring(0, 100).split('\n')[0] || 'AI Generated Video';
    }

    // Build the request body according to v2 API spec
    const body: Record<string, any> = {
      post: {
        accountId: accountId,
        content: {
          text: caption,
          mediaUrls: [videoUrl],
          platform: platform,
        },
        target: target,
      },
    };

    // Add scheduled time if provided (ISO 8601 format)
    if (scheduledTime) {
      body.scheduledTime = scheduledTime.toISOString();
    }

    console.log(`📤 Blotato API request for ${platform}:`, JSON.stringify(body, null, 2));

    const response = await fetch(`${BLOTATO_BASE_URL}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Blotato API error for ${platform}:`, errorText);
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json() as { postSubmissionId?: string };
    console.log(`✅ Blotato API response for ${platform}:`, data);

    return {
      success: true,
      postSubmissionId: data.postSubmissionId,
    };
  } catch (error: any) {
    console.error(`Error posting to ${request.platform}:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Schedule video to all configured platforms
 *
 * Platform ID structure:
 * - Facebook: facebookAccountId = main account, pageIds.facebook = page ID
 * - Instagram: uses facebookAccountId (connected via Facebook)
 * - YouTube: pageIds.youtube = YouTube Account ID (not channel ID!)
 * - TikTok: pageIds.tiktok = TikTok Account ID
 * - Twitter: pageIds.twitter = Twitter Account ID
 */
export async function scheduleToAllPlatforms(
  facebookAccountId: string,
  pageIds: PageIds,
  videoUrl: string,
  caption: string,
  scheduledTime?: Date,
  apiKey?: string
): Promise<BlotatoPostResult[]> {
  const results: BlotatoPostResult[] = [];

  // Define platform configs with their account IDs
  // Facebook/Instagram share the same account, others have their own
  const platformConfigs = [
    { platform: 'facebook' as const, accountId: facebookAccountId, pageId: pageIds.facebook },
    { platform: 'instagram' as const, accountId: facebookAccountId, pageId: '' }, // Instagram uses Facebook account
    { platform: 'youtube' as const, accountId: pageIds.youtube, pageId: '' }, // YouTube: page_ids.youtube IS the account ID
    { platform: 'tiktok' as const, accountId: pageIds.tiktok, pageId: '' }, // TikTok: page_ids.tiktok IS the account ID
    { platform: 'twitter' as const, accountId: pageIds.twitter, pageId: '' }, // Twitter: page_ids.twitter IS the account ID
  ];

  // Validate scheduledTime - only use if it's a valid Date
  const validScheduledTime = scheduledTime && !isNaN(scheduledTime.getTime()) ? scheduledTime : undefined;

  // Post to each platform that has a configured account ID
  for (const config of platformConfigs) {
    const { platform, accountId, pageId } = config;

    // Skip platforms without account IDs
    if (!accountId || accountId.trim() === '') {
      continue;
    }

    // Retry logic: try up to 3 times
    let response: { success: boolean; postSubmissionId?: string; error?: string } = { success: false, error: '' };
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const scheduleInfo = validScheduledTime ? ` (scheduled: ${validScheduledTime.toISOString()})` : ' (immediate)';
      console.log(`📤 Posting to ${platform} (accountId: ${accountId}, attempt ${attempt}/${maxRetries})...${scheduleInfo}`);

      response = await postToPlatform({
        accountId,
        pageId: pageId || '',
        platform,
        videoUrl,
        caption,
        scheduledTime: validScheduledTime,
        apiKey,
      });

      if (response.success) {
        break; // Success - exit retry loop
      }

      if (attempt < maxRetries) {
        console.log(`⚠️ ${platform} failed (attempt ${attempt}): ${response.error}. Retrying in 3s...`);
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3 seconds before retry
      } else {
        console.log(`❌ ${platform} failed after ${maxRetries} attempts: ${response.error}`);
      }
    }

    results.push({
      platform,
      postSubmissionId: response.postSubmissionId,
      status: response.success ? 'success' : 'failed',
      error: response.error,
    });

    // Small delay between posts to avoid rate limiting (30 req/min limit)
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return results;
}

/**
 * Generate caption for video using OpenAI
 * This requires OpenAI API key to be configured
 */
export async function generateCaption(
  prompt: string,
  language: 'en' | 'th',
  hashtags: string,
  openaiApiKey: string,
  aiBaseUrl: string = 'https://api.openai.com/v1'
): Promise<string> {
  if (!openaiApiKey) {
    // Fallback: return basic caption from prompt
    const baseCaption = prompt.substring(0, 200);
    return `${baseCaption}\n\n${hashtags}`;
  }

  try {
    // Random style selection for variety - each caption will have different style
    const stylesTh = [
      'เขียนแบบตื่นเต้น ใช้อีโมจิ',
      'เขียนแบบเรียบง่าย กระชับ',
      'เขียนแบบถามคำถามให้คนอยากคอมเมนต์',
      'เขียนแบบเล่าเรื่อง มีอารมณ์',
      'เขียนแบบท้าทาย ชวนให้คนดูจนจบ',
      'เขียนแบบตลก ขำขัน',
      'เขียนแบบลึกลับ ชวนสงสัย',
      'เขียนแบบให้ข้อคิด สร้างแรงบันดาลใจ',
    ];

    const stylesEn = [
      'Write with excitement and emojis',
      'Write minimalist and punchy',
      'Write with a question to encourage comments',
      'Write storytelling style with emotion',
      'Write a challenge to watch till the end',
      'Write with humor and wit',
      'Write mysterious and intriguing',
      'Write inspirational and thought-provoking',
    ];

    const randomStyle = language === 'th'
      ? stylesTh[Math.floor(Math.random() * stylesTh.length)]
      : stylesEn[Math.floor(Math.random() * stylesEn.length)];

    const systemPrompt =
      language === 'th'
        ? `คุณเป็นผู้เชี่ยวชาญด้านการเขียน caption สำหรับ social media ภาษาไทย สไตล์ครั้งนี้: ${randomStyle}`
        : `You are a social media caption expert. Style for this one: ${randomStyle}`;

    const userPrompt =
      language === 'th'
        ? `เขียน caption สำหรับวิดีโอที่มีเนื้อหาดังนี้: "${prompt}"\n\nเขียน caption ที่น่าสนใจ เหมาะกับ social media ภาษาไทย ความยาวไม่เกิน 150 ตัวอักษร สร้างสรรค์ใหม่ ห้ามซ้ำ`
        : `Write a caption for a video with this content: "${prompt}"\n\nWrite an engaging social media caption in English, max 150 characters. Be creative and unique.`;

    const response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 1.0, // Higher for more variety
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const generatedCaption = data.choices?.[0]?.message?.content?.trim() || prompt.substring(0, 100);

    // Append hashtags
    return `${generatedCaption}\n\n${hashtags}`;
  } catch (error: any) {
    console.error('Error generating caption:', error);
    // Fallback to basic caption
    return `${prompt.substring(0, 150)}\n\n${hashtags}`;
  }
}

export default {
  postToPlatform,
  scheduleToAllPlatforms,
  generateCaption,
};
