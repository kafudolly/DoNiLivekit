# 前端开发指南

本文档说明前端目录结构、代码风格、模块职责和新增功能建议。

## 前端目录

```text
ui/src/
├─ main.js
├─ App.vue
├─ app/
│  └─ runtime.js
├─ stores/
│  └─ appStore.js
├─ components/
├─ features/
├─ shared/
└─ legacy/
```

## `App.vue`

`App.vue` 是页面骨架层，不应该写复杂业务逻辑。

它适合做：

```text
导入组件
组织整体布局
把组件事件转发给 runtime
```

不适合做：

```text
连接 LiveKit
创建 AudioContext
调用 Tauri invoke
操作 WebSocket
拼接远端视频 DOM
```

## components 写法

组件只负责 UI。

推荐：

```vue
<template>
  <button @click="$emit('toggle-mic')">
    {{ isMicOn ? '关闭麦克风' : '开启麦克风' }}
  </button>
</template>
```

不推荐：

```vue
<script setup>
import { invoke } from '../shared/tauri';

async function toggleMic() {
  await invoke('toggle_rust_mic', { enable: true });
}
</script>
```

业务动作应该放在 feature 模块里。

## features 写法

feature 模块负责业务动作。

一个 feature 文件应该具备明确职责。例如：

```text
rustMic.js：只处理 Rust 麦克风开关、发布、错误监听
appAudio.js：只处理应用音频共享
screenShare.js：只处理屏幕共享
chat.js：只处理聊天发送和消息接收相关逻辑
```

feature 模块可以依赖：

```text
shared 工具
store 状态
LiveKit SDK
Tauri invoke
其他 feature 暴露的明确接口
```

feature 模块不应该成为新的大杂烩。

## stores 写法

store 负责给 UI 提供状态。

推荐保存：

```text
isMicOn
isScreenOn
currentChannel
isAppAudioSharing
selectedMicId
isSettingsOpen
participants
messages
```

不推荐保存：

```text
AudioContext
WebSocket
MediaStreamTrack
LiveKit Room
AudioWorkletNode
```

重对象应该由 feature 模块管理生命周期。

## shared 写法

`shared/` 放跨模块通用能力，例如：

```text
tauri.js       Tauri invoke/listen 封装
constants.js   常量
text.js        文本转义
errors.js      错误信息格式化
```

不要把业务逻辑放进 shared。

## legacy 写法

`legacy/client.js` 只保留历史兼容入口。

后续不要新增业务到这里。

如果旧代码需要一个全局函数，例如 HTML 中仍然有 `onclick="toggleMic()"`，可以在 runtime 中挂载：

```js
window.toggleMic = toggleMic;
```

但新增 Vue 组件时，优先使用 Vue 事件，不要继续增加 inline onclick。

## 新增功能示例

### 示例：新增设置弹窗

推荐文件结构：

```text
src/features/settings.js
src/components/modals/SettingsModal.vue
src/components/settings/AudioSettings.vue
src/components/settings/AppearanceSettings.vue
```

store 中增加：

```js
ui: {
  isSettingsOpen: false,
  settingsTab: 'audio'
}
```

组件只负责显示和触发事件，保存动作放到 `features/settings.js`。

### 示例：新增频道分类

推荐调整：

```text
stores/appStore.js：保存频道分类状态
features/roomConnection.js：解析服务端频道数据
components/sidebar/ChannelList.vue：按分类渲染
```

不要只在组件里临时拼接字符串。

## 代码风格

项目使用 `.editorconfig` 统一基础格式。

建议规则：

```text
JavaScript/Vue：4 空格缩进
JSON/Markdown/YAML：2 空格缩进
UTF-8 编码
LF 换行
文件末尾保留空行
删除行尾空格
```

## 注释规范

注释应该说明“为什么这么做”，而不是重复代码本身。

推荐：

```js
// 切频道前先停止本地 Rust 麦克风发布，避免旧 room 的 publication 残留。
await stopRustMicShare();
```

不推荐：

```js
// 调用 stopRustMicShare 函数
await stopRustMicShare();
```

## 错误提示规范

错误日志必须能定位模块。

推荐：

```js
console.error('devices/updateMicList：获取麦克风列表失败', error);
```

不推荐：

```js
console.error(error);
```

## 回归测试

每次前端重构或新增功能后，请至少测试：

```text
页面启动
进入大厅
自动进入频道
Rust 麦克风发布
绿线跳动
切频道恢复麦克风
麦克风设备切换
扬声器切换
应用音频共享
屏幕共享
聊天发送/接收
离开房间资源释放
```
