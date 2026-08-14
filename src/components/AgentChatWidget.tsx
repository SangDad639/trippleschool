import { useEffect, useRef, useState } from 'react';
import { api, type AgentChatThreadDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, X, Send, Loader2, Bot, Headset } from 'lucide-react';

// Guest identity survives reloads; logged-in users are keyed by their token.
function getGuestId(): string {
  let g = localStorage.getItem('agent_chat_guest_id');
  if (!g) {
    g = crypto.randomUUID();
    localStorage.setItem('agent_chat_guest_id', g);
  }
  return g;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ai: { label: 'AI', cls: 'bg-primary/15 text-primary border border-primary/30' },
  escalated: { label: 'รอทีมงานตอบ', cls: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30' },
  answered: { label: 'ทีมงานตอบแล้ว', cls: 'bg-green-500/15 text-green-400 border border-green-500/30' },
  closed: { label: 'ปิดแล้ว', cls: 'bg-gray-500/15 text-gray-400 border border-gray-500/30' },
};

interface AgentChatWidgetProps {
  /** The course this chat session is scoped to — one thread per course. */
  courseId: number;
  courseName: string;
}

const AgentChatWidget = ({ courseId, courseName }: AgentChatWidgetProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<AgentChatThreadDto>({ conversation: null, messages: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const guestId = user ? undefined : getGuestId();
  const conv = thread.conversation;

  const load = async () => {
    try {
      const data = await api.agentChatGetConversation(courseId, guestId);
      setThread(data);
      return data;
    } catch {
      return null;
    }
  };

  // Initial load once per identity/course (badge state even before first open).
  useEffect(() => {
    setThread({ conversation: null, messages: [] });
    load().then((data) => {
      if (data) lastCountRef.current = data.messages.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, courseId]);

  // Poll while waiting on a human: 10s when the panel is open, 30s when closed.
  useEffect(() => {
    if (!conv || conv.status === 'ai' || conv.status === 'closed') return;
    const interval = setInterval(async () => {
      const data = await load();
      if (data && data.messages.length > lastCountRef.current) {
        if (!open) setUnread(true);
        lastCountRef.current = data.messages.length;
      }
    }, open ? 10000 : 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.status, open]);

  // Autoscroll on new messages.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [open, thread.messages.length, sending]);

  const handleOpen = () => {
    setOpen(true);
    setUnread(false);
    load();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    // Optimistic bubble while the AI thinks.
    setThread((t) => ({
      ...t,
      messages: [...t.messages, { id: -1, sender_type: 'user', body: text, created_at: new Date().toISOString() }],
    }));
    try {
      const data = await api.agentChatSend({
        conversation_id: conv?.id,
        guest_id: guestId,
        course_id: courseId,
        text,
      });
      setThread(data);
      lastCountRef.current = data.messages.length;
    } catch (e: any) {
      setThread((t) => ({
        ...t,
        messages: [
          ...t.messages,
          {
            id: -2,
            sender_type: 'ai',
            body: e?.message || 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
            created_at: new Date().toISOString(),
          },
        ],
      }));
    } finally {
      setSending(false);
    }
  };

  const handleEscalate = async () => {
    if (!conv || sending) return;
    try {
      const data = await api.agentChatEscalate({ conversation_id: conv.id, guest_id: guestId });
      setThread(data);
      lastCountRef.current = data.messages.length;
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={handleOpen}
          aria-label="เปิดแชทผู้ช่วย"
          className="fixed bottom-4 right-4 z-[60] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
        >
          <MessageCircle className="h-6 w-6" />
          {unread && <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background" />}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-4 left-2 right-2 sm:left-auto sm:right-4 sm:w-[380px] z-[60] h-[560px] max-h-[calc(100dvh-2rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/5">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">น้องทริปเปิ้ล</p>
              <p className="text-[11px] text-muted-foreground truncate">ผู้ช่วยคอร์ส: {courseName}</p>
            </div>
            {conv && (
              <Badge className={`text-[10px] px-2 py-0.5 ${STATUS_BADGE[conv.status]?.cls || ''}`}>
                {STATUS_BADGE[conv.status]?.label || conv.status}
              </Badge>
            )}
            <button onClick={() => setOpen(false)} aria-label="ปิดแชท" className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {thread.messages.length === 0 && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground max-w-[80%]">
                  สวัสดีค่ะ 👋 ถามได้เลยเกี่ยวกับคอร์ส "{courseName}" — เนื้อหาที่สอน ราคา หรือวิธีสมัครค่ะ
                </div>
              </div>
            )}
            {thread.messages.map((m, idx) => (
              <div key={`${m.id}-${idx}`} className={`flex gap-2 ${m.sender_type === 'user' ? 'justify-end' : ''}`}>
                {m.sender_type !== 'user' && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${m.sender_type === 'admin' ? 'bg-green-500/15' : 'bg-primary/15'}`}>
                    {m.sender_type === 'admin' ? <Headset className="h-4 w-4 text-green-400" /> : <Bot className="h-4 w-4 text-primary" />}
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words ${
                    m.sender_type === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted text-foreground rounded-tl-sm'
                  }`}
                >
                  {m.sender_type === 'admin' && (
                    <p className="text-[10px] font-semibold text-green-400 mb-0.5">ทีมงาน</p>
                  )}
                  {m.body}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-2.5 space-y-1.5">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="พิมพ์ข้อความ..."
                disabled={sending}
                className="h-9 text-sm"
              />
              <Button onClick={handleSend} disabled={sending || !input.trim()} size="sm" className="h-9 px-3">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {conv && conv.status === 'ai' && (
              <button
                onClick={handleEscalate}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                🙋 คุยกับแอดมิน
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default AgentChatWidget;
