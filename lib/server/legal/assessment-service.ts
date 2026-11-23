import { createHash } from 'node:crypto';
import { generateSceneContent, type AICallFn } from '@openmaic/generation';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  AssessmentBusyError,
  AssessmentConflictError,
  LegalAssessmentStore,
  questionFingerprint,
} from '@/lib/persistence/legal-assessment';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { isOwnerRetiredError } from '@/lib/persistence/owner-merges';
import { backgroundWorkspaceId } from '@/lib/server/model-config/runtime';
import { resolveClassroomWebSearchConfig } from '@/lib/server/web-search-config';
import { formatSearchResultsAsContext, searchWeb } from '@/lib/web-search';
import type { AssessmentResult, BankQuestion } from '@/lib/legal/questions';
import { bankQuestionSchema } from '@/lib/legal/questions';
import type { SceneOutline } from '@/lib/types/generation';
import type { QuizQuestion } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

const log = createLogger('LegalAssessment');

export async function assessmentStore(): Promise<LegalAssessmentStore> {
  const { pool, withTransaction } = await getServerPersistenceProvider(
    process.env.DATABASE_URL ?? '',
  );
  return new LegalAssessmentStore(pool as unknown as Queryable, withTransaction);
}

export function matchesAssessment(entry: BankQuestion, outline: SceneOutline): boolean {
  const config = outline.quizConfig;
  if (!entry.enabled || (config?.difficulty && entry.difficulty !== config.difficulty))
    return false;
  const type = entry.question.type === 'short_answer' ? 'text' : entry.question.type;
  if (config?.questionTypes?.length && !config.questionTypes.includes(type)) return false;
  const text = [outline.title, outline.description, ...(outline.keyPoints ?? [])]
    .join(' ')
    .toLowerCase();
  return [entry.topic, ...entry.tags].some((tag) => text.includes(tag.toLowerCase()));
}

async function researchQuestions(ownerId: string, topic: string, signal?: AbortSignal) {
  try {
    const config = await resolveClassroomWebSearchConfig(ownerId);
    if (!config) return { text: '', status: 'unavailable' as const };
    const bounded = AbortSignal.timeout(15000);
    const result = await searchWeb({
      ...config,
      query: `${topic} 练习 参考资料`,
      signal: signal ? AbortSignal.any([signal, bounded]) : bounded,
    });
    return { text: formatSearchResultsAsContext(result).slice(0, 16000), status: 'used' as const };
  } catch (error) {
    if (signal?.aborted) throw error;
    log.warn('Question search unavailable, continuing with the course material', error);
    return { text: '', status: 'failed' as const };
  }
}

interface AssessmentInput {
  ownerId: string;
  selectionKey: string;
  courseKey?: string;
  outline: SceneOutline;
  aiCall: AICallFn;
  languageDirective?: string;
  materials?: string;
  signal?: AbortSignal;
}

type SelectionStore = Pick<
  LegalAssessmentStore,
  'claim' | 'save' | 'list' | 'release' | 'usedQuestions'
>;
interface AssessmentDeps {
  store?: SelectionStore;
  search?: typeof researchQuestions;
  resolveOwner?: (ownerId: string) => Promise<string>;
}

/** Both course entry points and the empty-bank practice page use this selection. */
export async function generateAssessment(
  input: AssessmentInput,
  deps: AssessmentDeps = {},
): Promise<AssessmentResult> {
  const store = deps.store ?? (await assessmentStore());
  const resolveOwner = deps.resolveOwner ?? backgroundWorkspaceId;
  const asOwner = async <T>(operation: (owner: string) => Promise<T>): Promise<T> => {
    const owner = await resolveOwner(input.ownerId);
    try {
      return await operation(owner);
    } catch (error) {
      if (!isOwnerRetiredError(error)) throw error;
      return operation(await resolveOwner(input.ownerId));
    }
  };
  const config = input.outline.quizConfig ?? {
    questionCount: 3,
    difficulty: 'medium' as const,
    questionTypes: ['single' as const],
  };
  const count = config.questionCount;
  const specHash = createHash('sha256')
    .update(
      JSON.stringify({
        outline: input.outline,
        language: input.languageDirective,
        materials: input.materials,
      }),
    )
    .digest('hex');
  let lease: Awaited<ReturnType<SelectionStore['claim']>>;
  for (;;) {
    input.signal?.throwIfAborted();
    try {
      lease = await asOwner((owner) =>
        store.claim(owner, input.selectionKey, specHash, input.courseKey),
      );
      break;
    } catch (error) {
      if (!(error instanceof AssessmentBusyError) || !input.courseKey) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (lease.complete && lease.result) return lease.result;
  let result: AssessmentResult = lease.result ?? {
    questions: [],
    bankCount: 0,
    generatedCount: 0,
    missing: count,
    searchStatus: 'unused',
  };
  const save = (release: boolean) =>
    asOwner((owner) => store.save(owner, input.selectionKey, lease.token, result, release));
  let bankSelected = lease.result !== null;
  try {
    const used = await asOwner((owner) =>
      store.usedQuestions(owner, input.courseKey ?? input.selectionKey, input.selectionKey),
    );
    const excluded = new Set(used.map(questionFingerprint));
    if (!lease.result) {
      const entries = await asOwner((owner) => store.list(owner));
      const chosen = entries
        .filter(
          (entry) =>
            matchesAssessment(entry, input.outline) &&
            !excluded.has(questionFingerprint(entry.question)),
        )
        .slice(0, count);
      const questions = chosen.map((entry) => ({
        ...entry.question,
        id: entry.id,
        analysis: [
          entry.question.analysis,
          `题库资料${entry.sourceTitle ? ` · ${entry.sourceTitle}` : ''}`,
          entry.sourceUrl,
        ]
          .filter(Boolean)
          .join('\n\n'),
      }));
      result = {
        ...result,
        questions,
        bankCount: questions.length,
        missing: count - questions.length,
      };
      bankSelected = true;
      await save(false);
    }
    if (result.missing > 0) {
      const search = await (deps.search ?? researchQuestions)(
        await resolveOwner(input.ownerId),
        input.outline.title,
        input.signal,
      );
      result.searchStatus = search.status;
      const known = new Set([...excluded, ...result.questions.map(questionFingerprint)]);
      const legalInstructions =
        '学习者主要是法学专业学生与法学爱好者。法律题结合概念理解、适用条件与案例推理，解释必要术语。' +
        '遵循原练习主题，非法律主题按该主题出题。区分已知事实、推断和不确定处。' +
        '引用仅限已提供资料的真实来源，无法核实的题目标明为原创练习。不要编造真题身份、法条编号。' +
        '回复只包含原协议要求的题目数组，教学内容中省略校验规则、规则版本和技术版本号。';
      const aiCall: AICallFn = (system, prompt) =>
        input.aiCall(
          `${system}\n\n${legalInstructions}`,
          `${prompt}\n\n已有题目（只生成缺少的 ${result.missing} 题，避免重复）：\n${[...used, ...result.questions].map((q) => q.question).join('\n')}` +
            `\n课程资料：\n${(input.materials ?? '').slice(0, 18000)}\n检索资料：\n${search.text}`,
        );
      const generateMissing = () =>
        generateSceneContent(
          { ...input.outline, quizConfig: { ...config, questionCount: result.missing } },
          aiCall,
          { languageDirective: input.languageDirective },
        );
      let generated = await generateMissing();
      if (!generated) generated = await generateMissing();
      if (!generated || !('questions' in generated)) throw new Error('题目生成未完成，请重试');
      for (const question of generated.questions) {
        const parsed = bankQuestionSchema.safeParse({ topic: input.outline.title, question });
        const type = question.type === 'short_answer' ? 'text' : question.type;
        if (!parsed.success || !config.questionTypes.includes(type)) continue;
        const fingerprint = questionFingerprint(parsed.data.question);
        if (known.has(fingerprint)) continue;
        known.add(fingerprint);
        const normalized: QuizQuestion = {
          ...parsed.data.question,
          id: `generated-${fingerprint.slice(0, 24)}`,
          hasAnswer: question.type !== 'short_answer',
          analysis: [question.analysis, '模型原创或依据所附资料整理的练习']
            .filter(Boolean)
            .join('\n\n'),
        };
        result.questions.push(normalized);
        result.generatedCount += 1;
        if (result.questions.length >= count) break;
      }
      result.missing = Math.max(0, count - result.questions.length);
    }
    input.signal?.throwIfAborted();
    if (!result.questions.length) throw new Error('暂未生成可用题目，请重试');
    await save(true);
    return result;
  } catch (error) {
    if (error instanceof AssessmentConflictError) throw error;
    // Preserve selected questions even when the model or search is retried.
    await (bankSelected
      ? save(true)
      : asOwner((owner) => store.release(owner, input.selectionKey, lease.token)));
    if (result.questions.length && !input.signal?.aborted) return result;
    throw error;
  }
}
