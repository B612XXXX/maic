import { describe, expect, it, vi } from 'vitest';
import { validateAppScene } from '@/lib/document-store/validators';
import {
  CONTRACT_DELIVERY_CASE,
  getScenarioDocuments,
  makeCourtroomOutline,
} from '@/lib/legal/courtroom';
import { generateCourtroomPracticeContent } from '@/lib/server/legal/courtroom-content';
import { buildCompleteScene } from '@openmaic/generation';
import { buildSimulatorSystemPrompt, runSimulatorTurn } from '@/lib/pbl/v2/agents/simulator';
import { buildFinalEvalPrompt } from '@/lib/pbl/v2/operations/runtime/eval-prompts';
import { buildScenarioAwarenessBlock } from '@/lib/pbl/v2/agents/instructor';
import { formatCourtroomEvidence } from '@/lib/pbl/v2/operations/runtime/courtroom-evidence';
import { stripToDesignTemplate } from '@/lib/pbl/v2/runtime/learner-state';
import { PBL_SIMULATOR_AGENT_ID } from '@/lib/pbl/v2/operations/kernel/progress';
import {
  courtroomDocuments,
  usesCourtroom,
} from '@/components/scene-renderers/pbl/v2/courtroom-state';
import { shouldShowScenarioBriefing } from '@/components/scene-renderers/pbl/v2/scenario-briefing-gate';
import type { AppScene } from '@/lib/types/stage';

const outline = makeCourtroomOutline(
  { caseId: CONTRACT_DELIVERY_CASE, topic: '合同解除与预付款返还' },
  1,
);

describe('legal short practice', () => {
  it('assembles a persistable single-issue scene using one common case archive and a distinct legal rubric', async () => {
    const aiCall = vi.fn();
    const generated = await generateCourtroomPracticeContent(outline, aiCall, {
      targetLanguage: 'zh-CN',
    });
    expect(aiCall).not.toHaveBeenCalled();
    const project = stripToDesignTemplate(generated.projectV2);
    const scene = buildCompleteScene(outline, { projectV2: project }, [], 'stage-legal');
    expect(validateAppScene(scene as AppScene)).toEqual({ valid: true });
    expect(shouldShowScenarioBriefing(project)).toBe(true);
    expect(courtroomDocuments(project)).toEqual(getScenarioDocuments(project));
    expect(project.milestones.map((item) => item.scenarioStage)).toEqual([
      'prep',
      'roleplay',
      'wrapup',
    ]);

    const materials = formatCourtroomEvidence(project);
    expect(materials).toContain('D13');
    const [prep, act] = project.milestones;
    const briefing = buildScenarioAwarenessBlock({ project, milestone: prep, phase: 'greeting' });
    expect(briefing).toContain(materials);
    expect(briefing).toContain('Short practice preparation');
    const opponent = buildSimulatorSystemPrompt(project, act, act.microtasks[0]);
    expect(opponent).toContain(materials);
    expect(opponent).not.toContain('第563条');
    prep.status = 'completed';
    act.status = 'active';
    expect(usesCourtroom(project)).toBe(true);

    const events = [];
    for await (const event of runSimulatorTurn({
      project,
      phase: 'greeting',
      userMessage: '',
      languageModel: {} as never,
      thinkingConfig: { mode: 'disabled', enabled: false },
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(['project_patch', 'done']);
    const thread = project.threads.find((item) => item.agentId === PBL_SIMULATOR_AGENT_ID);
    expect(thread).toBeDefined();
    thread?.messages.push({
      id: 'answer',
      roleType: 'user',
      content: '我根据材料 3 判断未证明最终交付已经到期。',
      ts: project.createdAt,
    });
    const report = buildFinalEvalPrompt(project);
    expect(report.user).toContain(materials);
    expect(report.user).toContain('第563条');
    expect(report.user).toContain('未证明最终交付已经到期');
    expect(report.system).toContain('Never infer mastery from completion');
    expect(report.system).toContain('Do not give a numerical score');
    prep.documents![0].content = '课程作者已编辑合同约定。';
    const amended = buildFinalEvalPrompt(project);
    expect(amended.user).toContain('No verified legal source is attached');
    expect(amended.user).not.toContain('第563条');
  });

  it('does not attach the contract rubric to a generated case', async () => {
    const model = vi.fn(async () =>
      JSON.stringify({
        title: '两份证词',
        issue: '两份记录能否证明该事实？',
        learnerRole: '原告代理人',
        opponentRole: '被告代理人',
        opponentPosition: '否认见过原件。',
        openingLine: '哪份材料记录了时间？',
        documents: [
          { title: '签收单', content: '记录显示在早上九点签收。' },
          { title: '证词', content: '证人自述没有见过原件。' },
        ],
      }),
    );
    const { projectV2 } = await generateCourtroomPracticeContent(
      makeCourtroomOutline({ caseId: 'generated', topic: '证据证明力' }, 1),
      model,
    );
    expect(model).toHaveBeenCalledOnce();
    expect(projectV2.description).toContain('AI 生成的虚构教学案情');
    expect(formatCourtroomEvidence(projectV2)).toContain('早上九点签收');
    expect(buildFinalEvalPrompt(projectV2).user).toContain('No verified legal source is attached');
    expect(buildFinalEvalPrompt(projectV2).user).not.toContain('第563条');
  });
});
