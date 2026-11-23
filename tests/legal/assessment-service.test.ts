import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentResult, BankQuestion } from '@/lib/legal/questions';
import { generateAssessment, matchesAssessment } from '@/lib/server/legal/assessment-service';
import type { SceneOutline } from '@/lib/types/generation';

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@openmaic/generation', () => ({ generateSceneContent: mocks.generate }));

const outline: SceneOutline = {
  id: 'quiz-1',
  order: 1,
  type: 'quiz',
  title: '合同履行',
  description: '合同履行与违约责任',
  keyPoints: ['违约责任'],
  quizConfig: { questionCount: 3, questionTypes: ['single'], difficulty: 'medium' },
};

function question(id: string) {
  return {
    id,
    type: 'single' as const,
    question: `合同履行问题${id}`,
    options: [
      { value: 'A', label: '甲' },
      { value: 'B', label: '乙' },
    ],
    answer: ['A'],
    analysis: '解析',
    points: 1,
  };
}

function bankEntry(id: string): BankQuestion {
  return {
    id,
    topic: '合同履行',
    difficulty: 'medium',
    enabled: true,
    tags: [],
    sourceTitle: '教师资料',
    sourceUrl: '',
    updatedAt: new Date().toISOString(),
    question: question(id),
  };
}

function dependencies(entries: BankQuestion[] = []) {
  let stored: AssessmentResult | null = null;
  let complete = false;
  const store = {
    release: vi.fn(async () => {}),
    usedQuestions: vi.fn(async (): Promise<ReturnType<typeof question>[]> => []),
    claim: vi.fn(async () => ({
      result: stored ? structuredClone(stored) : null,
      complete,
      token: 'token',
    })),
    list: vi.fn(async () => entries),
    save: vi.fn(async (_owner: string, _key: string, _token: string, result: AssessmentResult) => {
      stored = structuredClone(result);
      complete = result.missing === 0;
    }),
  };
  return {
    store,
    resolveOwner: async (owner: string) => owner,
    search: vi.fn(async () => ({ text: '', status: 'unavailable' as const })),
  };
}

describe('shared assessment selection', () => {
  beforeEach(() => vi.clearAllMocks());
  const input = () => ({
    ownerId: 'owner',
    selectionKey: 'selection',
    outline,
    aiCall: vi.fn(async () => ''),
  });

  it('fills an empty bank and reuses the result on retry without adding questions to the bank', async () => {
    const deps = dependencies();
    mocks.generate.mockResolvedValue({
      questions: [question('g1'), question('g2'), question('g3')],
    });
    const first = await generateAssessment(input(), deps);
    const retry = await generateAssessment(input(), deps);
    expect(first).toMatchObject({ bankCount: 0, generatedCount: 3, missing: 0 });
    expect(retry).toEqual(first);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it('uses sufficient bank questions without calling search or the model', async () => {
    const deps = dependencies([bankEntry('a'), bankEntry('b'), bankEntry('c')]);
    const result = await generateAssessment(input(), deps);
    expect(result).toMatchObject({ bankCount: 3, generatedCount: 0, missing: 0 });
    expect(result.questions[0]?.answer).toEqual(['A']);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(deps.search).not.toHaveBeenCalled();
  });

  it('retries an unusable generated response once', async () => {
    mocks.generate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ questions: [question('g1'), question('g2'), question('g3')] });
    expect(await generateAssessment(input(), dependencies())).toMatchObject({
      generatedCount: 3,
      missing: 0,
    });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it('preserves bank hits and asks only for the missing count', async () => {
    const deps = dependencies([bankEntry('a')]);
    mocks.generate.mockResolvedValue({ questions: [question('g1'), question('g2')] });
    const result = await generateAssessment(input(), deps);
    expect(mocks.generate.mock.calls[0]?.[0].quizConfig.questionCount).toBe(2);
    expect(result).toMatchObject({ bankCount: 1, generatedCount: 2, missing: 0 });
    expect(result.questions[0]?.id).toBe('a');
  });

  it('keeps a partial result on model failure and fills it on the next request', async () => {
    const deps = dependencies([bankEntry('a')]);
    mocks.generate.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await generateAssessment(input(), deps)).toMatchObject({ bankCount: 1, missing: 2 });
    mocks.generate.mockResolvedValueOnce({ questions: [question('b'), question('c')] });
    expect(await generateAssessment(input(), deps)).toMatchObject({
      bankCount: 1,
      generatedCount: 2,
      missing: 0,
    });
    expect(deps.store.list).toHaveBeenCalledTimes(1);
  });

  it('filters malformed and duplicate generated questions', async () => {
    const deps = dependencies([bankEntry('a')]);
    mocks.generate.mockResolvedValue({
      questions: [question('a'), question('b'), question('b'), { ...question('c'), answer: ['Z'] }],
    });
    expect(await generateAssessment(input(), deps)).toMatchObject({
      bankCount: 1,
      generatedCount: 1,
      missing: 1,
    });
  });

  it('matches enabled topics, types and difficulty without taking unrelated questions', () => {
    expect(matchesAssessment(bankEntry('a'), outline)).toBe(true);
    expect(matchesAssessment({ ...bankEntry('a'), enabled: false }, outline)).toBe(false);
    expect(matchesAssessment({ ...bankEntry('a'), difficulty: 'hard' }, outline)).toBe(false);
    expect(matchesAssessment({ ...bankEntry('a'), topic: '刑事诉讼' }, outline)).toBe(false);
  });

  it('does not treat a failed bank lookup as an empty bank on retry', async () => {
    const deps = dependencies([bankEntry('a'), bankEntry('b'), bankEntry('c')]);
    deps.store.list.mockRejectedValueOnce(new Error('database offline'));
    await expect(generateAssessment(input(), deps)).rejects.toThrow('database offline');
    expect(deps.store.release).toHaveBeenCalledOnce();
    expect(deps.store.save).not.toHaveBeenCalled();
    expect(await generateAssessment(input(), deps)).toMatchObject({
      bankCount: 3,
      generatedCount: 0,
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('excludes questions used in another scene of this course', async () => {
    const deps = dependencies([bankEntry('a'), bankEntry('b'), bankEntry('c')]);
    deps.store.usedQuestions.mockResolvedValue([question('a')]);
    mocks.generate.mockResolvedValue({ questions: [question('a'), question('g1')] });
    const result = await generateAssessment({ ...input(), courseKey: 'course' }, deps);
    expect(result).toMatchObject({ bankCount: 2, generatedCount: 1, missing: 0 });
    expect(result.questions.map((q) => q.question)).not.toContain(question('a').question);
  });
});
