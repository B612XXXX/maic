import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ResolvedSlideElementReference } from '@/lib/chat/pi/element-reference';
import type { AgentTurnSummary } from '@/lib/orchestration/types';

const mocks = vi.hoisted(() => ({
  streamLLM: vi.fn(),
  sharedElementEvidence: [] as unknown[],
  callAgentExecutions: 0,
  teacherResponse: '',
}));

vi.mock('@/lib/ai/llm', () => ({ streamLLM: mocks.streamLLM }));
vi.mock('@/lib/chat/pi/tools/call-agent', () => ({
  buildCallAgentTool: (options: {
    elementReferenceEvidence?: unknown;
    onAgentDone: (summary: AgentTurnSummary) => void;
  }) => ({
    name: 'call_agent',
    label: 'Call agent',
    description: 'Call agent',
    parameters: {
      type: 'object',
      properties: { agentId: { type: 'string' }, instruction: { type: 'string' } },
      required: ['agentId', 'instruction'],
      additionalProperties: false,
    },
    execute: async () => {
      if (mocks.teacherResponse) {
        options.onAgentDone({
          agentId: 'teacher-1',
          agentName: 'Teacher',
          contentPreview: mocks.teacherResponse,
          actionCount: 0,
          whiteboardActions: [],
        });
        return { content: [{ type: 'text' as const, text: mocks.teacherResponse }], details: {} };
      }
      mocks.sharedElementEvidence.push(options.elementReferenceEvidence);
      mocks.callAgentExecutions += 1;
      if (mocks.callAgentExecutions > 1) {
        return {
          content: [{ type: 'text' as const, text: 'Grounded retry succeeded.' }],
          details: {},
        };
      }
      return {
        content: [{ type: 'text' as const, text: 'No grounded visible response.' }],
        details: {},
        isError: true,
      };
    },
  }),
}));

import { runPiDirectorLoop } from '@/lib/chat/pi/director-loop';

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
};

function resultFrom(parts: Array<Record<string, unknown>>) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    usage: new Promise(() => {}),
  };
}

const teacher: AgentConfig = {
  id: 'teacher-1',
  name: 'Teacher',
  role: 'teacher',
  persona: 'Teach from evidence.',
  avatar: '',
  color: '#3366ff',
  allowedActions: [],
  priority: 10,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  isDefault: true,
};

const body = {
  messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Explain this.' }] }],
  storeState: {
    stage: null,
    scenes: [],
    currentSceneId: null,
    mode: 'playback',
    whiteboardOpen: false,
  },
  config: { agentIds: [teacher.id] },
  apiKey: '',
} as StatelessChatRequest;

const elementReference: ResolvedSlideElementReference = {
  reference: { kind: 'slide_element', sceneId: 'scene-1', elementId: 'element-1' },
  evidence: {
    kind: 'slide_element',
    source: 'request_start_snapshot',
    sceneId: 'scene-1',
    elementId: 'element-1',
    elementType: 'text',
    geometry: { left: 0, top: 0, width: 100, height: 40, rotate: 0 },
    truncatedFields: [],
    omittedItems: {},
    content: { text: 'Grounded fact' },
  },
  directorSummary: 'Selected slide reference: Grounded fact.',
  childEvidence: 'Selected element packet: Grounded fact.',
};

describe('Pi Director request-scoped selected-element evidence', () => {
  beforeEach(() => {
    mocks.streamLLM.mockReset();
    mocks.sharedElementEvidence.length = 0;
    mocks.callAgentExecutions = 0;
    mocks.teacherResponse = '';
  });

  it.each([
    ['合同解除有什么条件，为什么不一定要全额退款？', '', 'contract-delivery-v1'],
    ['请用法考案例练习正当防卫的时间条件。', '正当防卫的时间条件', 'generated'],
    ['善意取得和无权处分有什么区别，买家该怎么判断？', '善意取得的条件', 'generated'],
    ['如何判断力的方向？', '', undefined],
    ['只解释合同解除的条件，不要演练。', '合同解除', undefined],
  ])(
    'can offer a practice after teaching without requiring an input case (%s)',
    async (text, courtroomTopic, expectedCaseId) => {
      mocks.teacherResponse = '先区分判断所用的规则和已有事实。';
      mocks.streamLLM
        .mockReturnValueOnce(
          resultFrom([
            {
              type: 'tool-call',
              toolCallId: 'teach',
              toolName: 'call_agent',
              input: { agentId: teacher.id, instruction: '解释知识点。' },
            },
            { type: 'finish', finishReason: 'tool-calls', totalUsage: ZERO_USAGE },
          ]),
        )
        .mockReturnValueOnce(
          resultFrom([
            {
              type: 'tool-call',
              toolCallId: 'end',
              toolName: 'cue_user',
              input: courtroomTopic ? { courtroomTopic } : {},
            },
            { type: 'finish', finishReason: 'tool-calls', totalUsage: ZERO_USAGE },
          ]),
        );
      const request: StatelessChatRequest = {
        ...body,
        messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text }] }],
        storeState: {
          ...body.storeState,
          stage: { id: 'practice-source', name: '课堂', createdAt: 1, updatedAt: 1 },
        },
        config: { ...body.config, sessionType: 'qa' },
      };
      const events: StatelessEvent[] = [];
      const signal = new AbortController().signal;
      await runPiDirectorLoop({
        body: request,
        agentConfigs: [teacher],
        send: async (event) => {
          events.push(event);
        },
        languageModel: { provider: 'test', modelId: 'director' } as never,
        thinkingConfig: { mode: 'disabled', enabled: false },
        abortSignal: signal,
        signal,
        maxAgentTurns: 2,
        maxActionsPerAgent: 1,
        enableWhiteboardTools: false,
      });
      const done = events.find((event) => event.type === 'done');
      expect(done?.data.courtroomOffer?.caseId).toBe(expectedCaseId);
      expect(done?.data.cueUserReceived).toBe(true);
    },
  );

  it('shares evidence with a retry after an ordinary grounded Child failure', async () => {
    mocks.streamLLM
      .mockReturnValueOnce(
        resultFrom([
          {
            type: 'tool-call',
            toolCallId: 'call-grounded-child-1',
            toolName: 'call_agent',
            input: { agentId: teacher.id, instruction: 'Explain it.' },
          },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: ZERO_USAGE },
        ]),
      )
      .mockReturnValueOnce(
        resultFrom([
          {
            type: 'tool-call',
            toolCallId: 'call-grounded-child-2',
            toolName: 'call_agent',
            input: { agentId: teacher.id, instruction: 'Retry from the same evidence.' },
          },
          { type: 'finish', finishReason: 'tool-calls', totalUsage: ZERO_USAGE },
        ]),
      )
      .mockReturnValueOnce(
        resultFrom([
          { type: 'text-delta', text: 'The grounded retry completed.' },
          { type: 'finish', finishReason: 'stop', totalUsage: ZERO_USAGE },
        ]),
      );
    const events: StatelessEvent[] = [];
    const controller = new AbortController();

    await runPiDirectorLoop({
      body,
      elementReference,
      agentConfigs: [teacher],
      send: async (event) => {
        events.push(event);
      },
      languageModel: { provider: 'test', modelId: 'director' } as never,
      thinkingConfig: { mode: 'disabled', enabled: false },
      abortSignal: controller.signal,
      signal: controller.signal,
      maxAgentTurns: 2,
      maxActionsPerAgent: 1,
      enableWhiteboardTools: false,
    });

    expect(JSON.stringify(mocks.streamLLM.mock.calls[0]?.[0])).toContain(
      'Selected slide reference: Grounded fact.',
    );
    expect(mocks.sharedElementEvidence).toHaveLength(2);
    expect(mocks.sharedElementEvidence[0]).toBe(mocks.sharedElementEvidence[1]);
    expect(mocks.sharedElementEvidence[0]).toEqual(
      expect.objectContaining({ content: 'Selected element packet: Grounded fact.' }),
    );
    expect(events.some((event) => event.type === 'done')).toBe(true);
    expect(mocks.callAgentExecutions).toBe(2);
    expect(mocks.streamLLM).toHaveBeenCalledTimes(3);
  });
});
