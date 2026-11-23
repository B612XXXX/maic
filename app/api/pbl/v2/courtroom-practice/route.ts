import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { buildCompleteScene } from '@openmaic/generation';
import { z } from 'zod';
import {
  CONTRACT_DELIVERY_CASE,
  COURTROOM_PRACTICE_IDS,
  COURTROOM_TOPIC_LIMIT,
  makeCourtroomOutline,
} from '@/lib/legal/courtroom';
import { generateCourtroomPracticeContent } from '@/lib/server/legal/courtroom-content';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { createGenerationAiCallFactory } from '@/lib/server/agent-runtime/generation-ai-call';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { isStageIdTakenError } from '@/lib/persistence/owner-bound-document-store';
import { createLogger } from '@/lib/logger';
import type { AppScene } from '@/lib/types/stage';

export const runtime = 'nodejs';
export const maxDuration = 90;

const log = createLogger('CourtroomPractice');
const bodySchema = z.object({
  caseId: z.enum(COURTROOM_PRACTICE_IDS),
  topic: z.string().trim().min(1).max(COURTROOM_TOPIC_LIMIT),
  sourceStageId: z.string().regex(/^[\w-]{1,140}$/),
});

export async function POST(req: NextRequest) {
  return withRequestOwner(req, async (principal, headers) => {
    const body = await readJsonBody(req, 4096);
    if (!body.ok)
      return ownerApiError('INVALID_REQUEST', body.status, '无法读取短练设置。', headers);
    const parsed = bodySchema.safeParse(body.value);
    if (!parsed.success) return ownerApiError('INVALID_REQUEST', 400, '短练设置无效。', headers);
    const { caseId, sourceStageId } = parsed.data;
    const topic =
      caseId === CONTRACT_DELIVERY_CASE
        ? '合同解除与预付款返还'
        : parsed.data.topic.replace(/\s+/g, ' ');
    const suffix = createHash('sha256')
      .update(JSON.stringify([principal.ownerId, sourceStageId, caseId, topic]))
      .digest('hex')
      .slice(0, 24);
    const stageId = `stage-courtroom-${suffix}`;
    const result = { classroomUrl: `/classroom/${stageId}` };

    try {
      const store = await getOwnerScopedDocumentStore(principal);
      if (await store.loadDocument(stageId)) return ownerJson(result, 200, headers);
      if (!(await store.loadDocument(sourceStageId))) return ownerNotFound(headers);
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(80_000)]);
      const outline = makeCourtroomOutline({ caseId, topic }, 1);
      const languageDirective = '使用简体中文。';
      const content = await generateCourtroomPracticeContent(
        outline,
        createGenerationAiCallFactory({ ownerId: principal.ownerId, abortSignal: signal })(
          'scene-content:pbl',
        ),
        { languageDirective, targetLanguage: 'zh-CN', signal },
      );
      content.projectV2.courtroomPractice = { caseId, returnStageId: sourceStageId };
      const scene = buildCompleteScene(outline, content, [], stageId, {
        sceneId: `courtroom-${suffix}`,
      });
      if (!scene) throw new Error('Could not assemble the courtroom practice scene.');
      const now = Date.now();
      try {
        await store.createDocument({
          stage: {
            id: stageId,
            name: outline.title,
            languageDirective,
            createdAt: now,
            updatedAt: now,
          },
          scenes: [scene as AppScene],
          outline: {
            outlines: [outline],
            requirement: outline.description,
            generationComplete: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      } catch (error) {
        if (!isStageIdTakenError(error) || !(await store.loadDocument(stageId))) throw error;
      }
      return ownerJson(result, 200, headers);
    } catch (error) {
      const ownerError = ownerWriteErrorResponse(error, headers);
      if (ownerError) return ownerError;
      log.error('Could not launch courtroom practice', error);
      return ownerApiError(
        'INTERNAL_ERROR',
        502,
        '暂时无法打开短练，可以重试或继续原课程。',
        headers,
      );
    }
  });
}
