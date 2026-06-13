# features 目录说明

`features/` 存放业务模块和外部系统集成代码，例如 LiveKit、Tauri、AudioWorklet、屏幕共享和设备切换。

约定：

- 新功能优先新建 `xxx.js`，并导出 `createXFeature(context)` 或明确的业务函数。
- feature 可以调用 Tauri、LiveKit、浏览器 API，但不要直接承担大段页面布局。
- 组件只触发事件；具体业务动作由 `app/runtime.js` 转发到 feature。
- 共享工具放到 `shared/`，轻量状态放到 `stores/`。
