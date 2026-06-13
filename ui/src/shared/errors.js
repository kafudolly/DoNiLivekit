// 错误格式化工具：统一把未知类型错误转成可读文本。
// 业务模块的 catch 中应优先使用这些函数，方便日志中定位“模块/动作/原始错误”。

/**
 * 从任意 error 值中提取可读消息。
 * Rust invoke、浏览器 API、LiveKit SDK 抛出的错误结构不完全一致，因此统一在这里兜底。
 */
export function getErrorMessage(error, fallback = '未知错误') {
    if (!error) return fallback;

    if (typeof error === 'string') return error;

    if (error instanceof Error) {
        return error.message || fallback;
    }

    if (typeof error === 'object') {
        if (typeof error.message === 'string' && error.message.trim()) {
            return error.message;
        }

        try {
            return JSON.stringify(error);
        } catch (_) {
            return fallback;
        }
    }

    return String(error);
}

/** 给错误消息加上模块前缀，例如 rustMic/startRustMicShare，便于按日志快速定位。 */
export function formatError(scope, error, fallback = '未知错误') {
    return `${scope}: ${getErrorMessage(error, fallback)}`;
}

/** 输出带模块前缀的错误日志，并保留原始 error 对象用于 DevTools 展开查看。 */
export function logError(scope, error, level = 'error') {
    const message = formatError(scope, error);
    const logger = console[level] || console.error;
    logger(message, error);
    return message;
}

/** 面向用户弹出错误；详细错误仍应在调用处用 logError 写入控制台。 */
export function alertError(scope, error, fallback = '操作失败，请稍后重试。') {
    alert(`${scope}：${getErrorMessage(error, fallback)}`);
}
