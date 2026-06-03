/**
 * AiAgentTab — host of the AI Agent feature on the Content Scheduler page.
 *
 * Two modes:
 *   1. Chat (default)  — conversational agent driven by user skills (Claude Code-style)
 *   2. Classic Form    — the original topic + duration + Generate button form
 *
 * Chat mode is split 3 columns: SkillsSidebar | ChatPane | (future) JobStatus.
 */
import { useState } from 'react';
import { MessageSquare, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatPane } from './ChatPane';
import { SkillsSidebar } from './SkillsSidebar';
import { SkillEditorModal } from './SkillEditorModal';
import { AiAgentForm } from './AiAgentForm';
import type { UserSkillDto } from '@/lib/api';

type Mode = 'chat' | 'form';

export function AiAgentTab() {
  const [mode, setMode] = useState<Mode>('chat');
  const [activeSkillIds, setActiveSkillIds] = useState<number[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkillDto | null>(null);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);

  const activeSkillIdsKey = activeSkillIds.slice().sort((a, b) => a - b).join(',');

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={mode === 'chat' ? 'default' : 'outline'}
          onClick={() => setMode('chat')}
          className={mode === 'chat' ? 'bg-[#FFB300] hover:bg-[#FFB300]/80 text-black' : ''}
        >
          <MessageSquare className="h-4 w-4 mr-1" /> Chat mode
        </Button>
        <Button
          size="sm"
          variant={mode === 'form' ? 'default' : 'outline'}
          onClick={() => setMode('form')}
          className={mode === 'form' ? 'bg-[#FFB300] hover:bg-[#FFB300]/80 text-black' : ''}
        >
          <FileText className="h-4 w-4 mr-1" /> Classic form
        </Button>
      </div>

      {mode === 'chat' ? (
        <div className="flex gap-4 min-h-[70vh]">
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
          <ChatPane
            activeSkillIds={activeSkillIds}
            activeSkillIdsKey={activeSkillIdsKey}
          />
        </div>
      ) : (
        <AiAgentForm />
      )}

      <SkillEditorModal
        open={editorOpen}
        editing={editingSkill}
        onClose={() => setEditorOpen(false)}
        onSaved={() => setSkillsRefreshKey((x) => x + 1)}
      />
    </div>
  );
}
