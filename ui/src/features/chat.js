import { addChatMessage } from '../stores/chatStore.js';
import { profileStore, getStableAvatarColor } from '../stores/profileStore.js';
import { logError } from '../shared/errors.js';
import { silentPostChatMessage } from '../shared/apiClient.js';

/**
 * 创建聊天模块。
 * 消息通过 LiveKit DataChannel 发送；渲染由 chatStore + ChatPanel.vue (Vue 响应式) 负责。
 * 同时通过 REST API 将消息持久化到服务器，确保其他客户端加入后也能看到历史记录。
 */
export function createChatFeature(context) {
    /**
     * 发送当前输入框内容，并在本地立即追加一条 self 消息。
     * @param {string} [text] - 可选文本；不传则读取 #chat-input（兼容旧 DOM 接口）
     */
    async function sendChatMessage(text) {
        const room = context.getRoom();
        if (!room || !room.localParticipant) return;

        const msgText = text ?? document.getElementById('chat-input')?.value ?? '';
        const trimmed = String(msgText).trim();
        if (!trimmed) return;

        try {
            // 聊天消息改为全部通过后端 POST 和 Presence WebSocket 同步，
            // 不再使用 DataChannel 广播（避免 ID 不一致和重复渲染）

            const myName = room.localParticipant.name || room.localParticipant.identity;
            const myId = room.localParticipant.identity;

            // 本地立即渲染（isSelf=true 使用完整头像 URL）
            const msg = renderChatMessage({
                senderId: myId,
                senderName: myName,
                senderColor: profileStore.avatarColor,
                senderPreset: profileStore.avatarPreset,
                senderAvatarUrl: profileStore.avatarUrl ?? null,
                content: trimmed,
                isSelf: true,
            });

            // 后台同步到服务器（不阻塞发送流程，失败只打日志）
            if (msg) {
                silentPostChatMessage(msg);
            }

            // 清空输入框
            const input = document.getElementById('chat-input');
            if (input) input.value = '';
        } catch (e) {
            logError('chat/sendChatMessage 发送消息失败', e);
        }
    }

    /**
     * 渲染一条聊天消息（写入 chatStore，由 ChatPanel.vue 响应式渲染）。
     * @param {Object|string} msgData - 消息对象或发送者名称（兼容旧调用签名）
     * @returns {Object|undefined} 写入 chatStore 的消息对象
     */
    function renderChatMessage(msgData) {
        // 兼容旧调用签名: renderChatMessage(sender, text, isSelf)
        if (typeof msgData === 'string') {
            const [sender, text, isSelf] = arguments;
            return addChatMessage({
                senderId: sender,
                senderName: sender,
                senderColor: getStableAvatarColor(sender),
                senderPreset: '',
                senderAvatarUrl: null,
                content: text,
                isSelf: !!isSelf,
            });
        }

        return addChatMessage({
            senderId: msgData.senderId || '',
            senderName: msgData.senderName || '未知用户',
            senderColor: msgData.senderColor || getStableAvatarColor(msgData.senderName || ''),
            senderPreset: msgData.senderPreset || '',
            senderAvatarUrl: msgData.senderAvatarUrl ?? null,
            content: msgData.content || '',
            isSelf: !!msgData.isSelf,
        });
    }

    return { sendChatMessage, renderChatMessage };
}
