// 手写 innerHTML 前必须做文本转义，防止昵称、频道名、聊天消息破坏 DOM 或注入脚本。
// Vue 模板会自动转义；这里只服务于保留的 legacy DOM 渲染路径。

export function sanitizeText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
