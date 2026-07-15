import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { api } from '@/lib/api';
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
  is_active: boolean;
  display_order: number;
  lesson_count: number;
  enrollment_count: number;
  price: number;
  discount_price: number | null;
  learning_outcomes?: string[];
  requirements?: string[];
}

interface Section {
  id: number;
  course_id: number;
  title: string;
  description: string;
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
  display_order: 0,
  price: 0,
  discount_price: null as number | null,
  learning_outcomes: [] as string[],
  requirements: [] as string[],
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

const AdminCourses = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [uploadingHtmlIdx, setUploadingHtmlIdx] = useState<number | null>(null);
  const htmlTargetIdxRef = useRef<number | null>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [showMaterialPreview, setShowMaterialPreview] = useState(false);

  // Section dialog
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [sectionForm, setSectionForm] = useState(initialSectionForm);
  const [selectedCourseForSection, setSelectedCourseForSection] = useState<Course | null>(null);
  const [courseSections, setCourseSections] = useState<Record<number, Section[]>>({});

  useEffect(() => {
    if (!user?.isAdmin) return;
    loadCourses();
  }, [user]);

  const loadCourses = async () => {
    try {
      setLoading(true);
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
        display_order: course.display_order || 0,
        price: course.price || 0,
        discount_price: course.discount_price,
        learning_outcomes: Array.isArray(course.learning_outcomes) ? course.learning_outcomes : [],
        requirements: Array.isArray(course.requirements) ? course.requirements : [],
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

  const handleDeleteCourse = async (course: Course) => {
    if (!confirm(`Are you sure you want to delete "${course.name}"?`)) return;

    try {
      await api.deleteCourse(course.id);
      toast.success('Success: Course deleted successfully');
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleToggleCourseActive = async (course: Course) => {
    try {
      await api.updateCourse(course.id, { is_active: !course.is_active });
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

    // Validate file size (15MB max)
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Error: ไฟล์ต้องมีขนาดไม่เกิน 15MB');
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
      setLessonForm({
        title: lesson.title,
        description: lesson.description || '',
        youtube_url: lesson.youtube_url || '',
        duration_minutes: lesson.duration_minutes || 0,
        is_preview: lesson.is_preview,
        section_id: lesson.section_id,
        materials: lesson.materials ?? [],
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
      const toMaterial = (u: { content: string; name: string }): LessonMaterial => ({
        title: (u.name || '').replace(/\.html?$/i, ''),
        url: '',
        type: 'html',
        content: u.content,
        fileName: u.name,
        enabled: true,
      });
      setLessonForm((prev) => {
        const materials = [...prev.materials];
        const first = uploaded[0];
        if (materials[idx]) {
          materials[idx] = {
            ...materials[idx],
            content: first.content,
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
    if (file.type !== 'application/pdf') {
      toast.error('รองรับเฉพาะไฟล์ PDF');
      return;
    }
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

  const handleSaveLesson = async () => {
    if (!lessonForm.title || !lessonForm.youtube_url) {
      toast.error('Error: Title and YouTube URL are required');
      return;
    }

    try {
      setSaving(true);
      const materials = lessonForm.materials.filter((m) =>
        m.type === 'html' ? (m.content || '').trim() : m.url.trim()
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
      setLessonDialogOpen(false);
      loadCourseData(selectedCourseForLesson!.id);
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message || 'Failed to save lesson'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLesson = async (lesson: Lesson) => {
    if (!confirm(`Are you sure you want to delete "${lesson.title}"?`)) return;

    try {
      await api.deleteLesson(lesson.id);
      toast.success('Success: Lesson deleted successfully');
      loadCourseLessons(lesson.course_id);
      loadCourses();
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
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

  const handleDeleteSection = async (section: Section) => {
    if (!confirm(`Are you sure you want to delete section "${section.title}"? Lessons in this section will become unassigned.`)) return;

    try {
      await api.deleteSection(section.id);
      toast.success('Success: Section deleted successfully');
      loadCourseSections(section.course_id);
      loadCourseLessons(section.course_id);
    } catch (error: any) {
      toast.error(`Error: ${error.message}`);
    }
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

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <GraduationCap className="h-6 w-6 text-purple-400" />
              จัดการคอร์สเรียน
            </h1>
            <p className="text-gray-400">สร้างและจัดการคอร์สเรียนและบทเรียน</p>
          </div>
          <div className="flex gap-2">
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
                    <div className="flex items-center justify-between w-full mr-4">
                      <div className="flex items-center gap-4">
                        {course.thumbnail_url ? (
                          <img
                            src={api.mediaUrl(course.thumbnail_url)}
                            alt={course.name}
                            className="w-16 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-16 h-10 rounded bg-gray-700 flex items-center justify-center">
                            <BookOpen className="h-5 w-5 text-gray-500" />
                          </div>
                        )}
                        <div className="text-left">
                          <h3 className="text-white font-medium">{course.name}</h3>
                          <p className="text-gray-400 text-sm">
                            {course.lesson_count || 0} บทเรียน | {course.enrollment_count || 0} คนลงทะเบียน
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={course.is_active ? 'default' : 'secondary'}>
                          {course.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {course.is_featured && (
                          <Badge className="bg-yellow-500/10 text-yellow-500">Featured</Badge>
                        )}
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
              {/* Thumbnail Upload Section */}
              <div>
                <Label>รูปปกคอร์ส (แนะนำ 16:9, เช่น 1280x720)</Label>
                <div className="mt-2 flex gap-4">
                  {/* Preview */}
                  <div className="w-40 h-24 rounded-lg border border-gray-700 bg-gray-800 overflow-hidden flex-shrink-0">
                    {courseForm.thumbnail_url ? (
                      <img
                        src={api.mediaUrl(courseForm.thumbnail_url)}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
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
                  ปุ่มดาวน์โหลด (ลิงก์ / Google Drive / PDF) หรือ "เอกสาร HTML" ที่แสดงเนื้อหาในหน้าเลย (นักเรียนก็อปข้อความได้)
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
                          {(m.content || '').trim() && (
                            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              แนบแล้ว: {m.fileName || `เนื้อหา ${(m.content || '').length} ตัวอักษร`}
                            </div>
                          )}
                        </div>
                        <Textarea
                          value={m.content || ''}
                          onChange={(e) => updateMaterial(idx, { content: e.target.value })}
                          placeholder="อัปโหลดไฟล์ .html ด้านบน หรือพิมพ์เนื้อหาที่นี่ เช่น <h3>หัวข้อ</h3><p>ข้อความ...</p>"
                          rows={6}
                          className="font-mono text-xs"
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
                            value={m.type === 'pdf' ? (m.fileName || 'ไฟล์ PDF') : m.url}
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
                    อัปโหลด PDF
                  </Button>
                  <input
                    ref={materialInputRef}
                    type="file"
                    accept="application/pdf"
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
                      const htmlDocs = visible.filter((m) => m.type === 'html' && (m.content || '').trim());
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
                          {htmlDocs.map((m, idx) => (
                            <div key={idx} className="mt-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                              {m.title && <p className="text-sm font-semibold text-white mb-2">{m.title}</p>}
                              <div
                                className="prose prose-invert prose-sm max-w-none text-gray-200"
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m.content || '') }}
                              />
                            </div>
                          ))}
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
              <Button onClick={handleSaveLesson} disabled={saving} className="bg-purple-600">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                บันทึก
              </Button>
            </DialogFooter>
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
