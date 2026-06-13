# 小豆泥电竞语音客户端

这是一个基于 **Tauri + Vue 3 + LiveKit + Rust WASAPI** 的桌面语音客户端。项目核心目标是提供类似 Discord 的语音频道体验，并支持 Rust 侧的低延迟音频采集、应用音频共享、屏幕共享、聊天和设备选择。

## 技术栈

- 前端：Vue 3、Vite、JavaScript、AudioWorklet
- 桌面壳：Tauri v2
- 后端本地能力：Rust、Windows WASAPI、WebSocket
- 实时音视频：LiveKit
- 本地音频端口：
  - `127.0.0.1:9001`：应用/进程音频共享
  - `127.0.0.1:9002`：Rust 麦克风音频采集

## 项目目录

推荐仓库结构如下：

```text
livekit_pack/
├─ README.md
├─ PROJECT_GUIDE.md
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ AUDIO_PIPELINE.md
│  ├─ FRONTEND_GUIDE.md
│  └─ TROUBLESHOOTING.md
├─ ui/
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.js
│  ├─ public/
│  │  └─ pcm-worker.js
│  └─ src/
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ src/
│     ├─ lib.rs
│     └─ main.rs
└─ .editorconfig
```

## 本地开发运行

先安装前端依赖：

```powershell
cd F:\livekit_pack\ui
npm install
```

从项目根目录启动 Tauri：

```powershell
cd F:\livekit_pack
npx tauri dev
```

如果 Tauri 配置中的 `beforeDevCommand` 使用的是 `npm run dev`，请确保命令从项目根目录运行，并且 `tauri.conf.json` 中 `devUrl` 指向：

```json
"devUrl": "http://localhost:5173"
```

## 打包

```powershell
cd F:\livekit_pack
npx tauri build
```

## 核心功能

- 进入大厅并显示频道列表
- 自动加入默认语音频道
- Rust 麦克风采集与 LiveKit 发布
- 麦克风输入音量绿条
- 麦克风设备选择
- 扬声器输出设备选择
- 应用进程音频共享
- 屏幕共享和本地预览
- 远端用户音量百分比保存
- 聊天消息发送与接收
- 切换频道后自动恢复麦克风状态

## 文档入口

- `PROJECT_GUIDE.md`：给开发者看的项目开发规则和模块边界
- `docs/ARCHITECTURE.md`：整体架构说明
- `docs/AUDIO_PIPELINE.md`：9001、9002、AudioWorklet、LiveKit 音频链路说明
- `docs/FRONTEND_GUIDE.md`：前端目录、组件、状态和业务模块说明
- `docs/TROUBLESHOOTING.md`：常见问题排查

## 开发原则

后续新增功能时，请遵守以下原则：

```text
components 只负责 UI
features 只负责业务动作
stores 只负责状态
shared 只放通用工具
legacy 不再新增业务代码
```

不要把新功能直接写进 `legacy/client.js`。如果确实需要兼容旧函数名，只在 `legacy/client.js` 中做导出或入口转发。
