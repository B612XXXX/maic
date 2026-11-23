/**
 * Instructor — empty-output fallback fires on a "silent dead turn" (reviewer #593, point 1).
 *
 * The reviewer flagged that suppressing the empty-output error on ANY tool call
 * was too broad: a turn that only called an internal bookkeeping tool, with no
 * acknowledgment text, left the learner with NOTHING — no chat bubble, no
 * error, no retry. The page just sat there.
 *
 * Fix under test (flow level): the empty-output error is keyed on real
 * user-perceivable output (scenario auto-completion, committed text, or a
 * difficulty ack), not on "a tool was called", so a genuinely silent turn
 * surfaces the retry fallback instead of dead air.
 *
 * Note on ordering: the client aborts the whole SSE stream on the first `error`
 * frame (assertNotStreamError). Emitting the empty error before a later patch
 * would drop that patch on the client, so it is emitted after project patches.
 */
import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';

import { runInstructorTurn } from '@/lib/pbl/v2/agents/instructor';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import type { PBLSSEEvent } from '@/lib/pbl/v2/api/sse';

type DoStreamConfig = NonNullable<
  NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>['doStream']
>;
type StreamResult = Extract<DoStreamConfig, { stream: unknown }>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};
const FINISH_TOOLS = {
  type: 'finish' as const,
  finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
  usage: USAGE,
};

function toolCallStep(toolName: string, input: Record<string, unknown>): StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: `tc-${toolName}`, toolName, input: JSON.stringify(input) },
    FINISH_TOOLS,
  ];
}

function scriptedModel(steps: StreamPart[][]): MockLanguageModelV3 {
  let i = 0;
  const fallback: StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({ stream: convertArrayToReadableStream(steps[i++] ?? fallback) }),
  });
}

function makeProject(): PBLProjectV2 {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    uiPhase: 'workspace',
    title: 'Build a HashMap Playground',
    description: 'A small interactive HashMap tool.',
    learningObjective: 'Learn HashMap operations by building a toy tool.',
    proficiency: 'intermediate',
    language: 'zh-CN',
    tags: ['hashmap'],
    status: 'active',
    roles: [{ id: 'role-i', type: 'instructor', name: 'Instructor' }],
    milestones: [
      {
        id: 'ms-1',
        title: 'Model the core HashMap behavior',
        order: 0,
        status: 'active',
        microtasks: [
          {
            id: 'mt-1',
            title: 'Implement lookup',
            description: 'Use a key to find the right bucket and return the value.',
            status: 'in_progress',
            assignee: 'user',
            hints: [],
            order: 0,
          },
        ],
        documents: [],
      },
    ],
    submissions: [],
    evaluations: [],
    threads: [{ agentId: 'role-i', messages: [] }],
    engagementEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function runTurn(model: MockLanguageModelV3, userMessage: string): Promise<PBLSSEEvent[]> {
  const events: PBLSSEEvent[] = [];
  for await (const ev of runInstructorTurn({
    project: makeProject(),
    userMessage,
    phase: 'instructing',
    languageModel: model as never,
  })) {
    events.push(ev);
  }
  return events;
}

function committedMessages(events: PBLSSEEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<PBLSSEEvent, { type: 'project_patch' }> =>
        e.type === 'project_patch' && e.patch.kind === 'message',
    )
    .map((e) => (e.patch as { message: { content: string } }).message.content);
}

function emptyOutputIndex(events: PBLSSEEvent[]): number {
  return events.findIndex(
    (e) => e.type === 'error' && (e as { code?: string }).code === 'EMPTY_LLM_OUTPUT',
  );
}

describe('Instructor — empty-output fallback on a silent dead turn (#593 point 1)', () => {
  it('reports EMPTY_LLM_OUTPUT when record_observation ran and the model wrote no text', async () => {
    // record_observation is internal bookkeeping. No text, no scenario
    // auto-completion, no difficulty ack → previously the `toolCalled` guard
    // swallowed the error and the learner saw nothing.
    const events = await runTurn(
      scriptedModel([
        toolCallStep('record_observation', {
          kind: 'question',
          signature: 'lookup_question',
          label: 'lookup question',
        }),
      ]),
      '这里为什么要先算 hash？',
    );

    expect(emptyOutputIndex(events)).toBeGreaterThanOrEqual(0);
    // Nothing user-facing was committed.
    expect(committedMessages(events)).toHaveLength(0);
  });

  it('emits the empty-output error LAST (after any project_patch frame) so the client cannot drop a later patch', async () => {
    const events = await runTurn(
      scriptedModel([
        toolCallStep('record_observation', {
          kind: 'question',
          signature: 'lookup_question',
          label: 'lookup question',
        }),
      ]),
      '这里为什么要先算 hash？',
    );

    const errIdx = emptyOutputIndex(events);
    expect(errIdx).toBeGreaterThanOrEqual(0);
    const lastPatchIdx = events.reduce((acc, e, i) => (e.type === 'project_patch' ? i : acc), -1);
    // The empty-output error must come after the last project_patch (if any).
    expect(errIdx).toBeGreaterThan(lastPatchIdx);
  });

  it('still reports empty output on a totally silent turn (no tool, no text)', async () => {
    const events = await runTurn(scriptedModel([]), '在吗');
    expect(emptyOutputIndex(events)).toBeGreaterThanOrEqual(0);
  });
});

describe('scenario closing debrief', () => {
  function wrapupProject(): PBLProjectV2 {
    const project = makeProject();
    project.scenario = {
      setting: '共同案卷的退款争议',
      characters: [{ id: 'opponent', name: '被告', persona: '依据材料回应' }],
    };
    const roleplay = structuredClone(project.milestones[0]);
    roleplay.scenarioStage = 'roleplay';
    roleplay.status = 'completed';
    roleplay.microtasks[0].status = 'completed';
    const wrapup = project.milestones[0];
    wrapup.id = 'wrapup';
    wrapup.order = 1;
    wrapup.scenarioStage = 'wrapup';
    wrapup.microtasks[0].id = 'wrapup-task';
    project.milestones = [roleplay, wrapup];
    project.threads[0].messages = [
      {
        id: 'old-question',
        roleType: 'user',
        content: '请帮我写第一版原告主张',
        microtaskId: roleplay.microtasks[0].id,
        ts: project.createdAt,
      },
    ];
    project.threads.push({
      agentId: 'simulator',
      messages: [
        {
          id: 'argument',
          roleType: 'user',
          content: '现有材料不足以支持立即全额退款。',
          microtaskId: roleplay.microtasks[0].id,
          ts: project.createdAt,
        },
      ],
    });
    return project;
  }

  it('requests a terminal reflection instead of answering preparation or assigning a new task', async () => {
    const model = scriptedModel([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'closing' },
        {
          type: 'text-delta',
          id: 'closing',
          delta: '你依据材料修正了全额退款主张，下次可更明确地区分事实与推断。',
        },
        { type: 'text-end', id: 'closing' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE },
      ],
    ]);
    const events: PBLSSEEvent[] = [];
    for await (const event of runInstructorTurn({
      project: wrapupProject(),
      userMessage: '继续',
      phase: 'setup',
      languageModel: model as never,
    }))
      events.push(event);
    const prompt = model.doStreamCalls[0].prompt;
    const system = prompt
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const conversation = JSON.stringify(prompt.filter((m) => m.role !== 'system'));
    expect(system).toContain('现有材料不足以支持立即全额退款');
    expect(system).not.toContain('Right now: SETUP phase');
    expect(conversation).not.toContain('请帮我写第一版原告主张');
    expect(conversation).toContain('closing debrief');
    const closing = events.findIndex(
      (e) => e.type === 'project_patch' && e.patch.kind === 'message',
    );
    const completion = events.findIndex(
      (e) => e.type === 'project_patch' && e.patch.kind === 'advance' && e.patch.projectCompleted,
    );
    expect(closing).toBeGreaterThanOrEqual(0);
    expect(completion).toBeGreaterThan(closing);
  });

  it('keeps the wrapup active when the model produces no closing text', async () => {
    const project = wrapupProject();
    const events: PBLSSEEvent[] = [];
    for await (const event of runInstructorTurn({
      project,
      userMessage: '继续',
      phase: 'setup',
      languageModel: scriptedModel([]) as never,
    }))
      events.push(event);
    expect(emptyOutputIndex(events)).toBeGreaterThanOrEqual(0);
    expect(project.milestones[1].status).toBe('active');
    expect(events.some((e) => e.type === 'project_patch' && e.patch.kind === 'advance')).toBe(
      false,
    );
  });
});
