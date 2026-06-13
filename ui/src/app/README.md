# app 目录说明

`app/runtime.js` 是前端运行时装配层：创建 feature、注入依赖、同步 store，并向 Vue 组件暴露动作。

不要把新业务直接堆到 `runtime.js`。新增功能时：

1. 状态放 `stores/`。
2. 业务动作放 `features/`。
3. 页面结构放 `components/`。
4. `runtime.js` 只负责把它们连接起来。
