import { alertError, logError } from '../shared/errors.js';
import { presenceStore } from '../stores/presenceStore.js';

/** 创建房间连接模块；维护大厅状态、当前频道和 LiveKit 切频道流程。 */
export function createRoomConnectionFeature(context) {
    let currentChannel = null;
    let isInLobby = false;
    let channels = ['day0', 'day1', 'day2'];
    let roomPollTimer = null;
    let isPolling = false;
    let shouldRestoreMicAfterChannelSwitch = false;
    let isSwitchingChannel = false;

    /** 规范化服务器输入，允许用户输入 http/ws 前缀但内部只保留 host:port。 */
    function normalizeServerInput(rawValue) {
        let val = (rawValue || '').trim();
        if (!val) return context.defaultServerIp;
        val = val.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
        val = val.replace(/\/$/, '');
        return val;
    }

    /** 从输入框生成 API 地址和 LiveKit WebSocket 地址。 */
    function getServerConfig() {
        const inputEl = document.getElementById('server-ip');
        const normalized = normalizeServerInput(inputEl ? inputEl.value : '');

        let host = normalized;
        let apiPort = '5000';

        if (normalized.includes(':')) {
            const parts = normalized.split(':');
            host = parts[0];
            apiPort = parts[1] || '5000';
        }

        const apiBase = `http://${host}:${apiPort}`;
        const livekitWs = `ws://${host}:7880`;
        return { apiBase, livekitWs, persistValue: `${host}:${apiPort}` };
    }

    /** 从 Presence 状态中读取频道名；Presence 未连接前回退到本地默认频道。 */
    function getAvailableChannelNames() {
        const presenceChannels = presenceStore.channels
            .map((channel) => String(channel.name || channel.id || '').trim())
            .filter(Boolean);

        return presenceChannels.length > 0 ? presenceChannels : channels;
    }

    /** 更新本地频道缓存；只保存频道名，不保存成员。成员唯一来源是 presenceStore。 */
    function setLocalChannels(nextChannels) {
        const seen = new Set();
        const normalized = [];

        nextChannels.forEach((name) => {
            const cleanName = String(name || '').trim();
            if (!cleanName || seen.has(cleanName)) return;
            seen.add(cleanName);
            normalized.push(cleanName);
        });

        if (normalized.length > 0) {
            channels = normalized;
        }
    }

    /**
     * 兼容旧调用的空渲染函数。
     *
     * 频道列表现在由 ChannelList.vue 直接读取 presenceStore 渲染，
     * 这里保留函数名，避免旧初始化和错误恢复流程调用时报错。
     */
    function renderChannelList() {}

    /**
     * 兼容旧接口：只从 /api/rooms 拉取频道列表，不再读取或维护成员。
     *
     * 成员状态已经迁移到 Presence WebSocket 和 presenceStore。
     */
    async function refreshRoomsFromServer() {
        const serverConfig = getServerConfig();
        const response = await fetch(`${serverConfig.apiBase}/api/rooms`);
        if (!response.ok) throw new Error(`房间列表接口返回异常：HTTP ${response.status}`);

        const rows = await response.json();
        if (!Array.isArray(rows)) return getAvailableChannelNames();

        const nextChannels = rows
            .map((row) => (row && row.name ? String(row.name).trim() : ''))
            .filter(Boolean);

        setLocalChannels(nextChannels);
        return getAvailableChannelNames();
    }

    /** Presence 已接管实时成员状态，保留轮询函数用于兼容旧导出但不再启动定时器。 */
    function startRoomPolling() {
        isPolling = false;
        if (roomPollTimer) {
            clearTimeout(roomPollTimer);
            roomPollTimer = null;
        }
    }

    function stopRoomPolling() {
        isPolling = false;
        if (roomPollTimer) {
            clearTimeout(roomPollTimer);
            roomPollTimer = null;
        }
    }

    /** 调用后端创建频道，成功后等待 Presence snapshot 刷新 Vue 频道列表，并切入新频道。 */
    async function createChannel() {
        const value = prompt('输入新频道名（英文字母/数字/短横线）:');
        if (!value) return;
        const name = value.trim();
        if (!name) return;

        const serverConfig = getServerConfig();
        const action = {
            action: 'create_channel',
            name,
        };

        try {
            const response = await fetch(`${serverConfig.apiBase}/api/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `创建频道接口返回异常：HTTP ${response.status}`);
            }

            setLocalChannels([...channels, name]);
            context.presence.requestSnapshot?.();
            await switchChannel(name);
        } catch (e) {
            logError('roomConnection/createChannel 创建频道失败', e);
            alertError('创建频道失败', e);
        }
    }

    /** 断开房间后重置 DOM、按钮、远端音频路由和本地屏幕预览。 */
    function resetRoomUIAfterDisconnect() {
        document.getElementById('video-container').innerHTML = '';
        document.getElementById('audio-container').innerHTML = '';
        document.getElementById('participant-list').innerHTML = '<div style="font-size: 12px; color: #80848e; text-align: center; margin-top: 20px;">加入频道后显示在线人员</div>';
        document.getElementById('user-count').innerText = '0';
        document.getElementById('btn-mic').disabled = true;
        document.getElementById('mic-select').disabled = true;
        document.getElementById('audio-output-select').disabled = true;
        document.getElementById('btn-screen').disabled = true;
        document.getElementById('screen-res').disabled = true;
        document.getElementById('screen-fps').disabled = true;
        document.getElementById('screen-bitrate').disabled = true;
        document.getElementById('chat-input').disabled = true;
        document.getElementById('btn-send').disabled = true;
        document.getElementById('btn-app-audio').disabled = true;

        context.rustMic.setMicOn(false);
        context.screenShare.setIsScreenOn(false);
        context.appAudio.setIsAppAudioSharing(false);
        context.appAudio.setLocalAppAudioPublication(null);
        context.participants.clearActiveSpeakers();
        context.remoteAudio.clearRemoteGainNodes();
        context.livekitEvents.clearLocalScreenControls();
        context.screenShare.hideLocalScreenPreview();

        const uiName = document.getElementById('ui-username');
        if (uiName) uiName.innerText = '未连接大厅';
        const uiStatus = document.getElementById('ui-status');
        if (uiStatus) {
            uiStatus.innerText = '等待加入房间';
            uiStatus.style.color = '#b5bac1';
        }

        context.appAudio.closeAppAudioModal();
    }

    /** 进入大厅：保存用户名/服务器地址，连接 Presence，并按配置自动加入第一个频道。 */
    async function joinRoom(options = {}) {
        const autoJoinFirstChannel = options.autoJoinFirstChannel !== false;
        const username = document.getElementById('username').value.trim();
        if (!username) return alert('起个响亮的名字吧！');

        context.ensureAudioContext();
        await context.audioPipelines.resumeLocalPcmAudioContext();

        localStorage.setItem('lk_username', username);
        const serverConfig = getServerConfig();
        localStorage.setItem('lk_server_ip', serverConfig.persistValue);

        isInLobby = true;
        document.getElementById('btn-connect').innerText = '🏛️ 已进入大厅';
        document.getElementById('btn-connect').style.backgroundColor = '#1a6334';
        document.getElementById('header').innerText = '# 🏛️ DoNiChannel 电竞大厅（选择左侧语音分组）';

        try {
            await context.presence.connect({
                apiBase: serverConfig.apiBase,
                username,
            });
            context.presence.requestSnapshot();
        } catch (err) {
            logError('roomConnection/joinRoom 连接 Presence WebSocket 失败', err, 'warn');
        }

        if (context.autoJoinFirstChannelAfterLobby && autoJoinFirstChannel && !context.getRoom()) {
            const availableChannels = getAvailableChannelNames();
            if (availableChannels.length > 0) {
                await switchChannel(availableChannels[0]);
            }
        }
    }

    /** 切换频道：按固定顺序停止本地发布、disconnect、connect，再恢复原来的麦克风状态。 */
    async function switchChannel(roomName) {
        if (!isInLobby) {
            await joinRoom({ autoJoinFirstChannel: false });
            if (!isInLobby) return;
        }

        if (isSwitchingChannel) return;

        const room = context.getRoom();
        if (currentChannel === roomName && room) return;
        isSwitchingChannel = true;

        const isInitialChannelJoin = !room;
        const shouldRestoreMic = isInitialChannelJoin
            ? true
            : (context.rustMic.getIsMicOn() || context.rustMic.getIsRustMicOn() || context.rustMic.hasLocalRustMicPublication());
        shouldRestoreMicAfterChannelSwitch = shouldRestoreMic;

        try {
            const currentRoom = context.getRoom();
            if (currentRoom) {
                try {
                    if (context.isTauriClient && (context.rustMic.getIsMicOn() || context.rustMic.getIsRustMicOn() || context.rustMic.hasLocalRustMicPublication())) {
                        await context.rustMic.stopRustMicShare();
                    } else if (!context.isTauriClient && context.rustMic.getIsMicOn() && currentRoom.localParticipant) {
                        await currentRoom.localParticipant.setMicrophoneEnabled(false).catch(() => {});
                        context.rustMic.setMicOn(false);
                    }

                    if (context.appAudio.getIsAppAudioSharing()) {
                        await context.appAudio.stopAppAudioShare();
                    }

                    if (context.screenShare.getIsScreenOn() && currentRoom.localParticipant) {
                        await currentRoom.localParticipant.setScreenShareEnabled(false).catch(() => {});
                        context.screenShare.setIsScreenOn(false);
                    }
                } catch (e) {
                    logError('roomConnection/switchChannel 停止旧频道本地资源失败', e, 'warn');
                }

                try {
                    await currentRoom.disconnect();
                } catch (e) {
                    logError('roomConnection/switchChannel 断开旧频道失败', e, 'warn');
                }

                context.setRoom(null);
                resetRoomUIAfterDisconnect();
            }

            currentChannel = roomName;
            await connectToChannel(roomName, { autoMic: false });

            if (context.getRoom() && currentChannel === roomName) {
                try {
                    context.presence.joinChannel(roomName);
                } catch (error) {
                    logError('roomConnection/switchChannel 通知 Presence 切换频道失败', error, 'warn');
                }
            }

            const nextRoom = context.getRoom();
            if (shouldRestoreMicAfterChannelSwitch && nextRoom && nextRoom.localParticipant) {
                try {
                    if (context.isTauriClient) {
                        await context.updateMicList().catch((error) => logError('roomConnection/switchChannel 恢复麦克风前刷新设备列表失败', error, 'warn'));
                        await context.rustMic.startRustMicShare();
                        context.rustMic.showRustMicUi();
                    } else {
                        await nextRoom.localParticipant.setMicrophoneEnabled(true, context.rustMic.getMicCaptureOptions());
                    }

                    context.rustMic.setMicOn(true);
                    context.rustMic.updateMicSourceButton();
                    console.log('[roomConnection/switchChannel] 麦克风已在新频道重新发布');
                } catch (e) {
                    logError('roomConnection/switchChannel 新频道恢复麦克风失败', e);
                    context.rustMic.setMicOn(false);
                    context.rustMic.setRustMicOn(false);
                    context.rustMic.updateMicSourceButton();
                    alertError('切换频道后恢复麦克风失败', e);
                }
            }
        } finally {
            shouldRestoreMicAfterChannelSwitch = false;
            isSwitchingChannel = false;
            context.rustMic.updateMicSourceButton();
        }
    }

    /** 连接指定 LiveKit 房间，并启用按钮、设备列表、事件绑定和自动开麦。 */
    async function connectToChannel(targetRoomName, options = {}) {
        const autoMic = options.autoMic !== false;
        const username = document.getElementById('username').value.trim();
        if (!username) return;
        const serverConfig = getServerConfig();

        try {
            const presenceIdentity = context.presence?.getIdentity?.();
            const tokenUrl = `${serverConfig.apiBase}/api/get_token?user=${encodeURIComponent(username)}&room=${encodeURIComponent(targetRoomName)}${
                presenceIdentity ? `&identity=${encodeURIComponent(presenceIdentity)}` : ''
            }`;

            const response = await fetch(tokenUrl);
            const data = await response.json();
            const token = data.token;

            const room = new context.LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true,
                audioCaptureDefaults: context.rustMic.getMicCaptureOptions(),
                publishDefaults: {
                    videoCodec: 'h264',
                    dtx: true,
                    audioPreset: (context.LivekitClient.AudioPresets && (context.LivekitClient.AudioPresets.musicHighQuality || context.LivekitClient.AudioPresets.music)) || undefined,
                },
            });

            context.setRoom(room);
            context.livekitEvents.registerRoomEvents(room);

            await room.connect(serverConfig.livekitWs, token);
            document.getElementById('header').innerText = `# 🔊 ${targetRoomName} 语音分组`;
            document.getElementById('ui-username').innerText = username;
            document.getElementById('ui-status').innerText = '已连接: ' + targetRoomName;
            document.getElementById('ui-status').style.color = '#23a559';

            document.getElementById('username').disabled = true;
            document.getElementById('btn-mic').disabled = false;
            document.getElementById('mic-select').disabled = false;
            document.getElementById('audio-output-select').disabled = false;
            document.getElementById('btn-screen').disabled = false;
            context.rustMic.updateMicSourceButton();
            document.getElementById('screen-res').disabled = false;
            document.getElementById('screen-fps').disabled = false;
            document.getElementById('screen-bitrate').disabled = false;
            document.getElementById('btn-app-audio').disabled = false;
            document.getElementById('btn-leave').style.display = 'flex';

            await context.updateMicList();

            try {
                if (autoMic && !context.rustMic.getIsMicOn()) {
                    await context.updateMicList().catch((error) => logError('roomConnection/connectToChannel 自动开麦前刷新设备列表失败', error, 'warn'));
                    await context.rustMic.toggleMic();
                }
            } catch (e) {
                logError('roomConnection/connectToChannel 自动开麦失败', e, 'warn');
            }

            document.getElementById('chat-input').disabled = false;
            document.getElementById('btn-send').disabled = false;

            context.participants.updateParticipantList();
            await context.updateAudioOutputList();
            await context.switchAudioOutput(document.getElementById('audio-output-select').value || context.getSelectedAudioOutputId());
            context.appAudio.updateAppAudioButtons();
        } catch (error) {
            logError('roomConnection/connectToChannel 频道连接失败', error);
            alertError('连接频道失败', error, '请检查 LiveKit 服务、Token 服务或网络连接。');
            currentChannel = null;
            context.setRoom(null);
            document.getElementById('header').innerText = '# 🏛️ DoNiChannel 电竞大厅（连接失败，请重试）';
        }
    }

    /** 主动离开房间；释放麦克风、应用音频、屏幕共享和远端音频资源。 */
    async function leaveRoom() {
        try {
            context.presence.leaveChannel?.();
            context.presence.disconnect?.();
        } catch (error) {
            logError('roomConnection/leaveRoom 断开 Presence 失败', error, 'warn');
        }

        if (context.isTauriClient && context.rustMic.getIsMicOn()) {
            await context.rustMic.stopRustMicShare();
        }

        context.appAudio.stopAppAudioShare();
        stopRoomPolling();
        context.screenShare.stopScreenBitrateMonitor();
        context.screenShare.hideLocalScreenPreview();

        const room = context.getRoom();
        if (room) room.disconnect();
        context.audioPipelines.teardownLocalPcmPipeline();

        setTimeout(() => {
            window.location.reload();
        }, 100);
    }

    return {
        normalizeServerInput,
        getServerConfig,
        renderChannelList,
        refreshRoomsFromServer,
        startRoomPolling,
        stopRoomPolling,
        createChannel,
        resetRoomUIAfterDisconnect,
        joinRoom,
        switchChannel,
        connectToChannel,
        leaveRoom,
        getCurrentChannel: () => currentChannel,
        getChannels: () => getAvailableChannelNames(),
        getIsInLobby: () => isInLobby,
    };
}
