import { useEffect, useRef, useState } from 'react';
import { api, type AgentChatThreadDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, Send, Loader2, Bot, Headset, ImagePlus } from 'lucide-react';

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

// บับเบิลทักทายโผล่ครั้งเดียวตลอดไป — กด ✕ หรือเปิดแชทแล้วจะไม่โผล่อีก
const GREETING_DISMISSED_KEY = 'agent_chat_greeting_dismissed';

const AgentChatWidget = ({ courseId, courseName }: AgentChatWidgetProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [thread, setThread] = useState<AgentChatThreadDto>({ conversation: null, messages: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [unread, setUnread] = useState(false);
  const [attachedImage, setAttachedImage] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
  }, [open, thread.messages.length, sending, streamingText]);

  // โผล่บับเบิลหลังเข้าหน้า 2.5 วิ เฉพาะคนที่ยังไม่เคยปิด/เปิดแชท
  useEffect(() => {
    if (localStorage.getItem(GREETING_DISMISSED_KEY)) return;
    const t = setTimeout(() => setShowGreeting(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const dismissGreeting = () => {
    setShowGreeting(false);
    localStorage.setItem(GREETING_DISMISSED_KEY, '1');
  };

  const handleOpen = () => {
    dismissGreeting();
    setOpen(true);
    setUnread(false);
    load();
  };

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      setThread((t) => ({
        ...t,
        messages: [
          ...t.messages,
          { id: -3, sender_type: 'ai', body: 'รูปใหญ่เกิน 5MB ค่ะ ลองย่อรูปแล้วส่งใหม่นะคะ', created_at: new Date().toISOString() },
        ],
      }));
      return;
    }
    setAttachedImage(file);
    setAttachedPreview(URL.createObjectURL(file));
  };

  const clearAttachment = () => {
    if (attachedPreview) URL.revokeObjectURL(attachedPreview);
    setAttachedImage(null);
    setAttachedPreview('');
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !attachedImage) || sending) return;
    const image = attachedImage;
    const preview = attachedPreview;
    setInput('');
    setAttachedImage(null);
    setAttachedPreview('');
    setSending(true);
    // Optimistic bubble while the AI thinks.
    setThread((t) => ({
      ...t,
      messages: [
        ...t.messages,
        { id: -1, sender_type: 'user', body: text || '(ส่งรูปภาพ)', image_url: preview || null, created_at: new Date().toISOString() },
      ],
    }));
    try {
      const payload = {
        conversation_id: conv?.id,
        guest_id: guestId,
        course_id: courseId,
        text,
        image: image ?? undefined,
      };
      let data: AgentChatThreadDto;
      try {
        // Streaming first — the reply types itself out live.
        setStreamingText('');
        data = await api.agentChatSendStream(payload, (chunk) => setStreamingText((s) => s + chunk));
      } catch {
        // Any stream failure → plain request (identical behavior, just slower).
        setStreamingText('');
        data = await api.agentChatSend(payload);
      }
      setStreamingText('');
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

  const handleBackToAi = async () => {
    if (!conv || sending) return;
    try {
      const data = await api.agentChatBackToAi({ conversation_id: conv.id, guest_id: guestId });
      setThread(data);
      lastCountRef.current = data.messages.length;
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {/* บับเบิลทักทาย — ครั้งเดียวตลอดไปจนกว่าจะกดปิดหรือเปิดแชท */}
      {!open && showGreeting && (
        <div className="fixed bottom-24 sm:bottom-28 right-4 z-[60] max-w-[260px] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div
            onClick={handleOpen}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
            className="relative bg-card border border-border rounded-2xl rounded-br-sm shadow-xl px-4 py-3 pr-8 cursor-pointer hover:border-primary/50 transition-colors"
          >
            <p className="text-sm text-foreground leading-relaxed">
              สวัสดีค่ะ 👋 มีคำถามเรื่องคอร์สนี้ ถาม<span className="font-semibold text-primary">น้องทริปเปิ้ล</span>ได้เลยนะคะ
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissGreeting();
              }}
              aria-label="ปิดข้อความทักทาย"
              className="absolute top-1.5 right-1.5 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {/* หางชี้ลงหาปุ่ม */}
            <span className="absolute -bottom-1.5 right-6 w-3 h-3 bg-card border-b border-r border-border rotate-45" />
          </div>
        </div>
      )}

      {/* FAB */}
      {!open && (
        <button
          onClick={handleOpen}
          aria-label="เปิดแชทผู้ช่วย"
          // safe-area: กันปุ่มทับแถบ home indicator ของ iPhone
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          className="fixed bottom-4 right-4 z-[60] w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-full bg-gradient-to-br from-primary to-fuchsia-600 text-primary-foreground shadow-xl shadow-primary/50 flex items-center justify-center hover:scale-110 transition-transform"
        >
          {/* วงแหวน pulse เรียกสายตา (ปิดเองเมื่อผู้ใช้ตั้งค่าลดการเคลื่อนไหว) */}
          <span
            className="absolute inset-0 rounded-full bg-primary/40 animate-ping motion-reduce:hidden pointer-events-none"
            style={{ animationDuration: '2.5s' }}
          />
          <Bot className="h-8 w-8 sm:h-9 sm:w-9 relative" />
          {unread && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 border-2 border-background" />}
        </button>
      )}

      {/* Panel */}
      {open && (
        <>
        {/* ฉากหลังเฉพาะมือถือ: แผงกินจอเกือบเต็ม — กันเผลอเลื่อน/กดหน้าเบื้องหลัง + กดปิดได้ */}
        <div className="fixed inset-0 z-[55] bg-black/50 sm:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
        <div
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
          className="fixed bottom-4 left-2 right-2 sm:left-auto sm:right-4 sm:w-[380px] z-[60] h-[560px] max-h-[calc(100dvh-2rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden"
        >
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
                  สวัสดีค่ะ 👋 อยากรู้อะไรเกี่ยวกับคอร์ส "{courseName}" ถามน้องทริปเปิ้ลได้เลยนะคะ — เนื้อหาที่สอน ราคา หรือวิธีสมัครก็ได้ค่ะ
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
                  {m.image_url && (
                    <img
                      src={m.image_url.startsWith('blob:') ? m.image_url : api.mediaUrl(m.image_url)}
                      alt="รูปที่แนบ"
                      className="rounded-lg mb-1.5 max-h-44 w-auto max-w-full"
                    />
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
                {streamingText ? (
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground max-w-[80%] whitespace-pre-wrap break-words">
                    {streamingText}
                    <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-primary/70 animate-pulse" />
                  </div>
                ) : (
                  /* จุดสามจุดเด้งแบบ "กำลังพิมพ์" — ให้ความรู้สึกมีคนอยู่ปลายแชทมากกว่า spinner */
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-3" aria-label="กำลังพิมพ์">
                    <span className="flex items-center gap-1 motion-reduce:hidden">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-bounce"
                          style={{ animationDelay: `${delay}ms`, animationDuration: '1s' }}
                        />
                      ))}
                    </span>
                    <span className="hidden motion-reduce:inline text-xs text-muted-foreground">กำลังพิมพ์...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-2.5 space-y-1.5">
            {attachedPreview && (
              <div className="flex items-center gap-2">
                <img src={attachedPreview} alt="รูปที่จะส่ง" className="h-12 w-12 object-cover rounded-md border border-border" />
                <span className="text-[11px] text-muted-foreground flex-1 truncate">แนบรูปแล้ว — พิมพ์คำถามได้เลย</span>
                <button onClick={clearAttachment} aria-label="เอารูปออก" className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => imageInputRef.current?.click()}
                disabled={sending}
                aria-label="แนบรูปภาพ"
                className="h-9 px-2 text-muted-foreground hover:text-foreground"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
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
                className="h-11 md:h-9"
              />
              <Button onClick={handleSend} disabled={sending || (!input.trim() && !attachedImage)} size="sm" className="h-11 md:h-9 px-3">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handlePickImage} />
            {conv && conv.status === 'ai' && (
              <button
                onClick={handleEscalate}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                🙋 คุยกับแอดมิน
              </button>
            )}
            {conv && (conv.status === 'escalated' || conv.status === 'answered') && (
              <button
                onClick={handleBackToAi}
                className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                🤖 กลับไปคุยกับน้องทริปเปิ้ล
              </button>
            )}
          </div>
        </div>
        </>
      )}
    </>
  );
};

export default AgentChatWidget;
