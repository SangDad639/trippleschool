/**
 * ChatPane — conversational AI Agent UI.
 *
 * Streams assistant turn events via SSE. Renders assistant text + collapsible
 * tool-call cards (showing what the agent did and the result).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, Sparkles, Wrench, ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  api,
  type ChatThreadDto,
  type ChatMessageDto,
  type ChatStreamEventDto,
  type ChatThreadSummaryDto,
} from '@/lib/api';

interface Props {
  activeSkillIds: number[];
  activeSkillIdsKey: string;
}

interface DisplayBlock {
  kind: 'text' | 'tool_call';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOk?: boolean;
  toolSummary?: string;
  toolResult?: unknown;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  blocks: DisplayBlock[];
}

function messagesToDisplay(messages: ChatMessageDto[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, blocks: [{ kind: 'text', text: m.content }] });
      continue;
    }
    // Array of blocks (assistant tool_use, user tool_result)
    if (m.role === 'user') {
      // Tool results are technical noise — skip displaying as separate user bubbles
      const hasOnlyToolResults = m.content.every((b) => b.type === 'tool_result');
      if (hasOnlyToolResults) continue;
      // Mixed content (rare) — show only text parts
      const text = m.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
      if (text) out.push({ role: 'user', blocks: [{ kind: 'text', text }] });
      continue;
    }
    // Assistant: text + tool_use blocks
    const blocks: DisplayBlock[] = [];
    for (const b of m.content) {
      if (b.type === 'text' && b.text) {
        blocks.push({ kind: 'text', text: b.text });
      } else if (b.type === 'tool_use') {
        blocks.push({
          kind: 'tool_call',
          toolName: b.name,
          toolInput: b.input,
        });
      }
    }
    if (blocks.length > 0) out.push({ role: 'assistant', blocks });
  }
  return out;
}

export function ChatPane({ activeSkillIds, activeSkillIdsKey }: Props) {
  const [threads, setThreads] = useState<ChatThreadSummaryDto[]>([]);
  const [thread, setThread] = useState<ChatThreadDto | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingBlocks, setStreamingBlocks] = useState<DisplayBlock[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reloadThreads = async () => {
    try {
      const { items } = await api.chatThreadsList();
      setThreads(items);
    } catch (err: any) {
      toast.error(err?.message || 'โหลด threads ไม่สำเร็จ');
    }
  };

  useEffect(() => {
    reloadThreads();
  }, []);

  // When active skills change AND a thread is open, sync to backend.
  useEffect(() => {
    if (!thread) return;
    const cur = JSON.stringify([...thread.active_skill_ids].sort());
    const next = JSON.stringify([...activeSkillIds].sort());
    if (cur === next) return;
    (async () => {
      try {
        const { thread: updated } = await api.chatThreadPatch(thread.id, {
          active_skill_ids: activeSkillIds,
        });
        setThread(updated);
      } catch (err) {
        // non-critical — log silently
        console.warn('Failed to sync active skills to thread', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSkillIdsKey]);

  const openThread = async (id: number) => {
    try {
      const { thread: t } = await api.chatThreadGet(id);
      setThread(t);
      setStreamingBlocks([]);
    } catch (err: any) {
      toast.error(err?.message || 'โหลด thread ไม่สำเร็จ');
    }
  };

  const startNewThread = async () => {
    try {
      const { thread: t } = await api.chatThreadCreate({
        active_skill_ids: activeSkillIds,
      });
      setThread(t);
      setStreamingBlocks([]);
      await reloadThreads();
    } catch (err: any) {
      toast.error(err?.message || 'สร้าง thread ไม่สำเร็จ');
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;

    let currentThread = thread;
    if (!currentThread) {
      try {
        const { thread: t } = await api.chatThreadCreate({
          active_skill_ids: activeSkillIds,
        });
        currentThread = t;
        setThread(t);
      } catch (err: any) {
        toast.error(err?.message || 'สร้าง thread ไม่สำเร็จ');
        return;
      }
    }

    setDraft('');
    setStreaming(true);
    // Optimistically append user message to displayed thread
    setThread((prev) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, { role: 'user', content: text }],
          }
        : prev,
    );
    setStreamingBlocks([]);

    try {
      let currentText = '';
      let currentBlocks: DisplayBlock[] = [];
      const flushText = () => {
        if (currentText) {
          currentBlocks.push({ kind: 'text', text: currentText });
          currentText = '';
        }
      };

      for await (const ev of api.chatThreadSend(currentThread.id, text) as AsyncGenerator<ChatStreamEventDto>) {
        if (ev.type === 'text_delta' && ev.text) {
          currentText += ev.text;
          setStreamingBlocks([...currentBlocks, { kind: 'text', text: currentText }]);
        } else if (ev.type === 'tool_use_start') {
          flushText();
          currentBlocks.push({
            kind: 'tool_call',
            toolName: ev.name,
            toolInput: ev.input,
            toolOk: undefined,
            toolSummary: 'กำลังทำงาน...',
          });
          setStreamingBlocks([...currentBlocks]);
        } else if (ev.type === 'tool_use_result') {
          // Update the most recent tool_call block with the matching name
          for (let i = currentBlocks.length - 1; i >= 0; i -= 1) {
            const b = currentBlocks[i];
            if (b.kind === 'tool_call' && b.toolName === ev.name && b.toolOk === undefined) {
              currentBlocks[i] = {
                ...b,
                toolOk: ev.ok,
                toolSummary: ev.summary || (ev.ok ? '✅ done' : '❌ failed'),
                toolResult: ev.raw_result,
              };
              break;
            }
          }
          setStreamingBlocks([...currentBlocks]);
        } else if (ev.type === 'error') {
          toast.error(ev.message || 'Agent error');
        } else if (ev.type === 'done') {
          break;
        }
      }
      flushText();

      // Reload the full thread so the persisted message list is canonical.
      const { thread: refreshed } = await api.chatThreadGet(currentThread.id);
      setThread(refreshed);
      setStreamingBlocks([]);
      reloadThreads();
    } catch (err: any) {
      toast.error(err?.message || 'Chat error');
    } finally {
      setStreaming(false);
    }
  };

  useEffect(() => {
    // Auto-scroll to bottom on new content
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [thread?.messages.length, streamingBlocks.length]);

  const displayMessages = useMemo(
    () => (thread ? messagesToDisplay(thread.messages) : []),
    [thread],
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Thread list header */}
      <div className="flex items-center gap-2 mb-2">
        <Button size="sm" onClick={startNewThread} className="h-7">
          <Plus className="h-3.5 w-3.5 mr-1" /> สนทนาใหม่
        </Button>
        <div className="flex-1 overflow-x-auto flex gap-1.5 scrollbar-hide">
          {threads.slice(0, 8).map((t) => (
            <button
              key={t.id}
              onClick={() => openThread(t.id)}
              className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${
                thread?.id === t.id
                  ? 'border-[#FFB300]/60 bg-[#FFB300]/10 text-[#FFB300]'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-3 w-3 inline mr-1" />
              {t.title || `Thread #${t.id}`}
            </button>
          ))}
        </div>
      </div>

      {/* Messages scroll area */}
      <Card className="flex-1 flex flex-col min-h-[60vh] max-h-[75vh]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {!thread ? (
            <EmptyState onStart={startNewThread} hasSkills={activeSkillIds.length > 0} />
          ) : (
            <>
              {displayMessages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
              {streamingBlocks.length > 0 && (
                <MessageBubble message={{ role: 'assistant', blocks: streamingBlocks }} streaming />
              )}
              {streaming && streamingBlocks.length === 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> AI กำลังคิด...
                </div>
              )}
            </>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border p-3">
          <div className="flex gap-2 items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                activeSkillIds.length === 0
                  ? 'เลือก skill ก่อน หรือพิมพ์เพื่อใช้ default...'
                  : 'พิมพ์ที่นี่ — Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัด'
              }
              disabled={streaming}
              rows={2}
              className="flex-1 px-3 py-2 text-sm bg-muted/40 border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-[#FFB300]/50"
            />
            <Button
              onClick={send}
              disabled={streaming || !draft.trim()}
              className="bg-[#FFB300] hover:bg-[#FFB300]/80 text-black h-auto py-2"
            >
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          {activeSkillIds.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {activeSkillIds.length} skill active in this thread
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function EmptyState({ onStart, hasSkills }: { onStart: () => void; hasSkills: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <Sparkles className="h-12 w-12 text-[#FFB300] mb-3" />
      <h3 className="text-lg font-semibold mb-2">เริ่มแชทกับ AI Agent</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">
        บอก AI ว่าอยากทำคลิปเรื่องอะไร — AI จะใช้ <strong>skills</strong> ที่คุณเลือกไว้
        เพื่อวางแผน เขียนบท และเรียก pipeline เมื่อคุณยืนยัน
      </p>
      {!hasSkills && (
        <p className="text-xs text-yellow-500 mb-3">
          ⚠ ยังไม่มี skill active — fork template จาก sidebar ก่อน
        </p>
      )}
      <Button onClick={onStart} className="bg-[#FFB300] hover:bg-[#FFB300]/80 text-black">
        <Plus className="h-4 w-4 mr-1" /> เริ่มสนทนา
      </Button>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: DisplayMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-[#FFB300]/10 border border-[#FFB300]/30'
            : 'bg-muted/40 border border-border'
        }`}
      >
        {message.blocks.map((block, idx) =>
          block.kind === 'text' ? (
            <div
              key={idx}
              className="text-sm whitespace-pre-wrap break-words"
            >
              {block.text}
              {streaming && idx === message.blocks.length - 1 && (
                <span className="animate-pulse text-[#FFB300]">▍</span>
              )}
            </div>
          ) : (
            <ToolCallCard
              key={idx}
              name={block.toolName || ''}
              input={block.toolInput || {}}
              ok={block.toolOk}
              summary={block.toolSummary || ''}
              result={block.toolResult}
            />
          ),
        )}
      </div>
    </div>
  );
}

function ToolCallCard({
  name,
  input,
  ok,
  summary,
  result,
}: {
  name: string;
  input: Record<string, unknown>;
  ok: boolean | undefined;
  summary: string;
  result: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColor =
    ok === undefined
      ? 'text-yellow-500'
      : ok
        ? 'text-green-500'
        : 'text-red-500';
  return (
    <div className="my-1.5 border border-border/60 rounded-md bg-background/40">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full px-2 py-1.5 flex items-center gap-2 text-xs hover:bg-muted/30 transition"
      >
        <Wrench className={`h-3 w-3 ${statusColor}`} />
        <code className="text-[11px]">{name}</code>
        <span className="text-muted-foreground truncate flex-1 text-left">{summary}</span>
        <ChevronRight
          className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">Input</div>
            <pre className="text-[10px] bg-muted/50 p-1.5 rounded overflow-x-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Result</div>
              <pre className="text-[10px] bg-muted/50 p-1.5 rounded overflow-x-auto max-h-60 overflow-y-auto">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
