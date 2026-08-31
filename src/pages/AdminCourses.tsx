import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sanitizeMaterialHtml } from '@/lib/sanitizeMaterialHtml';
import { MaterialHtmlFrame } from '@/components/MaterialHtmlFrame';
import { api, type TagDto } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  GraduationCap,
  Users,
  Star,
  Clapperboard,
  ChevronUp,
  ChevronDown,
  Youtube,
  FolderOpen,
  Layers,
  Upload,
  ImageIcon,
  ArrowLeft,
  FileText,
  Link2,
  X,
  Eye,
  CheckCircle2,
} from 'lucide-react';

interface Course {
  id: number;
  name: string;
  slug: string;
  description: string;
  short_description: string;
  thumbnail_url: string;
  instructor_name: string;
  instructor_avatar: string;
  difficulty: string;
  duration_hours: number;
  total_lessons: number;
  is_featured: boolean;
  /** คอร์สฟรี: ทุกบทดูได้ไม่ต้อง login — flag ชัดเจน ไม่ผูกกับราคา */
  is_free?: boolean;
  /** ปักขึ้น Billboard หน้าแรกเอง (ได้ครั้งละ 1 คอร์ส); ไม่ปัก = ใช้คอร์สล่าสุดอัตโนมัติ */
  is_billboard?: boolean;
  /** ชื่อย่อขึ้นเมนู header (join จากตาราง tags) */
  tag?: string | null;
  tag_id?: number | null;
  /** ชื่อย่อของ Tip เอง (แสดงใน UI แทน title ที่ยาว) */
  tag_name?: string | null;
  is_active: boolean;
  display_order: number;
  created_at?: string;
  lesson_count: number;
  enrollment_count: number;
  price: number;
  discount_price: number | null;
  content_type?: 'course' | 'tip';
  learning_outcomes?: string[];
  requirements?: string[];
  tools?: CourseTool[];
}

/** เครื่องมือที่ใช้ในคอร์ส — price เป็นข้อความอิสระ (เช่น "฿250/เดือน", "ฟรี") */
interface CourseTool {
  name: string;
  price: string;
}

interface Section {
  id: number;
  course_id: number;
  title: string;
  description: string;
  mode?: 'basic' | 'update';
  section_order: number;
  is_active: boolean;
  lessons: Lesson[];
}

interface LessonMaterial {
  title: string;
  url: string;
  type: 'link' | 'pdf' | 'html';
  enabled?: boolean;
  content?: string;
  fileName?: string;
  /** Set by list payloads whose html content was stripped (fetch full before editing). */
  has_content?: boolean;
}

interface Lesson {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  description: string;
  youtube_url: string;
  youtube_id: string;
  duration_minutes: number;
  lesson_order: number;
  is_preview: boolean;
  is_active: boolean;
  cover_url?: string | null;
  materials?: LessonMaterial[];
}

const initialCourseForm = {
  name: '',
  slug: '',
  description: '',
  short_description: '',
  thumbnail_url: '',
  instructor_name: '',
  instructor_avatar: '',
  difficulty: 'beginner',
  duration_hours: 0,
  is_featured: false,
  is_free: false,
  display_order: 0,
  price: 0,
  discount_price: null as number | null,
  content_type: 'course' as 'course' | 'tip',
  tag_id: null as number | null,
  tag_name: '',
  learning_outcomes: [] as string[],
  requirements: [] as string[],
  tools: [] as CourseTool[],
};

const initialLessonForm = {
  title: '',
  description: '',
  youtube_url: '',
  duration_minutes: 0,
  is_preview: false,
  section_id: null as number | null,
  materials: [] as LessonMaterial[],
};

const initialSectionForm = {
  title: '',
  description: '',
  mode: 'basic' as 'basic' | 'update',
};

// Reusable add/edit/remove bullet-list editor for string[] fields.
const BulletListEditor = ({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) => {
  const update = (idx: number, value: string) => {
    const next = [...items];
    next[idx] = value;
    onChange(next);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () => onChange([...items, '']);

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 space-y-2">
        {items.length === 0 && (
          <p className="text-gray-500 text-sm">ยังไม่มีรายการ — กดปุ่มด้านล่างเพื่อเพิ่ม</p>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => update(idx, e.target.value)}
              placeholder={placeholder}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 flex-shrink-0"
              onClick={() => remove(idx)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-1" />
          เพิ่มรายการ
        </Button>
      </div>
    </div>
  );
};

// เครื่องมือที่ใช้ในคอร์ส — แถวละ 2 ช่อง (ชื่อ + ราคาเริ่มต้นแบบข้อความอิสระ)
// ลูกค้าเห็นเป็นการ์ดบนหน้าคอร์ส พร้อมหมายเหตุตายตัว "คิดตามเครดิต/แพ็กเกจรายเดือน"
const ToolsEditor = ({
  items,
  onChange,
}: {
  items: CourseTool[];
  onChange: (items: CourseTool[]) => void;
}) => {
  const update = (idx: number, patch: Partial<CourseTool>) =>
    onChange(items.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () => onChange([...items, { name: '', price: '' }]);

  return (
    <div>
      <Label>🛠️ เครื่องมือที่ใช้ในคอร์ส</Label>
      <p className="text-gray-500 text-xs mt-0.5">
        ลูกค้าจะเห็นบนหน้าคอร์ส พร้อมหมายเหตุ "ราคาเริ่มต้นคิดตามเครดิต / แพ็กเกจรายเดือน"
      </p>
      <div className="mt-2 space-y-2">
        {items.length === 0 && (
          <p className="text-gray-500 text-sm">ยังไม่มีเครื่องมือ — กดปุ่มด้านล่างเพื่อเพิ่ม</p>
        )}
        {items.map((tool, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              value={tool.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              placeholder="ชื่อเครื่องมือ เช่น CapCut"
              className="flex-1"
            />
            <Input
              value={tool.price}
              onChange={(e) => update(idx, { price: e.target.value })}
              placeholder="ราคาเริ่มต้น เช่น ฿250/เดือน หรือ ฟรี"
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 flex-shrink-0"
              onClick={() => remove(idx)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-4 w-4 mr-1" />
          เพิ่มเครื่องมือ
        </Button>
      </div>
    </div>
  );
};

const AdminCourses = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // ซับไตเติลบอท dialog
  const [subDialogCourse, setSubDialogCourse] = useState<Course | null>(null);
  const [subLessons, setSubLessons] = useState<
    Array<{
      lesson_id: number;
      title: string;
      lesson_order: number;
      has_youtube: boolean;
      has_sub: boolean;
      chars: number;
      too_short: boolean;
      language: string | null;
      fetched_at: string | null;
      last_status: 'ok' | 'no_captions' | 'too_short' | 'failed' | null;
      last_reason: string | null;
      last_detail: string | null;
      last_attempt_at: string | null;
    }>
  >([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subBusy, setSubBusy] = useState<number | 'bulk' | null>(null);
  const [syncingMissing, setSyncingMissing] = useState(false);
  // คลัง tag (ชื่อย่อขึ้นเมนู header) — ใช้ทั้งช่องเลือกใน dialog และหน้าจัดการ
  const [tags, setTags] = useState<TagDto[]>([]);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  // ผลตรวจการเชื่อมต่อ YouTube ของเซิร์ฟเวอร์ — ใช้แยก "ระบบดึงไม่ได้" ออกจาก "คลิปไม่มีซับ"
  const [ytHealth, setYtHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [ytHealthChecking, setYtHealthChecking] = useState(false);
  const subFileRef = useRef<HTMLInputElement>(null);
  const subUploadTargetRef = useRef<number | null>(null);

  // ปกคลิป (episode cover)
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverRev, setCoverRev] = useState(0); // bump = force-refresh preview img
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  // Course dialog
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState(initialCourseForm);

  // Lesson dialog
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [lessonForm, setLessonForm] = useState(initialLessonForm);
  const [selectedCourseForLesson, setSelectedCourseForLesson] = useState<Course | null>(null);
  const [courseLessons, setCourseLessons] = useState<Record<number, Lesson[]>>({});
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const lessonTitleRef = useRef<HTMLInputElement>(null);
  const [uploadingHtmlIdx, setUploadingHtmlIdx] = useState<number | null>(null);
  const htmlTargetIdxRef = useRef<number | null>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [showMaterialPreview, setShowMaterialPreview] = useState(false);
  // Fetched text of S3-stored html materials, keyed by url — preview only.
  const [previewHtmlCache, setPreviewHtmlCache] = useState<Record<string, string>>({});

  // Section dialog
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [sectionForm, setSectionForm] = useState(initialSectionForm);
  const [selectedCourseForSection, setSelectedCourseForSection] = useState<Course | null>(null);
  const [courseSections, setCourseSections] = useState<Record<number, Section[]>>({});

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadCourses();
    loadTags();
  }, [user]);

  const loadTags = async () => {
    try {
      setTags(await api.getTags());
    } catch (e) {
      console.error('Failed to load tags:', e);
    }
  };

  // สร้าง tag เร็วๆ จากใน dialog คอร์ส — สร้างแล้วเลือกให้ทันที
  const handleQuickCreateTag = async () => {
    const name = prompt('ชื่อ tag ใหม่ (สั้นๆ เช่น Gemini, ChatCut):')?.trim();
    if (!name) return;
    try {
      const tag = await api.createTag(name);
      await loadTags();
      setCourseForm((prev) => ({ ...prev, tag_id: tag.id }));
      toast.success(`สร้าง tag "${tag.name}" และเลือกให้แล้ว`);
    } catch (e: any) {
      toast.error(e?.message || 'สร้าง tag ไม่สำเร็จ');
    }
  };

  // Confirm dialog กลางก่อนลบ (แทน confirm() ของ browser) — ใช้ร่วมทุกจุดลบในหน้านี้
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description?: string;
    onConfirm: () => void;
  } | null>(null);

  const handleDeleteTag = (tag: TagDto) => {
    const used = tag.course_count || 0;
    setConfirmState({
      title: `ลบ Tag "${tag.name}"?`,
      description: used ? `มีคอร์ส/ทิปใช้อยู่ ${used} รายการ — จะกลายเป็นไม่มี tag` : undefined,
      onConfirm: async () => {
        try {
          await api.deleteTag(tag.id);
          toast.success('ลบ tag แล้ว');
          loadTags();
          loadCourses();
        } catch (e: any) {
          toast.error(e?.message || 'ลบไม่สำเร็จ');
        }
      },
    });
  };

  // Preview of S3-stored html materials needs their text fetched first
  // (inline-content rows render directly and skip this).
  useEffect(() => {
    if (!showMaterialPreview) return;
    const urls = lessonForm.materials
      .filter(
        (m) =>
          m.type === 'html' &&
          m.enabled !== false &&
          !(m.content || '').trim() &&
          (m.url || '').trim() &&
          previewHtmlCache[m.url] === undefined
      )
      .map((m) => m.url);
    if (urls.length === 0) return;
    let cancelled = false;
    Promise.all(
      urls.map(async (u) => {
        try {
          const r = await fetch(api.mediaUrl(u));
          return [u, r.ok ? await r.text() : ''] as const;
        } catch {
          return [u, ''] as const;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setPreviewHtmlCache((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
  }, [showMaterialPreview, lessonForm.materials]);

  const loadCourses = async () => {
    try {
      // Spinner เต็มหน้าเฉพาะโหลดครั้งแรก — การ refresh หลังบันทึก/ปัก/ลบ
      // อัปเดตข้อมูลใต้หน้าเดิมเงียบๆ ไม่ unmount ลิสต์ (accordion ที่กางไว้
      // และตำแหน่ง scroll จะคงอยู่ ไม่ต้องเลื่อนหาคอร์สใหม่ทุกครั้ง)
      if (courses.length === 0) setLoading(true);
      const data = await api.getAdminCourses();
      setCourses(data);
    } catch (error) {
      console.error('Failed to load courses:', error);
      toast.error('Error: Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  const loadCourseLessons = async (courseId: number) => {
    try {
      const data = await api.getCourseLessons(courseId);
      setCourseLessons((prev) => ({ ...prev, [courseId]: data }));
    } catch (error) {
      console.error('Failed to load lessons:', error);
    }
  };

  const loadCourseSections = async (courseId: number) => {
    try {
      const data = await api.getCourseSections(courseId);
      setCourseSections((prev) => ({ ...prev, [courseId]: data }));
    } catch (error) {
      console.error('Failed to load sections:', error);
    }
  };

  const loadCourseData = async (courseId: number) => {
    await Promise.all([
      loadCourseLessons(courseId),
      loadCourseSections(courseId)
    ]);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  // Course CRUD
  const handleOpenCourseDialog = (course?: Course) => {
    if (course) {
      setEditingCourse(course);
      setCourseForm({
        name: course.name,
        slug: course.slug,
        description: course.description || '',
        short_description: course.short_description || '',
        thumbnail_url: course.thumbnail_url || '',
        instructor_name: course.instructor_name || '',
        instructor_avatar: course.instructor_avatar || '',
        difficulty: course.difficulty || 'beginner',
        duration_hours: course.duration_hours || 0,
        is_featured: course.is_featured,
        is_free: course.is_free === true,
        display_order: course.display_order || 0,
        price: course.price || 0,
        discount_price: course.discount_price,
        content_type: course.content_type === 'tip' ? 'tip' : 'course',
        tag_id: course.tag_id ?? null,
        tag_name: course.tag_name || '',
        learning_outcomes: Array.isArray(course.learning_outcomes) ? course.learning_outcomes : [],
        requirements: Array.isArray(course.requirements) ? course.requirements : [],
        tools: Array.isArray(course.tools) ? course.tools : [],
      });
    } else {
      setEditingCourse(null);
      setCourseForm(initialCourseForm);
    }
    setCourseDialogOpen(true);
  };

  const handleSaveCourse = async () => {
    if (!courseForm.name || !courseForm.slug) {
      toast.error('Error: Name and slug are required');
      return;
    }

    try {
      setSaving(true);
      if (editingCourse) {
        await api.updateCourse(editingCourse.id, courseForm);
        toast.success('Success: Course updated successfully');
      } else {
        await api.createCourse(courseForm);
        toast.success('Success: Course created successfully');
      }
      setCourseDialogOpen(false);
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Failed to save course'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = (course: Course) => {
    setConfirmState({
      title: `ลบคอร์ส "${course.name}"?`,
      description: 'บทเรียนและเนื้อหาในคอร์สนี้จะถูกลบด้วย — การลบย้อนกลับไม่ได้',
      onConfirm: async () => {
        try {
          await api.deleteCourse(course.id);
          toast.success('ลบคอร์สแล้ว');
          loadCourses();
        } catch (error: any) {
          toast.error(`Error: ${error.message}`);
        }
      },
    });
  };

  const handleToggleCourseActive = async (course: Course) => {
    try {
      await api.updateCourse(course.id, { is_active: !course.is_active });
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // ===== ปกคลิป (episode cover) =====
  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editingLesson) return;
    if (!file.type.startsWith('image/')) { toast.error('รองรับเฉพาะไฟล์รูปภาพ'); return; }
    setCoverBusy(true);
    try {
      const r = await api.uploadLessonCover(editingLesson.id, file);
      setEditingLesson({ ...editingLesson, cover_url: r.cover_url });
      setCoverRev((n) => n + 1);
      toast.success('อัปโหลดปกคลิปแล้ว');
      if (selectedCourseForLesson) loadCourseData(selectedCourseForLesson.id);
    } catch (error: any) {
      toast.error(error?.message || 'อัปโหลดปกไม่สำเร็จ');
    } finally {
      setCoverBusy(false);
    }
  };

  const handleDeleteCover = async () => {
    if (!editingLesson) return;
    setCoverBusy(true);
    try {
      await api.deleteLessonCover(editingLesson.id);
      setEditingLesson({ ...editingLesson, cover_url: null });
      setCoverRev((n) => n + 1);
      toast.success('กลับไปใช้ปกจาก YouTube แล้ว');
      if (selectedCourseForLesson) loadCourseData(selectedCourseForLesson.id);
    } catch (error: any) {
      toast.error(error?.message || 'ลบปกไม่สำเร็จ');
    } finally {
      setCoverBusy(false);
    }
  };

  // ===== ซับไตเติลบอท (ความรู้ของผู้ช่วยประจำคอร์ส) =====
  const openSubDialog = (course: Course) => {
    setSubDialogCourse(course);
    setYtHealth(null);
    loadSubLessons(course.id);
  };

  // ตรวจว่าเซิร์ฟเวอร์ติดต่อ YouTube ได้ไหม "ตอนนี้" — คำตอบของอาการ
  // "กดแล้วไม่ได้ทุกคอร์ส" ที่เมื่อก่อนแยกไม่ออกว่าเป็นที่ระบบหรือที่คลิป
  const handleCheckYoutubeHealth = async () => {
    setYtHealthChecking(true);
    try {
      const r = await api.agentChatYoutubeHealth();
      setYtHealth({ ok: r.ok, message: r.message });
    } catch (error: any) {
      setYtHealth({ ok: false, message: error?.message || 'ตรวจการเชื่อมต่อไม่สำเร็จ' });
    } finally {
      setYtHealthChecking(false);
    }
  };

  const loadSubLessons = async (courseId: number) => {
    setSubLoading(true);
    try {
      const r = await api.agentChatCourseSubtitles(courseId);
      setSubLessons(r.lessons);
    } catch (error: any) {
      toast.error(error?.message || 'โหลดสถานะซับไม่สำเร็จ');
    } finally {
      setSubLoading(false);
    }
  };

  // "ไม่มีซับ" / "คลิปไม่มีเสียงพูด" / "ดึงไม่ได้" คนละเรื่องกัน — เดิมรายงานรวมเป็น
  // "ไม่พบซับอัตโนมัติเลย" ทำให้หาสาเหตุผิดทาง
  const syncTail = (r: { no_captions: number; too_short: number; failed: number }) =>
    [
      r.no_captions > 0 ? `ยังไม่มีซับ ${r.no_captions} บท` : '',
      r.too_short > 0 ? `คลิปไม่มีเสียงพูด ${r.too_short} บท` : '',
      r.failed > 0 ? `ดึงไม่ได้ ${r.failed} บท (ลองอีกครั้ง)` : '',
    ]
      .filter(Boolean)
      .join(' · ');

  const handleBulkSyncSubtitles = async () => {
    if (!subDialogCourse) return;
    setSubBusy('bulk');
    try {
      const r = await api.agentChatSyncSubtitles(subDialogCourse.id);
      const tail = syncTail(r);
      if (r.total === 0) toast.info('คอร์สนี้ยังไม่มีบทเรียนที่มีวิดีโอ YouTube');
      else if (r.ok === 0) toast.warning(`ไม่ได้ซับเพิ่มเลย (${r.total} บท) — ${tail || 'ลองอัปโหลดไฟล์ซับเองรายบท'}`);
      else toast.success(`ดึงซับสำเร็จ ${r.ok}/${r.total} บท${tail ? ` · ${tail}` : ''}`);
      await loadSubLessons(subDialogCourse.id);
    } catch (error: any) {
      toast.error(error?.message || 'ดึงซับไม่สำเร็จ');
    } finally {
      setSubBusy(null);
    }
  };

  // ดึงซับ "ทุกคอร์สที่ยังไม่มี" ในครั้งเดียว — เดิมต้องเปิดกล่องกดทีละคอร์ส
  // ทำให้หลายคอร์สไม่เคยถูกดึงเลย บอทจึงไม่มีความรู้
  const handleSyncMissingSubtitles = async () => {
    if (!confirm('ดึงซับจาก YouTube ให้ทุกบทที่ยังไม่มีซับ (ทุกคอร์สที่เปิดใช้งาน)?\n\nใช้เวลาสักครู่ตามจำนวนคลิป — อย่าปิดหน้านี้')) return;
    setSyncingMissing(true);
    try {
      const r = await api.agentChatSyncMissingSubtitles();
      const tail = syncTail(r);
      if (r.total === 0) toast.info('ทุกบทมีซับครบแล้ว ไม่มีอะไรต้องดึง');
      else {
        const courses = r.courses.filter((c) => c.ok > 0).length;
        toast.success(`ดึงซับสำเร็จ ${r.ok}/${r.total} บท จาก ${courses} คอร์ส${tail ? ` · ${tail}` : ''}`, { duration: 8000 });
      }
    } catch (error: any) {
      toast.error(error?.message || 'ดึงซับไม่สำเร็จ');
    } finally {
      setSyncingMissing(false);
    }
  };

  const handleLessonSyncSubtitle = async (lessonId: number) => {
    setSubBusy(lessonId);
    try {
      const r = await api.agentChatSyncLessonSubtitle(lessonId);
      toast.success(`ดึงซับสำเร็จ (${r.chars.toLocaleString()} ตัวอักษร, ${r.language})`);
      if (subDialogCourse) await loadSubLessons(subDialogCourse.id);
    } catch (error: any) {
      // BE ส่งข้อความตรงเคสมาแล้ว (ยังไม่มีซับ / คลิปไม่มีเสียงพูด / ถูกบล็อก)
      toast.error(error?.message || 'ดึงซับไม่สำเร็จ', { duration: 7000 });
    } finally {
      setSubBusy(null);
    }
  };

  const pickSubtitleFile = (lessonId: number) => {
    subUploadTargetRef.current = lessonId;
    subFileRef.current?.click();
  };

  const handleSubtitleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const lessonId = subUploadTargetRef.current;
    if (!file || !lessonId) return;
    setSubBusy(lessonId);
    try {
      const r = await api.agentChatUploadSubtitle(lessonId, file);
      toast.success(`อัปโหลดซับแล้ว (${r.chars.toLocaleString()} ตัวอักษร, ไฟล์ ${r.format})`);
      if (subDialogCourse) await loadSubLessons(subDialogCourse.id);
    } catch (error: any) {
      toast.error(error?.message || 'อัปโหลดซับไม่สำเร็จ');
    } finally {
      setSubBusy(null);
      subUploadTargetRef.current = null;
    }
  };

  const handleDeleteSubtitle = (lessonId: number, title: string) => {
    setConfirmState({
      title: `ลบซับของ "${title}"?`,
      description: 'ผู้ช่วยประจำคอร์สจะไม่รู้เนื้อหาบทนี้จนกว่าจะดึงซับใหม่',
      onConfirm: async () => {
        setSubBusy(lessonId);
        try {
          await api.agentChatDeleteSubtitle(lessonId);
          toast.success('ลบซับแล้ว');
          if (subDialogCourse) await loadSubLessons(subDialogCourse.id);
        } catch (error: any) {
          toast.error(error?.message || 'ลบซับไม่สำเร็จ');
        } finally {
          setSubBusy(null);
        }
      },
    });
  };

  // ปัก/ถอนคอร์สแนะนำ — คุมแถว "คอร์สแนะนำ" และ Billboard หน้าแรก
  const handleToggleFeatured = async (course: Course) => {
    try {
      await api.updateCourse(course.id, { is_featured: !course.is_featured });
      toast.success(course.is_featured ? `เอา "${course.name}" ออกจากคอร์สแนะนำแล้ว` : `ปัก "${course.name}" เป็นคอร์สแนะนำแล้ว`);
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // ปัก/ถอน Billboard หน้าแรก — ปักได้ครั้งละ 1 คอร์ส (BE เคลียร์ตัวเก่าให้เอง);
  // ถอดหมด = กลับไปใช้กติกาอัตโนมัติ (คอร์สที่สร้างล่าสุด ไม่นับ Tip)
  const handleToggleBillboard = async (course: Course) => {
    const pinned = !course.is_billboard;
    try {
      await api.setCourseBillboard(course.id, pinned);
      toast.success(
        pinned
          ? `ปัก "${course.name}" ขึ้น Billboard แล้ว (ชั่วคราว — สร้างคอร์สใหม่เมื่อไหร่ระบบกลับอัตโนมัติ)`
          : 'ถอด Billboard แล้ว — กลับไปใช้คอร์สล่าสุดอัตโนมัติ'
      );
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // เลื่อนลำดับการแสดง (display_order) ขึ้น/ลง — คุมลำดับทั้งหน้าเว็บ.
  // Normalize ทั้งลิสต์เป็น 10,20,30,... ทุกครั้งที่ย้าย เพื่อแก้ปัญหาค่าซ้ำ (เดิมทุกตัวเป็น 0)
  const handleMoveCourse = async (course: Course, dir: -1 | 1) => {
    const idx = courses.findIndex((c) => c.id === course.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= courses.length) return;
    const reordered = [...courses];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    try {
      const updates = reordered
        .map((c, i) => ({ id: c.id, order: (i + 1) * 10, current: c.display_order }))
        .filter((u) => u.order !== u.current);
      await Promise.all(updates.map((u) => api.updateCourse(u.id, { display_order: u.order })));
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // Thumbnail upload
  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Error: รองรับเฉพาะไฟล์ JPEG, PNG, GIF, WebP');
      return;
    }

    // Validate file size (ตรงกับเพดานเซิร์ฟเวอร์ multer 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Error: ไฟล์ต้องมีขนาดไม่เกิน 5MB');
      return;
    }

    try {
      setUploading(true);
      const result = await api.uploadCourseThumbnail(file);
      setCourseForm({ ...courseForm, thumbnail_url: result.url });
      toast.success('Success: อัพโหลดรูปปกสำเร็จ');
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'อัพโหลดไม่สำเร็จ'}`);
    } finally {
      setUploading(false);
      // Reset input
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = '';
      }
    }
  };

  // Lesson CRUD
  const handleOpenLessonDialog = async (course: Course, lesson?: Lesson) => {
    setSelectedCourseForLesson(course);
    // Load sections if not loaded
    if (!courseSections[course.id]) {
      await loadCourseSections(course.id);
    }
    if (lesson) {
      setEditingLesson(lesson);
      // List payloads strip inline html content — MUST fetch the full
      // materials before filling the form, or saving would wipe the docs.
      let materials = lesson.materials ?? [];
      const stripped = materials.some((m: any) => m?.type === 'html' && !(m.content || '').trim() && m.has_content);
      if (stripped) {
        try {
          materials = (await api.getLessonMaterials(lesson.id)).materials;
        } catch (error: any) {
          toast.error('โหลดเอกสารของบทเรียนไม่สำเร็จ — ปิดแล้วลองใหม่ (อย่าเพิ่งกดบันทึก เนื้อเอกสารอาจหาย)');
        }
      }
      setLessonForm({
        title: lesson.title,
        description: lesson.description || '',
        youtube_url: lesson.youtube_url || '',
        duration_minutes: lesson.duration_minutes || 0,
        is_preview: lesson.is_preview,
        section_id: lesson.section_id,
        materials,
      });
    } else {
      setEditingLesson(null);
      setLessonForm(initialLessonForm);
    }
    setShowMaterialPreview(false);
    setLessonDialogOpen(true);
  };

  // ---- Lesson materials (downloadable documents) ----
  const addMaterialLink = () =>
    setLessonForm((prev) => ({ ...prev, materials: [...prev.materials, { title: '', url: '', type: 'link', enabled: true }] }));

  // Google Drive: adds a normal inline link row. Paste a Drive share link into
  // the field; the server converts it to a direct-download link when saved.
  const addGoogleDriveLink = () =>
    setLessonForm((prev) => ({
      ...prev,
      materials: [...prev.materials, { title: '', url: '', type: 'link', enabled: true }],
    }));

  // HTML document: content shown inline in the lesson so students can copy the text.
  const addHtmlDoc = () =>
    setLessonForm((prev) => ({
      ...prev,
      materials: [...prev.materials, { title: '', url: '', type: 'html', content: '', enabled: true }],
    }));

  const pickHtmlFileFor = (idx: number) => {
    htmlTargetIdxRef.current = idx;
    htmlInputRef.current?.click();
  };

  const handleUploadHtml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    const idx = htmlTargetIdxRef.current;
    if (files.length === 0 || idx === null) return;
    try {
      setUploadingHtmlIdx(idx);
      // Upload all selected files; the first fills the clicked row, the rest
      // become new HTML documents so several files can be attached at once.
      const uploaded = await Promise.all(files.map((f) => api.uploadCourseHtml(f)));
      const toMaterial = (u: { url: string; name: string }): LessonMaterial => ({
        title: (u.name || '').replace(/\.html?$/i, ''),
        url: u.url,
        type: 'html',
        content: '',
        fileName: u.name,
        enabled: true,
      });
      setLessonForm((prev) => {
        const materials = [...prev.materials];
        const first = uploaded[0];
        if (materials[idx]) {
          materials[idx] = {
            ...materials[idx],
            url: first.url,
            // The uploaded file replaces any inline (legacy) content — students
            // see inline content first when both exist.
            content: '',
            fileName: first.name,
            title: materials[idx].title?.trim() ? materials[idx].title : (first.name || '').replace(/\.html?$/i, ''),
          };
        }
        for (const u of uploaded.slice(1)) materials.push(toMaterial(u));
        return { ...prev, materials };
      });
      toast.success(files.length > 1 ? `อัปโหลด ${files.length} ไฟล์สำเร็จ` : 'อัปโหลดไฟล์ HTML สำเร็จ');
    } catch (error: any) {
      toast.error(`อัปโหลดไม่สำเร็จ: ${error.message || 'Failed to upload'}`);
    } finally {
      setUploadingHtmlIdx(null);
      htmlTargetIdxRef.current = null;
    }
  };

  const updateMaterial = (idx: number, patch: Partial<LessonMaterial>) =>
    setLessonForm((prev) => ({
      ...prev,
      materials: prev.materials.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }));

  const removeMaterial = (idx: number) =>
    setLessonForm((prev) => ({ ...prev, materials: prev.materials.filter((_, i) => i !== idx) }));

  const handleUploadMaterial = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      setUploadingMaterial(true);
      const { url, name } = await api.uploadCourseMaterial(file);
      setLessonForm((prev) => ({ ...prev, materials: [...prev.materials, { title: '', url, type: 'pdf', fileName: name, enabled: true }] }));
      toast.success('อัปโหลดเอกสารสำเร็จ');
    } catch (error: any) {
      toast.error(`อัปโหลดไม่สำเร็จ: ${error.message || 'Failed to upload'}`);
    } finally {
      setUploadingMaterial(false);
    }
  };

  // `andAddAnother`: skip closing the dialog and reset the form for the next
  // lesson instead — added so admins uploading several lessons in a row
  // don't have to close the dialog, re-open "เพิ่มบทเรียน", and re-pick the
  // section every time.
  const handleSaveLesson = async (andAddAnother = false) => {
    if (!lessonForm.title || !lessonForm.youtube_url) {
      toast.error('Error: Title and YouTube URL are required');
      return;
    }

    try {
      setSaving(true);
      const materials = lessonForm.materials.filter((m) =>
        // html rows are valid with inline content (legacy) OR an uploaded S3 file (url)
        m.type === 'html' ? Boolean((m.content || '').trim() || (m.url || '').trim()) : m.url.trim()
      );
      if (editingLesson) {
        await api.updateLesson(editingLesson.id, {
          ...lessonForm,
          materials,
          section_id: lessonForm.section_id || null
        });
        toast.success('Success: Lesson updated successfully');
      } else {
        await api.createLesson(selectedCourseForLesson!.id, {
          ...lessonForm,
          materials,
          section_id: lessonForm.section_id || null
        });
        toast.success('Success: Lesson created successfully');
      }
      if (andAddAnother && !editingLesson) {
        setLessonForm({ ...initialLessonForm, section_id: lessonForm.section_id });
        setShowMaterialPreview(false);
        // Straight back to typing the next lesson title.
        setTimeout(() => lessonTitleRef.current?.focus(), 50);
      } else {
        setLessonDialogOpen(false);
      }
      loadCourseData(selectedCourseForLesson!.id);
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Failed to save lesson'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLesson = (lesson: Lesson) => {
    setConfirmState({
      title: `ลบบทเรียน "${lesson.title}"?`,
      description: 'วิดีโอ/เอกสารประกอบของบทนี้จะหายจากคอร์ส — การลบย้อนกลับไม่ได้',
      onConfirm: async () => {
        try {
          await api.deleteLesson(lesson.id);
          toast.success('ลบบทเรียนแล้ว');
          loadCourseLessons(lesson.course_id);
          loadCourses();
        } catch (error: any) {
          toast.error(`Error: ${error.message}`);
        }
      },
    });
  };

  const handleMoveLesson = async (course: Course, lesson: Lesson, direction: 'up' | 'down') => {
    const lessons = courseLessons[course.id] || [];
    const currentIndex = lessons.findIndex((l) => l.id === lesson.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= lessons.length) return;

    const newLessons = [...lessons];
    const swapA = newLessons[currentIndex]!;
    const swapB = newLessons[newIndex]!;
    [newLessons[currentIndex], newLessons[newIndex]] = [swapB, swapA];

    try {
      await api.reorderLessons(course.id, newLessons.map((l) => l.id));
      loadCourseLessons(course.id);
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // Section CRUD
  const handleOpenSectionDialog = (course: Course, section?: Section) => {
    setSelectedCourseForSection(course);
    if (section) {
      setEditingSection(section);
      setSectionForm({
        title: section.title,
        description: section.description || '',
        mode: section.mode ?? 'basic',
      });
    } else {
      setEditingSection(null);
      setSectionForm(initialSectionForm);
    }
    setSectionDialogOpen(true);
  };

  const handleSaveSection = async () => {
    if (!sectionForm.title) {
      toast.error('Error: Title is required');
      return;
    }

    try {
      setSaving(true);
      if (editingSection) {
        await api.updateSection(editingSection.id, sectionForm);
        toast.success('Success: Section updated successfully');
      } else {
        await api.createSection(selectedCourseForSection!.id, sectionForm);
        toast.success('Success: Section created successfully');
      }
      setSectionDialogOpen(false);
      loadCourseSections(selectedCourseForSection!.id);
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Failed to save section'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = (section: Section) => {
    setConfirmState({
      title: `ลบหมวด "${section.title}"?`,
      description: 'บทเรียนในหมวดนี้จะไม่ถูกลบ แต่จะกลายเป็น "ไม่มีหมวด"',
      onConfirm: async () => {
        try {
          await api.deleteSection(section.id);
          toast.success('ลบหมวดแล้ว');
          loadCourseSections(section.course_id);
          loadCourseLessons(section.course_id);
        } catch (error: any) {
          toast.error(`Error: ${error.message}`);
        }
      },
    });
  };

  const handleMoveSection = async (course: Course, section: Section, direction: 'up' | 'down') => {
    const sections = courseSections[course.id] || [];
    const currentIndex = sections.findIndex((s) => s.id === section.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= sections.length) return;

    const newSections = [...sections];
    const swapA = newSections[currentIndex]!;
    const swapB = newSections[newIndex]!;
    [newSections[currentIndex], newSections[newIndex]] = [swapB, swapA];

    try {
      await api.reorderSections(course.id, newSections.map((s) => s.id));
      loadCourseSections(course.id);
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleAssignLessonToSection = async (lesson: Lesson, sectionId: number | null) => {
    try {
      await api.updateLesson(lesson.id, { section_id: sectionId });
      toast.success(sectionId ? 'Success: Lesson assigned to section' : 'Success: Lesson unassigned from section');
      loadCourseLessons(lesson.course_id);
      loadCourseSections(lesson.course_id);
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  // คอร์สที่ขึ้น Billboard จริงบนหน้าแรก: ตัวที่แอดมินปักไว้ก่อน ไม่มีก็ใช้กติกา
  // อัตโนมัติ (สร้างล่าสุด ไม่นับ Tip) — ตรงกับ logic ใน Storefront.tsx
  const pinnedBillboard = courses.find((c) => c.is_billboard && c.is_active) ?? null;
  const autoBillboard =
    [...courses]
      .filter((c) => c.is_active && c.content_type !== 'tip')
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] ?? null;
  const billboardId = (pinnedBillboard ?? autoBillboard)?.id ?? null;

  if (!user?.isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate('/admin')} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          กลับ
        </Button>

        {/* Header — มือถือ: หัวเรื่องกับแถวปุ่มแยกบรรทัด + ปุ่มตัดบรรทัดได้ (เดิมล้นจอ 2 เท่า) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <GraduationCap className="h-6 w-6 text-purple-400 shrink-0" />
              จัดการคอร์สเรียน
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">สร้างและจัดการคอร์สเรียนและบทเรียน</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* ดึงซับให้ทุกคอร์สในคลิกเดียว — เดิมต้องเปิดกล่อง 🎬 ทีละคอร์ส
                ทำให้หลายคอร์สไม่เคยถูกดึง บอทจึงไม่มีความรู้ */}
            <Button
              onClick={handleSyncMissingSubtitles}
              variant="outline"
              disabled={syncingMissing}
              title="ดึงซับจาก YouTube ให้ทุกบทที่ยังไม่มีซับ (ทุกคอร์สที่เปิดใช้งาน)"
            >
              {syncingMissing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Clapperboard className="h-4 w-4 mr-2 text-purple-400" />
              )}
              {syncingMissing ? 'กำลังดึงซับ...' : 'ดึงซับที่ยังไม่มี'}
            </Button>
            <Button onClick={() => setTagDialogOpen(true)} variant="outline" title="จัดการชื่อย่อที่ขึ้นเมนู Tip/Course บน header">
              🏷️ จัดการ Tag
            </Button>
            <Button onClick={() => navigate('/admin/enrollments')} variant="outline">
              <Users className="h-4 w-4 mr-2" />
              จัดการ Enrollments
            </Button>
            <Button onClick={() => handleOpenCourseDialog()} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="h-4 w-4 mr-2" />
              สร้างคอร์สใหม่
            </Button>
          </div>
        </div>

        {/* Courses List */}
        {courses.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">ยังไม่มีคอร์สเรียน</p>
            </CardContent>
          </Card>
        ) : (
          <>
          <p className="text-gray-500 text-xs mb-3 flex items-center gap-1.5 flex-wrap">
            <Star className="h-3.5 w-3.5 text-yellow-400" /> = ปักเป็น "คอร์สแนะนำ" (ขึ้นแถวแนะนำหน้าเว็บ) ·
            <Clapperboard className="h-3.5 w-3.5 text-purple-400" /> = ปักขึ้น "Billboard หน้าแรก" ชั่วคราว (ครั้งละ 1 คอร์ส
            — พอสร้างคอร์สใหม่ ระบบถอดปักแล้วกลับอัตโนมัติเอง) · ใช้ลูกศร ▲▼ จัดลำดับการแสดงทั้งเว็บ
          </p>
          <Accordion type="multiple" className="space-y-4">
            {courses.map((course) => (
              <AccordionItem key={course.id} value={course.id.toString()} className="border-0">
                <Card className="overflow-hidden">
                  <AccordionTrigger
                    className="px-6 py-4 hover:no-underline"
                    onClick={() => {
                      if (!courseLessons[course.id] || !courseSections[course.id]) {
                        loadCourseData(course.id);
                      }
                    }}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full mr-2 sm:mr-4 min-w-0">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        {/* ปกที่แสดงจริง = ภาพวิดีโอล่าสุด (เซิร์ฟเวอร์เลือกให้) ไม่ใช่ไฟล์ที่อัปไว้ */}
                        <div className="relative w-16 h-10 rounded bg-gray-700 flex items-center justify-center shrink-0 overflow-hidden">
                          <BookOpen className="h-5 w-5 text-gray-500" />
                          <img
                            src={api.courseCoverUrl(course, 'card')}
                            alt={course.name}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        </div>
                        <div className="text-left min-w-0">
                          <h3 className="text-white font-medium line-clamp-2 md:line-clamp-none">{course.name}</h3>
                          <p className="text-gray-400 text-sm">
                            {course.lesson_count || 0} บทเรียน | {course.enrollment_count || 0} คนลงทะเบียน
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Billboard: ปักเอง (📌) ชนะ ไม่ปักก็ใช้คอร์สล่าสุดอัตโนมัติ */}
                        {billboardId === course.id && (
                          <Badge className="bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                            <Clapperboard className="h-3 w-3" />
                            Billboard หน้าแรก{course.is_billboard ? ' (ปักเอง)' : ' (อัตโนมัติ)'}
                          </Badge>
                        )}
                        {course.content_type === 'tip' && (
                          <Badge className="bg-sky-500/15 text-sky-400 border border-sky-500/30">💡 Tip</Badge>
                        )}
                        {course.is_free && (
                          <Badge className="bg-green-500/15 text-green-400 border border-green-500/30">🆓 ฟรี</Badge>
                        )}
                        {/* tag ที่ขึ้นเมนู header — ไม่มี = เตือนให้ไปตั้ง */}
                        {course.tag ? (
                          <Badge variant="outline" className="text-gray-300 border-gray-600">🏷️ {course.tag}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-500/80 border-yellow-500/30">ไม่มี tag</Badge>
                        )}
                        <Badge variant={course.is_active ? 'default' : 'secondary'}>
                          {course.is_active ? 'Active' : 'Inactive'}
                        </Badge>

                        {/* ปัก/ถอน Billboard หน้าแรก (span แทน button — อยู่ใน AccordionTrigger) */}
                        <span
                          role="button"
                          tabIndex={0}
                          title={
                            course.is_billboard
                              ? 'ถอดออกจาก Billboard (กลับไปใช้คอร์สล่าสุดอัตโนมัติ)'
                              : 'ปักคอร์สนี้ขึ้น Billboard หน้าแรก'
                          }
                          onClick={(e) => { e.stopPropagation(); handleToggleBillboard(course); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleToggleBillboard(course); } }}
                          className={`p-1.5 rounded-md border transition-colors ${
                            course.is_billboard
                              ? 'bg-purple-500/15 border-purple-500/40 text-purple-400 hover:bg-purple-500/25'
                              : 'border-gray-700 text-gray-500 hover:text-purple-400 hover:border-purple-500/40'
                          }`}
                        >
                          <Clapperboard className="h-4 w-4" />
                        </span>

                        {/* ปัก/ถอนคอร์สแนะนำ (span แทน button — อยู่ใน AccordionTrigger) */}
                        <span
                          role="button"
                          tabIndex={0}
                          title={course.is_featured ? 'เอาออกจากคอร์สแนะนำ' : 'ปักเป็นคอร์สแนะนำ'}
                          onClick={(e) => { e.stopPropagation(); handleToggleFeatured(course); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleToggleFeatured(course); } }}
                          className={`p-1.5 rounded-md border transition-colors ${
                            course.is_featured
                              ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/25'
                              : 'border-gray-700 text-gray-500 hover:text-yellow-400 hover:border-yellow-500/40'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${course.is_featured ? 'fill-yellow-400' : ''}`} />
                        </span>

                        {/* จัดลำดับการแสดง */}
                        <span className="flex flex-col">
                          <span
                            role="button"
                            tabIndex={0}
                            title="เลื่อนขึ้น"
                            onClick={(e) => { e.stopPropagation(); handleMoveCourse(course, -1); }}
                            className={`p-0.5 rounded ${courses[0]?.id === course.id ? 'text-gray-700 pointer-events-none' : 'text-gray-400 hover:text-white'}`}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            title="เลื่อนลง"
                            onClick={(e) => { e.stopPropagation(); handleMoveCourse(course, 1); }}
                            className={`p-0.5 rounded ${courses[courses.length - 1]?.id === course.id ? 'text-gray-700 pointer-events-none' : 'text-gray-400 hover:text-white'}`}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </span>
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="px-6 pb-4 border-t border-gray-800 pt-4">
                      {/* Course Actions */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={course.is_active}
                            onCheckedChange={() => handleToggleCourseActive(course)}
                          />
                          <span className="text-gray-400 text-sm">Active</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleOpenCourseDialog(course)}>
                            <Pencil className="h-4 w-4 mr-1" />
                            แก้ไข
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenSectionDialog(course)}>
                            <Layers className="h-4 w-4 mr-1" />
                            เพิ่มหมวด
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenLessonDialog(course)}>
                            <Plus className="h-4 w-4 mr-1" />
                            เพิ่มบทเรียน
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSubDialog(course)}
                            title="จัดการซับไตเติล (ความรู้ของบอทผู้ช่วยคอร์สนี้) — ดึงจาก YouTube หรืออัปโหลดไฟล์"
                          >
                            🎬 ซับบอท
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteCourse(course)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Sections and Lessons */}
                      {(() => {
                        const sections = courseSections[course.id] || [];
                        const lessons = courseLessons[course.id] || [];
                        const unassignedLessons = lessons.filter(l => l.section_id === null);

                        if (sections.length === 0 && lessons.length === 0) {
                          return <p className="text-gray-400 text-center py-4">ยังไม่มีบทเรียน</p>;
                        }

                        const renderLessonRow = (lesson: Lesson, index: number, lessonsInGroup: Lesson[]) => (
                          <TableRow key={lesson.id}>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  disabled={index === 0}
                                  onClick={() => handleMoveLesson(course, lesson, 'up')}
                                >
                                  <ChevronUp className="h-4 w-4" />
                                </Button>
                                <span className="text-center">{lesson.lesson_order}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  disabled={index === lessonsInGroup.length - 1}
                                  onClick={() => handleMoveLesson(course, lesson, 'down')}
                                >
                                  <ChevronDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Youtube className="h-4 w-4 text-red-500" />
                                <span className="text-white">{lesson.title}</span>
                                {(lesson.materials?.length ?? 0) > 0 && (
                                  <Badge className="bg-emerald-500/10 text-emerald-400 gap-1">
                                    <FileText className="h-3 w-3" />
                                    {lesson.materials!.length}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{lesson.duration_minutes}</TableCell>
                            <TableCell>
                              <Badge variant={lesson.is_preview ? 'default' : 'secondary'}>
                                {lesson.is_preview ? 'Yes' : 'No'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={lesson.section_id?.toString() || 'none'}
                                onValueChange={(value) => handleAssignLessonToSection(lesson, value === 'none' ? null : parseInt(value))}
                              >
                                <SelectTrigger className="w-28 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">ไม่จัดหมวด</SelectItem>
                                  {sections.map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()}>{s.title}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-purple-400"
                                  title="ดูตัวอย่างแบบที่นักเรียนเห็น"
                                  onClick={() => window.open(`/app/courses/${course.slug}/learn/${lesson.id}`, '_blank', 'noopener')}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleOpenLessonDialog(course, lesson)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-400"
                                  onClick={() => handleDeleteLesson(lesson)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );

                        return (
                          <div className="space-y-4">
                            {sections.length > 0 && (
                              <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-800/40 border border-gray-700 rounded-md px-3 py-2">
                                <Layers className="h-4 w-4 text-purple-400 flex-shrink-0 mt-0.5" />
                                <span>เนื้อหาแบ่งเป็น 2 โหมด: หมวด <b className="text-slate-300">พื้นฐาน</b> กับ <b className="text-amber-400">อัพเดท</b> จะแยกเป็น 2 แท็บให้ผู้เรียน (ตั้งโหมดในปุ่มแก้ไขหมวด) — บทเรียนที่ "ไม่จัดหมวด" จะอยู่แท็บพื้นฐาน</span>
                              </div>
                            )}
                            {/* Sections with Lessons */}
                            {sections.map((section, sectionIndex) => {
                              const sectionLessons = lessons.filter(l => l.section_id === section.id);
                              return (
                                <div key={section.id} className="border border-gray-700 rounded-lg overflow-hidden">
                                  {/* Section Header */}
                                  <div className="bg-gray-800/50 px-4 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="flex flex-col gap-1">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-5 w-5 p-0"
                                          disabled={sectionIndex === 0}
                                          onClick={() => handleMoveSection(course, section, 'up')}
                                        >
                                          <ChevronUp className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-5 w-5 p-0"
                                          disabled={sectionIndex === sections.length - 1}
                                          onClick={() => handleMoveSection(course, section, 'down')}
                                        >
                                          <ChevronDown className="h-3 w-3" />
                                        </Button>
                                      </div>
                                      <FolderOpen className="h-4 w-4 text-purple-400" />
                                      <span className="text-white font-medium">{section.title}</span>
                                      <Badge className={`text-xs ${section.mode === 'update' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>
                                        {section.mode === 'update' ? 'อัพเดท' : 'พื้นฐาน'}
                                      </Badge>
                                      <Badge variant="secondary" className="text-xs">{sectionLessons.length} บท</Badge>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button size="sm" variant="ghost" onClick={() => handleOpenSectionDialog(course, section)}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button size="sm" variant="ghost" className="text-red-400" onClick={() => handleDeleteSection(section)}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  {/* Section Lessons */}
                                  {sectionLessons.length > 0 ? (
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="w-12">#</TableHead>
                                          <TableHead>บทเรียน</TableHead>
                                          <TableHead className="w-16">นาที</TableHead>
                                          <TableHead className="w-20">Preview</TableHead>
                                          <TableHead className="w-28">หมวด</TableHead>
                                          <TableHead className="w-32">Actions</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {sectionLessons.map((lesson, idx) => renderLessonRow(lesson, idx, sectionLessons))}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <p className="text-gray-500 text-center py-4 text-sm">ยังไม่มีบทเรียนในหมวดนี้</p>
                                  )}
                                </div>
                              );
                            })}

                            {/* Unassigned Lessons */}
                            {unassignedLessons.length > 0 && (
                              <div className="border border-gray-700 rounded-lg overflow-hidden">
                                <div className="bg-gray-800/30 px-4 py-3 flex items-center gap-3">
                                  <BookOpen className="h-4 w-4 text-gray-400" />
                                  <span className="text-gray-300 font-medium">ไม่จัดหมวด</span>
                                  <Badge variant="secondary" className="text-xs">{unassignedLessons.length} บท</Badge>
                                </div>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-12">#</TableHead>
                                      <TableHead>บทเรียน</TableHead>
                                      <TableHead className="w-16">นาที</TableHead>
                                      <TableHead className="w-20">Preview</TableHead>
                                      <TableHead className="w-28">หมวด</TableHead>
                                      <TableHead className="w-32">Actions</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {unassignedLessons.map((lesson, idx) => renderLessonRow(lesson, idx, unassignedLessons))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}

                            {/* If no sections, just show all lessons */}
                            {sections.length === 0 && lessons.length > 0 && (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-12">#</TableHead>
                                    <TableHead>บทเรียน</TableHead>
                                    <TableHead className="w-16">นาที</TableHead>
                                    <TableHead className="w-20">Preview</TableHead>
                                    <TableHead className="w-28">หมวด</TableHead>
                                    <TableHead className="w-32">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {lessons.map((lesson, idx) => renderLessonRow(lesson, idx, lessons))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </AccordionContent>
                </Card>
              </AccordionItem>
            ))}
          </Accordion>
          </>
        )}

        {/* Course Dialog */}
        <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingCourse ? 'แก้ไขคอร์ส' : 'สร้างคอร์สใหม่'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ชื่อคอร์ส *</Label>
                  <Input
                    value={courseForm.name}
                    onChange={(e) => {
                      setCourseForm({
                        ...courseForm,
                        name: e.target.value,
                        slug: editingCourse ? courseForm.slug : generateSlug(e.target.value),
                      });
                    }}
                    placeholder="เช่น AI Video Masterclass"
                  />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input
                    value={courseForm.slug}
                    onChange={(e) => setCourseForm({ ...courseForm, slug: e.target.value })}
                    placeholder="ai-video-masterclass"
                  />
                </div>
              </div>
              <div>
                <Label>คำอธิบายสั้น</Label>
                <Input
                  value={courseForm.short_description}
                  onChange={(e) => setCourseForm({ ...courseForm, short_description: e.target.value })}
                  placeholder="คำอธิบายสั้นๆ สำหรับแสดงในการ์ด"
                />
              </div>
              <div>
                <Label>รายละเอียดคอร์ส</Label>
                <Textarea
                  value={courseForm.description}
                  onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })}
                  rows={4}
                  placeholder="รายละเอียดเต็มของคอร์ส"
                />
              </div>
              <BulletListEditor
                label="สิ่งที่จะได้เรียนรู้"
                items={courseForm.learning_outcomes}
                onChange={(learning_outcomes) => setCourseForm({ ...courseForm, learning_outcomes })}
                placeholder="เช่น เข้าใจหลักการสร้างวิดีโอด้วย AI"
              />
              <BulletListEditor
                label="พื้นฐานที่ควรมี"
                items={courseForm.requirements}
                onChange={(requirements) => setCourseForm({ ...courseForm, requirements })}
                placeholder="เช่น มีคอมพิวเตอร์และอินเทอร์เน็ต"
              />
              <ToolsEditor
                items={courseForm.tools}
                onChange={(tools) => setCourseForm({ ...courseForm, tools })}
              />
              {/* Thumbnail Upload Section */}
              <div>
                <Label>🖼️ รูปปกสำรอง (ใช้เฉพาะตอนคอร์สยังไม่มีวิดีโอ)</Label>
                <p className="text-gray-500 text-xs mt-0.5">
                  ปกคอร์สบนเว็บใช้ <span className="text-gray-300">ภาพของวิดีโอล่าสุดในคอร์สโดยอัตโนมัติ</span> — เพิ่ม/เปลี่ยนวิดีโอเมื่อไหร่ ปกเปลี่ยนตามทันที
                  (อยากกำหนดเอง ให้ตั้ง "ปกบทเรียน" ที่บทล่าสุด) · ไฟล์สำรองแนะนำ 16:9 อย่างน้อย 1920×1080 ไม่เกิน 5MB
                </p>
                <div className="mt-2 flex flex-col sm:flex-row gap-4">
                  {/* Preview: แสดง "ปกที่จะขึ้นจริง" ไม่ใช่ไฟล์ที่อัป (สัดส่วนตรงกับการ์ดบนเว็บ 16:9) */}
                  <div className="relative w-40 aspect-video rounded-lg border border-gray-700 bg-gray-800 overflow-hidden flex-shrink-0">
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                    {editingCourse ? (
                      <img
                        src={api.courseCoverUrl(editingCourse, 'card')}
                        alt="ปกที่จะแสดงจริง"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : courseForm.thumbnail_url ? (
                      <img
                        src={api.mediaUrl(courseForm.thumbnail_url, 'card')}
                        alt="Preview"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : null}
                  </div>
                  {/* Upload Controls */}
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => thumbnailInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        {uploading ? 'กำลังอัพโหลด...' : 'เลือกไฟล์'}
                      </Button>
                      {courseForm.thumbnail_url && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCourseForm({ ...courseForm, thumbnail_url: '' })}
                          className="text-red-400 hover:text-red-300"
                        >
                          ลบ
                        </Button>
                      )}
                    </div>
                    <Input
                      value={courseForm.thumbnail_url}
                      onChange={(e) => setCourseForm({ ...courseForm, thumbnail_url: e.target.value })}
                      placeholder="หรือใส่ URL รูปภาพ..."
                      className="text-sm"
                    />
                    <input
                      ref={thumbnailInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handleThumbnailUpload}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label>ประเภทคอนเทนต์</Label>
                <Select
                  value={courseForm.content_type}
                  onValueChange={(value) => setCourseForm({ ...courseForm, content_type: value === 'tip' ? 'tip' : 'course' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="course">📚 Course — คอร์สหลายตอน (แสดงในเมนู Course)</SelectItem>
                    <SelectItem value="tip">💡 Tip — ตอนเดียวจบ (แสดงในเมนู Tip)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  🏷️ {courseForm.content_type === 'tip'
                    ? 'Link Tag (เลือก tag เดียวกับคอร์สแม่ = Tip นี้เกาะกับคอร์สนั้น)'
                    : 'Tag (ชื่อย่อที่ขึ้นในเมนู Course บน header)'}
                </Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Select
                    value={courseForm.tag_id === null ? 'none' : String(courseForm.tag_id)}
                    onValueChange={(v) => setCourseForm({ ...courseForm, tag_id: v === 'none' ? null : Number(v) })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="— ไม่มี tag —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— ไม่มี tag —</SelectItem>
                      {tags.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={handleQuickCreateTag} title="สร้าง tag ใหม่">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {courseForm.content_type === 'tip' && (
                <div>
                  <Label>🏷️ Tag Name ของ Tip (ชื่อย่อสั้นๆ ที่แสดงในเมนู Tip และชื่อ tab — สั้นกว่า title)</Label>
                  <Input
                    value={courseForm.tag_name}
                    onChange={(e) => setCourseForm({ ...courseForm, tag_name: e.target.value.slice(0, 40) })}
                    placeholder='เช่น "FLUX 3", "Monsoon Clash" (เว้นว่าง = ใช้ชื่อเต็มตัดสั้น)'
                    className="mt-1.5"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ระดับความยาก</Label>
                  <Select
                    value={courseForm.difficulty}
                    onValueChange={(value) => setCourseForm({ ...courseForm, difficulty: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">เริ่มต้น</SelectItem>
                      <SelectItem value="intermediate">ปานกลาง</SelectItem>
                      <SelectItem value="advanced">ขั้นสูง</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>ระยะเวลา (ชั่วโมง)</Label>
                  <Input
                    type="number"
                    value={courseForm.duration_hours}
                    onChange={(e) => setCourseForm({ ...courseForm, duration_hours: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ชื่อผู้สอน</Label>
                  <Input
                    value={courseForm.instructor_name}
                    onChange={(e) => setCourseForm({ ...courseForm, instructor_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Avatar ผู้สอน (URL)</Label>
                  <Input
                    value={courseForm.instructor_avatar}
                    onChange={(e) => setCourseForm({ ...courseForm, instructor_avatar: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>ลำดับการแสดง</Label>
                <Input
                  type="number"
                  value={courseForm.display_order}
                  onChange={(e) => setCourseForm({ ...courseForm, display_order: parseInt(e.target.value) || 0 })}
                  className="w-32"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ราคาปกติ (บาท)</Label>
                  <Input
                    type="number"
                    value={courseForm.price}
                    onChange={(e) => setCourseForm({ ...courseForm, price: parseInt(e.target.value) || 0 })}
                    placeholder="0 = ฟรี"
                  />
                </div>
                <div>
                  <Label>ราคาลด (บาท)</Label>
                  <Input
                    type="number"
                    value={courseForm.discount_price ?? ''}
                    onChange={(e) => setCourseForm({ ...courseForm, discount_price: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="ไม่ใส่ = ไม่มีลด"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={courseForm.is_featured}
                  onCheckedChange={(checked) => setCourseForm({ ...courseForm, is_featured: checked === true })}
                />
                <Label>คอร์สแนะนำ (Featured)</Label>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={courseForm.is_free}
                    onCheckedChange={(checked) => setCourseForm({ ...courseForm, is_free: checked === true })}
                  />
                  <Label>🆓 เปิดให้เรียนฟรี</Label>
                </div>
                {courseForm.is_free && Number(courseForm.price) > 0 && (
                  <p className="text-yellow-400 text-xs pl-6">
                    ⚠️ คอร์สนี้ตั้งราคาไว้ ฿{Number(courseForm.price).toLocaleString()} — แนะนำตั้งราคาเป็น 0 ให้ป้ายราคาบนเว็บตรงกับสิทธิ์ฟรี
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCourseDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={handleSaveCourse} disabled={saving} className="bg-purple-600">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lesson Dialog */}
        <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingLesson ? 'แก้ไขบทเรียน' : 'เพิ่มบทเรียน'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>ชื่อบทเรียน *</Label>
                <Input
                  ref={lessonTitleRef}
                  value={lessonForm.title}
                  onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                  placeholder="เช่น บทที่ 1: Introduction"
                />
              </div>
              <div>
                <Label>YouTube URL *</Label>
                <Input
                  value={lessonForm.youtube_url}
                  onChange={(e) => setLessonForm({ ...lessonForm, youtube_url: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=... หรือ youtu.be/..."
                />
              </div>

              {/* ปกคลิป (Episode cover) — default ใช้ปกจาก YouTube อัตโนมัติ */}
              <div>
                <Label>ปกคลิป</Label>
                {editingLesson ? (
                  <div className="flex items-center gap-3 mt-1">
                    <img
                      key={coverRev}
                      src={`${api.mediaUrl(`/api/courses/lessons/${editingLesson.id}/thumb`)}?cr=${coverRev}`}
                      alt="ปกคลิป"
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2'; }}
                      className="w-32 aspect-video object-cover rounded-md border border-gray-700 bg-gray-800"
                    />
                    <div className="flex flex-col gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={coverBusy}
                        onClick={() => coverInputRef.current?.click()}
                      >
                        {coverBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : '📤 '}
                        อัปโหลดปกเอง
                      </Button>
                      {editingLesson.cover_url && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={coverBusy}
                          onClick={handleDeleteCover}
                          className="text-gray-400"
                        >
                          ↩ ใช้ปกจาก YouTube
                        </Button>
                      )}
                      <p className="text-[11px] text-gray-500">
                        {editingLesson.cover_url ? 'ใช้ปกที่อัปโหลดเอง' : 'ใช้ปกจาก YouTube อัตโนมัติ'}
                      </p>
                    </div>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverFileChange}
                    />
                  </div>
                ) : (
                  <p className="text-gray-500 text-xs mt-1">
                    ปกจะดึงจาก YouTube อัตโนมัติ — บันทึกบทเรียนก่อน แล้วกลับมาแก้ไขถ้าต้องการอัปโหลดปกเอง
                  </p>
                )}
              </div>
              <div>
                <Label>รายละเอียด</Label>
                <Textarea
                  value={lessonForm.description}
                  onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>ระยะเวลา (นาที)</Label>
                  <Input
                    type="number"
                    value={lessonForm.duration_minutes}
                    onChange={(e) => setLessonForm({ ...lessonForm, duration_minutes: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>หมวดหมู่</Label>
                  <Select
                    value={lessonForm.section_id?.toString() || 'none'}
                    onValueChange={(value) => setLessonForm({ ...lessonForm, section_id: value === 'none' ? null : parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="เลือกหมวด" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">ไม่จัดหมวด</SelectItem>
                      {selectedCourseForLesson && (courseSections[selectedCourseForLesson.id] || []).map((s) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={lessonForm.is_preview}
                  onCheckedChange={(checked) => setLessonForm({ ...lessonForm, is_preview: checked === true })}
                />
                <Label>ให้ดู Preview ได้ (ไม่ต้องลงทะเบียน)</Label>
              </div>

              {/* เอกสารประกอบ — downloadable documents (links + uploaded PDFs) */}
              <div className="border-t border-gray-800 pt-4">
                <Label>เอกสารประกอบ</Label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  ปุ่มดาวน์โหลด (ลิงก์ / Google Drive / อัปโหลดไฟล์เอง — กดแล้วโหลดทันที) หรือ "เอกสาร HTML" ที่แสดงเนื้อหาในหน้าเลย (นักเรียนก็อปข้อความได้)
                </p>
                <div className="space-y-2">
                  {lessonForm.materials.length === 0 && (
                    <p className="text-gray-500 text-sm">ยังไม่มีเอกสาร</p>
                  )}
                  {lessonForm.materials.map((m, idx) =>
                    m.type === 'html' ? (
                      <div key={idx} className="rounded-md border border-gray-700 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 flex-shrink-0" title="ติ๊ก = โชว์ให้นักเรียนเห็น">
                            <Checkbox
                              checked={m.enabled !== false}
                              onCheckedChange={(checked) => updateMaterial(idx, { enabled: checked === true })}
                            />
                          </div>
                          <FileText className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                          <Input
                            value={m.title}
                            onChange={(e) => updateMaterial(idx, { title: e.target.value })}
                            placeholder="หัวข้อเอกสาร เช่น สรุปเนื้อหา"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300 flex-shrink-0"
                            onClick={() => removeMaterial(idx)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingHtmlIdx === idx}
                            onClick={() => pickHtmlFileFor(idx)}
                          >
                            {uploadingHtmlIdx === idx ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4 mr-1" />
                            )}
                            อัปโหลดไฟล์ HTML
                          </Button>
                          <span className="text-xs text-gray-500 ml-2">เลือกได้หลายไฟล์ หรือพิมพ์/วางเนื้อหาด้านล่าง</span>
                        </div>
                        {((m.content || '').trim() || (m.url || '').trim()) && (
                          <div className="mt-2 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">
                              แนบไฟล์แล้ว: <span className="font-semibold">{m.fileName || ((m.content || '').trim() ? `เนื้อหา ${(m.content || '').length} ตัวอักษร` : 'ไฟล์ HTML')}</span>
                            </span>
                          </div>
                        )}
                        <Textarea
                          value={m.content || ''}
                          onChange={(e) => updateMaterial(idx, { content: e.target.value })}
                          placeholder="อัปโหลดไฟล์ .html ด้านบน หรือพิมพ์เนื้อหาที่นี่ เช่น <h3>หัวข้อ</h3><p>ข้อความ...</p>"
                          rows={(m.content || '').trim() ? 3 : 6}
                          className="font-mono text-xs mt-2"
                        />
                      </div>
                    ) : (
                      <div key={idx}>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 flex-shrink-0" title="ติ๊ก = โชว์ให้นักเรียนเห็น">
                            <Checkbox
                              checked={m.enabled !== false}
                              onCheckedChange={(checked) => updateMaterial(idx, { enabled: checked === true })}
                            />
                          </div>
                          {m.type === 'pdf' ? (
                            <FileText className="h-4 w-4 text-purple-400 flex-shrink-0" />
                          ) : (
                            <Link2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          )}
                          <Input
                            value={m.type === 'pdf' ? (m.fileName || 'ไฟล์แนบ') : m.url}
                            onChange={(e) => updateMaterial(idx, { url: e.target.value })}
                            placeholder="ลิงก์เอกสาร / Google Drive (https://...)"
                            readOnly={m.type === 'pdf'}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-400 hover:text-red-300 flex-shrink-0"
                            onClick={() => removeMaterial(idx)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {/\/drive\/folders\//.test(m.url) && (
                          <p className="text-xs text-yellow-400/90 mt-1 ml-7">
                            ⚠️ นี่คือลิงก์ “โฟลเดอร์” — ปุ่มจะเปิดโฟลเดอร์ใน Google Drive (นักเรียนเลือกโหลดไฟล์ในนั้นเอง). ถ้าอยากให้กดแล้วโหลดไฟล์เดียวทันที ให้ใช้ลิงก์แชร์ของ “ไฟล์” แทน
                          </p>
                        )}
                      </div>
                    )
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={addMaterialLink}>
                    <Plus className="h-4 w-4 mr-1" />
                    เพิ่มลิงก์เอกสาร
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addHtmlDoc}>
                    <FileText className="h-4 w-4 mr-1" />
                    เอกสาร HTML
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addGoogleDriveLink}>
                    <Link2 className="h-4 w-4 mr-1" />
                    Google Drive
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingMaterial}
                    onClick={() => materialInputRef.current?.click()}
                  >
                    {uploadingMaterial ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1" />
                    )}
                    อัปโหลดไฟล์
                  </Button>
                  <input
                    ref={materialInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.zip,.rar,.png,.jpg,.jpeg,.webp,.gif,.mp3,.mp4"
                    className="hidden"
                    onChange={handleUploadMaterial}
                  />
                  <input
                    ref={htmlInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    multiple
                    className="hidden"
                    onChange={handleUploadHtml}
                  />
                </div>

                {/* Live preview — exactly what students see, from the current form (works before saving) */}
                {lessonForm.materials.filter((m) => m.enabled !== false).length > 0 && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-purple-400"
                      onClick={() => setShowMaterialPreview((v) => !v)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      {showMaterialPreview ? 'ซ่อนตัวอย่าง' : 'ดูตัวอย่าง (แบบที่นักเรียนเห็น)'}
                    </Button>
                    {showMaterialPreview && (() => {
                      const visible = lessonForm.materials.filter((m) => m.enabled !== false);
                      const downloads = visible.filter((m) => m.type !== 'html' && m.url.trim());
                      const htmlDocs = visible.filter(
                        (m) => m.type === 'html' && ((m.content || '').trim() || (m.url || '').trim())
                      );
                      return (
                        <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/50 p-4">
                          <p className="text-sm font-medium text-white mb-2">เอกสารประกอบ</p>
                          {downloads.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {downloads.map((m, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-2 rounded-md border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-sm text-purple-300"
                                >
                                  <Upload className="h-4 w-4 rotate-180" />
                                  ดาวน์โหลด
                                </span>
                              ))}
                            </div>
                          )}
                          {htmlDocs.map((m, idx) => {
                            const inline = (m.content || '').trim();
                            const fetched = !inline && (m.url || '').trim() ? previewHtmlCache[m.url] : undefined;
                            const fetching = !inline && (m.url || '').trim() && fetched === undefined;
                            const raw = inline ? m.content || '' : fetched || '';
                            const clean = sanitizeMaterialHtml(raw);
                            const hasVisibleText = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
                            return (
                              <div key={idx} className="mt-3 rounded-lg border border-gray-800 overflow-hidden">
                                {m.title && <p className="text-sm font-semibold text-white bg-gray-900/60 px-4 py-2">{m.title}</p>}
                                {fetching ? (
                                  <p className="text-gray-400 text-sm flex items-center gap-2 px-4 py-3">
                                    <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดเอกสาร...
                                  </p>
                                ) : hasVisibleText ? (
                                  <MaterialHtmlFrame html={clean} maxHeight={400} />
                                ) : (
                                  <pre className="bg-white text-gray-900 p-4 max-h-[400px] overflow-auto whitespace-pre-wrap break-words text-sm font-sans">
                                    {raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || 'ไม่มีเนื้อหา'}
                                  </pre>
                                )}
                              </div>
                            );
                          })}
                          {downloads.length === 0 && htmlDocs.length === 0 && (
                            <p className="text-gray-500 text-sm">ยังไม่มีเอกสารที่จะแสดง (ต้องมีลิงก์/ไฟล์/เนื้อหา และติ๊กเปิดไว้)</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLessonDialogOpen(false)}>
                ยกเลิก
              </Button>
              {editingLesson ? (
                <Button onClick={() => handleSaveLesson(false)} disabled={saving} className="bg-purple-600">
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  บันทึก
                </Button>
              ) : (
                <>
                  {/* Bulk entry is the common flow — save-and-continue is the primary action */}
                  <Button variant="outline" onClick={() => handleSaveLesson(false)} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    บันทึกและปิด
                  </Button>
                  <Button onClick={() => handleSaveLesson(true)} disabled={saving} className="bg-purple-600">
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    บันทึก + เพิ่มบทต่อ ▸
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm ก่อนลบ — dialog กลางใช้ร่วมทุกจุดลบ (คอร์ส/บทเรียน/หมวด/tag/ซับ) */}
        <AlertDialog open={!!confirmState} onOpenChange={(open) => { if (!open) setConfirmState(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-red-400" />
                {confirmState?.title}
              </AlertDialogTitle>
              {confirmState?.description && (
                <AlertDialogDescription className="whitespace-pre-line">
                  {confirmState.description}
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { confirmState?.onConfirm(); setConfirmState(null); }}
              >
                🗑️ ลบ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ซับไตเติลบอท Dialog — ความรู้ของผู้ช่วยประจำคอร์ส */}
        <Dialog open={!!subDialogCourse} onOpenChange={(o) => !o && setSubDialogCourse(null)}>
          {/* ปิดได้เฉพาะปุ่ม X/Esc — คลิกนอกกรอบแล้วปิดทำให้งานอัปซับหลายบทหลุดกลางคัน */}
          <DialogContent
            className="max-w-2xl max-h-[85vh] overflow-y-auto"
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="truncate">🎬 ซับไตเติลบอท — {subDialogCourse?.name}</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-gray-400 -mt-1">
              ซับไตเติล = ความรู้ที่บอทผู้ช่วยคอร์สใช้ตอบคำถามเชิงลึก · ดึงอัตโนมัติจาก YouTube หรืออัปโหลดไฟล์ที่
              export มา (<b>.sbv .srt .vtt .txt</b> — ไฟล์แบบ "ข้อความ+เวลา" ใช้ได้เลย ระบบตัด timestamp ให้เอง)
            </p>
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200/90">
              ดึงจาก YouTube ได้เมื่อ: คลิป <b>มีคนพูด</b> (YouTube ถอดเสียงเป็นซับให้) และ <b>สร้างซับเสร็จแล้ว</b> —
              คลิปที่เพิ่งอัปต้องรอราวไม่กี่นาทีถึงชั่วโมง ถ้ายังไม่ได้ให้กดใหม่ภายหลัง · คลิปที่มีแต่เพลง/เสียงเอฟเฟกต์
              จะไม่ได้ซับที่ใช้งานได้ ให้อัปโหลดไฟล์เอง
            </div>
            <div className="flex items-center gap-3 mb-1">
              <Button
                size="sm"
                onClick={handleBulkSyncSubtitles}
                disabled={subBusy !== null}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {subBusy === 'bulk' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <>📥 </>}
                ดึงทั้งหมดจาก YouTube
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCheckYoutubeHealth}
                disabled={ytHealthChecking || subBusy !== null}
                title="ตรวจว่าเซิร์ฟเวอร์ติดต่อ YouTube ได้ไหมตอนนี้ — ใช้แยกว่าปัญหาอยู่ที่ระบบหรือที่คลิป"
              >
                {ytHealthChecking ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <>🔌 </>}
                ตรวจการเชื่อมต่อ
              </Button>
              <span className="text-xs text-gray-400">
                {subLessons.filter((l) => l.has_sub).length}/{subLessons.length} บทมีซับแล้ว
              </span>
            </div>
            {ytHealth && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  ytHealth.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/40 bg-red-500/10 text-red-300'
                }`}
              >
                {ytHealth.ok ? '✅ ' : '⛔ '}
                {ytHealth.message}
              </div>
            )}
            {subLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : subLessons.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">คอร์สนี้ยังไม่มีบทเรียน</p>
            ) : (
              <div className="space-y-1.5">
                {subLessons.map((l) => (
                  <div
                    key={l.lesson_id}
                    className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{l.title}</p>
                      <p className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                        {l.has_sub
                          ? `✅ ${l.chars.toLocaleString()} ตัวอักษร (${l.language || '?'}) · ${
                              l.fetched_at ? new Date(l.fetched_at).toLocaleString('th-TH') : ''
                            }`
                          : '❌ ยังไม่มีซับ'}
                        {/* ซับที่ไม่ใช่ไทยหมายถึงบอทจะอ้างอิงเนื้อหาภาษาอื่น — เดิมไม่มีการเตือน */}
                        {l.has_sub && l.language && l.language !== 'th' && (
                          <span className="rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 text-yellow-300">
                            ⚠ ซับ {l.language.toUpperCase()} (บอทจะอ้างอิงภาษานี้)
                          </span>
                        )}
                        {l.too_short && (
                          <span className="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 text-orange-300">
                            ⚠ สั้นผิดปกติ — คลิปแทบไม่มีเสียงพูด
                          </span>
                        )}
                      </p>
                      {/* บทที่ยังไม่มีซับ: บอกว่าครั้งล่าสุดที่ลองเกิดอะไรขึ้น
                          (เดิมขึ้นแค่ "ยังไม่มีซับ" จึงไม่รู้ว่าคลิปไม่มีซับ หรือระบบดึงไม่ได้) */}
                      {!l.has_sub && l.last_status && l.last_status !== 'ok' && (
                        <p className="text-[11px] text-yellow-500/90 mt-0.5">
                          ลองล่าสุด{' '}
                          {l.last_attempt_at ? new Date(l.last_attempt_at).toLocaleString('th-TH') : ''} · ผล:{' '}
                          {l.last_status === 'no_captions'
                            ? 'YouTube ยังไม่มีซับของคลิปนี้'
                            : l.last_status === 'too_short'
                              ? 'คลิปแทบไม่มีเสียงพูด (ซับสั้นเกินไป)'
                              : `ดึงไม่ได้ — ${l.last_reason || 'ไม่ทราบสาเหตุ'}${l.last_detail ? ` (${l.last_detail})` : ''}`}
                        </p>
                      )}
                    </div>
                    {l.has_youtube && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={subBusy !== null}
                        onClick={() => handleLessonSyncSubtitle(l.lesson_id)}
                        title="ดึงซับอัตโนมัติจาก YouTube เฉพาะบทนี้"
                      >
                        {subBusy === l.lesson_id ? <Loader2 className="h-4 w-4 animate-spin" /> : '📥'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={subBusy !== null}
                      onClick={() => pickSubtitleFile(l.lesson_id)}
                      title="อัปโหลดไฟล์ซับ (.sbv .srt .vtt .txt)"
                    >
                      📄
                    </Button>
                    {l.has_sub && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={subBusy !== null}
                        onClick={() => handleDeleteSubtitle(l.lesson_id, l.title)}
                        className="text-red-400 hover:text-red-300"
                        title="ลบซับของบทนี้"
                      >
                        🗑
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <input
              ref={subFileRef}
              type="file"
              accept=".srt,.vtt,.sbv,.txt"
              className="hidden"
              onChange={handleSubtitleFileChange}
            />
          </DialogContent>
        </Dialog>

        {/* จัดการ Tag — ชื่อย่อที่ขึ้นเมนู Tip/Course บน header */}
        <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>🏷️ จัดการ Tag</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-gray-400 -mt-1">
              Tag = ชื่อย่อที่แสดงในเมนู Course/Tip บน header · Tip ที่ใช้ tag เดียวกับคอร์ส = เกาะกับคอร์สนั้น
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="ชื่อ tag ใหม่ เช่น Gemini"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newTagName.trim()) {
                    try {
                      await api.createTag(newTagName.trim());
                      setNewTagName('');
                      loadTags();
                    } catch (err: any) {
                      toast.error(err?.message || 'สร้างไม่สำเร็จ');
                    }
                  }
                }}
              />
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                disabled={!newTagName.trim()}
                onClick={async () => {
                  try {
                    await api.createTag(newTagName.trim());
                    setNewTagName('');
                    loadTags();
                  } catch (err: any) {
                    toast.error(err?.message || 'สร้างไม่สำเร็จ');
                  }
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> เพิ่ม
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {tags.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-6">ยังไม่มี tag</p>
              ) : (
                tags.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md border border-gray-800 px-3 py-2">
                    <span className="flex-1 text-sm text-white">{t.name}</span>
                    <span className="text-xs text-gray-500">{t.course_count || 0} รายการ</span>
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 px-2" onClick={() => handleDeleteTag(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Section Dialog */}
        <Dialog open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSection ? 'แก้ไขหมวดหมู่' : 'สร้างหมวดหมู่ใหม่'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>ชื่อหมวดหมู่ *</Label>
                <Input
                  value={sectionForm.title}
                  onChange={(e) => setSectionForm({ ...sectionForm, title: e.target.value })}
                  placeholder="เช่น บทนำ, หลักการพื้นฐาน, ฝึกปฏิบัติ"
                />
              </div>
              <div>
                <Label>คำอธิบาย (ไม่บังคับ)</Label>
                <Textarea
                  value={sectionForm.description}
                  onChange={(e) => setSectionForm({ ...sectionForm, description: e.target.value })}
                  rows={3}
                  placeholder="คำอธิบายสั้นๆ เกี่ยวกับหมวดนี้"
                />
              </div>
              <div>
                <Label>โหมด</Label>
                <p className="text-xs text-gray-500 mt-0.5 mb-1">เลือกว่าหมวดนี้เป็นเนื้อหาพื้นฐาน หรือเนื้อหาอัพเดท</p>
                <Select
                  value={sectionForm.mode}
                  onValueChange={(value) => setSectionForm({ ...sectionForm, mode: value as 'basic' | 'update' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">พื้นฐาน</SelectItem>
                    <SelectItem value="update">อัพเดท</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSectionDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button onClick={handleSaveSection} disabled={saving} className="bg-purple-600">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default AdminCourses;
