import { getScenarioDocuments, hasCourtroomEvidence } from '@/lib/legal/courtroom';
import type { PBLProjectV2 } from '../../types';

export function formatCourtroomEvidence(project: PBLProjectV2): string | undefined {
  if (
    !project.scenario ||
    (!hasCourtroomEvidence(project) && project.workspacePresentationOverride !== 'courtroom')
  )
    return undefined;
  return JSON.stringify(
    getScenarioDocuments(project).map(({ id, title, content }) => ({ id, title, content })),
  );
}
