/**
 * Story Agent LLM service — the "thinking" part of the AI Agent pipeline.
 *
 * Three single-shot prompt chains (no agent loop, no tool use):
 *   1. generateIdea(topic, tone, language)               → { title, hook, premise, three_acts }
 *   2. generateScript(idea, sceneCount, language)        → { lines: [{ scene, text }] }
 *   3. generateStoryboard(idea, script, language)        → { style_bible, scenes: [{ scene, prompt_en, panel_th }] }
 *
 * Provider routing — picks one based on which key the user has set:
 *   - openrouter_api_key set → OpenAI SDK pointed at OpenRouter (model: anthropic/claude-sonnet-4.5)
 *   - anthropic_api_key set  → native Anthropic SDK with prompt caching (model: claude-sonnet-4-6)
 *   - fallback               → server-level ANTHROPIC_API_KEY env var
 *
 * Prompt caching only applies to the native Anthropic path; OpenRouter does not
 * pass cache_control through reliably across all providers, so we skip it there.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MAX_TOKENS = 4096;

export interface LlmKeys {
  anthropic?: string | null;
  openrouter?: string | null;
}

/**
 * Call an LLM with system + user messages, returning the raw text content.
 * Routes to Anthropic or OpenRouter based on which key is set on the user.
 */
async function callLLM(
  systemPrompt: string,
  userMsg: string,
  keys: LlmKeys,
  maxTokens: number = MAX_TOKENS
): Promise<string> {
  // Prefer Anthropic native if user has that key (it supports prompt caching)
  if (keys.anthropic) {
    return callAnthropic(systemPrompt, userMsg, keys.anthropic, maxTokens);
  }
  // Otherwise try OpenRouter
  if (keys.openrouter) {
    return callOpenRouter(systemPrompt, userMsg, keys.openrouter, maxTokens);
  }
  // Fallback to server env (Anthropic)
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return callAnthropic(systemPrompt, userMsg, envKey, maxTokens);
  }
  throw new Error(
    'No LLM key configured. Set anthropic_api_key or openrouter_api_key on user profile, or ANTHROPIC_API_KEY in env.'
  );
}

async function callAnthropic(
  systemPrompt: string,
  userMsg: string,
  apiKey: string,
  maxTokens: number
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMsg }],
  });
  const block = resp.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Anthropic returned no text block');
  return block.text;
}

async function callOpenRouter(
  systemPrompt: string,
  userMsg: string,
  apiKey: string,
  maxTokens: number
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE,
    defaultHeaders: {
      // OpenRouter ranking headers (optional but recommended)
      'HTTP-Referer': 'https://tripleschool.com',
      'X-Title': 'Triple School AI Agent',
    },
  });
  const resp = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
  });
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned no content');
  return text;
}

export type Language = 'th' | 'en';

export interface Idea {
  title: string;
  hook: string;
  premise: string;
  three_acts: { act1: string; act2: string; act3: string };
  // Optional structural hooks the script writer uses to enforce
  // "Hook-3-layer + Catchphrase + Direct quote + Specifics" patterns.
  // Backward compatible: when missing, script writer still works (just weaker).
  catchphrase?: string;
  direct_quote?: string;
  cases?: string[];
  specifics?: string[];
}

export interface ScriptLine {
  scene: number;
  text: string;
}

export interface Script {
  lines: ScriptLine[];
}

export interface StoryboardScene {
  scene: number;
  prompt_en: string;   // sent to kie.ai gpt-image-2
  panel_th: string;    // Thai description for UI display
}

export interface Storyboard {
  style_bible: string;       // shared visual style description (recurring chars, lighting, palette)
  character_sheet: string;   // recurring people/objects to keep consistent across scenes
  scenes: StoryboardScene[];
}

// ---------- Stage 1: idea ----------

const IDEA_SYSTEM_TH = `คุณเป็นนักคิดคอนเซ็ปต์เนื้อหา Reels/Short ภาษาไทย ความเชี่ยวชาญคือเปลี่ยนหัวข้อกว้างให้กลายเป็นไอเดียคลิปสั้น 60-180 วินาที ที่มี hook ตรึงคนดูใน 3 วินาทีแรก แล้วเล่าต่อจนจบแบบ 3 องก์

หลักการที่ต้องทำตามทุกครั้ง:
- เปิดด้วย hook ที่สั้น เห็นภาพ มี curiosity gap — "ทำไม" "ยังไง" "เกิดอะไรขึ้น"
- premise ต้องชัด: เรื่องนี้พูดถึงอะไร ใคร ที่ไหน เมื่อไร
- 3 องก์ต้องไหลต่อกัน องก์ 1 ปูสถานการณ์ องก์ 2 ไต่ระดับ องก์ 3 พีค+คลายปม
- หลีกเลี่ยงคำพูดเกินจริง ไม่รับประกันผลลัพธ์ ไม่ดูถูกใคร

ตอบกลับเป็น JSON เท่านั้น ห้ามใส่ markdown หรือคำอธิบายเพิ่ม โครงสร้าง:
{
  "title": "ชื่อคลิป (สั้น ดึงดูด ≤60 ตัวอักษร)",
  "hook": "ประโยค hook เปิดเรื่อง (1-2 ประโยค ≤120 ตัวอักษร)",
  "premise": "แก่นเรื่อง (2-3 ประโยค)",
  "three_acts": {
    "act1": "องก์ 1: ปูสถานการณ์",
    "act2": "องก์ 2: ไต่ระดับ",
    "act3": "องก์ 3: พีค + คลายปม"
  }
}`;

const IDEA_SYSTEM_EN = `You are a Reels/Shorts concept writer. Your specialty is turning a broad topic into a 60-180 second short-video idea with a hook that locks viewers in within 3 seconds, then delivers a 3-act story.

Rules every time:
- Open with a short, visual hook that creates a curiosity gap — "why" "how" "what happened"
- Premise must be clear: what is this about, who, where, when
- 3 acts must flow: Act 1 sets the stage, Act 2 escalates, Act 3 peaks + resolves
- No exaggerated claims, no guaranteed outcomes, no disrespect

Reply with JSON only — no markdown, no extra commentary. Schema:
{
  "title": "Clip title (short, catchy, ≤60 chars)",
  "hook": "Opening hook (1-2 sentences ≤120 chars)",
  "premise": "Core premise (2-3 sentences)",
  "three_acts": {
    "act1": "Act 1: setup",
    "act2": "Act 2: escalation",
    "act3": "Act 3: peak + resolution"
  }
}`;

export async function generateIdea(
  topic: string,
  tone: string | null,
  language: Language,
  keys: LlmKeys
): Promise<Idea> {
  const system = language === 'en' ? IDEA_SYSTEM_EN : IDEA_SYSTEM_TH;
  const toneLine = tone
    ? language === 'en'
      ? `\nTone: ${tone}`
      : `\nโทนอารมณ์: ${tone}`
    : '';
  const userMsg =
    language === 'en'
      ? `Topic: ${topic}${toneLine}\n\nReturn JSON only.`
      : `หัวข้อ: ${topic}${toneLine}\n\nตอบเป็น JSON เท่านั้น`;

  const raw = await callLLM(system, userMsg, keys);
  return parseJsonText<Idea>(raw);
}

// ---------- Stage 2: script ----------

const SCRIPT_SYSTEM_TH = `คุณเป็นนักเขียนบทเรื่องเล่าสำหรับ Reels/Short ภาษาไทย เปลี่ยนไอเดียให้กลายเป็นบทพากย์รายบรรทัด แต่ละบรรทัดคือ 1 ฉาก ยาว ~6 วินาที

กฎ:
- เขียนเป็นภาษาไทยที่ "ฟัง" แล้วลื่น ประโยคสั้น ตามจังหวะ
- แต่ละบรรทัด ~50-62 ตัวอักษร (พูดได้ ~4.5-5.3 วินาที) **ห้ามเกิน 70 ตัวอักษร**
- บรรทัดที่ 1-3 = HOOK ต้องตรึงทันที
- บรรทัดท้าย 2 บรรทัด = ปิด/CTA
- ทุกบรรทัดจบความในตัว ไม่ห้อยค้างไปบรรทัดถัดไป
- ใช้คำเห็นภาพ สร้างอารมณ์ ทุกบรรทัดวาดเป็นฉากเดียวได้

ตอบเป็น JSON เท่านั้น โครงสร้าง:
{
  "lines": [
    { "scene": 1, "text": "บรรทัดที่ 1" },
    { "scene": 2, "text": "บรรทัดที่ 2" },
    ...
  ]
}`;

const SCRIPT_SYSTEM_EN = `You are a script writer for Reels/Shorts. Turn an idea into per-line narration where each line = 1 scene ≈ 6 seconds.

Rules:
- Write spoken English: short, punchy sentences
- ~14-18 words per line, never exceed 22 words
- Lines 1-3 = HOOK, must lock viewer immediately
- Last 2 lines = closing / CTA
- Each line completes its own thought — no dangling continuations
- Use visual, sensory language; each line must be drawable as one scene

Reply with JSON only. Schema:
{
  "lines": [
    { "scene": 1, "text": "Line 1" },
    { "scene": 2, "text": "Line 2" },
    ...
  ]
}`;

export async function generateScript(
  idea: Idea,
  sceneCount: number,
  language: Language,
  keys: LlmKeys
): Promise<Script> {
  const system = language === 'en' ? SCRIPT_SYSTEM_EN : SCRIPT_SYSTEM_TH;
  const userMsg =
    language === 'en'
      ? `Idea:\n${JSON.stringify(idea, null, 2)}\n\nWrite exactly ${sceneCount} lines (one per scene). Return JSON only.`
      : `ไอเดีย:\n${JSON.stringify(idea, null, 2)}\n\nเขียนบท ${sceneCount} บรรทัด (1 บรรทัด = 1 ฉาก) ตอบเป็น JSON เท่านั้น`;

  const raw = await callLLM(system, userMsg, keys);
  const script = parseJsonText<Script>(raw);
  // Sanity check + normalize scene numbers
  if (!Array.isArray(script.lines) || script.lines.length === 0) {
    throw new Error('LLM returned empty script lines');
  }
  script.lines = script.lines
    .map((l, i) => ({ scene: i + 1, text: String(l.text || '').trim() }))
    .filter((l) => l.text.length > 0);
  return script;
}

// ---------- Stage 4: storyboard ----------

const STORYBOARD_SYSTEM = `You are a storyboard director. Given a Reels/Shorts idea and a per-scene script, write:
1. A "style bible" — the unified visual style (lighting, palette, mood, aspect ratio 9:16)
2. A "character sheet" — recurring characters/objects to keep visually consistent across scenes
3. Per-scene image prompts in ENGLISH (for an image generator) + Thai panel description (for UI)

Rules for each scene prompt (prompt_en):
- ENGLISH only, even if the script is Thai. Image models perform better on English prompts.
- 30-60 words per prompt
- Cinematic, semi-realistic digital painting style
- Vertical 9:16 composition
- One clear focal subject per scene, matching the script line
- Reference the character sheet for any recurring people/objects
- Avoid embedded text/letters/watermarks in the image

For panel_th: 1-2 short Thai sentences describing what the viewer sees.

Reply with JSON only:
{
  "style_bible": "shared visual style (≤120 words English)",
  "character_sheet": "recurring characters/objects (≤80 words English)",
  "scenes": [
    { "scene": 1, "prompt_en": "...", "panel_th": "..." },
    ...
  ]
}`;

export async function generateStoryboard(
  idea: Idea,
  script: Script,
  language: Language,
  keys: LlmKeys
): Promise<Storyboard> {
  const userMsg = `Idea:\n${JSON.stringify(idea, null, 2)}\n\nScript (${language}):\n${JSON.stringify(
    script,
    null,
    2
  )}\n\nWrite ${script.lines.length} scene entries matching the script lines 1-to-1. Return JSON only.`;

  const raw = await callLLM(STORYBOARD_SYSTEM, userMsg, keys);
  const sb = parseJsonText<Storyboard>(raw);
  if (!Array.isArray(sb.scenes) || sb.scenes.length === 0) {
    throw new Error('LLM returned empty storyboard scenes');
  }
  // Normalize scene numbering and ensure 1-to-1 with script
  sb.scenes = sb.scenes
    .map((s, i) => ({
      scene: i + 1,
      prompt_en: String(s.prompt_en || '').trim(),
      panel_th: String(s.panel_th || '').trim(),
    }))
    .filter((s) => s.prompt_en.length > 0);
  return sb;
}

// ---------- Optional: caption generator for stage 8 ----------

export async function generateCaptions(
  idea: Idea,
  script: Script,
  language: Language,
  keys: LlmKeys
): Promise<{ caption_fb: string; caption_tt: string; hashtags: string[] }> {
  const system =
    language === 'en'
      ? `Write social media captions for a short video. Reply JSON only:
{ "caption_fb": "Facebook caption (2-3 sentences, hook + CTA, ≤250 chars)",
  "caption_tt": "TikTok caption (1 sentence + hashtags inline, ≤150 chars)",
  "hashtags": ["#tag1", "#tag2", ...] }`
      : `เขียนแคปชั่นสำหรับโพสต์คลิปสั้น ตอบเป็น JSON เท่านั้น:
{ "caption_fb": "แคปชั่น Facebook (2-3 ประโยค hook + CTA ≤250 ตัวอักษร)",
  "caption_tt": "แคปชั่น TikTok (1 ประโยค + แฮชแท็กในประโยค ≤150 ตัวอักษร)",
  "hashtags": ["#แท็ก1", "#แท็ก2", ...] }`;

  const userMsg =
    language === 'en'
      ? `Idea: ${JSON.stringify(idea)}\nScript: ${JSON.stringify(script)}\n\nReturn JSON only.`
      : `ไอเดีย: ${JSON.stringify(idea)}\nบท: ${JSON.stringify(script)}\n\nตอบเป็น JSON เท่านั้น`;

  const raw = await callLLM(system, userMsg, keys, 1024);
  return parseJsonText(raw);
}

// ---------- helpers ----------

function parseJsonText<T>(rawText: string): T {
  let raw = rawText.trim();
  // Strip markdown code fences if the model added them anyway
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err: any) {
    throw new Error(`LLM returned invalid JSON: ${err.message}\n--- raw ---\n${raw.substring(0, 500)}`);
  }
}

/**
 * Compute scene count from desired clip duration.
 * Each scene = 6s of kie.ai grok-imagine output. Clamp to [5, 30] for sanity.
 */
export function deriveSceneCount(durationSec: number): number {
  const n = Math.round(durationSec / 6);
  return Math.max(5, Math.min(30, n));
}
