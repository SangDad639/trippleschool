import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, Upload as UploadIcon, ImageIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export type StoryImageCategory = 'main' | 'outfit' | 'background' | 'object';

const CATEGORY_TITLES: Record<StoryImageCategory, { th: string; en: string }> = {
  main: { th: 'เลือกรูป', en: 'Pick Image' },
  outfit: { th: 'เลือกรูปชุด', en: 'Pick Outfit' },
  background: { th: 'เลือกรูปพื้นหลัง', en: 'Pick Background' },
  object: { th: 'เลือกรูป Object', en: 'Pick Object' },
};

interface GalleryItem {
  id: number;
  category: string;
  image_url: string;
  created_at: string;
}

interface Props {
  open: boolean;
  category: StoryImageCategory | null;
  language: string;
  onClose: () => void;
  onSelect: (url: string) => void;
}

export function StoryImagePickerModal({ open, category, language, onClose, onSelect }: Props) {
  const l = (th: string, en: string) => (language === 'th' ? th : en);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'upload' | 'gallery'>('upload');
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!open || !category) return;
    setLoadingList(true);
    api
      .storyGalleryList(category)
      .then(({ items }) => setItems(items as GalleryItem[]))
      .catch((err) => toast.error(err?.message || 'Failed to load gallery'))
      .finally(() => setLoadingList(false));
  }, [open, category]);

  if (!category) return null;
  const title = CATEGORY_TITLES[category];

  const handleUpload = async (file: File) => {
    if (!category) return;
    setUploading(true);
    try {
      const { item } = await api.storyGalleryUpload(file, category);
      // Insert at top of gallery + auto-select uploaded image
      setItems((prev) => [item as GalleryItem, ...prev]);
      onSelect(item.image_url);
      onClose();
      toast.success(l('อัปโหลดสำเร็จ', 'Uploaded'));
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.storyGalleryDelete(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      toast.success(l('ลบแล้ว', 'Deleted'));
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle>{l(title.th, title.en)}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'gallery')}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="upload">{l('อัปโหลด', 'Upload')}</TabsTrigger>
            <TabsTrigger value="gallery">
              {l('คลังรูป', 'Gallery')} {items.length > 0 && <span className="ml-1.5 text-xs opacity-70">({items.length})</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full aspect-video border-2 border-dashed border-zinc-700 rounded-lg hover:border-[#FFB300]/60 hover:bg-[#FFB300]/5 transition-colors flex flex-col items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-[#FFB300]" />
                  <span className="text-sm text-zinc-400">{l('กำลังอัปโหลด...', 'Uploading...')}</span>
                </>
              ) : (
                <>
                  <UploadIcon className="h-10 w-10 text-zinc-500" />
                  <span className="text-sm text-zinc-300">{l('คลิกเพื่อเลือกไฟล์ (สูงสุด 30MB)', 'Click to pick file (max 30MB)')}</span>
                </>
              )}
            </button>
          </TabsContent>

          <TabsContent value="gallery" className="mt-4">
            {loadingList ? (
              <div className="flex items-center justify-center py-12 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <ImageIcon className="h-12 w-12 mb-2" />
                <p className="text-sm">{l('ยังไม่มีรูปในคลัง', 'No images in gallery yet')}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setTab('upload')}
                  className="mt-2 text-[#FFB300]"
                >
                  {l('อัปโหลดรูปแรก', 'Upload first image')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-zinc-700 cursor-pointer hover:border-[#FFB300]"
                    onClick={() => {
                      onSelect(it.image_url);
                      onClose();
                    }}
                  >
                    <img src={it.image_url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(it.id);
                      }}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/70 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-opacity"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default StoryImagePickerModal;
