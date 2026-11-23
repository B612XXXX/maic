import type { PBLDocument, PBLProject } from '@openmaic/dsl';
import type { SceneOutline } from '@/lib/types/generation';

export const CONTRACT_DELIVERY_CASE = 'contract-delivery-v1';
export const COURTROOM_PRACTICE_IDS = [CONTRACT_DELIVERY_CASE, 'generated'] as const;
export type CourtroomPracticeId = (typeof COURTROOM_PRACTICE_IDS)[number];

export interface CourtroomOffer {
  caseId: CourtroomPracticeId;
  topic: string;
}

export const COURTROOM_TOPIC_LIMIT = 100;

export function permitsCourtroomPractice(text: string): boolean {
  if (!text || declinesCourtroom(text)) return false;
  if (/我(?:的|被|想起诉)|真实案件|找律师|法律咨询/u.test(text) && !/法考|模拟|练习/u.test(text))
    return false;
  if (/完整.{0,6}(?:法庭|庭审|演练)|全流程|多幕/u.test(text)) return false;
  if (
    /^(?:(?:请问\s*)?什么是|define\s)|是什么意思|定义是什么/iu.test(text) &&
    !/案例|演练|应用|适用|区别|判断|但|如果|举例/u.test(text)
  )
    return false;
  if (
    /^(?:请\s*)?(?:查|查询|给我|列出|展示).*(?:法条|条文|原文)/u.test(text) &&
    !/案例|适用/u.test(text)
  )
    return false;
  return true;
}

export function mayConsiderCourtroomPractice(text: string, context: string): boolean {
  if (!permitsCourtroomPractice(text)) return false;
  const legalTopic =
    /法考|法律职业资格|民法|刑法|民诉|刑诉|诉讼|行政法|行政复议|商经法|法理学|抗辩|违约|合同|犯罪|正当防卫|侵权|举证责任|构成要件|意思表示|物权|撤销权|解除权|预付款/u;
  // For an application question, let the Director recognize a legal concept
  // from its meaning. This gate does not itself classify the query as legal.
  return (
    legalTopic.test(`${text} ${context}`) ||
    /为什么|怎么|如何|能否|能不能|区分|区别|什么情形|什么情况|适用条件|事实|证据|案例|短练|演练/u.test(
      text,
    )
  );
}

export function isCourtroomPracticeId(value: unknown): value is CourtroomPracticeId {
  return COURTROOM_PRACTICE_IDS.some((id) => id === value);
}

function declinesCourtroom(text: string): boolean {
  return /(?:不要|不用|不想|无需|不需要|别|跳过).{0,12}(?:法庭|庭审|角色|练习|演练|案例|例子)|只(?:讲|解释)(?!.*(?:练习|演练|案例|举例))|(?:只要|只看|只查).{0,8}(?:定义|概念|原文|法条|背诵|解释)|(?:no|without)\s+(?:role.?play|practice|examples?|mock trial)/iu.test(
    text,
  );
}

export function preferredCourtroomCase(text: string): CourtroomOffer | undefined {
  if (!permitsCourtroomPractice(text)) return undefined;
  // The civil service-contract packet does not teach a special regime such
  // as the termination of employment. Leave such topics to the planner.
  if (/劳动合同|劳动法|劳动关系|劳动争议|劳动仲裁/u.test(text)) return undefined;
  const contractTermination = /合同.{0,8}(?:解除|解约)|(?:解除|解约).{0,6}合同/u.test(text);
  const asksApplication =
    /条件|情形|为什么|怎么|什么情况|什么时候|能否|能不能|可以|一定|区别|区分|效果|后果|如何|案例|演练|适用|理解|判断/u.test(
      text,
    );
  const deliveryAndRefund =
    /预付款|返还|退款|退钱/u.test(text) && /解除|解约|违约|交付|履行/u.test(text);
  if ((!contractTermination || !asksApplication) && !deliveryAndRefund) return undefined;
  return { caseId: CONTRACT_DELIVERY_CASE, topic: '合同解除与预付款返还' };
}

export function makeCourtroomOutline(offer: CourtroomOffer, order: number): SceneOutline {
  return {
    id: 'courtroom-practice',
    type: 'pbl',
    order,
    title: `${offer.topic}：模拟法庭短练`,
    description: `围绕「${offer.topic}」练习争点判断、事实引用和书面理由。`,
    keyPoints: [offer.topic],
    pblConfig: {
      projectTopic: offer.topic,
      projectDescription: '使用教学案情进行一个争点的简短对抗练习。',
      targetSkills: ['争点判断', '事实引用', '理由表达'],
      scenarioRoleplay: true,
      presentation: 'courtroom',
      courtroomPractice: offer.caseId,
    },
  };
}

export function hasCourtroomEvidence(project: PBLProject): boolean {
  return (
    !!project.scenario &&
    (project.workspacePresentation === 'courtroom' || !!project.courtroomPractice)
  );
}

export function getScenarioDocuments(project: Pick<PBLProject, 'milestones'>): PBLDocument[] {
  const documents = new Map<string, PBLDocument>();
  for (const milestone of project.milestones) {
    for (const document of milestone.documents ?? []) {
      if (!documents.has(document.id)) documents.set(document.id, document);
    }
  }
  return [...documents.values()];
}
