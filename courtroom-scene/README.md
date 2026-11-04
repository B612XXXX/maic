# 模拟法庭场景设计

2026-11-03，独立视觉与交互预览。双击本目录 `打开法庭预览.cmd` 或 `index.html` 即可在默认浏览器打开，无需安装依赖或启动服务。打开即显示全部示例角色，默认高亮你的角色。

## 本轮范围

- 按最新选择采用疏朗的长桌布局，画风扁平化，压低家具厚度与阴影，保留木质描边、米金色调。双方当事人及代理人分别同坐左右长桌，中央展示证据。
- 背景、角色、角色名牌、区域文字、证据交互分别渲染。所有人物为独立元素。
- 普通角色为无五官、无服装细节的纯黑人形。真实学生和参与演练的模拟学生使用各自头像。
- 当前角色从底部锚点放大 1.2 倍，附淡金色侧影，名牌保持原尺寸。支持减少动态效果的系统偏好。
- 民事、刑事和精简演练三个示例展示角色数量、身份与学生位置变化。这些是界面示例，不代表通用庭审程序。
- 中央文书与图片缩略图可打开详情，支持缩放、滚动、Esc 关闭、关闭后焦点返回。查看证据不会改变发言角色。
- 旁听席为空置背景。

底部控制用于设计检查：切换示例、下一位发言、清空高亮、启停模拟学生头像、试用本地自定义头像。上传仅在当前浏览器内存显示，刷新即恢复，文件不发送到服务器。

## 后续接入

当前为独立预览，尚未连接真实课堂、LLM、用户账户或证据库。预设头像复制自参考项目，不能把预览默认头像当作当前登录学生头像。

预留的视图接口：

```js
courtroomScene.setUserProfile({ avatar: currentProfile.avatar, nickname: currentProfile.nickname });
courtroomScene.setActiveRole(currentCourtRoleId); // 轮到某角色时调用；null 清空
courtroomScene.setScene({ name, labels, roles }); // 数据结构参见 scene.js
```

真实接入时将课堂 participant/agent ID 映射到法庭 role ID，头像读取 `useUserProfileStore` 当前值，模拟学生头像来自课堂 roster。LLM 决定角色与流程，视图仅显示传入状态；演示按钮不是生产调度器。

参考代码：`D:/project/OpenMAIC-main/lib/store/user-profile.ts`、`lib/playback/derived-state.ts`、`lib/chat/pi/director-loop.ts`。证据详情目前是本地视觉实现，后续接入项目资料详情能力。

当前背景家具为一张美术底图，可动态变化的是角色人数、席位名称、头像与发言状态；若后续案件需要增删整张桌子，应把家具拆成独立美术层并新增位置配置。当前画面先验证已确定的法庭结构。

## 文件

- `index.html`、`scene.css`、`scene.js`：独立预览。
- `assets/courtroom-background-flat.png`：当前使用的扁平化长桌布局背景。
- `assets/courtroom-background-v2.png`：上一轮俯视布局草稿，当前页面未引用。
- `assets/courtroom-background.png`：较早的视角草稿，留存供比较，当前页面未引用。
- `assets/user.png`、`assets/student.png`：项目预设头像示例。
- `assets/contract.svg`、`assets/receipt.svg`：可完整查看的教学虚构材料。
- `image-prompt-flat.txt`：当前背景使用的内置 imagegen 提示词及扁平化修订提示词。
- `image-prompt.txt`：上一轮背景提示词留档。

## 检查记录

已检查 JavaScript 语法、本地静态资源引用及示例 SVG 格式。浏览器工具禁止打开 file 协议，因此本轮未完成实际浏览器交互与截图验证；请本地双击 index.html 预览。
