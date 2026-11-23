import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/quiz-grade/route';

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/lib/ai/llm', () => ({ callLLM: mocks.call }));
vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromRequest: async () => ({ model: {}, serverManaged: true }),
}));

describe('short answer feedback', () => {
  beforeEach(() => vi.clearAllMocks());
  const request = () =>
    new Request('http://localhost/api/quiz-grade', {
      method: 'POST',
      body: JSON.stringify({
        question: '说明合同履行的要求',
        userAnswer: '按约履行',
        points: 5,
        language: 'zh-CN',
      }),
    }) as NextRequest;

  it('returns valid model feedback', async () => {
    mocks.call.mockResolvedValue({ text: '{"score":4,"comment":"说明较完整"}' });
    expect(await (await POST(request())).json()).toMatchObject({ score: 4, comment: '说明较完整' });
  });

  it.each([
    'not json',
    '{"comment":"收到"}',
    '{"score":null,"comment":"收到"}',
    '{"score":"bad","comment":"收到"}',
  ])('keeps malformed feedback pending instead of assigning a score', async (text) => {
    mocks.call.mockResolvedValue({ text });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('score');
  });
});
