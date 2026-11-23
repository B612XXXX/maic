import type { PBLDocument, PBLProject } from '@openmaic/dsl';
import { CONTRACT_DELIVERY_CASE, getScenarioDocuments } from '@/lib/legal/courtroom';

export function buildCourtroomDocuments(
  records: readonly Pick<PBLDocument, 'title' | 'content'>[],
): PBLDocument[] {
  return records.map(({ title, content }, index) => ({
    id: `courtroom-material-${index + 1}`,
    title: `材料 ${index + 1} · ${title}`,
    content,
    docType: 'markdown',
  }));
}

// Keep v1 facts and feedback together. A revised fact pattern needs a new case ID.
export const CONTRACT_DELIVERY = {
  id: CONTRACT_DELIVERY_CASE,
  title: '宣传页面设计服务争议',
  issue: '现有材料能否支持甲方在 D13 要求返还全部预付款？',
  learnerRole: '原告甲方',
  opponentRole: '被告乙方',
  opponentPosition: '初稿按约提交，修改仍在进行；现有材料不足以支持立即返还全款。',
  openingLine: '我方反对全额返还。请先说说，哪份材料支持你的请求？',
  documents: [
    {
      title: '合同节选',
      content:
        '甲方某学习工作室委托乙方某设计公司制作课程宣传页，总价 5,000 元，先付 2,500 元，验收后支付余款。需求确认后十个工作日内提交初稿，甲方确认修改意见后完成最终交付，交付物包括设计稿和可编辑源文件。现有节选未写明最终交付日期或特殊退款条款。',
    },
    {
      title: '付款记录',
      content: 'D0，双方确认需求，乙方确认收到甲方支付的 2,500 元预付款。',
    },
    {
      title: '沟通记录',
      content:
        'D 为需求确认后的工作日编号。D8，乙方发 JPG 初稿，甲方提出字体和配色两项修改。D9，乙方确认收到意见并表示可改，双方未约定最终交付日期。D12，甲方要求取得可编辑源文件；乙方称未改完，最终稿验收后交付源文件。D13，甲方提出解除并退预付款；乙方表示愿继续修改，反对全额退款。材料未给出实际损失金额。',
    },
  ],
};

export const CONTRACT_DELIVERY_RUBRIC = {
  criteria: [
    '区分初稿期限与最终交付义务；用材料 1、3 检查已知的 D8 交付和未约定的最终交付日期，不把未交稿直接当成期限届满。',
    '分别判断是否有解除事由及解除后的清算；从履行情况与合同性质解释为何不能仅凭已支付预付款推出应全额返还。',
    '区分付款已发生、双方在沟通中的主张与尚缺证据；可以作有理由的条件性判断，不凭空补入催告、拒绝履行或损失。',
  ],
  authority:
    '《中华人民共和国民法典》第563条（法定解除事由）、第566条（解除后的处理）。来源：国家法律法规数据库 https://wb.flk.npc.gov.cn/flfg/PDF/bd53dd912c1048f2aecbaa229238334b.pdf 。练习允许有理由的不同观点，不要求背条号。',
};

export function matchesContractDeliveryCase(project: PBLProject): boolean {
  if (project.courtroomPractice?.caseId !== CONTRACT_DELIVERY_CASE) return false;
  const actual = getScenarioDocuments(project);
  const expected = buildCourtroomDocuments(CONTRACT_DELIVERY.documents);
  return (
    actual.length === expected.length &&
    expected.every(({ id, title, content }, index) => {
      const document = actual[index];
      return document.id === id && document.title === title && document.content === content;
    })
  );
}
