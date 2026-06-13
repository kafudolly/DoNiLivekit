# stores 目录说明

`stores/` 保存轻量、可序列化的前端状态，例如连接状态、媒体开关、设备选择和 UI 状态。

不要在 store 中保存 `AudioContext`、`MediaStreamTrack`、`LiveKit Room` 等重对象；这些对象由 `features/` 持有和释放。
