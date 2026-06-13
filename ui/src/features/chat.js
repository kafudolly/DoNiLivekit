import { logError } from '../shared/errors.js';

/** 创建聊天模块；消息通过 LiveKit DataChannel 发送，渲染仍写入 #chat-messages。 */
export function createChatFeature(context) {
    /** 发送当前输入框内容，并在本地立即追加一条 self 消息。 */
    async function sendChatMessage() {
        const room = context.getRoom();
        if (!room || !room.localParticipant) return;

        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;

        try {
            const data = JSON.stringify({ msg: text });
            await room.localParticipant.publishData(new TextEncoder().encode(data), { reliable: true });

            const myName = room.localParticipant.name || room.localParticipant.identity;
            renderChatMessage(myName, text, true);
            input.value = '';
        } catch (e) {
            logError('chat/sendChatMessage 发送消息失败', e);
        }
    }

    /** 渲染一条聊天消息；sender/text 必须先转义后写入 innerHTML。 */
    function renderChatMessage(sender, text, isSelf) {
        const messagesDiv = document.getElementById('chat-messages');
        if (!messagesDiv) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message' + (isSelf ? ' self' : '');

        const now = new Date();
        const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

        msgEl.innerHTML = `
            <div class="chat-meta">${context.sanitizeText(sender)} ${timeStr}</div>
            <div class="chat-content">${context.sanitizeText(text)}</div>
        `;
        messagesDiv.appendChild(msgEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    return { sendChatMessage, renderChatMessage };
}
