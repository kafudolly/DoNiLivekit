import { reactive } from 'vue';

/**
 * Presence 状态。
 *
 * 只保存“大厅在线状态”和“频道成员分布”。
 * 不保存 AudioContext、MediaStreamTrack、LiveKit Room 等重对象。
 */
export const presenceStore = reactive({
    connected: false,
    identity: '',
    displayName: '',
    channels: [],
    participants: {},
    lastMessageType: '',
    lastUpdatedAt: Date.now(),
});

/** 清空 Presence 状态，用于断线或退出大厅。 */
export function resetPresenceStore() {
    presenceStore.connected = false;
    presenceStore.identity = '';
    presenceStore.displayName = '';
    presenceStore.channels = [];
    presenceStore.participants = {};
    presenceStore.lastMessageType = '';
    presenceStore.lastUpdatedAt = Date.now();
}

/** 应用后端推送的完整 Presence 快照。 */
export function applyPresenceSnapshot(message) {
    if (!message || message.type !== 'presence_snapshot') return;

    presenceStore.channels = Array.isArray(message.channels) ? message.channels : [];
    presenceStore.participants = message.participants && typeof message.participants === 'object'
        ? message.participants
        : {};
    presenceStore.lastMessageType = message.type;
    presenceStore.lastUpdatedAt = Date.now();
}

/** 记录当前 WebSocket 连接身份。 */
export function setPresenceConnectionState({ connected, identity, displayName }) {
    presenceStore.connected = !!connected;
    if (identity !== undefined) presenceStore.identity = identity || '';
    if (displayName !== undefined) presenceStore.displayName = displayName || '';
    presenceStore.lastUpdatedAt = Date.now();
}

/** 统一处理 Presence 消息。 */
export function applyPresenceMessage(message) {
    if (!message || !message.type) return;

    if (message.type === 'presence_snapshot') {
        applyPresenceSnapshot(message);
        return;
    }

    presenceStore.lastMessageType = message.type;
    presenceStore.lastUpdatedAt = Date.now();
}