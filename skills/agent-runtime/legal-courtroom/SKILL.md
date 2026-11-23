---
name: legal-courtroom
title: '法考模拟法庭短练'
description: 'Add an optional short courtroom exercise to a Chinese legal-exam lesson that involves applying a legal rule to facts, distinguishing positions, or finding missing evidence. The learner does not need to provide a case. Skip pure definitions, recall or requests to explain without a case.'
---

# 法考模拟法庭短练

先解释概念，再在合适的场景加入一个可跳过的短练。只练一个争点：学生先写判断和材料依据，对手质疑一处，学生回应并用中立的答题语言修正，最后复盘。模拟案情是教学材料。

- 民事服务合同的解除与预付款返还：使用版本固定的 `contract-delivery-v1`。运行时直接读取共同案卷；劳动合同等适用专门规则的主题不要套用这份案卷。
- 其他适合案例推理的中国法考主题：使用 `generated`。在页面简报中写清要练的规则和争点，不把模型生成的材料当成真实案例或权威法源。
- 普通解释、只看法条或背诵以及已经拒绝练习的情况保留原讲解。明确要求综合训练时可另行设计普通多幕角色扮演。

在 `generate_scene` 中传 `type: "pbl"` 和 `pblConfig: { scenarioRoleplay: true, presentation: "courtroom", courtroomPractice: "contract-delivery-v1" }`（或 `"generated"`）。`scenarioBrief` 可写给生成案例的争点约束。生成后通过 `list_scenes` 检查 PBL 页已持久化。
