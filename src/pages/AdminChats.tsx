/**
 * Admin inbox for Agent Chat — conversations escalated to a human.
 * List + status filter badges + click row → thread dialog with reply box.
 * Backed by /api/agent-chat/admin/* (requireAdmin on the server).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type AgentChatMessageDto, type AgentChatConversationDto, type AgentKnowledgeDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ArrowLeft, MessagesSquare, Search, Send, Bot, Headset, User as UserIcon, Brain, Trash2, Plus } from 'lucide-react';

type ConvRow = AgentChatConversationDto & {
  user_email: string | null;
  last_message: string | null;
  last_sender: string | null;
  message_count: number;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ai: { label: 'คุยกับ AI', cls: 'bg-primary/15 text-primary border-primary/30' },
  escalated: { label: 'รอทีมงาน', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  answered: { label: 'ตอบแล้ว', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  closed: { label: 'ปิดแล้ว', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};

const AdminChats = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [statusFilter, setStatusFilter] = useState('escalated');
  const [search, setSearch] = useState('');

  // Thread dialog
  const [openConv, setOpenConv] = useState<ConvRow | null>(null);
  const [messages, setMessages] = useState<AgentChatMessageDto[]>([]);
  const [threadEmail, setThreadEmail] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);

  // Knowledge base dialog (คลังความรู้บอท)
  const [kbOpen, setKbOpen] = useState(false);
  const [kb, setKb] = useState<AgentKnowledgeDto[]>([]);
  const [kbTitle, setKbTitle] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbEditId, setKbEditId] = useState<number | null>(null);
  const [kbSaving, setKbSaving] = useState(false);

  const loadKb = async () => {
    try {
      const data = await api.agentChatKnowledgeList();
      setKb(data.knowledge);
    } catch (e: any) {
      toast.error(e?.message || 'โหลดคลังความรู้ไม่สำเร็จ');
    }
  };

  const saveKb = async () => {
    if (!kbTitle.trim() || !kbContent.trim() || kbSaving) return;
    try {
      setKbSaving(true);
      if (kbEditId) {
        await api.agentChatKnowledgeUpdate(kbEditId, { title: kbTitle.trim(), content: kbContent.trim() });
      } else {
        await api.agentChatKnowledgeCreate({ title: kbTitle.trim(), content: kbContent.trim() });
      }
      setKbTitle('');
      setKbContent('');
      setKbEditId(null);
      toast.success('บันทึกแล้ว — บอทใช้ความรู้นี้ทันที');
      loadKb();
    } catch (e: any) {
      toast.error(e?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setKbSaving(false);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await api.agentChatAdminList({ status: statusFilter, search: search || undefined });
      setRows(data.conversations);
      setCounts(data.counts || {});
    } catch (e: any) {
      toast.error(e?.message || 'โหลดรายการไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.isAdmin && !user?.isSuperAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter]);

  const openThread = async (row: ConvRow) => {
    setOpenConv(row);
    setMessages([]);
    try {
      const data = await api.agentChatAdminGet(row.id);
      setMessages(data.messages);
      setThreadEmail(data.user_email);
      if (data.conversation) setOpenConv({ ...row, ...data.conversation });
    } catch (e: any) {
      toast.error(e?.message || 'โหลดบทสนทนาไม่สำเร็จ');
    }
  };

  const sendReply = async () => {
    if (!openConv || !reply.trim() || replying) return;
    try {
      setReplying(true);
      const data = await api.agentChatAdminReply(openConv.id, reply.trim());
      setMessages(data.messages);
      if (data.conversation) setOpenConv({ ...openConv, ...data.conversation });
      setReply('');
      toast.success('ตอบกลับแล้ว');
    } catch (e: any) {
      toast.error(e?.message || 'ตอบกลับไม่สำเร็จ');
    } finally {
      setReplying(false);
    }
  };

  const setStatus = async (status: string) => {
    if (!openConv) return;
    try {
      await api.agentChatAdminSetStatus(openConv.id, status);
      setOpenConv({ ...openConv, status: status as any });
      load();
    } catch (e: any) {
      toast.error(e?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  };

  if (!user?.isAdmin && !user?.isSuperAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-gray-400">ต้องเป็นแอดมินเท่านั้น</p>
      </div>
    );
  }

  const filterButtons: Array<{ key: string; label: string; count?: number }> = [
    { key: 'escalated', label: 'รอทีมงาน', count: counts.escalated },
    { key: 'answered', label: 'ตอบแล้ว', count: counts.answered },
    { key: 'ai', label: 'คุยกับ AI', count: counts.ai },
    { key: 'closed', label: 'ปิดแล้ว', count: counts.closed },
    { key: 'all', label: 'ทั้งหมด', count: counts.total },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <Button variant="ghost" onClick={() => navigate('/admin')} className="mb-4 text-gray-400 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับหน้าแอดมิน
        </Button>

        <div className="flex items-center gap-2 mb-5">
          <MessagesSquare className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">แชทลูกค้า (Agent Chat)</h1>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => { setKbOpen(true); loadKb(); }}>
            <Brain className="h-4 w-4 mr-1.5 text-primary" />
            คลังความรู้บอท
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {filterButtons.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                statusFilter === f.key
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-card text-gray-400 border-border hover:text-white'
              }`}
            >
              {f.label}
              {typeof f.count === 'number' && <span className="ml-1.5 text-xs opacity-80">({f.count})</span>}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="ค้นหาอีเมล/ช่องทางติดต่อ..."
              className="h-9 w-56 text-sm"
            />
            <Button variant="outline" size="sm" className="h-9" onClick={load}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center text-gray-400">ไม่มีบทสนทนาในหมวดนี้</CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <Card
                key={row.id}
                className="cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => openThread(row)}
              >
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-white truncate">
                        {row.user_email || row.contact_info || `Guest ${String(row.guest_id || '').slice(0, 8)}`}
                      </span>
                      <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_LABEL[row.status]?.cls || ''}`}>
                        {STATUS_LABEL[row.status]?.label || row.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 truncate">
                      {row.last_sender === 'admin' ? '↩ ทีมงาน: ' : row.last_sender === 'ai' ? '🤖 ' : ''}
                      {row.last_message || '-'}
                    </p>
                    {row.escalate_reason && row.status === 'escalated' && (
                      <p className="text-[11px] text-yellow-400/90 truncate mt-0.5">เหตุผล: {row.escalate_reason}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[11px] text-gray-500">{new Date(row.last_message_at).toLocaleString('th-TH')}</p>
                    <p className="text-[11px] text-gray-500">{row.message_count} ข้อความ</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Thread dialog */}
      <Dialog open={!!openConv} onOpenChange={(o) => !o && setOpenConv(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessagesSquare className="h-4 w-4 text-primary" />
              <span className="truncate">
                {threadEmail || openConv?.contact_info || `Guest ${String(openConv?.guest_id || '').slice(0, 8)}`}
              </span>
              {openConv && (
                <Select value={openConv.status} onValueChange={setStatus}>
                  <SelectTrigger className="h-7 w-32 text-xs ml-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="escalated">รอทีมงาน</SelectItem>
                    <SelectItem value="answered">ตอบแล้ว</SelectItem>
                    <SelectItem value="ai">คืนให้ AI</SelectItem>
                    <SelectItem value="closed">ปิด</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </DialogTitle>
          </DialogHeader>

          {openConv?.escalate_reason && (
            <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2.5 py-1.5">
              เหตุผลที่ส่งต่อ: {openConv.escalate_reason}
            </p>
          )}

          <div className="max-h-[45vh] overflow-y-auto space-y-2.5 py-1 pr-1">
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2 ${m.sender_type === 'admin' ? 'justify-end' : ''}`}>
                {m.sender_type !== 'admin' && (
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${m.sender_type === 'ai' ? 'bg-primary/15' : 'bg-gray-500/20'}`}>
                    {m.sender_type === 'ai' ? <Bot className="h-3.5 w-3.5 text-primary" /> : <UserIcon className="h-3.5 w-3.5 text-gray-300" />}
                  </div>
                )}
                <div
                  className={`rounded-xl px-3 py-1.5 text-sm max-w-[80%] whitespace-pre-wrap break-words ${
                    m.sender_type === 'admin'
                      ? 'bg-green-500/15 text-green-100 border border-green-500/20'
                      : m.sender_type === 'ai'
                        ? 'bg-muted text-gray-300'
                        : 'bg-card border border-border text-white'
                  }`}
                >
                  {m.body}
                  <p className="text-[10px] text-gray-500 mt-0.5">{new Date(m.created_at).toLocaleString('th-TH')}</p>
                </div>
                {m.sender_type === 'admin' && (
                  <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                    <Headset className="h-3.5 w-3.5 text-green-400" />
                  </div>
                )}
              </div>
            ))}
            {messages.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto my-6" />}
          </div>

          <div className="flex gap-2 items-end">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="พิมพ์คำตอบถึงลูกค้า..."
              rows={2}
              className="text-sm"
            />
            <Button onClick={sendReply} disabled={replying || !reply.trim()} className="h-9">
              {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Knowledge base dialog (คลังความรู้บอท) */}
      <Dialog open={kbOpen} onOpenChange={setKbOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Brain className="h-4 w-4 text-primary" />
              คลังความรู้บอท
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            เพิ่มความรู้/FAQ ให้บอทใช้ตอบ (เช่น มี certificate ไหม, โปรโมชัน, ช่องทางติดต่อ) — บอทเห็นทันที ไม่ต้องแก้โค้ด
          </p>

          {/* Add / edit form */}
          <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/30">
            <Input
              value={kbTitle}
              onChange={(e) => setKbTitle(e.target.value)}
              placeholder="หัวข้อ เช่น เรียนจบได้ certificate ไหม"
              className="h-9 text-sm"
            />
            <Textarea
              value={kbContent}
              onChange={(e) => setKbContent(e.target.value)}
              placeholder="เนื้อหาคำตอบที่อยากให้บอทรู้..."
              rows={3}
              className="text-sm"
            />
            <div className="flex gap-2 justify-end">
              {kbEditId && (
                <Button variant="ghost" size="sm" onClick={() => { setKbEditId(null); setKbTitle(''); setKbContent(''); }}>
                  ยกเลิกแก้ไข
                </Button>
              )}
              <Button size="sm" onClick={saveKb} disabled={kbSaving || !kbTitle.trim() || !kbContent.trim()}>
                {kbSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                {kbEditId ? 'บันทึกแก้ไข' : 'เพิ่มความรู้'}
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[40vh] overflow-y-auto space-y-1.5">
            {kb.length === 0 && <p className="text-sm text-gray-500 text-center py-4">ยังไม่มีความรู้ — เพิ่มรายการแรกได้เลย</p>}
            {kb.map((k) => (
              <div
                key={k.id}
                className={`flex items-start gap-2 border border-border rounded-lg px-3 py-2 ${!k.is_active ? 'opacity-50' : ''}`}
              >
                <button
                  className="flex-1 text-left min-w-0"
                  onClick={() => { setKbEditId(k.id); setKbTitle(k.title); setKbContent(k.content); }}
                  title="คลิกเพื่อแก้ไข"
                >
                  <p className="text-sm font-medium text-white truncate">{k.title}</p>
                  <p className="text-xs text-gray-400 line-clamp-2">{k.content}</p>
                </button>
                <button
                  onClick={async () => {
                    await api.agentChatKnowledgeUpdate(k.id, { is_active: !k.is_active });
                    loadKb();
                  }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 ${k.is_active ? 'text-green-400 border-green-500/40' : 'text-gray-500 border-gray-600'}`}
                >
                  {k.is_active ? 'เปิด' : 'ปิด'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`ลบ "${k.title}"?`)) return;
                    await api.agentChatKnowledgeDelete(k.id);
                    loadKb();
                  }}
                  className="text-red-400/70 hover:text-red-400 flex-shrink-0 p-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminChats;
