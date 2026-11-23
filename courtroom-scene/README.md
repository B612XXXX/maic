# 模拟法庭场景素材与预览

更新：2026-11-19。本目录用于视觉与交互预览；课堂里的 React 法庭视图复用其背景素材。法考短练的运行逻辑见[实现设计](../docs/legal-learning-implementation-design.md)。

当前有两个不同入口：

- 本目录的 index.html：静态示例，可切换案件、角色高亮与材料，没有真实课堂或 LLM 状态。
- components/scene-renderers/pbl/v2/courtroom.tsx：课堂 PBL 情景模拟中的 React 视图，显示实际课程角色、用户资料和阶段文档。

课堂中的法庭舞台在角色扮演阶段显示；默认规划与回退规划都保留法庭展示偏好。准备与复盘可从简报查看共同案卷。手动切换外观不会加载新案卷或改变评价。查看[短练试用说明](../docs/courtroom-preview-and-tryout.md)。

## 静态预览

双击 打开法庭预览.cmd 或 index.html，无需依赖、数据库或模型。预览默认显示全部示例角色，可切换民事、刑事与精简布局。这些是视觉样例，不代表相应庭审程序已实现。

- 背景、人物、名牌、材料和发言状态分层渲染。
- 普通角色使用简化人形，学生与模拟学生可显示头像。
- 当前角色放大高亮，支持减少动态效果的偏好。
- 材料详情支持缩放、滚动、Esc 关闭和焦点返回。
- 上传的自定义头像仅在浏览器内存中显示，刷新恢复。
- 三个静态示例共用预览材料，不能当成真实课程的案件库。

## 预览接口与课堂职责

下列接口只用于本目录的静态演示，不承担课程运行：

```js
courtroomScene.setUserProfile({ avatar, nickname });
courtroomScene.setActiveRole(roleId); // null 清空
courtroomScene.setScene({ name, labels, roles });
```

正式课堂读取自己的课程文档和学习状态。短练由服务端实践构建器写入案卷，学生、一个 AI 对手、导师和评价读取该课程中的共同材料。静态 `scene.js` 不参与课程运行。

运行状态继续复用 PBL runtime。法官、证人、私有证据和程序模板待综合训练需求验证后再决定。

当前家具为整张底图，角色和名牌可变，桌子布局不可任意增删。只有实际场景需要变化时才拆家具层；美术结构不决定法律角色或程序。

## 文件

- index.html、scene.css、scene.js：独立预览。
- assets/courtroom-background-flat.png：当前扁平布局背景。
- assets/courtroom-background-v2.png、courtroom-background.png：历史视觉草稿，当前预览未使用。
- assets/user.png、student.png：预设头像示例。
- assets/contract.svg、receipt.svg：教学虚构材料。
- image-prompt-flat.txt、image-prompt.txt：美术生成与修订提示记录。

## 验证范围

2026-11-04 的历史浏览器检查覆盖静态页面、角色、材料、缩放和关闭行为；2026-11-09 接入课堂 React 视图。本轮未重做静态预览验证。手机专用布局、证据披露与完整庭审仍未实现。

具体实现状态见[实现设计](../docs/legal-learning-implementation-design.md)，建议顺序见[制作计划](../制作计划.md)。
