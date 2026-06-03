import { Download, ExternalLink, Image as ImageIcon, Film } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { ViralTemplateTask } from '@/types/viralTemplate';

async function handleProxyDownload(url: string, filename: string) {
  try {
    await api.downloadViaProxy(url, filename);
  } catch (err: any) {
    toast.error(err?.message || 'Download failed');
  }
}

interface ViralTaskDetailModalProps {
  task: ViralTemplateTask;
  open: boolean;
  onClose: () => void;
}

export function ViralTaskDetailModal({ task, open, onClose }: ViralTaskDetailModalProps) {
  const images = (task.image_tasks || []).filter(t => t.image_url);
  const videos = (task.video_tasks || []).filter(t => t.video_url);
  const hasContent = images.length > 0 || videos.length > 0 || task.final_video_url;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="text-base">
            Task #{task.task_index + 1} — {task.character_name || 'ไม่มีชื่อ'}
          </DialogTitle>
        </DialogHeader>

        {!hasContent && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            ยังไม่มีภาพหรือวิดีโอที่เจนสำเร็จ
          </div>
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
              <ImageIcon className="h-4 w-4" />
              ภาพ ({images.length} ฉาก)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-zinc-700">
                  <img
                    src={img.image_url!}
                    alt={`ฉาก ${img.scene}`}
                    className="w-full aspect-[9/16] object-cover"
                  />
                  <button
                    onClick={() => handleProxyDownload(img.image_url!, `scene-${img.scene}.jpg`)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
                    ฉาก {img.scene}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scene Videos */}
        {videos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
              <Film className="h-4 w-4" />
              VDO แต่ละฉาก ({videos.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {videos.map((vid, i) => (
                <div key={i} className="relative">
                  <video
                    src={vid.video_url!}
                    controls
                    className="w-full aspect-[9/16] max-h-[250px] object-contain bg-black rounded-lg border border-zinc-700"
                  />
                  <button
                    onClick={() => handleProxyDownload(vid.video_url!, `scene-${vid.scene}.mp4`)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors z-10"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
                    ฉาก {vid.scene}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Final Video */}
        {task.final_video_url && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
              <Film className="h-4 w-4 text-green-400" />
              VDO สุดท้าย
            </div>
            <div className="relative">
              <video
                src={task.final_video_url}
                controls
                className="w-full aspect-[9/16] max-h-[400px] object-contain bg-black rounded-lg border border-zinc-700"
              />
              <button
                onClick={() => handleProxyDownload(task.final_video_url!, `final-${task.id}.mp4`)}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-[#FFB300] hover:text-black transition-colors z-10"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
