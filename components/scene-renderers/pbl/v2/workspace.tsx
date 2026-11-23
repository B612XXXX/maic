'use client';

/**
 * PBL v2 — Workspace shell.
 *
 * Three-column layout: stage tree sidebar (left, ~22%), agent chat
 * (center, ~52%), submission / hints side panel (right, ~26%).
 * Hidden when `uiPhase` is not 'workspace' — the parent renderer
 * routes other phases to Hero / Completion. The Workspace itself
 * doesn't manage navigation between phases; it just renders the
 * one it's been asked to show.
 */

import type { PBLMilestone, PBLProjectV2 } from '@/lib/pbl/v2/types';
import Image from 'next/image';
import { BookOpen, Maximize2, Upload, Workflow, X } from 'lucide-react';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { PBLV2Sidebar } from './sidebar';
import { PBLV2AgentTabs } from './agent-tabs';
import type { SubmissionEvaluationStatus } from './submission';
import { PBLV2RightPanelTabs } from './right-panel-tabs';
import { shouldShowScenarioBriefing } from './scenario-briefing-gate';
import { cn } from '@/lib/utils/cn';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { CSSProperties } from 'react';
import { runOneStream, type StreamDisplayState, type StreamStatus } from './use-instructor-stream';
import type { PBLProjectPatch } from '@/lib/pbl/v2/api/sse';
import { Courtroom } from './courtroom';
import { displayedMilestone, usesCourtroom } from './courtroom-state';
import { PBL_THEME } from './theme';

interface Props {
  readonly project: PBLProjectV2;
  readonly onProjectChange: (next: PBLProjectV2) => void;
  /** Leave the workspace and go back to the Hero, keeping all progress.
   *  Hero then offers "Continue project" (progress intact) + a reset. */
  readonly onReturnToHero: () => void;
  /** True while an Instructor / evaluator stream is in flight (including one
   *  started before this workspace remounted). Threaded to the chat so its
   *  "thinking…" indicator survives a Hero ↔ workspace round trip. */
  readonly instructorStreaming: boolean;
  readonly onInstructorStreamingChange: (active: boolean) => void;
  /** When provided, render an "expand to fullscreen workspace" button
   *  (inline mode). Absent when rendered inside the immersive overlay. */
  readonly onExpand?: () => void;
}

type PanelSlot = 'sidebar' | 'chat' | 'submission';
type ResizeHandleSide = 'left' | 'right';

const DEFAULT_PANEL_WIDTHS = {
  sidebar: 22,
  chat: 52,
  submission: 26,
};

const PANEL_LIMITS = {
  sidebarMin: 15,
  sidebarMax: 36,
  chatMin: 34,
  submissionMin: 18,
  submissionMax: 38,
};

function streamStatusForEvaluationKind(kind: unknown): StreamStatus {
  if (kind === 'final') return 'eval-final';
  if (kind === 'milestone') return 'eval-milestone';
  if (kind === 'task') return 'eval-task';
  return 'instructor';
}

interface CompleteTaskPayload {
  project?: PBLProjectV2;
  completedMicrotaskId?: string;
  milestoneId?: string;
  milestoneCompleted?: boolean;
  projectCompleted?: boolean;
  nextMicrotaskId?: string;
}

export function PBLV2Workspace({
  project,
  onProjectChange,
  onReturnToHero,
  instructorStreaming,
  onInstructorStreamingChange,
  onExpand,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const courtroom = usesCourtroom(project);
  const stageId = displayedMilestone(project)?.id;
  const [drawer, setDrawer] = useState<{ stageId?: string; tab: 'submission' | 'briefing' } | null>(
    null,
  );
  const drawerTab = courtroom && drawer && drawer.stageId === stageId ? drawer.tab : null;
  const closeDrawer = () => {
    setDrawer(null);
    drawerTriggerRef.current?.focus();
  };
  const openDrawer = (tab: 'submission' | 'briefing', trigger?: HTMLButtonElement) => {
    if (drawerTab === tab) {
      closeDrawer();
      return;
    }
    drawerTriggerRef.current =
      trigger ??
      rootRef.current?.querySelector<HTMLButtonElement>('[data-court-briefing-trigger]') ??
      null;
    setDrawer({ stageId, tab });
    requestAnimationFrame(() => drawerCloseRef.current?.focus());
  };
  const [panelWidths, setPanelWidths] = useState(DEFAULT_PANEL_WIDTHS);
  const [resizingHandle, setResizingHandle] = useState<ResizeHandleSide | null>(null);
  const [submissionEvaluationStatus, setSubmissionEvaluationStatus] =
    useState<SubmissionEvaluationStatus | null>(null);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [workspaceStream, setWorkspaceStream] = useState<StreamDisplayState | null>(null);
  const activeMilestoneIndex = useMemo(() => workspaceActiveMilestoneIndex(project), [project]);

  // SCENARIO ONLY. Once the learner has ENTERED the scenario (the prep stage is
  // complete), the right column gains a "scenario briefing" tab beside the
  // submission panel. `prep` only ever transitions to `completed`, so this
  // stays true for the rest of the run — through every roleplay stage, the
  // wrapup, and after returning from the completion page. Non-scenario projects
  // (and scenario projects still in prep) keep the bare submission panel, so
  // there is zero change for them.
  const showScenarioBriefing = useMemo(() => shouldShowScenarioBriefing(project), [project]);

  // SCENARIO ONLY. The sidebar scene controls all hit the same stateless
  // task/update endpoint (no LLM, no eval) and replace the local project
  // with the server-mutated result:
  //   - enter_scenario     → prep → first roleplay stage (+ divider)
  //   - continue_handover  → consume a staged handover → next stage (+ divider)
  // There is NO manual beat-advance control: within a roleplay stage, beats
  // advance ONLY when the engine detects the learner actually did them.
  // Ordinary projects never render these buttons; the server rejects any
  // action that is not a scenario stage in the right state.
  const runSceneAction = useCallback(
    async (action: 'enter_scenario' | 'continue_handover' | 'complete_act') => {
      if (sceneBusy) return;
      setSceneBusy(true);
      try {
        const res = await fetch('/api/pbl/v2/task/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project, action }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          data?: { project?: PBLProjectV2 };
          project?: PBLProjectV2;
        };
        const nextProject = data.data?.project ?? data.project;
        if (nextProject) onProjectChange(nextProject);
      } catch {
        /* transient; the button stays available for retry */
      } finally {
        setSceneBusy(false);
      }
    },
    [sceneBusy, project, onProjectChange],
  );
  const handleEnterScenario = useCallback(() => runSceneAction('enter_scenario'), [runSceneAction]);
  const handleContinueHandover = useCallback(
    () => runSceneAction('continue_handover'),
    [runSceneAction],
  );
  // ACT MODEL. Finish the current roleplay act. No confirmation: an act may
  // legitimately hold a single hidden beat that one learner turn satisfies, so
  // "finished after one message" is a valid path — not something to second-guess.
  // The button itself only appears once the learner has engaged the scene
  // (sidebar gates on ≥1 learner message), which is the only guard needed.
  const handleCompleteAct = useCallback(() => {
    void runSceneAction('complete_act');
  }, [runSceneAction]);

  const runWorkspaceStream = useCallback(
    async (startingProject: PBLProjectV2, status: StreamStatus, body: Record<string, unknown>) => {
      setWorkspaceStream({ status, draftAssistant: '', streamCommittedOutput: false });
      return runOneStream({
        endpoint: status === 'instructor' ? '/api/pbl/v2/open-task' : '/api/pbl/v2/evaluate',
        body,
        startingProject,
        setDraftAssistant: (update) => {
          setWorkspaceStream((current) => {
            const base =
              current && current.status === status
                ? current
                : { status, draftAssistant: '', streamCommittedOutput: false };
            return { ...base, draftAssistant: update(base.draftAssistant) };
          });
        },
        onPatch: (patch: PBLProjectPatch) => {
          if (patch.kind === 'message' || patch.kind === 'evaluation') {
            setWorkspaceStream((current) =>
              current ? { ...current, draftAssistant: '', streamCommittedOutput: true } : current,
            );
          }
        },
        onProjectUpdated: onProjectChange,
      });
    },
    [onProjectChange],
  );

  const runEvaluationPhase = useCallback(
    async (
      startingProject: PBLProjectV2,
      kind: 'task' | 'milestone' | 'final',
      body: Record<string, unknown>,
    ) => runWorkspaceStream(startingProject, streamStatusForEvaluationKind(kind), body),
    [runWorkspaceStream],
  );

  const runTaskOpenerPhase = useCallback(
    async (startingProject: PBLProjectV2) =>
      runWorkspaceStream(startingProject, 'instructor', {
        project: startingProject,
        phase: 'setup',
      }),
    [runWorkspaceStream],
  );

  const handleCompleteTask = useCallback(async () => {
    if (taskBusy || instructorStreaming || submissionEvaluationStatus) return;
    setTaskBusy(true);
    onInstructorStreamingChange(true);
    try {
      const res = await fetch('/api/pbl/v2/task/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, action: 'complete_pending_task' }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as CompleteTaskPayload & { data?: CompleteTaskPayload };
      const payload: CompleteTaskPayload = data.data ?? data;
      let nextProject = payload.project;
      if (!nextProject) return;
      onProjectChange(nextProject);

      if (payload.milestoneCompleted && payload.milestoneId) {
        nextProject = await runEvaluationPhase(nextProject, 'milestone', {
          project: nextProject,
          kind: 'milestone',
          milestoneId: payload.milestoneId,
        });
      }
      if (payload.projectCompleted) {
        nextProject = await runEvaluationPhase(nextProject, 'final', {
          project: nextProject,
          kind: 'final',
        });
      }
      if (!payload.milestoneCompleted && payload.nextMicrotaskId) {
        await runTaskOpenerPhase(nextProject);
      }
    } catch {
      /* transient; the button stays available for retry */
    } finally {
      setTaskBusy(false);
      setWorkspaceStream(null);
      onInstructorStreamingChange(false);
    }
  }, [
    taskBusy,
    instructorStreaming,
    submissionEvaluationStatus,
    onProjectChange,
    onInstructorStreamingChange,
    project,
    runEvaluationPhase,
    runTaskOpenerPhase,
  ]);
  const handleResizeStart = useCallback(
    (event: ReactMouseEvent, side: ResizeHandleSide) => {
      event.preventDefault();
      const root = rootRef.current;
      if (!root) return;

      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return;
      const startWidths = panelWidths;
      setResizingHandle(side);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const pointerPercent = ((moveEvent.clientX - rect.left) / rect.width) * 100;

        setPanelWidths(() => {
          if (side === 'left') {
            const pairTotal = startWidths.sidebar + startWidths.chat;
            const nextSidebar = clamp(
              pointerPercent,
              PANEL_LIMITS.sidebarMin,
              Math.min(PANEL_LIMITS.sidebarMax, pairTotal - PANEL_LIMITS.chatMin),
            );
            return {
              sidebar: nextSidebar,
              chat: pairTotal - nextSidebar,
              submission: startWidths.submission,
            };
          }

          const pairTotal = startWidths.chat + startWidths.submission;
          const nextSubmission = clamp(
            100 - pointerPercent,
            PANEL_LIMITS.submissionMin,
            Math.min(PANEL_LIMITS.submissionMax, pairTotal - PANEL_LIMITS.chatMin),
          );
          return {
            sidebar: startWidths.sidebar,
            chat: pairTotal - nextSubmission,
            submission: nextSubmission,
          };
        });
      };

      const handleMouseUp = () => {
        setResizingHandle(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelWidths],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative grid h-full w-full overflow-hidden bg-background text-foreground ring-1 ring-border',
        'shadow-[0_16px_60px_rgba(104,67,25,0.08)]',
      )}
      data-pbl-workspace="true"
      data-workspace-view={courtroom ? 'courtroom' : 'standard'}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          drawerTab &&
          !(event.target as HTMLElement).closest('[role="dialog"]')
        ) {
          event.preventDefault();
          closeDrawer();
        }
      }}
      style={{
        ...PBL_THEME,
        gridTemplateRows: '58px minmax(0, 1fr)',
        gridTemplateColumns: `${panelWidths.sidebar}fr 6px ${panelWidths.chat}fr 6px ${panelWidths.submission}fr`,
      }}
    >
      <WorkspaceTopBar
        project={project}
        activeMilestoneIndex={activeMilestoneIndex}
        panelWidths={panelWidths}
        onReturnToHero={onReturnToHero}
        onExpand={onExpand}
        onProjectChange={onProjectChange}
        busy={instructorStreaming || sceneBusy || taskBusy}
      />
      <Panel slot="sidebar">
        {/* Scene controls ("finish this act" / enter / continue) are disabled
            while ANYTHING is generating: character speaking, narrator,
            evaluation, submission analysis and opener streams all flip
            `instructorStreaming` (ref-counted across remounts). It is never the
            learner's turn to advance the scene mid-generation, so gating here
            stops a click from racing an in-flight stream and corrupting state. */}
        <PBLV2Sidebar
          project={project}
          onEnterScenario={handleEnterScenario}
          onContinueHandover={handleContinueHandover}
          onCompleteAct={handleCompleteAct}
          onCompleteTask={handleCompleteTask}
          sceneBusy={sceneBusy || instructorStreaming}
          taskBusy={taskBusy}
        />
      </Panel>
      <WorkspaceResizeHandle
        side="left"
        active={resizingHandle === 'left'}
        onMouseDown={handleResizeStart}
      />
      <Panel
        slot="chat"
        style={courtroom ? { gridColumn: '3 / -1' } : undefined}
        contentClassName="flex flex-col min-h-0"
      >
        {courtroom && (
          <Courtroom
            project={project}
            busy={instructorStreaming && !submissionEvaluationStatus}
            onBriefing={() => openDrawer('briefing')}
          />
        )}
        <PBLV2AgentTabs
          project={project}
          onProjectChange={onProjectChange}
          submissionEvaluationStatus={submissionEvaluationStatus}
          instructorStreaming={instructorStreaming}
          onInstructorStreamingChange={onInstructorStreamingChange}
          externalStream={workspaceStream}
          courtroom={courtroom}
        />
      </Panel>
      <WorkspaceResizeHandle
        side="right"
        hidden={courtroom}
        active={resizingHandle === 'right'}
        onMouseDown={handleResizeStart}
      />
      <Panel
        slot="submission"
        className={courtroom ? 'rounded-xl border border-border shadow-xl' : undefined}
        style={
          courtroom
            ? {
                position: 'absolute',
                top: 70,
                right: 62,
                bottom: 12,
                width: 'min(380px, calc(78% - 76px))',
                height: 'auto',
                zIndex: 55,
                display: drawerTab ? undefined : 'none',
              }
            : undefined
        }
      >
        <div
          id={drawerId}
          role={courtroom ? 'region' : undefined}
          aria-label={courtroom ? (drawerTab === 'briefing' ? '情景简报' : '提交区') : undefined}
          className="flex h-full min-h-0 flex-col"
        >
          {courtroom && (
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3 text-sm font-semibold">
              <span>{drawerTab === 'briefing' ? '情景简报' : '提交区'}</span>
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={closeDrawer}
                aria-label="收起侧栏"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <PBLV2RightPanelTabs
            project={project}
            onProjectChange={onProjectChange}
            onEvaluationStatusChange={setSubmissionEvaluationStatus}
            onInstructorStreamingChange={onInstructorStreamingChange}
            instructorStreaming={instructorStreaming}
            showBriefing={showScenarioBriefing}
            selectedTab={courtroom ? (drawerTab ?? 'submission') : undefined}
            hideTabs={courtroom}
          />
        </div>
      </Panel>
      {courtroom && (
        <div
          className="absolute right-2 top-[78px] z-50 flex w-11 flex-col gap-3"
          aria-label="法庭辅助面板"
        >
          {!project.courtroomPractice && (
            <button
              type="button"
              aria-label="展开提交区"
              aria-expanded={drawerTab === 'submission'}
              aria-controls={drawerId}
              onClick={(event) => openDrawer('submission', event.currentTarget)}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-2 py-3 text-xs text-primary shadow-sm hover:bg-accent"
            >
              <Upload size={17} />
              <span>提交区</span>
            </button>
          )}
          <button
            type="button"
            data-court-briefing-trigger
            aria-label="展开情景简报"
            aria-expanded={drawerTab === 'briefing'}
            aria-controls={drawerId}
            onClick={(event) => openDrawer('briefing', event.currentTarget)}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-2 py-3 text-xs text-primary shadow-sm hover:bg-accent"
          >
            <BookOpen size={17} />
            <span>情景简报</span>
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceTopBar({
  project,
  activeMilestoneIndex,
  panelWidths,
  onReturnToHero,
  onExpand,
  onProjectChange,
  busy,
}: {
  readonly project: PBLProjectV2;
  readonly activeMilestoneIndex: number;
  readonly panelWidths: typeof DEFAULT_PANEL_WIDTHS;
  readonly onReturnToHero: () => void;
  readonly onExpand?: () => void;
  readonly onProjectChange: (next: PBLProjectV2) => void;
  readonly busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <header
      className="relative z-40 col-span-full grid min-w-0 items-center overflow-hidden border-b border-border bg-[#fffaf2]/88 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_14px_42px_rgba(163,108,38,0.1)] backdrop-blur-xl"
      style={{
        gridTemplateColumns: `${panelWidths.sidebar}fr 6px ${panelWidths.chat}fr 6px ${panelWidths.submission}fr`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(163,108,38,0.20),transparent_30%),radial-gradient(circle_at_78%_0%,rgba(192,148,82,0.13),transparent_26%),linear-gradient(90deg,rgba(255,255,255,0.05),transparent_34%,rgba(255,255,255,0.035))]" />
      <div className="relative flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-primary/10 shadow-[0_0_24px_rgba(163,108,38,0.18)]">
          <Image
            src="/openmaic-mark.png"
            alt="OpenMAIC"
            width={28}
            height={28}
            className="h-6 w-6"
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="line-clamp-1 text-base font-semibold tracking-tight text-foreground">
              {project.title}
            </h2>
          </div>
          {/* Breadcrumb doubles as the "back to Hero" affordance: the brand
              (logo + project name) stays pinned top-left, and the "up" nav lives
              in the breadcrumb per standard SaaS practice (directional back is
              not placed in the top-right utility zone). */}
          <nav
            className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
            aria-label={t('pbl.v2.workspace.returnToHero')}
          >
            <button
              type="button"
              onClick={onReturnToHero}
              title={t('pbl.v2.workspace.returnToHero')}
              className="rounded bg-gradient-to-r from-amber-800 via-amber-700 to-amber-600 bg-clip-text text-transparent transition-opacity hover:opacity-80 focus-visible:underline focus-visible:outline-none"
            >
              {t('pbl.v2.workspace.breadcrumbOverview')}
            </button>
            <span aria-hidden className="text-primary">
              ›
            </span>
            <span className="text-primary">{t('pbl.v2.workspace.breadcrumbCurrent')}</span>
          </nav>
        </div>
      </div>

      <div className="relative col-start-3 hidden min-w-0 items-center gap-2 lg:flex">
        <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-primary">
          <Workflow className="h-3.5 w-3.5 text-primary" />
          {t('pbl.v2.workspace.progressLabel')}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {project.milestones.map((milestone, index) => {
            const active = index === activeMilestoneIndex;
            const completed = milestone.status === 'completed';
            return (
              <div
                key={milestone.id}
                className="group relative flex min-w-0 flex-1 items-center"
                title={milestone.title}
              >
                <div
                  className={cn(
                    'h-1.5 min-w-4 flex-1 rounded-full transition-colors',
                    completed && 'bg-primary/45',
                    active && 'bg-primary',
                    !active && !completed && 'bg-card',
                  )}
                />
                {active && (
                  <div
                    className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-primary/10 shadow-[0_0_18px_rgba(163,108,38,0.1)] transition-[left] duration-500 ease-out"
                    style={{ left: `${milestoneProgressFraction(milestone) * 100}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {project.scenario && (
        <select
          aria-label="情景工作区样式"
          value={
            project.workspacePresentationOverride ?? project.workspacePresentation ?? 'standard'
          }
          disabled={busy}
          onChange={(event) =>
            onProjectChange({
              ...project,
              workspacePresentationOverride: event.target.value as 'standard' | 'courtroom',
              updatedAt: new Date().toISOString(),
            })
          }
          className="relative col-start-5 mr-10 max-w-full justify-self-end rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
        >
          <option value="standard">情景对话</option>
          <option value="courtroom">模拟法庭</option>
        </select>
      )}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="absolute right-3 top-1/2 z-50 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-card text-primary shadow-sm backdrop-blur transition-colors hover:bg-card"
          aria-label={t('pbl.v2.workspace.enterFullscreen')}
          title={t('pbl.v2.workspace.enterFullscreen')}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
    </header>
  );
}

/** Horizontal position (0..1) of the progress dot WITHIN the active
 *  milestone's bar segment, derived from how far the learner is through
 *  that milestone's own microtasks. The first task sits near the head,
 *  the last near the tail (a small margin keeps the dot off the very
 *  edges), evenly spaced in between. A single-task milestone centers the
 *  dot. The count is read off the milestone's OWN `microtasks`, so each
 *  stage uses its own task total — stage A's 2 tasks never get mixed with
 *  stage B's 3. */
function milestoneProgressFraction(milestone: PBLMilestone): number {
  const EDGE_MARGIN = 0.12;
  const total = milestone.microtasks.length;
  if (total <= 1) return 0.5;
  let index = milestone.microtasks.findIndex(
    (task) => task.status === 'todo' || task.status === 'in_progress',
  );
  // No open task left (all completed/skipped) → the learner is at the end
  // of this milestone, so pin the dot to the tail.
  if (index < 0) index = total - 1;
  return EDGE_MARGIN + (index / (total - 1)) * (1 - 2 * EDGE_MARGIN);
}

export function workspaceActiveMilestoneIndex(project: PBLProjectV2): number {
  const activeIndex = project.milestones.findIndex((milestone) => milestone.status === 'active');
  if (activeIndex >= 0) return activeIndex;
  if (project.status === 'completed') return -1;
  return project.milestones.length > 0 ? 0 : -1;
}

function WorkspaceResizeHandle({
  side,
  active,
  hidden = false,
  onMouseDown,
}: {
  readonly side: ResizeHandleSide;
  readonly active: boolean;
  readonly hidden?: boolean;
  readonly onMouseDown: (event: ReactMouseEvent, side: ResizeHandleSide) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="separator"
      style={hidden ? { display: 'none' } : undefined}
      aria-orientation="vertical"
      aria-label={
        side === 'left'
          ? t('pbl.v2.workspace.resizeSidebar')
          : t('pbl.v2.workspace.resizeSubmission')
      }
      className={cn(
        'group relative z-30 row-start-2 h-full cursor-col-resize select-none bg-transparent',
        active && 'bg-primary/[0.04]',
      )}
      onMouseDown={(event) => onMouseDown(event, side)}
    >
      <div
        className={cn(
          'absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary/10 transition-colors',
          'group-hover:bg-primary/55',
          active && 'bg-primary/75',
        )}
      />
      <div
        className={cn(
          'absolute left-1/2 top-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/60 opacity-0 shadow-[0_0_14px_rgba(163,108,38,0.28)] transition-all',
          'group-hover:h-14 group-hover:opacity-100',
          active && 'h-16 opacity-100',
        )}
      />
    </div>
  );
}

function Panel({
  slot,
  children,
  className,
  contentClassName,
  style,
}: {
  readonly slot: PanelSlot;
  readonly children: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        'relative row-start-2 h-full min-w-0 overflow-hidden bg-card',
        slot === 'sidebar' && 'bg-[#f2eadf]',
        slot === 'chat' && 'bg-[#fcf8f1]',
        slot === 'submission' && 'bg-[#f8f1e5]',
        className,
      )}
      style={style}
    >
      <div className={cn('relative z-10 h-full', contentClassName)}>{children}</div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
