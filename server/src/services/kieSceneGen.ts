/**
 * KIE.ai scene generation helpers — text-to-image (gpt-image-2) and image-to-video (grok-imagine).
 *
 * Pure functions over kie.ai's createTask + recordInfo endpoints. The orchestrator
 * (storyAgentRunnerJob) calls submit* to create tasks and poll* to advance them.
 *
 * Pattern matches storyTemplateRunner.ts:
 *   - submit returns { task_id } or throws
 *   - poll returns { state: 'pending' | 'success' | 'failed', url?, error? }
 */

const KIE_BASE = 'https://api.kie.ai';

export interface KiePollResult {
  state: 'pending' | 'success' | 'failed';
  url: string | null;
  error?: string;
}

// ---------- Image (gpt-image-2 text-to-image) ----------

export async function submitSceneImage(
  apiKey: string,
  prompt: string,
  opts: { aspect_ratio?: string; resolution?: string } = {}
): Promise<string> {
  const cleanPrompt = prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // KIE gpt-image-2 worker crashes on portrait (9:16/3:4/4:5/2:3) + 2K/4K combos.
  // For scene gen we want 9:16 vertical at 1K — safest combo.
  const safeAspect = opts.aspect_ratio || '9:16';
  const safeResolution = opts.resolution || '1K';

  const body = {
    model: 'gpt-image-2-text-to-image',
    input: {
      prompt: cleanPrompt,
      aspect_ratio: safeAspect,
      resolution: safeResolution,
    },
  };

  const res = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 200 || !data.data?.taskId) {
    throw new Error(data.msg || `KIE image submit HTTP ${res.status}: ${JSON.stringify(data).substring(0, 200)}`);
  }
  return data.data.taskId as string;
}

// ---------- Video (grok-imagine image-to-video, 6s default) ----------

export async function submitSceneVideo(
  apiKey: string,
  imageUrl: string,
  prompt: string,
  opts: { aspect_ratio?: string; duration?: 5 | 10; resolution?: string } = {}
): Promise<string> {
  const duration = opts.duration ?? 10; // grok-imagine accepts 5 or 10; we use 10 then trim if needed
  const aspect = opts.aspect_ratio || '9:16';
  const resolution = opts.resolution || '720p';

  // grok-imagine i2v expects @image1 prefix to reference the input image
  const finalPrompt = /^@image\d/i.test(prompt) ? prompt : `@image1 ${prompt}`;

  const body = {
    model: 'grok-imagine/image-to-video',
    input: {
      image_urls: [imageUrl],
      prompt: finalPrompt,
      mode: 'spicy',
      aspect_ratio: aspect,
      duration,
      resolution,
    },
  };

  const res = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 200 || !data.data?.taskId) {
    throw new Error(data.msg || `KIE video submit HTTP ${res.status}: ${JSON.stringify(data).substring(0, 200)}`);
  }
  return data.data.taskId as string;
}

// ---------- Polling ----------

export async function pollKieTask(apiKey: string, taskId: string): Promise<KiePollResult> {
  const res = await fetch(
    `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    // Transient HTTP error → treat as pending
    return { state: 'pending', url: null };
  }
  const raw: any = await res.json().catch(() => ({}));
  const data = raw?.data || raw || {};
  const stateRaw = String(
    data.state || data.status || data.taskState || data.taskStatus || ''
  ).toLowerCase().trim();

  if (['success', 'completed', 'done', 'finished', 'ok', '2', 'complete'].includes(stateRaw)) {
    const url = extractResultUrl(data) || extractResultUrl(raw);
    if (!url) {
      return { state: 'failed', url: null, error: 'KIE success but no URL in response' };
    }
    return { state: 'success', url };
  }
  if (['fail', 'failed', 'error', 'rejected', '3'].includes(stateRaw)) {
    const msg = data.failMsg || data.fail_msg || data.errorMessage || data.error || 'KIE task failed';
    return { state: 'failed', url: null, error: String(msg) };
  }
  return { state: 'pending', url: null };
}

function extractResultUrl(obj: any): string | null {
  if (!obj) return null;
  // 1) Parse resultJson if string
  if (obj.resultJson) {
    try {
      const rd = typeof obj.resultJson === 'string' ? JSON.parse(obj.resultJson) : obj.resultJson;
      const url =
        rd.resultUrls?.[0] ||
        rd.result_urls?.[0] ||
        rd.imageUrls?.[0] ||
        rd.image_urls?.[0] ||
        rd.videoUrls?.[0] ||
        rd.video_urls?.[0] ||
        rd.urls?.[0] ||
        rd.url ||
        rd.image_url ||
        rd.imageUrl ||
        rd.video_url ||
        rd.videoUrl ||
        null;
      if (url) return url;
      const deep = findUrl(rd);
      if (deep) return deep;
    } catch {}
  }
  // 2) Top-level fallback fields
  const top =
    obj.resultUrl ||
    obj.imageUrl ||
    obj.image_url ||
    obj.videoUrl ||
    obj.video_url ||
    obj.url ||
    obj.resultUrls?.[0] ||
    obj.result_urls?.[0] ||
    obj.imageUrls?.[0] ||
    obj.image_urls?.[0] ||
    obj.videoUrls?.[0] ||
    obj.video_urls?.[0] ||
    null;
  if (top) return top;
  // 3) Deep search
  return findUrl(obj);
}

function findUrl(obj: any): string | null {
  if (!obj) return null;
  if (typeof obj === 'string') return /^https?:\/\//.test(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const u = findUrl(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const u = findUrl(obj[k]);
      if (u) return u;
    }
  }
  return null;
}
