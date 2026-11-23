import type { NextRequest } from 'next/server';
import { hasCourtroomEvidence } from '@/lib/legal/courtroom';
import { formatCourtroomEvidence } from '@/lib/pbl/v2/operations/runtime/courtroom-evidence';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerApiError } from '@/lib/server/agent-runtime/route-response';
import { attachOwnerCookies, withRequestOwner } from '@/lib/server/identity/with-owner';

export interface CourtroomRuntimeScope {
  stageId?: string;
  sceneId?: string;
}

export async function withCourtroomRuntimeProject(
  req: NextRequest,
  body: CourtroomRuntimeScope & { project: PBLProjectV2 },
  run: (project: PBLProjectV2) => Promise<Response>,
): Promise<Response> {
  if (!hasCourtroomEvidence(body.project)) return run(body.project);
  return withRequestOwner(req, async (principal, headers) => {
    if (
      !body.stageId ||
      !body.sceneId ||
      ![body.stageId, body.sceneId].every(
        (id) => typeof id === 'string' && /^[\w-]{1,160}$/.test(id),
      )
    ) {
      return ownerApiError('INVALID_REQUEST', 400, '无法定位原案卷，请刷新课堂后重试。', headers);
    }
    const store = await getOwnerScopedDocumentStore(principal);
    const scene = await store.getScene(body.stageId, body.sceneId);
    const saved = scene?.content.type === 'pbl' ? scene.content.projectV2 : undefined;
    if (
      !saved ||
      !hasCourtroomEvidence(saved) ||
      saved.courtroomPractice?.caseId !== body.project.courtroomPractice?.caseId ||
      saved.milestones.length !== body.project.milestones.length ||
      saved.milestones.some((item, index) => item.id !== body.project.milestones[index]?.id) ||
      formatCourtroomEvidence(saved) !== formatCourtroomEvidence(body.project)
    ) {
      return ownerApiError(
        'INVALID_REQUEST',
        409,
        '案卷与保存版本不一致，请刷新课堂后重试。',
        headers,
      );
    }
    const authoredMilestones = new Map(
      saved.milestones.map((milestone) => [milestone.id, milestone]),
    );
    const project: PBLProjectV2 = {
      ...body.project,
      title: saved.title,
      description: saved.description,
      scenario: saved.scenario,
      workspacePresentation: saved.workspacePresentation,
      courtroomPractice: saved.courtroomPractice,
      milestones: body.project.milestones.map((milestone) => ({
        ...milestone,
        documents: authoredMilestones.get(milestone.id)?.documents,
      })),
    };
    return attachOwnerCookies(await run(project), headers.getSetCookie());
  });
}
