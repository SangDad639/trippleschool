import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Loader2, Trash2, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface GalleryImage {
  id: number;
  filename: string;
  shared_url: string;
  category: string;
  created_at: string;
}

interface IdolImageGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  title?: string;
  category?: string;
}

export function IdolImageGallery({ open, onClose, onSelect, title = 'เลือกรูป', category }: IdolImageGalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = async () => {
    setLoading(true);
    try {
      const data = await api.getIdolGallery(category);
      setImages(data);
    } catch (err: any) {
      toast.error('โหลดรูปไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchImages();
  }, [open, category]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadIdolImage(file, category);
      // Add to gallery list immediately
      setImages(prev => [{
        id: result.id,
        filename: result.filename,
        shared_url: result.url,
        category: category || 'general',
        created_at: new Date().toISOString(),
      }, ...prev]);
      toast.success('อัพโหลดสำเร็จ');
    } catch (err: any) {
      toast.error(err?.message || 'อัพโหลดล้มเหลว');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('ลบรูปนี้?')) return;
    setDeleting(id);
    try {
      await api.deleteIdolGalleryImage(id);
      setImages(prev => prev.filter(img => img.id !== id));
      toast.success('ลบแล้ว');
    } catch {
      toast.error('ลบไม่สำเร็จ');
    } finally {
      setDeleting(null);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70"
      style={{ pointerEvents: 'auto' }}
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[90vw] max-w-[600px] max-h-[80vh] flex flex-col"
        style={{ pointerEvents: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Upload Button */}
        <div className="px-4 py-3 border-b border-zinc-800">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-zinc-600 hover:border-[#FFB300] text-zinc-400 hover:text-[#FFB300] transition-colors w-full justify-center"
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> กำลังอัพโหลด...</>
            ) : (
              <><Upload className="h-4 w-4" /> อัพโหลดรูปใหม่</>
            )}
          </button>
        </div>

        {/* Gallery Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              ยังไม่มีรูป — กด "อัพโหลดรูปใหม่" เพื่อเพิ่ม
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {images.map(img => (
                <div
                  key={img.id}
                  onClick={() => { onSelect(img.shared_url); onClose(); }}
                  className="relative group cursor-pointer rounded-lg overflow-hidden border-2 border-zinc-700 hover:border-[#FFB300] transition-colors aspect-square bg-zinc-800"
                >
                  <img
                    src={img.shared_url}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <Check className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(img.id, e)}
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/80"
                  >
                    {deleting === img.id ? (
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                    ) : (
                      <Trash2 className="h-3 w-3 text-red-400" />
                    )}
                  </button>
                  {/* Filename */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[8px] text-zinc-300 truncate block">{img.filename}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
