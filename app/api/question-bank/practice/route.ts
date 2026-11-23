import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { buildCompleteScene } from '@openmaic/generation';
import { practiceRequestSchema } from '@/lib/legal/questions';
import { generateAssessment } from '@/lib/server/legal/assessment-service';
import { AssessmentBusyError, AssessmentConflictError } from '@/lib/persistence/legal-assessment';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { isStageIdTakenError } from '@/lib/persistence/owner-bound-document-store';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { ownerJson, ownerApiError } from '@/lib/server/agent-runtime/route-response';
import { createGenerationAiCallFactory } from '@/lib/server/agent-runtime/generation-ai-call';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { readJsonBody } from '@/lib/server/generation/run/input';
import type { SceneOutline } from '@/lib/types/generation';
import type { AppScene } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;
const log = createLogger('LegalPractice');

export async function POST(req: NextRequest) {
  return withRequestOwner(req, async (principal, headers) => {
    const body = await readJsonBody(req, 8192);
    if (!body.ok) return ownerApiError('INVALID_REQUEST', body.status, '练习设置无法读取', headers);
    const parsed = practiceRequestSchema.safeParse(body.value);
    if (!parsed.success)
      return ownerApiError('INVALID_REQUEST', 400, '请填写主题并选择 1 至 10 道题', headers);
    const input = parsed.data;
    const outline: SceneOutline = {
      id: 'practice',
      order: 1,
      type: 'quiz',
      title: input.topic,
      description: `面向法学专业学生和法学爱好者的${input.topic}练习`,
      keyPoints: [input.topic],
      quizConfig: {
        questionCount: input.count,
        questionTypes: [input.type === 'short_answer' ? 'text' : input.type],
        difficulty: input.difficulty,
      },
    };
    try {
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(290000)]);
      const result = await generateAssessment({
        ownerId: principal.ownerId,
        selectionKey: `practice:${input.requestId}`,
        outline,
        languageDirective: '使用简体中文，解释必要的法律术语。',
        signal,
        aiCall: createGenerationAiCallFactory({ ownerId: principal.ownerId, abortSignal: signal })(
          'scene-content:quiz',
        ),
      });
      const suffix = createHash('sha256')
        .update(`${principal.ownerId}\0${input.requestId}\0${JSON.stringify(result.questions)}`)
        .digest('hex')
        .slice(0, 24);
      const stageId = `stage-practice-${suffix}`;
      const scene = buildCompleteScene(outline, { questions: result.questions }, [], stageId, {
        sceneId: `quiz-${suffix}`,
      });
      if (!scene) throw new Error('Could not assemble practice');
      const store = await getOwnerScopedDocumentStore(principal);
      const now = Date.now();
      try {
        await store.createDocument({
          stage: { id: stageId, name: `${input.topic}练习`, createdAt: now, updatedAt: now },
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
        if (!isStageIdTakenError(error)) throw error;
        if (!(await store.loadDocument(stageId))) throw error;
      }
      return ownerJson(
        {
          classroomUrl: `/classroom/${stageId}`,
          count: result.questions.length,
          bankCount: result.bankCount,
          generatedCount: result.generatedCount,
          missing: result.missing,
          searchStatus: result.searchStatus,
        },
        200,
        headers,
      );
    } catch (error) {
      const ownerError = ownerWriteErrorResponse(error, headers);
      if (ownerError) return ownerError;
      if (error instanceof AssessmentBusyError || error instanceof AssessmentConflictError) {
        return ownerApiError('INVALID_REQUEST', 409, error.message, headers);
      }
      log.error('Practice generation failed', error);
      return ownerApiError(
        'INTERNAL_ERROR',
        502,
        '练习暂未生成完成，请检查模型设置后重试。已经选到的题目会保留。',
        headers,
      );
    }
  });
}
