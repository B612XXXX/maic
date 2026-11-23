import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneOutline } from '@/lib/types/generation';
import { fakeModel, testLogger } from '../server/generation-steps/helpers';

const mocks = vi.hoisted(() => ({ assessment: vi.fn() }));
vi.mock('@/lib/server/legal/assessment-service', () => ({ generateAssessment: mocks.assessment }));

const questions = [
  { id: 'bank-q', type: 'short_answer', question: '说明合同履行的要求', points: 1 },
];
const outline: SceneOutline = {
  id: 'quiz',
  order: 1,
  type: 'quiz',
  title: '合同履行',
  description: '合同练习',
  keyPoints: ['合同履行'],
};

describe('classic and Pro assessment entry points', () => {
  beforeEach(() => {
    mocks.assessment.mockResolvedValue({ questions, bankCount: 1, generatedCount: 0, missing: 0 });
  });

  it('routes a classic quiz through the shared service', async () => {
    const { generateSceneContent } = await import('@/lib/server/generation/steps/scene-content');
    const result = await generateSceneContent(
      {
        outline,
        model: fakeModel(),
        assessment: { ownerId: 'owner', selectionKey: 'classic:run:quiz' },
      },
      { log: testLogger(), resolveVisionImages: async () => [] },
    );
    expect(result.content).toEqual({ questions });
    expect(mocks.assessment).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner', selectionKey: 'classic:run:quiz' }),
    );
  });

  it('routes a Pro quiz through the same service and saves the resulting scene', async () => {
    const { buildGenerationTools } = await import('@/lib/server/agent-runtime/generation-tools');
    const store = {
      loadDocument: vi.fn(async () => ({ stage: { id: 'stage' }, scenes: [] })),
      putScene: vi.fn(),
    };
    const tools = buildGenerationTools({
      store,
      ownerId: 'owner',
      sessionId: 'session',
      stageAccess: async () => ({ kind: 'owned' }),
      onCheckpoint: vi.fn(),
      generateActions: vi.fn(async () => []),
      aiCall: vi.fn(async () => ''),
    } as never);
    const generate = tools.find((tool) => tool.name === 'generate_scene')!;
    await generate.execute('call', {
      stageId: 'stage',
      type: 'quiz',
      order: 1,
      title: '合同履行',
      brief: '练习',
    } as never);
    expect(mocks.assessment).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner', selectionKey: 'pro:session:call' }),
    );
    expect(store.putScene).toHaveBeenCalledWith(
      'stage',
      expect.objectContaining({ type: 'quiz', content: { type: 'quiz', questions } }),
    );
  });
});
