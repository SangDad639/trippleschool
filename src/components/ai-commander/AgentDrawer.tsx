/**
 * AgentDrawer — slide-in panel from right edge of viewport.
 *
 * Reuses EXISTING components from src/components/story-agent (ChatPane,
 * SkillsSidebar, SkillEditorModal) — no duplication. The only mode-specific
 * bit is the optional `agentMode='full-commander'` prop on ChatPane, which
 * is a backwards-compatible addition (default 'reels-pipeline' preserves
 * the AiAgentTab behavior).
 *
 * Layout:
 *   - Header: title + close button
 *   - Body: SkillsSidebar (collapsible on mobile) + ChatPane
 *   - Footer: ContextPanel (credits / jobs)
 */
import { useEffect, useState } from 'react';
import { X, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatPane } from '@/components/story-agent/ChatPane';
import { SkillsSidebar } from '@/components/story-agent/SkillsSidebar';
import { SkillEditorModal } from '@/components/story-agent/SkillEditorModal';
import { ContextPanel } from './ContextPanel';
import type { UserSkillDto } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AgentDrawer({ open, onClose }: Props) {
  const [activeSkillIds, setActiveSkillIds] = useState<number[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkillDto | null>(null);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);

  const activeSkillIdsKey = activeSkillIds.slice().sort((a, b) => a - b).join(',');

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editorOpen) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, editorOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 z-[70] h-full w-full sm:w-[520px] md:w-[680px] lg:w-[900px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!open}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#FFB300]" />
            <h2 className="text-sm font-semibold">AI Assistant</h2>
            <span className="text-[9px] font-bold px-1.5 py-px rounded bg-[#FFB300] text-black">
              NEW
            </span>
            <span className="text-[10px] text-muted-foreground hidden md:inline ml-1">
              · สั่งงานทุก feature ผ่านการแชท
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {/* Skills toggle (collapsible row) */}
        <button
          onClick={() => setSkillsOpen((x) => !x)}
          className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 border-b border-border shrink-0"
        >
          {skillsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          My Skills {activeSkillIds.length > 0 && `(${activeSkillIds.length} active)`}
        </button>

        {skillsOpen && (
          <div className="border-b border-border max-h-[40vh] overflow-y-auto shrink-0 p-2">
            <SkillsSidebar
              activeSkillIds={activeSkillIds}
              onActiveSkillsChange={setActiveSkillIds}
              onEditSkill={(s) => {
                setEditingSkill(s);
                setEditorOpen(true);
              }}
              onCreateSkill={() => {
                setEditingSkill(null);
                setEditorOpen(true);
              }}
              refreshKey={skillsRefreshKey}
            />
          </div>
        )}

        {/* Chat (existing ChatPane in full-commander mode) */}
        <div className="flex-1 flex flex-col min-h-0 p-3">
          <ChatPane
            activeSkillIds={activeSkillIds}
            activeSkillIdsKey={activeSkillIdsKey}
            agentMode="full-commander"
          />
        </div>

        {/* Context (collapsible) */}
        <button
          onClick={() => setContextOpen((x) => !x)}
          className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 border-t border-border shrink-0"
        >
          {contextOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          Credits + งานล่าสุด
        </button>
        {contextOpen && (
          <div className="border-t border-border max-h-[32vh] overflow-y-auto shrink-0">
            <ContextPanel />
          </div>
        )}
      </aside>

      {/* Skill editor modal — rendered via existing component, opens when user
          clicks edit/create in SkillsSidebar */}
      <SkillEditorModal
        open={editorOpen}
        editing={editingSkill}
        onClose={() => setEditorOpen(false)}
        onSaved={() => setSkillsRefreshKey((x) => x + 1)}
      />
    </>
  );
}
