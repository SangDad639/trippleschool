/**
 * User Skills service — CRUD + frontmatter parsing for the chat-based AI Agent.
 *
 * A skill is a markdown document with optional YAML frontmatter:
 *
 *   ---
 *   name: my-style
 *   scene_count: 15
 *   gates: { require_catchphrase: true }
 *   ---
 *
 *   # Body — read by the LLM as system prompt prefix.
 *
 * The frontmatter is parsed once at write-time and cached in `frontmatter`
 * JSONB column for fast querying. Body content is sent to the LLM raw.
 */
import pool from '../db.js';
import { parseFrontmatter } from './yamlMini.js';

export interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface UserSkill {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  content_md: string;
  frontmatter: Record<string, unknown> | null;
  trigger_keywords: string[] | null;
  source_template_id: number | null;
  is_default: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface SkillTemplate {
  id: number;
  name: string;
  category: string;
  description: string;
  content_md: string;
  preview_image_url: string | null;
  is_featured: boolean;
}

/**
 * Parse a skill markdown file → { frontmatter, body }.
 * Frontmatter is YAML-like (subset: scalars, arrays, nested maps).
 */
export function parseSkillMd(contentMd: string): ParsedSkill {
  return parseFrontmatter(contentMd);
}

/**
 * Merge multiple active skills into a single context for the LLM.
 *
 * - Frontmatters merge via shallow-then-deep override (later skills win)
 * - Bodies concatenate in order, separated by skill headings
 *
 * This is what gets prepended to the system prompt of the chat agent.
 */
export function composeSkillsContext(skills: UserSkill[]): {
  mergedFrontmatter: Record<string, unknown>;
  combinedBody: string;
  activeNames: string[];
} {
  let mergedFrontmatter: Record<string, unknown> = {};
  const bodyParts: string[] = [];
  const activeNames: string[] = [];

  for (const skill of skills) {
    const parsed = parseSkillMd(skill.content_md);
    mergedFrontmatter = deepMerge(mergedFrontmatter, parsed.frontmatter);
    bodyParts.push(`\n\n## Skill: ${skill.name}\n\n${parsed.body.trim()}`);
    activeNames.push(skill.name);
  }

  return {
    mergedFrontmatter,
    combinedBody: bodyParts.join('\n\n---\n').trim(),
    activeNames,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (isPlainObject(bv) && isPlainObject(ov)) {
      out[key] = deepMerge(bv, ov);
    } else {
      out[key] = ov;
    }
  }
  return out;
}

// ============================================================================
// CRUD
// ============================================================================

export async function listUserSkills(userId: number): Promise<UserSkill[]> {
  const r = await pool.query<UserSkill>(
    `SELECT id, user_id, name, description, content_md, frontmatter, trigger_keywords,
            source_template_id, is_default, use_count, created_at, updated_at
     FROM user_skills
     WHERE user_id = $1
     ORDER BY is_default DESC, updated_at DESC`,
    [userId]
  );
  return r.rows;
}

export async function getUserSkill(userId: number, skillId: number): Promise<UserSkill | null> {
  const r = await pool.query<UserSkill>(
    `SELECT id, user_id, name, description, content_md, frontmatter, trigger_keywords,
            source_template_id, is_default, use_count, created_at, updated_at
     FROM user_skills WHERE id = $1 AND user_id = $2`,
    [skillId, userId]
  );
  return r.rows[0] || null;
}

export async function getUserSkillsByIds(
  userId: number,
  skillIds: number[]
): Promise<UserSkill[]> {
  if (skillIds.length === 0) return [];
  const r = await pool.query<UserSkill>(
    `SELECT id, user_id, name, description, content_md, frontmatter, trigger_keywords,
            source_template_id, is_default, use_count, created_at, updated_at
     FROM user_skills
     WHERE user_id = $1 AND id = ANY($2::int[])
     ORDER BY array_position($2::int[], id)`,
    [userId, skillIds]
  );
  return r.rows;
}

export interface CreateSkillInput {
  name: string;
  description?: string | null;
  content_md: string;
  source_template_id?: number | null;
  is_default?: boolean;
}

export async function createUserSkill(
  userId: number,
  input: CreateSkillInput
): Promise<UserSkill> {
  const parsed = parseSkillMd(input.content_md);
  const keywords = extractTriggerKeywords(parsed.frontmatter);

  const r = await pool.query<UserSkill>(
    `INSERT INTO user_skills
       (user_id, name, description, content_md, frontmatter, trigger_keywords,
        source_template_id, is_default)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      input.name.trim(),
      input.description?.trim() || null,
      input.content_md,
      JSON.stringify(parsed.frontmatter),
      keywords,
      input.source_template_id || null,
      input.is_default ?? false,
    ]
  );
  return r.rows[0];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string | null;
  content_md?: string;
  is_default?: boolean;
}

export async function updateUserSkill(
  userId: number,
  skillId: number,
  patch: UpdateSkillInput
): Promise<UserSkill | null> {
  const existing = await getUserSkill(userId, skillId);
  if (!existing) return null;

  const nextContent = patch.content_md ?? existing.content_md;
  const parsed = parseSkillMd(nextContent);
  const keywords = extractTriggerKeywords(parsed.frontmatter);

  const r = await pool.query<UserSkill>(
    `UPDATE user_skills
     SET name = $1,
         description = $2,
         content_md = $3,
         frontmatter = $4::jsonb,
         trigger_keywords = $5,
         is_default = $6,
         updated_at = NOW()
     WHERE id = $7 AND user_id = $8
     RETURNING *`,
    [
      patch.name?.trim() || existing.name,
      patch.description?.trim() ?? existing.description,
      nextContent,
      JSON.stringify(parsed.frontmatter),
      keywords,
      patch.is_default ?? existing.is_default,
      skillId,
      userId,
    ]
  );
  return r.rows[0] || null;
}

export async function deleteUserSkill(userId: number, skillId: number): Promise<boolean> {
  const r = await pool.query(`DELETE FROM user_skills WHERE id = $1 AND user_id = $2`, [
    skillId,
    userId,
  ]);
  return (r.rowCount || 0) > 0;
}

export async function incrementUseCount(skillIds: number[]): Promise<void> {
  if (skillIds.length === 0) return;
  await pool.query(
    `UPDATE user_skills SET use_count = use_count + 1 WHERE id = ANY($1::int[])`,
    [skillIds]
  );
}

// ============================================================================
// Templates
// ============================================================================

export async function listSkillTemplates(): Promise<SkillTemplate[]> {
  const r = await pool.query<SkillTemplate>(
    `SELECT id, name, category, description, content_md, preview_image_url, is_featured
     FROM skill_templates
     ORDER BY is_featured DESC, name ASC`
  );
  return r.rows;
}

export async function getSkillTemplate(id: number): Promise<SkillTemplate | null> {
  const r = await pool.query<SkillTemplate>(
    `SELECT id, name, category, description, content_md, preview_image_url, is_featured
     FROM skill_templates WHERE id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

/**
 * Fork a template into the user's skill library.
 * Returns the created user_skill row.
 */
export async function forkTemplate(
  userId: number,
  templateId: number,
  overrideName?: string
): Promise<UserSkill> {
  const tpl = await getSkillTemplate(templateId);
  if (!tpl) throw new Error(`Template ${templateId} not found`);

  const desiredName = overrideName?.trim() || tpl.name;
  // If a skill with this name already exists for the user, append a suffix.
  const finalName = await ensureUniqueSkillName(userId, desiredName);

  return createUserSkill(userId, {
    name: finalName,
    description: tpl.description,
    content_md: tpl.content_md,
    source_template_id: tpl.id,
    is_default: false,
  });
}

async function ensureUniqueSkillName(userId: number, base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (true) {
    const r = await pool.query(
      `SELECT 1 FROM user_skills WHERE user_id = $1 AND name = $2 LIMIT 1`,
      [userId, candidate]
    );
    if (r.rowCount === 0) return candidate;
    n += 1;
    candidate = `${base} (${n})`;
  }
}

function extractTriggerKeywords(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.trigger_keywords;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
}
