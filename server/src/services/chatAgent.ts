/**
 * Chat AI Agent — Anthropic tool-use loop for the conversational pipeline UI.
 *
 * The agent receives:
 *   - chat history (user + assistant messages, including past tool calls)
 *   - the user's active skills (composed into a system prompt prefix)
 *   - the user's LLM keys (anthropic preferred, openrouter not yet supported
 *     for tool use here — Phase 2)
 *
 * Each turn:
 *   1. Send messages + tools to Claude
 *   2. If response has stop_reason="tool_use" → execute tool(s) → loop
 *   3. If stop_reason="end_turn" → emit final assistant text and stop
 *
 * Stream events (consumed by SSE / WebSocket on the frontend):
 *   - { type: 'text_delta', text }            → assistant text token
 *   - { type: 'tool_use_start', name, input } → tool call beginning
 *   - { type: 'tool_use_result', name, ok, summary }
 *   - { type: 'turn_end', usage }
 *   - { type: 'error', message }
 */
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFS, runTool, type ToolContext } from './agentTools.js';
import {
  composeSkillsContext,
  getUserSkillsByIds,
  incrementUseCount,
  type UserSkill,
} from './skillsService.js';
import type { LlmKeys } from './storyAgentLLM.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_TOOL_TURNS = 12; // hard cap to prevent runaway loops

export interface ChatMessage {
  role: 'user' | 'assistant';
  // Anthropic content blocks (string for simple text, array for tool_use/tool_result)
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | {
            type: 'tool_result';
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }
      >;
}

export interface ChatStreamEvent {
  type:
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_use_result'
    | 'turn_end'
    | 'error'
    | 'final_message';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  ok?: boolean;
  summary?: string;
  raw_result?: unknown;
  usage?: { input_tokens: number; output_tokens: number };
  message?: string;
  // Final assistant message (full assembled content) emitted at turn_end so
  // the caller can persist it to chat_threads.
  assistant_message?: ChatMessage;
}

export interface RunChatArgs {
  userId: number;
  activeSkillIds: number[];
  history: ChatMessage[];
  newUserMessage: string;
  llmKeys: LlmKeys;
  onEvent: (event: ChatStreamEvent) => void;
}

const SYSTEM_PROMPT_BASE = `คุณเป็น AI Agent ของระบบ TripleSchool สำหรับช่วย user สร้างคลิป Reels/Shorts ผ่านการแชท

## บทบาทของคุณ

- คุยกับ user เป็นภาษาไทยเป็นหลัก (ใช้อังกฤษเฉพาะตอนต้องส่งให้ image model)
- ก่อนทำงาน อ่าน "Active skills" ด้านล่างให้ครบ — skills คือคู่มือการทำคลิปสไตล์ต่างๆ ที่ user เก็บไว้
- ใช้ tools ที่มีอย่างเหมาะสม:
  - generate_idea → สร้างไอเดียก่อน show ให้ user ดู แล้วถามว่า OK ไหม
  - generate_script → เขียนบทตามไอเดียที่ user ยืนยัน ใช้ scene_count + structure จาก active skill
  - create_pipeline_job → trigger pipeline จริงเฉพาะตอน user ยืนยันให้ทำคลิปเต็ม (เปลือง credit)
  - check_pipeline_status → ดูความคืบหน้าเมื่อ user ถาม
- ห้าม trigger create_pipeline_job โดยไม่ได้ confirm ก่อน
- ถ้า user ขอคลิปแนวที่ active skill ไม่ตรง → suggest skill อื่นที่เหมาะกว่า (เรียก list_my_skills ก่อน)

## หลักการเล่าเรื่อง

- ทำตาม "Active skills" เป็นหลัก — ถ้า skill บอก "Hook 3 ชั้น + Catchphrase repeat" ต้องทำตามทุกข้อ
- ถ้าไม่มี active skill ใช้สามัญสำนึก: Hook สั้น + 3-act + CTA ปิด
- แสดง idea/script ที่ generate ออกมาให้ user ดู — ใช้ markdown formatting

## ข้อจำกัด

- ห้ามแต่งข้อมูลขึ้นเอง — ถ้าไม่แน่ใจให้ถาม user ก่อน
- เรื่องเล่า/ตำนาน ใช้คำว่า "เล่ากันว่า" "ตามตำนาน" ไม่รับประกันผลเกินจริง`;

function buildSystemPrompt(skillsContext: ReturnType<typeof composeSkillsContext>): string {
  if (skillsContext.activeNames.length === 0) {
    return `${SYSTEM_PROMPT_BASE}\n\n## Active skills\n\n(no skills active — using defaults)`;
  }
  const fmJson = JSON.stringify(skillsContext.mergedFrontmatter, null, 2);
  return `${SYSTEM_PROMPT_BASE}

## Active skills (${skillsContext.activeNames.join(', ')})

### Merged pipeline parameters
\`\`\`json
${fmJson}
\`\`\`

### Combined skill instructions
${skillsContext.combinedBody}`;
}

/**
 * Run a full chat turn:
 *   - ingest the new user message
 *   - drive Claude through tool calls until end_turn
 *   - emit stream events along the way
 *
 * Returns the updated message history (caller persists to chat_threads).
 */
export async function runChatTurn(args: RunChatArgs): Promise<ChatMessage[]> {
  const { userId, activeSkillIds, history, newUserMessage, llmKeys, onEvent } = args;

  if (!llmKeys.anthropic) {
    // For MVP tool-use we require native Anthropic. OpenRouter tool_use across
    // providers is too inconsistent to rely on.
    onEvent({
      type: 'error',
      message:
        'Anthropic API key required for chat mode (OpenRouter tool-use coming Phase 2). Set ANTHROPIC_API_KEY in Settings.',
    });
    throw new Error('Anthropic key missing');
  }

  const activeSkills = await getUserSkillsByIds(userId, activeSkillIds);
  const skillsContext = composeSkillsContext(activeSkills);
  const systemPrompt = buildSystemPrompt(skillsContext);

  const client = new Anthropic({ apiKey: llmKeys.anthropic });

  // Build the messages array — history + the new user turn.
  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', content: newUserMessage },
  ];

  const toolCtx: ToolContext = {
    userId,
    llmKeys,
    activeSkills,
    mergedFrontmatter: skillsContext.mergedFrontmatter,
  };

  let turn = 0;
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  while (turn < MAX_TOOL_TURNS) {
    turn += 1;

    // Cast: Anthropic SDK types are stricter than our union — we control the
    // shape so we know it's valid at runtime.
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: TOOL_DEFS as unknown as Anthropic.Tool[],
      messages: messages as unknown as Anthropic.MessageParam[],
    });

    totalUsage.input_tokens += resp.usage.input_tokens;
    totalUsage.output_tokens += resp.usage.output_tokens;

    // Re-assemble the assistant message from content blocks and emit text deltas.
    const assistantContent: ChatMessage['content'] = [];
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const block of resp.content) {
      if (block.type === 'text') {
        assistantContent.push({ type: 'text', text: block.text });
        onEvent({ type: 'text_delta', text: block.text });
      } else if (block.type === 'tool_use') {
        const input = (block.input as Record<string, unknown>) || {};
        assistantContent.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input,
        });
        toolUses.push({ id: block.id, name: block.name, input });
      }
    }

    messages.push({ role: 'assistant', content: assistantContent });

    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // Done — emit final state and return.
      if (activeSkillIds.length > 0) {
        incrementUseCount(activeSkillIds).catch(() => {});
      }
      onEvent({
        type: 'turn_end',
        usage: totalUsage,
        assistant_message: { role: 'assistant', content: assistantContent },
      });
      return messages;
    }

    // Execute every tool the model requested in this turn (Claude may emit
    // multiple tool_use blocks in one response — must answer them all).
    const toolResults: Extract<
      ChatMessage['content'],
      Array<unknown>
    >[number][] = [];

    for (const tu of toolUses) {
      onEvent({ type: 'tool_use_start', name: tu.name, input: tu.input });
      const result = await runTool(tu.name, tu.input, toolCtx);
      const summary = summarizeToolResult(tu.name, result);
      onEvent({
        type: 'tool_use_result',
        name: tu.name,
        ok: result.ok,
        summary,
        raw_result: result.data,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        is_error: !result.ok,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  onEvent({
    type: 'error',
    message: `Tool-use loop exceeded ${MAX_TOOL_TURNS} turns — bailing out`,
  });
  return messages;
}

/**
 * Short human-readable summary of a tool result for the UI event stream.
 * Full data is shipped separately in raw_result.
 */
function summarizeToolResult(
  name: string,
  result: { ok: boolean; data?: unknown; error?: string }
): string {
  if (!result.ok) return `❌ ${name}: ${result.error}`;
  switch (name) {
    case 'list_my_skills': {
      const arr = result.data as Array<{ name: string }>;
      return `✅ Found ${arr.length} skill(s): ${arr
        .slice(0, 5)
        .map((s) => s.name)
        .join(', ')}${arr.length > 5 ? '…' : ''}`;
    }
    case 'read_skill_content': {
      const d = result.data as { name: string };
      return `✅ Loaded skill "${d.name}"`;
    }
    case 'generate_idea': {
      const d = result.data as { title?: string };
      return `💡 Idea: ${d.title || '(untitled)'}`;
    }
    case 'generate_script': {
      const d = result.data as { lines?: unknown[] };
      return `✍️ Script: ${d.lines?.length ?? 0} lines`;
    }
    case 'create_pipeline_job': {
      const d = result.data as { job_id: number; scene_count: number };
      return `🚀 Job #${d.job_id} created with ${d.scene_count} scenes`;
    }
    case 'check_pipeline_status': {
      const d = result.data as { job: { current_stage: string; status: string } };
      return `📊 Stage: ${d.job.current_stage} (${d.job.status})`;
    }
    default:
      return `✅ ${name}`;
  }
}

// Exported for tests / use externally if needed.
export { UserSkill };
