// 统一封装 Tauri API，避免各业务模块直接依赖 window.__TAURI__ 的具体版本结构。
// 前端只能通过这里调用 Rust command 或监听 Rust event。

export const invoke = window.__TAURI__?.core?.invoke
    ? (...args) => window.__TAURI__.core.invoke(...args)
    : window.__TAURI__?.tauri?.invoke
        ? (...args) => window.__TAURI__.tauri.invoke(...args)
        : async () => {
            throw new Error('Tauri invoke 不可用：请确认当前页面运行在 Tauri 窗口内，而不是普通浏览器标签页。');
        };

export const listen = window.__TAURI__?.event?.listen
    ? (...args) => window.__TAURI__.event.listen(...args)
    : (..._args) => {
        console.warn('[tauri] Tauri event listen 不可用，Rust 事件将不会被接收。');
    };

export const isTauriClient = !!window.__TAURI__;
