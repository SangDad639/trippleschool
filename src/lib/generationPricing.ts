/**
 * Generation pricing (KIE credits).
 *
 * ราคาเครดิตที่โชว์ในป๊อปอัพยืนยัน = เครดิตของ "KIE key ตัว user เอง" ที่จะโดนหักตอน gen
 * (KIE หักจาก key ของ user โดยตรง). Trippleviral ไม่หักเครดิตของตัวเองสำหรับ image/video gen.
 *
 * Mirror ของ server/src/config/generationPricing.ts — ต้องอัปเดตคู่กันเสมอ.
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

/**
 * Markup applied when Trippleviral charges its own credits (system KIE key
 * tier). Mirror of server `CREDIT_MULTIPLIER` — keep in sync.
 */
export const CREDIT_MULTIPLIER = 2.5;

/** Convert KIE base credits → Trippleviral credit charge (ceil, never < 0). */
export function chargeCredits(kieBaseCredits: number): number {
  if (!Number.isFinite(kieBaseCredits) || kieBaseCredits <= 0) return 0;
  return Math.ceil(kieBaseCredits * CREDIT_MULTIPLIER);
}

// ── โมเดล/ความละเอียดที่ pipeline ใช้จริง (hardcoded ในฝั่ง server) ──
const VIRAL_IDOL_IMAGE_MODEL = 'nano-banana-2';
const VIRAL_IDOL_IMAGE_RES: ImageResolution = '1k';
const VIRAL_VIDEO_SECONDS = 10; // viral-pipeline: duration 10 (hardcoded)

/** Prompt Direct platform → duration (วินาที) + รองรับ extend ไหม */
const PROMPT_DIRECT_PLATFORMS: Record<string, { seconds: number; extend: boolean }> = {
  'kie-grok-10s': { seconds: 10, extend: false },
  'kie-grok-10s-extend': { seconds: 10, extend: true },
  'kie_grok_imagine': { seconds: 10, extend: false },
};

export interface CreditLine {
  /** เช่น "สร้างภาพ (Nano Banana 2)" */
  label: string;
  /** เช่น "3 รูป × 8" */
  detail: string;
  credits: number;
}

export interface TaskQuote {
  /** เช่น "Task #1" */
  taskLabel: string;
  lines: CreditLine[];
  subtotal: number;
  /** true เมื่อราคาคำนวณไม่ได้ (เช่น platform ที่ยังไม่มีราคา) */
  unknown?: boolean;
}

export interface Quote {
  tasks: TaskQuote[];
  total: number;
  hasUnknown: boolean;
}

function imageCredit(model: string, res: ImageResolution): number {
  return IMAGE_CREDITS[model]?.[res] ?? 0;
}

/** Viral task: ฉาก × (ภาพ nano-banana-2 1k + วิดีโอ grok 10วิ). directVideoFromRef → ไม่มีค่าภาพ */
export function quoteViralTask(opts: {
  taskLabel: string;
  scenes: number;
  directVideoFromRef?: boolean;
}): TaskQuote {
  const scenes = Math.max(1, opts.scenes || 1);
  const lines: CreditLine[] = [];

  if (!opts.directVideoFromRef) {
    const per = imageCredit(VIRAL_IDOL_IMAGE_MODEL, VIRAL_IDOL_IMAGE_RES);
    lines.push({
      label: 'สร้างภาพ (Nano Banana 2)',
      detail: `${scenes} รูป × ${per}`,
      credits: scenes * per,
    });
  }

  const perVid = VIRAL_VIDEO_SECONDS * GROK_VIDEO_CREDIT_PER_SEC;
  lines.push({
    label: 'วิดีโอ (Grok)',
    detail: `${scenes} คลิป × ${perVid} (${VIRAL_VIDEO_SECONDS}วิ)`,
    credits: scenes * perVid,
  });

  const subtotal = lines.reduce((s, l) => s + l.credits, 0);
  return { taskLabel: opts.taskLabel, lines, subtotal };
}

/** Idol task: ฉาก × (ภาพ nano-banana-2 1k + วิดีโอ grok @duration วิ) */
export function quoteIdolTask(opts: {
  taskLabel: string;
  scenes: number;
  durationSec: number;
}): TaskQuote {
  const scenes = Math.max(1, opts.scenes || 1);
  const seconds = Math.max(1, opts.durationSec || VIRAL_VIDEO_SECONDS);
  const perImg = imageCredit(VIRAL_IDOL_IMAGE_MODEL, VIRAL_IDOL_IMAGE_RES);
  const perVid = seconds * GROK_VIDEO_CREDIT_PER_SEC;

  const lines: CreditLine[] = [
    {
      label: 'สร้างภาพ (Nano Banana 2)',
      detail: `${scenes} รูป × ${perImg}`,
      credits: scenes * perImg,
    },
    {
      label: 'วิดีโอ (Grok)',
      detail: `${scenes} คลิป × ${perVid} (${seconds}วิ)`,
      credits: scenes * perVid,
    },
  ];

  const subtotal = lines.reduce((s, l) => s + l.credits, 0);
  return { taskLabel: opts.taskLabel, lines, subtotal };
}

/** Prompt Direct task: 1 วิดีโอ ตาม platform (+extend ถ้ามี). platform ที่ไม่มีราคา → unknown */
export function quotePromptDirectTask(opts: {
  taskLabel: string;
  platform?: string;
  hasExtendPrompt?: boolean;
}): TaskQuote {
  const cfg = opts.platform ? PROMPT_DIRECT_PLATFORMS[opts.platform] : undefined;
  if (!cfg) {
    return {
      taskLabel: opts.taskLabel,
      lines: [{ label: 'วิดีโอ', detail: 'ราคาแล้วแต่ KIE', credits: 0 }],
      subtotal: 0,
      unknown: true,
    };
  }

  const perVid = cfg.seconds * GROK_VIDEO_CREDIT_PER_SEC;
  const lines: CreditLine[] = [
    {
      label: 'วิดีโอ (Grok)',
      detail: `1 คลิป × ${perVid} (${cfg.seconds}วิ)`,
      credits: perVid,
    },
  ];

  if (cfg.extend && opts.hasExtendPrompt) {
    lines.push({
      label: 'ต่อวิดีโอ (Extend)',
      detail: `1 × ${GROK_EXTEND_CREDITS}`,
      credits: GROK_EXTEND_CREDITS,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.credits, 0);
  return { taskLabel: opts.taskLabel, lines, subtotal };
}

/**
 * Scheduler queue item: คิดตาม channel.ai_model.
 * - kie_viral_template: ฉาก × (8 ภาพ + 30 วิดีโอ[10วิ])
 * - kie_idol_template:  ฉาก × (8 ภาพ + duration×3 วิดีโอ)
 * - kie_grok_imagine:   1 วิดีโอ grok (duration×3)
 * - kie_grok_extend:    1 วิดีโอ grok (duration×3) + extend 20
 * - sora2 / veo3_1 / grok_imagine(vidgo): ยังไม่มีราคา → unknown
 *
 * หมายเหตุ: เป็นการ "ประมาณ" — จำนวนฉาก/template จริงถูกเลือกตอน gen (round-robin/random)
 * จึงใช้ค่า scenes ระดับ channel เป็นค่าตั้งต้น.
 */
export function quoteSchedulerItem(opts: {
  taskLabel: string;
  aiModel?: string;
  scenes?: number;
  durationSec?: number;
  hasExtendPrompt?: boolean;
}): TaskQuote {
  const scenes = Math.max(1, opts.scenes || 3);
  const seconds = Math.max(1, opts.durationSec || VIRAL_VIDEO_SECONDS);

  switch (opts.aiModel) {
    case 'kie_viral_template':
      return quoteViralTask({ taskLabel: opts.taskLabel, scenes });
    case 'kie_idol_template':
      return quoteIdolTask({ taskLabel: opts.taskLabel, scenes, durationSec: seconds });
    case 'kie_grok_imagine':
    case 'kie_grok_extend': {
      const perVid = seconds * GROK_VIDEO_CREDIT_PER_SEC;
      const lines: CreditLine[] = [
        { label: 'วิดีโอ (Grok)', detail: `1 คลิป × ${perVid} (${seconds}วิ)`, credits: perVid },
      ];
      if (opts.aiModel === 'kie_grok_extend' && opts.hasExtendPrompt) {
        lines.push({ label: 'ต่อวิดีโอ (Extend)', detail: `1 × ${GROK_EXTEND_CREDITS}`, credits: GROK_EXTEND_CREDITS });
      }
      return { taskLabel: opts.taskLabel, lines, subtotal: lines.reduce((s, l) => s + l.credits, 0) };
    }
    default:
      // sora2 / veo3_1 / vidgo grok — ไม่มีราคา
      return {
        taskLabel: opts.taskLabel,
        lines: [{ label: 'วิดีโอ', detail: 'ราคาแล้วแต่ KIE', credits: 0 }],
        subtotal: 0,
        unknown: true,
      };
  }
}

function normalizeRes(res?: string): ImageResolution {
  const r = String(res || '1k').toLowerCase();
  return (r === '2k' || r === '4k') ? r : '1k';
}

const IMAGE_MODEL_LABELS: Record<string, string> = {
  'nano-banana-2': 'Nano Banana 2',
  'nano-banana-pro': 'Nano Banana Pro',
  'gpt-image-2': 'GPT Image 2',
  'grok-imagine': 'Grok Imagine',
};

/** สร้างภาพตรง (GPT Image 2 / Nano Banana / Grok) — count รูป ที่ res ที่เลือก */
export function quoteImageGen(opts: {
  taskLabel: string;
  model: string;
  resolution?: string;
  count?: number;
}): TaskQuote {
  const count = Math.max(1, opts.count || 1);
  const res = normalizeRes(opts.resolution);
  const per = IMAGE_CREDITS[opts.model]?.[res];
  const label = `สร้างภาพ (${IMAGE_MODEL_LABELS[opts.model] || opts.model})`;
  if (per === undefined) {
    return {
      taskLabel: opts.taskLabel,
      lines: [{ label, detail: 'ราคาแล้วแต่ KIE', credits: 0 }],
      subtotal: 0,
      unknown: true,
    };
  }
  const lines: CreditLine[] = [
    { label, detail: `${count} รูป × ${per} (${res.toUpperCase()})`, credits: count * per },
  ];
  return { taskLabel: opts.taskLabel, lines, subtotal: count * per };
}

/** Kling 3.0 Motion Control — วิดีโอ duration วินาที = 20/วิ */
export function quoteKlingVideo(opts: {
  taskLabel: string;
  durationSec: number;
  count?: number;
}): TaskQuote {
  const count = Math.max(1, opts.count || 1);
  const seconds = Math.max(1, opts.durationSec || 1);
  const perVid = seconds * KLING_CREDIT_PER_SEC;
  const lines: CreditLine[] = [
    { label: 'วิดีโอ (Kling 3.0)', detail: `${count} คลิป × ${perVid} (${seconds}วิ)`, credits: count * perVid },
  ];
  return { taskLabel: opts.taskLabel, lines, subtotal: count * perVid };
}

/** รวม TaskQuote หลายอันเป็น Quote เดียว (สำหรับปุ่ม "สร้างทั้งหมด") */
export function buildQuote(tasks: TaskQuote[]): Quote {
  const total = tasks.reduce((s, t) => s + t.subtotal, 0);
  const hasUnknown = tasks.some(t => t.unknown);
  return { tasks, total, hasUnknown };
}
