'use client';

/**
 * PBL v2 — Right-column tabbed panel (SCENARIO ONLY, post-prep).
 *
 * Keeps the submission panel mounted across all stages. A scenario briefing
 * tab becomes available after preparation. In court mode, the workspace's
 * side rail controls the selected panel; elsewhere the ordinary tabs remain.
 * Short courtroom practice shows the case briefing from the start; learners
 * give their answer in the conversation rather than uploading a submission.
 *
 * Both panels stay MOUNTED and are toggled with CSS visibility (not unmounted).
 * This is deliberate: the submission panel owns an in-flight post-submit
 * evaluation stream and a draft modal; unmounting it on a tab switch would
 * abort the evaluation and drop local state. Hiding it leaves all of that
 * running untouched.
 */

import { useState } from 'react';
import { BookOpen, Upload } from 'lucide-react';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { cn } from '@/lib/utils/cn';
import { useI18n } from '@/lib/hooks/use-i18n';
import { PBLV2SubmissionPanel, type SubmissionEvaluationStatus } from './submission';
import { ScenarioBriefing } from './scene-stage/scenario-briefing';

type RightPanelTab = 'submission' | 'briefing';

interface Props {
  readonly project: PBLProjectV2;
  readonly onProjectChange: (next: PBLProjectV2) => void;
  readonly onEvaluationStatusChange: (status: SubmissionEvaluationStatus | null) => void;
  readonly onInstructorStreamingChange: (active: boolean) => void;
  readonly instructorStreaming: boolean;
  readonly showBriefing?: boolean;
  readonly selectedTab?: RightPanelTab;
  readonly hideTabs?: boolean;
}

export function PBLV2RightPanelTabs({
  project,
  onProjectChange,
  onEvaluationStatusChange,
  onInstructorStreamingChange,
  instructorStreaming,
  showBriefing = true,
  selectedTab,
  hideTabs = false,
}: Props) {
  const { t } = useI18n();
  // Default to the submission tab so the panel behaves exactly as before until
  // the learner actively reaches for the briefing.
  const [tab, setTab] = useState<RightPanelTab>('submission');
  if (project.courtroomPractice) return <ScenarioBriefing project={project} />;
  const activeTab = showBriefing ? (selectedTab ?? tab) : 'submission';

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className={cn('shrink-0 px-4 pt-4', (!showBriefing || hideTabs) && 'hidden')}>
        <div
          role="tablist"
          aria-label={t('pbl.v2.briefing.tablistLabel')}
          className="flex w-full rounded-full border border-border bg-card p-1"
        >
          <TabButton
            active={activeTab === 'submission'}
            onClick={() => setTab('submission')}
            icon={<Upload className="h-3.5 w-3.5" />}
            label={t('pbl.v2.briefing.submissionTab')}
          />
          <TabButton
            active={activeTab === 'briefing'}
            onClick={() => setTab('briefing')}
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label={t('pbl.v2.briefing.briefingTab')}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={cn('h-full', activeTab !== 'submission' && 'hidden')}>
          <PBLV2SubmissionPanel
            project={project}
            onProjectChange={onProjectChange}
            onEvaluationStatusChange={onEvaluationStatusChange}
            onInstructorStreamingChange={onInstructorStreamingChange}
            instructorStreaming={instructorStreaming}
          />
        </div>
        <div className={cn('h-full', activeTab !== 'briefing' && 'hidden')}>
          <ScenarioBriefing project={project} />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary/90 text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
