# shared 目录说明

`shared/` 存放不会持有业务状态的通用代码。

- `tauri.js`：统一封装 Tauri `invoke/listen`。
- `constants.js`：多个模块共同依赖的常量。
- `text.js`：legacy DOM 渲染使用的文本转义。
- `errors.js`：统一错误消息、日志和弹窗格式。
