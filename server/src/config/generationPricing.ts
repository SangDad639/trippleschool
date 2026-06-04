/**
 * Generation pricing (KIE credits) — server mirror.
 *
 * เครดิตที่โชว์ในป๊อปอัพยืนยัน = เครดิตของ KIE key ตัว user เองที่จะโดนหักตอน gen
 * (KIE หักจาก key ของ user โดยตรง). Trippleschool ไม่หักเครดิตของตัวเองสำหรับ image/video gen.
 *
 * Mirror ของ src/lib/generationPricing.ts — ต้องอัปเดตคู่กันเสมอ.
 * ฝั่ง server เก็บไว้เป็นแหล่งความจริงสำหรับ logic ใด ๆ ที่ต้องคิดเครดิตในอนาคต
 * (ตอนนี้ป๊อปอัพคำนวณฝั่ง frontend, ฝั่งนี้ดึง KIE balance อย่างเดียว).
 */

export type ImageResolution = '1k' | '2k' | '4k';

/** เครดิตต่อ 1 รูป แยกตาม resolution */
export const IMAGE_CREDITS: Record<string, Record<ImageResolution, number>> = {
  'nano-banana-2': { '1k': 8, '2k': 12, '4k': 18 },
  'nano-banana-pro': { '1k': 18, '2k': 18, '4k': 24 },
  'gpt-image-2': { '1k': 6, '2k': 10, '4k': 16 },
  // Grok image (text-to-image / image-to-image) = 4 เครดิต/รูป (flat, ทุก res)
  'grok-imagine': { '1k': 4, '2k': 4, '4k': 4 },
};

/** Grok image-to-video / text-to-video @720p = 3 เครดิต ต่อ 1 วินาที */
export const GROK_VIDEO_CREDIT_PER_SEC = 3;
/** Grok extend = 20 เครดิต ต่อ 1 บล็อก (10 วินาที) */
export const GROK_EXTEND_CREDITS = 20;
/** Kling 3.0 Motion Control @720p = 20 เครดิต ต่อ 1 วินาที */
export const KLING_CREDIT_PER_SEC = 20;

/** ค่าโมเดล/ความละเอียดที่ pipeline ใช้จริง (hardcoded) */
export const VIRAL_IDOL_IMAGE_MODEL = 'nano-banana-2';
export const VIRAL_IDOL_IMAGE_RES: ImageResolution = '1k';
export const VIRAL_VIDEO_SECONDS = 10;

/** Prompt Direct platform → duration (วินาที) + รองรับ extend ไหม */
export const PROMPT_DIRECT_PLATFORM_PRICING: Record<string, { seconds: number; extend: boolean }> = {
  'kie-grok-10s': { seconds: 10, extend: false },
  'kie-grok-10s-extend': { seconds: 10, extend: true },
  'kie_grok_imagine': { seconds: 10, extend: false },
};

// ============================================================================
// Trippleschool hybrid charge — markup applied when system KIE key is used.
// ============================================================================

/**
 * Multiplier applied to KIE base price when trippleschool charges the user
 * (i.e. user has no personal kie_api_key + system fallback active).
 *
 * Free tier (user provides own key) → multiplier irrelevant, KIE bills user directly.
 * Paid tier (system key) → trippleschool_credits = ceil(kie_credits × 2.5).
 */
export const CREDIT_MULTIPLIER = 2.5;

/**
 * Convert a KIE-base credit cost into the trippleschool credit charge for the
 * paid tier. Always returns a positive integer (Math.ceil) so we don't
 * undercharge fractional cases (e.g. 3 × 2.5 = 7.5 → 8).
 */
export function chargeCredits(kieBaseCredits: number): number {
  if (!Number.isFinite(kieBaseCredits) || kieBaseCredits <= 0) return 0;
  return Math.ceil(kieBaseCredits * CREDIT_MULTIPLIER);
}
