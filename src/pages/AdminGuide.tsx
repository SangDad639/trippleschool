import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { type GuideGroupDto } from '@/lib/api';
import GuideGroupsPanel from '@/components/guide/GuideGroupsPanel';
import GuideClipsPanel from '@/components/guide/GuideClipsPanel';
import GuideAdminsPanel from '@/components/guide/GuideAdminsPanel';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Youtube, ExternalLink } from 'lucide-react';

/**
 * /admin/guide - two levels, same shape as courses: groups first, then the clips
 * inside one group. Selecting a group swaps the body instead of routing, so the
 * back arrow always means "one level up" and never leaves the admin area.
 *
 * Guide admins (is_guide_admin) reach this page too but only see the clip side;
 * granting the role stays with full admins, and the API enforces that as well.
 */
const AdminGuide = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selected, setSelected] = useState<GuideGroupDto | null>(null);

  const canEditClips = !!(user?.isAdmin || user?.isSuperAdmin || user?.isGuideAdmin);
  const isFullAdmin = !!(user?.isAdmin || user?.isSuperAdmin);

  if (!canEditClips) {
    return (
      <div className="page-wrapper flex items-center justify-center">
        <p className="text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
      </div>
    );
  }

  const goBack = () => {
    if (selected) return setSelected(null);
    navigate(isFullAdmin ? '/admin' : '/');
  };

  const previewPath = selected ? `/guide/${selected.slug}` : '/guide';

  return (
    <div className="page-wrapper">
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="container mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={goBack} aria-label="ย้อนกลับ">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
              <Youtube className="h-5 w-5 shrink-0 text-[#FFB300]" />
              {selected ? selected.title : 'จัดการคู่มือ'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {selected
                ? 'คลิปในกลุ่มนี้ — เรียงลำดับได้ แก้แล้วขึ้นทันที'
                : 'สร้างกลุ่มคู่มือ แล้วใส่คลิปข้างใน เหมือนคอร์สกับบทเรียน'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(previewPath, '_blank')}
            className="shrink-0 gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" /> ดูหน้าจริง
          </Button>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4 py-6">
        {selected ? (
          <GuideClipsPanel group={selected} />
        ) : (
          <>
            <GuideGroupsPanel onSelect={setSelected} />
            {isFullAdmin && <GuideAdminsPanel />}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminGuide;
