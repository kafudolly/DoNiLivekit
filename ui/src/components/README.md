# components 目录说明

`components/` 只负责页面结构和事件转发，不直接调用 Rust、LiveKit 或 AudioWorklet。

当前仍保留部分稳定 DOM id，供 legacy 兼容层和 feature 模块挂载远端媒体、成员列表和设备控件。
