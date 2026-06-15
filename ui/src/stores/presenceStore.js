import { reactive } from 'vue';

/**
 * Presence 状态。
 *
 * 只保存大厅在线状态和频道成员分布。
 * 不保存 AudioContext、MediaStreamTrack、LiveKit Room 等重对象。
 */
export const presenceStore = reactive({
    connected: false,
    identity: '',
    userId: '',
    connectionId: '',
    displayName: '',
    channels: [],
    participants: {},
    lastMessageType: '',
    lastUpdatedAt: Date.now(),
});

/** 清空 Presence 状态，用于主动退出大厅或断开连接。 */
export function resetPresenceStore() {
    presenceStore.connected = false;
    presenceStore.identity = '';
    presenceStore.userId = '';
    presenceStore.connectionId = '';
    presenceStore.displayName = '';
    presenceStore.channels = [];
    presenceStore.participants = {};
    presenceStore.lastMessageType = '';
    presenceStore.lastUpdatedAt = Date.now();
}

/** 记录当前 WebSocket 连接身份。 */
export function setPresenceConnectionState({ connected, identity, userId, connectionId, displayName }) {
    presenceStore.connected = !!connected;
    if (identity !== undefined) presenceStore.identity = identity || '';
    if (userId !== undefined) presenceStore.userId = userId || '';
    if (connectionId !== undefined) presenceStore.connectionId = connectionId || '';
    if (displayName !== undefined) presenceStore.displayName = displayName || '';
    presenceStore.lastUpdatedAt = Date.now();
}

/** 标准化成员对象，保证 Vue 渲染层字段稳定。 */
function normalizeMember(member) {
    if (!member) return null;

    if (typeof member === 'string') {
        const name = member.trim();
        if (!name) return null;
        return {
            identity: name,
            userId: name,
            connectionId: '',
            displayName: name,
            statusText: '在线',
        };
    }

    const identity = String(member.identity || member.name || member.displayName || '').trim();
    const userId = String(member.userId || member.identity || member.name || member.displayName || '').trim();
    const connectionId = String(member.connectionId || '').trim();
    const displayName = String(member.displayName || member.name || member.identity || '').trim();

    if (!identity && !displayName) return null;

    return {
        identity: identity || displayName,
        userId: userId || identity || displayName,
        connectionId,
        displayName: displayName || identity,
        avatarColor: member.avatarColor,
        avatarPreset: member.avatarPreset,
        avatarUrl: member.avatarUrl,
        statusText: member.statusText || '在线',
    };
}

/** 标准化频道对象，后续 Discord UI 可以继续扩展 type/category/icon 等字段。 */
function normalizeChannel(channel) {
    const id = String(channel?.id || channel?.name || '').trim();
    const name = String(channel?.name || channel?.id || '').trim();

    if (!id && !name) return null;

    const members = Array.isArray(channel.members)
        ? channel.members.map(normalizeMember).filter(Boolean)
        : [];

    return {
        id: id || name,
        name: name || id,
        type: channel.type || 'voice',
        members,
    };
}

/** 查找频道索引，兼容 id/name 两种字段。 */
function findChannelIndex(channelId) {
    const cleanId = String(channelId || '').trim();
    if (!cleanId) return -1;

    return presenceStore.channels.findIndex((channel) => {
        return channel.id === cleanId || channel.name === cleanId;
    });
}

/** 确保频道存在；用于处理先收到 moved、后收到 snapshot 的极端顺序。 */
function ensureChannel(channelId) {
    const cleanId = String(channelId || '').trim();
    if (!cleanId) return null;

    let index = findChannelIndex(cleanId);

    if (index < 0) {
        presenceStore.channels.push({
            id: cleanId,
            name: cleanId,
            type: 'voice',
            members: [],
        });
        index = presenceStore.channels.length - 1;
    }

    return presenceStore.channels[index];
}

/** 从全部频道移除指定成员，避免切频道后同一个人残留在旧频道。 */
function removeMemberFromAllChannels(identity, displayName) {
    const id = String(identity || '').trim();
    const name = String(displayName || '').trim();

    presenceStore.channels.forEach((channel) => {
        channel.members = channel.members.filter((member) => {
            return member.identity !== id && member.displayName !== name;
        });
    });
}

/** 应用后端推送的完整 Presence 快照。 */
export function applyPresenceSnapshot(message) {
    if (!message || message.type !== 'presence_snapshot') return;

    presenceStore.channels = Array.isArray(message.channels)
        ? message.channels.map(normalizeChannel).filter(Boolean)
        : [];

    presenceStore.participants = message.participants && typeof message.participants === 'object'
        ? message.participants
        : {};

    presenceStore.lastMessageType = message.type;
    presenceStore.lastUpdatedAt = Date.now();
}

/** 应用成员移动事件。 */
function applyParticipantMoved(message) {
    const identity = String(message.identity || '').trim();
    const displayName = String(message.displayName || message.identity || '').trim();
    const targetChannel = String(message.to || '').trim();

    if (!identity && !displayName) return;

    removeMemberFromAllChannels(identity, displayName);

    if (targetChannel) {
        const channel = ensureChannel(targetChannel);
        if (channel) {
            const exists = channel.members.some((member) => {
                return member.identity === identity || member.displayName === displayName;
            });

            if (!exists) {
                channel.members.push({
                    identity: identity || displayName,
                    userId: message.userId || identity || displayName,
                    connectionId: message.connectionId || '',
                    displayName: displayName || identity,
                    avatarColor: message.avatarColor,
                    avatarPreset: message.avatarPreset,
                    avatarUrl: message.avatarUrl,
                    statusText: message.statusText || '在线',
                });
            }
        }
    }

    if (identity || displayName) {
        const key = identity || displayName;
        presenceStore.participants[key] = {
            ...(presenceStore.participants[key] || {}),
            identity: key,
            userId: message.userId || key,
            connectionId: message.connectionId || '',
            displayName: displayName || key,
            currentChannel: targetChannel || null,
            avatarColor: message.avatarColor,
            avatarPreset: message.avatarPreset,
            avatarUrl: message.avatarUrl,
            statusText: message.statusText || '在线',
        };
    }
}

/** 应用用户离线事件。 */
function applyParticipantOffline(message) {
    const identity = String(message.identity || '').trim();
    const displayName = String(message.displayName || message.identity || '').trim();

    removeMemberFromAllChannels(identity, displayName);

    if (identity && presenceStore.participants[identity]) {
        delete presenceStore.participants[identity];
    }
}

/** 应用用户进入大厅事件；未进入语音频道时不显示在频道下面。 */
function applyParticipantOnline(message) {
    const participant = message.participant || {};
    const identity = String(participant.identity || '').trim();
    const displayName = String(participant.displayName || participant.identity || '').trim();

    if (!identity && !displayName) return;

    const key = identity || displayName;
    presenceStore.participants[key] = {
        identity: key,
        userId: participant.userId || key,
        connectionId: participant.connectionId || '',
        displayName: displayName || key,
        currentChannel: participant.currentChannel || null,
        avatarColor: participant.avatarColor,
        avatarPreset: participant.avatarPreset,
        avatarUrl: participant.avatarUrl,
        statusText: participant.statusText || '在线',
    };
}

/** 应用用户资料更新（头像颜色、预设 emoji、头像 URL）。 */
function applyProfileUpdate(message) {
    const identity = String(message.identity || '').trim();
    const userId = String(message.userId || '').trim();

    const applyToMember = (member) => {
        if (!member) return;
        if (message.displayName) member.displayName = message.displayName;
        member.avatarColor = message.avatarColor;
        member.avatarPreset = message.avatarPreset;
        member.avatarUrl = message.avatarUrl;
        member.statusText = message.statusText || member.statusText || '在线';
    };

    for (const key of [identity, userId]) {
        if (key && presenceStore.participants[key]) {
            applyToMember(presenceStore.participants[key]);
        }
    }

    for (const channel of presenceStore.channels) {
        for (const member of channel.members) {
            if (member.identity === identity || (userId && member.userId === userId)) {
                applyToMember(member);
            }
        }
    }
}

/** 统一处理 Presence 消息；ChannelList.vue 会自动响应 presenceStore 的变化。 */
export function applyPresenceMessage(message) {
    if (!message || !message.type) return;

    if (message.type === 'presence_snapshot') {
        applyPresenceSnapshot(message);
    } else if (message.type === 'participant_moved') {
        applyParticipantMoved(message);
    } else if (message.type === 'participant_offline') {
        applyParticipantOffline(message);
    } else if (message.type === 'participant_online') {
        applyParticipantOnline(message);
    } else if (message.type === 'update_profile') {
        applyProfileUpdate(message);
    } else if (message.type === 'profile_updated') {
        applyProfileUpdate(message);
    }

    presenceStore.lastMessageType = message.type;
    presenceStore.lastUpdatedAt = Date.now();
}
