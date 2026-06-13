export const invoke = window.__TAURI__?.core?.invoke
    ? (...args) => window.__TAURI__.core.invoke(...args)
    : window.__TAURI__?.tauri?.invoke
    ? (...args) => window.__TAURI__.tauri.invoke(...args)
    : async () => {
        throw new Error('Tauri invoke 不可用，请在 Tauri 环境运行');
    };

export const listen = window.__TAURI__?.event?.listen
    ? (...args) => window.__TAURI__.event.listen(...args)
    : (..._args) => {
        console.warn('Tauri listen 不可用，事件将不会接收。');
    };

export const isTauriClient = !!window.__TAURI__;
