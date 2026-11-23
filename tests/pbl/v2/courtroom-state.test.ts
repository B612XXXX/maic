import { describe, expect, it } from 'vitest';
import type { PBLMilestone, PBLProjectV2 } from '@/lib/pbl/v2/types';
import {
  courtroomDocuments,
  courtroomSide,
  displayedMilestone,
  usesCourtroom,
} from '@/components/scene-renderers/pbl/v2/courtroom-state';
import {
  normalizeProjectRuntime,
  resetProjectProgress,
} from '@/lib/pbl/v2/operations/kernel/progress';
import {
  applyLearnerState,
  extractLearnerState,
  stripToDesignTemplate,
} from '@/lib/pbl/v2/runtime/learner-state';

function stage(
  id: string,
  scenarioStage: PBLMilestone['scenarioStage'],
  status: PBLMilestone['status'],
): PBLMilestone {
  return {
    id,
    title: id,
    scenarioStage,
    status,
    order: 1,
    microtasks: [
      {
        id: `${id}-task`,
        title: id,
        description: id,
        status: status === 'completed' ? 'completed' : 'todo',
        assignee: 'user',
        hints: [],
        order: 1,
      },
    ],
  };
}

function project(): PBLProjectV2 {
  return {
    uiPhase: 'workspace',
    title: '模拟法庭',
    description: '教学虚构案例',
    tags: [],
    language: 'zh-CN',
    proficiency: 'beginner',
    status: 'active',
    roles: [{ id: 'instructor', type: 'instructor', name: '导师' }],
    scenario: {
      setting: '法庭',
      learnerRole: '原告代理人',
      characters: [{ id: 'opponent', name: '对方', persona: '被告代理人' }],
    },
    workspacePresentation: 'courtroom',
    milestones: [
      stage('prep', 'prep', 'completed'),
      stage('act', 'roleplay', 'active'),
      stage('review', 'wrapup', 'locked'),
    ],
    submissions: [],
    evaluations: [],
    threads: [],
    engagementEvents: [],
    createdAt: '2026-11-09T00:00:00Z',
    updatedAt: '2026-11-09T00:00:00Z',
  };
}

describe('courtroom workspace routing', () => {
  it('lets the learner choose a presentation without changing the authored default', () => {
    const p = project();
    p.workspacePresentation = 'standard';
    p.workspacePresentationOverride = 'courtroom';
    expect(usesCourtroom(p)).toBe(true);
    const design = stripToDesignTemplate(p);
    expect(design.workspacePresentation).toBe('standard');
    expect(design.workspacePresentationOverride).toBeUndefined();
    const restored = applyLearnerState(design, extractLearnerState(p));
    expect(usesCourtroom(restored)).toBe(true);
  });
  it('lets the learner opt out of an authored courtroom in their own progress', () => {
    const p = project();
    p.workspacePresentationOverride = 'standard';
    expect(usesCourtroom(p)).toBe(false);
  });
  it('requires explicit opt-in even when the title mentions a court', () => {
    const p = project();
    delete p.workspacePresentation;
    expect(usesCourtroom(p)).toBe(false);
    p.workspacePresentation = 'standard';
    expect(usesCourtroom(p)).toBe(false);
  });
  it('uses the original workspace for preparation and wrapup', () => {
    const p = project();
    for (const index of [0, 2]) {
      p.milestones.forEach((m, i) => {
        m.status = i === index ? 'active' : 'locked';
      });
      expect(usesCourtroom(p)).toBe(false);
    }
  });
  it('uses the court for an active formal act', () => {
    expect(usesCourtroom(project())).toBe(true);
  });
  it('keeps the finished act visible until Continue actually activates wrapup', () => {
    const p = project();
    p.milestones[1].status = 'completed';
    p.pendingHandover = {
      completedMilestoneId: 'act',
      completedMilestoneTitle: 'act',
      nextMilestoneId: 'review',
      nextMilestoneTitle: 'review',
    };
    expect(displayedMilestone(p)?.id).toBe('act');
    expect(usesCourtroom(p)).toBe(true);
    p.pendingHandover.consumed = true;
    p.milestones[2].status = 'active';
    expect(usesCourtroom(p)).toBe(false);
  });
  it('does not convert an ordinary project into a court even if a stale preference exists', () => {
    const p = project();
    delete p.scenario;
    expect(usesCourtroom(p)).toBe(false);
  });
  it('keeps the explicit preference through runtime normalization and restarting', () => {
    const p = project();
    normalizeProjectRuntime(p);
    resetProjectProgress(p);
    expect(p.workspacePresentation).toBe('courtroom');
  });
  it('retains preparation material and stable IDs across later acts without duplicates', () => {
    const p = project();
    p.milestones[0].documents = [
      { id: 'contract', title: '合同', content: '原始内容', docType: 'reference' },
    ];
    p.milestones[1].documents = [
      { id: 'contract', title: '合同', content: '重复内容', docType: 'reference' },
      { id: 'receipt', title: '付款记录', content: '2500元', docType: 'reference' },
    ];
    expect(courtroomDocuments(p).map((d) => [d.id, d.content])).toEqual([
      ['contract', '原始内容'],
      ['receipt', '2500元'],
    ]);
  });
  it('places the learner on the side supplied by the scenario', () => {
    const p = project();
    expect(courtroomSide(p)).toBe('plaintiff');
    p.scenario!.learnerRole = '被告的委托代理人';
    expect(courtroomSide(p)).toBe('defendant');
  });
});
