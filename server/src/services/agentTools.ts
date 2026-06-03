/**
 * Tool definitions + handlers for the chat AI Agent.
 *
 * Tools are exposed to Claude (via Anthropic SDK tool_use). Each one wraps an
 * existing service or DB query — the agent decides which to call and when,
 * guided by the active skill(s) loaded in its system prompt.
 *
 * Adding a tool:
 *   1. Add a `ToolDef` entry to TOOL_DEFS (name + description + input_schema)
 *   2. Add a handler entry to toolHandlers (matches the name)
 *   3. The chat agent loop will pick it up automatically
 */
import pool from '../db.js';
import {
  generateIdea,
  generateScript,
  type Idea,
  type Script,
  type Language,
  type LlmKeys,
} from './storyAgentLLM.js';
import { listUserSkills, getUserSkill, type UserSkill } from './skillsService.js';

export interface ToolDef {
  name: string;
  description: string;
  // JSONSchema (subset) consumed by Anthropic tool_use API.
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  userId: number;
  llmKeys: LlmKeys;
  // Skills already loaded into the chat system prompt — handler can reference
  // them for parameter defaults without re-loading from DB.
  activeSkills: UserSkill[];
  mergedFrontmatter: Record<string, unknown>;
}

/**
 * Pick a value from frontmatter using dot-path (e.g. "stages.voice.timing_gate_max_sec").
 * Returns undefined if any step is missing.
 */
export function pickFM(fm: Record<string, unknown>, path: string): unknown {
  let cur: unknown = fm;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ============================================================================
// Tool definitions (sent to Claude)
// ============================================================================

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_my_skills',
    description:
      'List all skills the current user has in their library. Returns id, name, description, is_default, and whether each is currently active in this chat. Call this when the user asks about their skills or you need to suggest one to switch to.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_skill_content',
    description:
      'Read the full markdown content of a specific skill by id. Use this when you need to recall details of a skill that is NOT currently active in this chat (active ones are already in your system prompt).',
    input_schema: {
      type: 'object',
      properties: {
        skill_id: { type: 'number', description: 'The skill id from list_my_skills' },
      },
      required: ['skill_id'],
    },
  },
  {
    name: 'generate_idea',
    description:
      'Generate a structured story idea for a clip. Parameters come from active skill frontmatter when not supplied. Returns { title, hook, premise, three_acts, optional: catchphrase, direct_quote, cases, specifics }. Run this FIRST before any other content generation.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The story topic in user\'s language' },
        tone: {
          type: 'string',
          description:
            'Optional tone: dramatic, mystical, inspirational, humorous, documentary, horror, etc.',
        },
        language: {
          type: 'string',
          enum: ['th', 'en'],
          description: 'Output language (defaults to active skill language or th)',
        },
        extra_instructions: {
          type: 'string',
          description:
            'Optional extra constraints from this conversation (e.g. "focus on a specific historical period")',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'generate_script',
    description:
      'Write a per-scene script from an idea. Number of scenes defaults to active skill\'s scene_count. Returns { lines: [{ scene, text }] }. ONLY call after generate_idea has produced an idea you want to use.',
    input_schema: {
      type: 'object',
      properties: {
        idea_json: {
          type: 'object',
          description: 'The Idea object returned by generate_idea',
        },
        scene_count: {
          type: 'number',
          description:
            'Override the scene count from the active skill. Omit to use skill default.',
        },
        language: {
          type: 'string',
          enum: ['th', 'en'],
          description: 'Output language',
        },
        extra_instructions: {
          type: 'string',
          description:
            'Extra rules from this turn (e.g. "make line 5 shorter than 50 chars")',
        },
      },
      required: ['idea_json'],
    },
  },
  {
    name: 'create_pipeline_job',
    description:
      'Persist the planned clip as a story_agent_jobs row so the background runner can execute the slow stages (voice + image + video + assemble + post). Returns { job_id }. Use this only AFTER the user has approved the idea and script — this triggers credit charges.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Final topic to record on the job' },
        duration_sec: {
          type: 'number',
          description:
            'Total clip duration in seconds. Defaults to scene_count * scene_duration_sec from active skill.',
        },
        tone: { type: 'string', description: 'Tone label' },
        language: { type: 'string', enum: ['th', 'en'] },
        idea_json: { type: 'object', description: 'Pre-generated idea JSON' },
        script_json: {
          type: 'object',
          description: 'Pre-generated script JSON (lines array)',
        },
      },
      required: ['topic', 'duration_sec', 'language', 'idea_json', 'script_json'],
    },
  },
  {
    name: 'check_pipeline_status',
    description:
      'Look up the current stage / status / scene progress of a previously created job. Use this to update the user on progress when they ask "how is it going?".',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'number' },
      },
      required: ['job_id'],
    },
  },
];

// ============================================================================
// Tool handlers
// ============================================================================

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  try {
    const handler = toolHandlers[name];
    if (!handler) return { ok: false, error: `Unknown tool: ${name}` };
    const data = await handler(input, ctx);
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

const toolHandlers: Record<
  string,
  (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
> = {
  async list_my_skills(_input, ctx) {
    const skills = await listUserSkills(ctx.userId);
    const activeIds = new Set(ctx.activeSkills.map((s) => s.id));
    return skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      is_default: s.is_default,
      is_active_now: activeIds.has(s.id),
      use_count: s.use_count,
    }));
  },

  async read_skill_content(input, ctx) {
    const id = Number(input.skill_id);
    if (!id) throw new Error('skill_id is required');
    const skill = await getUserSkill(ctx.userId, id);
    if (!skill) throw new Error(`Skill ${id} not found`);
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content_md: skill.content_md,
    };
  },

  async generate_idea(input, ctx): Promise<Idea> {
    const topic = String(input.topic || '').trim();
    if (!topic) throw new Error('topic is required');
    const tone = (input.tone as string | undefined) || null;
    const language =
      (input.language as Language | undefined) ||
      ((pickFM(ctx.mergedFrontmatter, 'language') as Language | undefined) ?? 'th');
    const extra = (input.extra_instructions as string | undefined) || '';

    // The base storyAgentLLM uses a hard-coded system prompt. We don't have a
    // skill-aware overload yet (Phase 2), so we pass extra constraints via the
    // tone field for now. TODO: refactor generateIdea to accept a system-prompt
    // suffix so skills can fully steer it.
    const effectiveTone = extra ? `${tone || ''}\n\n${extra}`.trim() : tone;
    return generateIdea(topic, effectiveTone, language, ctx.llmKeys);
  },

  async generate_script(input, ctx): Promise<Script> {
    const ideaJson = input.idea_json as Idea | undefined;
    if (!ideaJson || typeof ideaJson !== 'object') {
      throw new Error('idea_json is required');
    }
    const language =
      (input.language as Language | undefined) ||
      ((pickFM(ctx.mergedFrontmatter, 'language') as Language | undefined) ?? 'th');
    const sceneCount =
      Number(input.scene_count) ||
      (pickFM(ctx.mergedFrontmatter, 'scene_count') as number | undefined) ||
      10;
    return generateScript(ideaJson, sceneCount, language, ctx.llmKeys);
  },

  async create_pipeline_job(input, ctx) {
    const topic = String(input.topic || '').trim();
    const durationSec = Number(input.duration_sec);
    const language = (input.language as 'th' | 'en') || 'th';
    const tone = (input.tone as string | undefined) || null;
    const ideaJson = input.idea_json;
    const scriptJson = input.script_json as { lines?: Array<{ scene: number; text: string }> };

    if (!topic) throw new Error('topic is required');
    if (!durationSec || durationSec < 10 || durationSec > 300) {
      throw new Error('duration_sec must be 10-300');
    }
    if (!ideaJson) throw new Error('idea_json is required');
    if (!scriptJson || !Array.isArray(scriptJson.lines) || scriptJson.lines.length === 0) {
      throw new Error('script_json with lines[] is required');
    }

    const sceneCount = scriptJson.lines.length;
    // Insert the job in the "voice" stage so the runner picks up at TTS
    // (idea + script already done in chat).
    const insert = await pool.query(
      `INSERT INTO story_agent_jobs
         (user_id, topic, duration_sec, tone, language, scene_count,
          current_stage, status, idea_json, script_json)
       VALUES ($1, $2, $3, $4, $5, $6, 'voice', 'pending', $7::jsonb, $8::jsonb)
       RETURNING id`,
      [
        ctx.userId,
        topic,
        durationSec,
        tone,
        language,
        sceneCount,
        JSON.stringify(ideaJson),
        JSON.stringify(scriptJson),
      ]
    );
    const jobId = insert.rows[0].id as number;

    // Pre-populate scene rows from script lines so the voice stage can run.
    for (const line of scriptJson.lines) {
      await pool.query(
        `INSERT INTO story_agent_scenes (job_id, scene_number, script_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (job_id, scene_number) DO UPDATE SET script_text = EXCLUDED.script_text`,
        [jobId, line.scene, line.text]
      );
    }

    await pool.query(
      `UPDATE story_agent_jobs
       SET logs = COALESCE(logs, '[]'::jsonb) || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify([
          {
            time: new Date().toISOString(),
            emoji: '🚀',
            text: `เริ่มงานจาก chat — "${topic.substring(0, 60)}", ${durationSec}s, ${sceneCount} ฉาก`,
          },
        ]),
        jobId,
      ]
    );

    return { job_id: jobId, scene_count: sceneCount };
  },

  async check_pipeline_status(input, ctx) {
    const jobId = Number(input.job_id);
    if (!jobId) throw new Error('job_id is required');

    const jobRes = await pool.query(
      `SELECT id, current_stage, status, error, final_video_url, caption_fb, caption_tt
       FROM story_agent_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, ctx.userId]
    );
    if (jobRes.rowCount === 0) throw new Error(`Job ${jobId} not found`);

    const scenesRes = await pool.query(
      `SELECT scene_number,
              voice_url IS NOT NULL AS has_voice,
              voice_duration,
              image_status,
              video_status
       FROM story_agent_scenes WHERE job_id = $1 ORDER BY scene_number ASC`,
      [jobId]
    );

    return {
      job: jobRes.rows[0],
      scenes: scenesRes.rows,
    };
  },
};
