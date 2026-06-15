/**
 * DoNiChannel Chat WebSocket 客户端（Phase 2）。
 *
 * 职责：
 * - 建立独立 /ws/chat 通道
 * - 频道订阅
 * - 消息发送 / ACK / 广播接收
 * - Reaction / Pin 同步
 * - 断线重连
 */
export function createChatClient({ logError, onMessage, onConnectionChange } = {}) {
  let socket = null;
  let shouldReconnect = false;
  let reconnectTimer = null;
  let lastConnectOptions = null;
  // currentChannelId 表示前端希望订阅的频道；confirmed/pending 用于避免重复订阅。
  let currentChannelId = null;
  let confirmedChannelId = null;
  let pendingSubscribeChannelId = null;

  let userId = '';
  let connectionId = '';
  let identity = '';
  let displayName = '';
  let avatarColor = '#5865f2';
  let avatarPreset = '';
  let avatarUrl = '';

  function toWsBase(apiBase) {
    return String(apiBase || '').replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  }

  function isConnected() {
    return !!socket && socket.readyState === WebSocket.OPEN;
  }

  function getReadyState() {
    if (!socket) return WebSocket.CLOSED;
    return socket.readyState;
  }

  function getDebugState() {
    const state = getReadyState();
    return {
      connected: isConnected(),
      readyState: state,
      readyStateText: state === WebSocket.CONNECTING ? 'CONNECTING' : state === WebSocket.OPEN ? 'OPEN' : state === WebSocket.CLOSING ? 'CLOSING' : 'CLOSED',
      shouldReconnect,
      hasLastConnectOptions: !!lastConnectOptions,
      currentChannelId,
      confirmedChannelId,
      pendingSubscribeChannelId,
      userId,
      connectionId,
      identity,
      displayName,
    };
  }

  function waitUntilConnected(timeoutMs = 3000) {
    if (isConnected()) return Promise.resolve(true);

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (isConnected()) {
          clearInterval(timer);
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 50);
    });
  }

  async function ensureConnected(options = {}, timeoutMs = 3000) {
    if (isConnected()) return true;

    const connectOptions = { ...(lastConnectOptions || {}), ...(options || {}) };
    if (connectOptions.apiBase) {
      await connect(connectOptions);
    }

    return waitUntilConnected(timeoutMs);
  }

  function emitConnectionState(connected) {
    onConnectionChange?.({
      connected,
      userId,
      connectionId,
      identity,
      displayName,
      currentChannelId,
    });
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      logError?.('chatClient/send 发送 Chat 消息失败', error, 'warn');
      return false;
    }
  }

  async function connect(options = {}) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const apiBase = options.apiBase;
    if (!apiBase) {
      logError?.('chatClient/connect 缺少 apiBase，跳过连接', null, 'warn');
      return;
    }

    userId = String(options.userId || options.identity || '').trim();
    connectionId = String(options.connectionId || '').trim();
    identity = String(options.identity || userId || '').trim();
    displayName = String(options.displayName || options.username || '访客').trim() || '访客';
    avatarColor = String(options.avatarColor || '#5865f2');
    avatarPreset = String(options.avatarPreset || '');
    avatarUrl = String(options.avatarUrl || '');
    const statusText = String(options.statusText || '在线');

    if (!userId) userId = identity || displayName;
    if (!identity) identity = userId;
    if (!connectionId) connectionId = `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    lastConnectOptions = {
      ...options,
      userId,
      connectionId,
      identity,
      displayName,
      avatarColor,
      avatarPreset,
      avatarUrl,
      statusText,
    };
    shouldReconnect = true;

    const wsBase = toWsBase(apiBase);
    const params = new URLSearchParams({
      user: displayName,
      userId,
      connectionId,
      identity,
      avatarColor,
      avatarPreset,
      avatarUrl,
      statusText,
    });
    const url = `${wsBase}/ws/chat?${params.toString()}`;

    await new Promise((resolve) => {
      socket = new WebSocket(url);

      socket.onopen = () => {
        console.log('[Chat] 已连接', url);
        confirmedChannelId = null;
        pendingSubscribeChannelId = null;
        emitConnectionState(true);

        if (currentChannelId) {
          subscribeChannel(currentChannelId, { force: true });
        } else {
          send({ type: 'request_state' });
        }

        resolve();
      };

      socket.onmessage = (event) => {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          logError?.('chatClient/onmessage 解析 Chat 消息失败', error, 'warn');
          return;
        }

        if (message.type === 'chat_subscribed') {
          confirmedChannelId = message.channelId || null;
          currentChannelId = confirmedChannelId;
          if (pendingSubscribeChannelId === confirmedChannelId) {
            pendingSubscribeChannelId = null;
          }
        }

        onMessage?.(message);
      };

      socket.onerror = (event) => {
        logError?.('chatClient/socket Chat 连接错误', event, 'warn');
      };

      socket.onclose = () => {
        console.warn('[Chat] 连接已关闭');
        socket = null;
        confirmedChannelId = null;
        pendingSubscribeChannelId = null;
        emitConnectionState(false);

        if (shouldReconnect && lastConnectOptions?.apiBase) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            connect(lastConnectOptions).catch((error) => {
              logError?.('chatClient/reconnect Chat 重连失败', error, 'warn');
            });
          }, 1500);
        }
      };
    });
  }

  function disconnect() {
    shouldReconnect = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    if (socket) {
      socket.close();
      socket = null;
    }

    emitConnectionState(false);
  }

  function subscribeChannel(channelId, options = {}) {
    const nextChannelId = String(channelId || '').trim() || null;
    const force = !!options.force;

    currentChannelId = nextChannelId;

    if (!nextChannelId) {
      confirmedChannelId = null;
      pendingSubscribeChannelId = null;
      return send({ type: 'unsubscribe_channel' });
    }

    // Phase 2.2：如果已经确认订阅或正在等待同一频道的订阅确认，不重复发送 subscribe。
    if (!force && (confirmedChannelId === nextChannelId || pendingSubscribeChannelId === nextChannelId)) {
      return true;
    }

    if (!isConnected()) return false;

    pendingSubscribeChannelId = nextChannelId;
    const ok = send({ type: 'subscribe_channel', channelId: nextChannelId });
    if (!ok) pendingSubscribeChannelId = null;
    return ok;
  }

  function requestState() {
    return send({ type: 'request_state' });
  }

  function ping() {
    return send({ type: 'ping' });
  }

  function sendMessage({ clientMessageId, channelId, content, senderColor, senderPreset, senderAvatarUrl }) {
    return send({
      type: 'send_message',
      clientMessageId,
      channelId: channelId || currentChannelId,
      content,
      senderColor: senderColor || avatarColor,
      senderPreset: senderPreset ?? avatarPreset,
      senderAvatarUrl: senderAvatarUrl ?? avatarUrl,
    });
  }

  function toggleReaction({ messageId, emoji, channelId }) {
    return send({
      type: 'toggle_reaction',
      messageId,
      emoji,
      channelId: channelId || currentChannelId,
    });
  }

  return {
    connect,
    disconnect,
    subscribeChannel,
    requestState,
    ping,
    send,
    sendMessage,
    toggleReaction,
    isConnected,
    waitUntilConnected,
    ensureConnected,
    getReadyState,
    getDebugState,
    getCurrentChannel: () => currentChannelId,
    getConfirmedChannel: () => confirmedChannelId,
    getUserId: () => userId,
    getConnectionId: () => connectionId,
    getIdentity: () => identity,
  };
}
