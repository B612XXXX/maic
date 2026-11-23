import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { getScenarioDocuments } from '@/lib/legal/courtroom';

/** A handover still belongs to the stage being reviewed, until Continue activates the next. */
export function displayedMilestone(project: PBLProjectV2) {
  const active = project.milestones.find((milestone) => milestone.status === 'active');
  if (active) return active;
  const handover = project.pendingHandover;
  if (handover && !handover.consumed) {
    return project.milestones.find((milestone) => milestone.id === handover.completedMilestoneId);
  }
  return undefined;
}

/** Explicit presentation opt-in; ordinary roleplay projects never become courtrooms by title. */
export function usesCourtroom(project: PBLProjectV2): boolean {
  return (
    (project.workspacePresentationOverride ?? project.workspacePresentation) === 'courtroom' &&
    !!project.scenario &&
    displayedMilestone(project)?.scenarioStage === 'roleplay'
  );
}

export function courtroomSide(project: PBLProjectV2): 'plaintiff' | 'defendant' {
  const role = project.scenario?.learnerRole ?? '';
  return /被告|辩护|defen[cs]e|defendant/i.test(role) ? 'defendant' : 'plaintiff';
}

/** Preparation documents remain available through every act; keep stable IDs and avoid duplicates. */
export const courtroomDocuments = getScenarioDocuments;
