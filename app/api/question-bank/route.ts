import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { bankQuestionSchema } from '@/lib/legal/questions';
import { assessmentStore } from '@/lib/server/legal/assessment-service';
import { AssessmentConflictError } from '@/lib/persistence/legal-assessment';
import { ownerWriteErrorResponse } from '@/lib/persistence/owner-merges';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { ownerJson, ownerApiError } from '@/lib/server/agent-runtime/route-response';
import { readJsonBody } from '@/lib/server/generation/run/input';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
const log = createLogger('QuestionBank');

function failure(error: unknown, headers: Headers) {
  const ownerError = ownerWriteErrorResponse(error, headers);
  if (ownerError) return ownerError;
  if (error instanceof AssessmentConflictError || (error as { code?: string })?.code === '23505') {
    return ownerApiError('INVALID_REQUEST', 409, '题目已更新或存在重复内容，请刷新后重试', headers);
  }
  log.error('Question bank operation failed', error);
  return ownerApiError('INTERNAL_ERROR', 503, '题库暂时不可用，请稍后重试', headers);
}

export async function GET(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    try {
      const store = await assessmentStore();
      return ownerJson({ questions: await store.list(ownerId) }, 200, headers);
    } catch (error) {
      return failure(error, headers);
    }
  });
}

export async function POST(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    if (!body.ok)
      return ownerApiError('INVALID_REQUEST', body.status, '导入文件过大或内容无法读取', headers);
    const parsed = z
      .object({ questions: z.array(bankQuestionSchema).min(1).max(200) })
      .safeParse(body.value);
    if (!parsed.success)
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        '请检查题目的知识点、题干、选项和答案，每次最多导入 200 题',
        headers,
      );
    try {
      const store = await assessmentStore();
      const inserted = await store.import(ownerId, parsed.data.questions);
      return ownerJson(
        { inserted, skipped: parsed.data.questions.length - inserted },
        200,
        headers,
      );
    } catch (error) {
      return failure(error, headers);
    }
  });
}

export async function PATCH(req: NextRequest) {
  return withRequestOwner(req, async ({ ownerId }, headers) => {
    const body = await readJsonBody(req, 128 * 1024);
    if (!body.ok) return ownerApiError('INVALID_REQUEST', body.status, '题目内容无法读取', headers);
    const parsed = z
      .object({
        id: z.string().min(1).max(128),
        updatedAt: z.iso.datetime(),
        entry: bankQuestionSchema,
      })
      .safeParse(body.value);
    if (!parsed.success)
      return ownerApiError('INVALID_REQUEST', 400, '请检查题目填写是否完整', headers);
    try {
      const store = await assessmentStore();
      await store.update(ownerId, parsed.data.id, parsed.data.updatedAt, parsed.data.entry);
      return ownerJson({ saved: true }, 200, headers);
    } catch (error) {
      return failure(error, headers);
    }
  });
}
