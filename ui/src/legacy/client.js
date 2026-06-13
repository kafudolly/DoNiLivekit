import { invoke, listen, isTauriClient } from '../shared/tauri.js';
import {
    DEFAULT_SERVER_IP,
    AUTO_JOIN_FIRST_CHANNEL_AFTER_LOBBY,
    ACTIVE_SPEAKER_LEVEL_THRESHOLD,
    ACTIVE_SPEAKER_DEBOUNCE_MS,
} from '../shared/constants.js';
import { sanitizeText } from '../shared/text.js';
import {
    updateMicList as updateMicListFromModule,
    switchMic as switchMicFromModule,
    updateAudioOutputList as updateAudioOutputListFromModule,
    switchAudioOutput as switchAudioOutputFromModule,
} from '../features/devices.js';
import {
    normalizeGainValue,
    gainToPercent,
    loadUserVolumesFromStorage,
    saveUserVolumesToStorage as persistUserVolumesToStorage,
    ensureParticipantVolumeState as ensureParticipantVolumeStateFromStore,
} from '../features/participantVolumes.js';
import { createAppAudioFeature } from '../features/appAudio.js';
import { createScreenShareFeature } from '../features/screenShare.js';
import { createChatFeature } from '../features/chat.js';
import { createRemoteAudioFeature } from '../features/remoteAudio.js';

let room;
let currentChannel = null;
let isInLobby = false;
let channels = ['day0', 'day1', 'day2'];
const channelParticipants = {};
let roomPollTimer = null;
let clickTimer = null;
let isPolling = false;
let isMicOn = false;
let currentMicSource = isTauriClient ? 'rust' : 'browser';
let isScreenOn = false;
const userVolumes = loadUserVolumesFromStorage();
const localScreenControls = {};
let remoteAudioContext = null;
let localPcmAudioContext = null;
let localPcmWorkletNode = null;
let localPcmDestination = null;
let localPcmTrack = null;
let localPcmSocket = null;
let isLocalPcmPipelineReady = false;
let localAppAudioPublication = null;
let isAppAudioSharing = false;
let localRustMicAudioContext = null;
let localRustMicWorkletNode = null;
let localRustMicDestination = null;
let localRustMicTrack = null;
let localRustMicSocket = null;
let isRustMicPipelineReady = false;
let localRustMicPublication = null;
let isRustMicOn = false;
let isMicMonitorOn = false;
let rustMicMonitorGain = null; // 用于控制耳返音量的节点
let currentMonitorVolume = 1.0; // 记录当前的监听音量比例
let shouldRestoreMicAfterChannelSwitch = false;
let isSwitchingChannel = false;
let hasRegisteredRustMicErrorListener = false;
let lastRustMicErrorAt = 0;

const activeSpeakerIdentities = new Set();
const activeSpeakerDebounceTimers = {};
let selectedAudioOutputId = localStorage.getItem('lk_audio_output') || 'default';

// ------------------------------
// Feature modules
// ------------------------------
// 这些模块仍通过 context 访问 client.js 中的 LiveKit/Audio 状态。
// 这样可以明显缩短 client.js，同时避免一次性迁移过多状态造成音频链路不稳定。
const appAudioFeature = createAppAudioFeature({
    invoke,
    sanitizeText,
    getRoom: () => room,
    getIsAppAudioSharing: () => isAppAudioSharing,
    setIsAppAudioSharing: (value) => { isAppAudioSharing = value; },
    getLocalAppAudioPublication: () => localAppAudioPublication,
    setLocalAppAudioPublication: (value) => { localAppAudioPublication = value; },
    initLocalPcmPipeline,
    teardownLocalPcmPipeline,
});

const screenShareFeature = createScreenShareFeature({
    LivekitClient,
    getRoom: () => room,
    getIsScreenOn: () => isScreenOn,
    setIsScreenOn: (value) => { isScreenOn = value; },
});

const chatFeature = createChatFeature({
    getRoom: () => room,
    sanitizeText,
});

const remoteAudioFeature = createRemoteAudioFeature({
    ensureAudioContext,
    getRemoteAudioContext: () => remoteAudioContext,
    ensureParticipantVolumeState,
    normalizeGainValue,
    saveUserVolumesToStorage,
});

// 保留同名包装函数，兼容 App.vue 和动态 innerHTML 里的 onclick。
function updateAppAudioButtons() { return appAudioFeature.updateAppAudioButtons(); }
function closeAppAudioModal(event) { return appAudioFeature.closeAppAudioModal(event); }
function handleAppAudioClick() { return appAudioFeature.handleAppAudioClick(); }
function openAppAudioModal() { return appAudioFeature.openAppAudioModal(); }
function toggleAppAudioProcessSelection(pid) { return appAudioFeature.toggleAppAudioProcessSelection(pid); }
function confirmAppAudioSelection() { return appAudioFeature.confirmAppAudioSelection(); }
function stopAppAudioShare() { return appAudioFeature.stopAppAudioShare(); }
function toggleScreen() { return screenShareFeature.toggleScreen(); }
function stopScreenBitrateMonitor() { return screenShareFeature.stopScreenBitrateMonitor(); }
function hideLocalScreenPreview() { return screenShareFeature.hideLocalScreenPreview(); }
function showLocalScreenPreview(track) { return screenShareFeature.showLocalScreenPreview(track); }
function getLocalScreenPublication() { return screenShareFeature.getLocalScreenPublication(); }
function hasPublishedScreenAudioTrack() { return screenShareFeature.hasPublishedScreenAudioTrack(); }
function sendChatMessage() { return chatFeature.sendChatMessage(); }
function renderChatMessage(sender, text, isSelf) { return chatFeature.renderChatMessage(sender, text, isSelf); }
function addRemoteGainNode(identity, source, track, audioEl) { return remoteAudioFeature.addRemoteGainNode(identity, source, track, audioEl); }
function clearRemoteGainNodes() { return remoteAudioFeature.clearRemoteGainNodes(); }
function removeRemoteAudioRouteByTrackSid(trackSid) { return remoteAudioFeature.removeRemoteAudioRouteByTrackSid(trackSid); }
function setParticipantVolume(identity, source, volumeValue) { return remoteAudioFeature.setParticipantVolume(identity, source, volumeValue); }

function saveUserVolumesToStorage() {
    persistUserVolumesToStorage(userVolumes);
}

function ensureParticipantVolumeState(identity) {
    return ensureParticipantVolumeStateFromStore(userVolumes, identity);
}

function clearActiveSpeakerDebounceTimers() {
    Object.keys(activeSpeakerDebounceTimers).forEach((identity) => {
        clearTimeout(activeSpeakerDebounceTimers[identity]);
        delete activeSpeakerDebounceTimers[identity];
    });
}

function markParticipantAsActiveSpeaker(identity) {
    if (!identity) return false;
    if (activeSpeakerDebounceTimers[identity]) {
        clearTimeout(activeSpeakerDebounceTimers[identity]);
        delete activeSpeakerDebounceTimers[identity];
    }
    if (activeSpeakerIdentities.has(identity)) return false;
    activeSpeakerIdentities.add(identity);
    return true;
}

function scheduleParticipantActiveSpeakerOff(identity) {
    if (!identity || !activeSpeakerIdentities.has(identity)) return;
    if (activeSpeakerDebounceTimers[identity]) return;

    activeSpeakerDebounceTimers[identity] = setTimeout(() => {
        delete activeSpeakerDebounceTimers[identity];
        const changed = activeSpeakerIdentities.delete(identity);
        if (changed) updateParticipantList();
    }, ACTIVE_SPEAKER_DEBOUNCE_MS);
}

function isScreenShareSource(source) {
    return source === LivekitClient.Track.Source.ScreenShare || source === 'screen_share';
}

function isAppAudioPublication(track, publication) {
    const trackName = publication?.trackName || publication?.name || track?.name || '';
    return trackName === 'app-audio';
}

function removeLocalScreenRestoreCard(identity) {
    const card = document.getElementById(`screen-restore-${identity}`);
    if (card) card.remove();
}

function upsertLocalScreenRestoreCard(identity, displayName) {
    let card = document.getElementById(`screen-restore-${identity}`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'screen-restore-card';
        card.id = `screen-restore-${identity}`;
        document.getElementById('video-container').appendChild(card);
    }

    card.innerHTML = `
        <div>${displayName} 的屏幕已在本地屏蔽</div>
        <button onclick="toggleLocalScreenSubscription('${identity}')">恢复屏幕</button>
    `;
}

async function toggleLocalScreenSubscription(identity) {
    const state = localScreenControls[identity];
    if (!state || !state.publication) return;

    try {
        if (!state.isBlocked) {
            await state.publication.setSubscribed(false);
            state.isBlocked = true;
            upsertLocalScreenRestoreCard(identity, state.displayName || identity);
        } else {
            await state.publication.setSubscribed(true);
            state.isBlocked = false;
            removeLocalScreenRestoreCard(identity);
        }
    } catch (e) {
        console.error('切换本地屏幕订阅状态失败:', e);
        alert('操作失败，请稍后重试。');
    }
}

// DOM加载完毕后恢复本地设置


// 🌟 智能路由：根据当前状态，决定是打开面板，还是停止共享
function normalizeServerInput(rawValue) {
    let val = (rawValue || '').trim();
    if (!val) return DEFAULT_SERVER_IP;
    val = val.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
    val = val.replace(/\/$/, '');
    return val;
}

function getServerConfig() {
    const inputEl = document.getElementById('server-ip');
    const normalized = normalizeServerInput(inputEl ? inputEl.value : '');

    // token服务默认走输入端口；LiveKit默认在同IP下7880
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

function ensureAudioContext() {
    if (!remoteAudioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) remoteAudioContext = new Ctx();
    }
    if (remoteAudioContext && remoteAudioContext.state === 'suspended') {
        remoteAudioContext.resume().catch(() => {});
    }
    return !!remoteAudioContext;
}

function getLocalPcmTrack() {
    return localPcmTrack;
}

function updateMicSourceButton() {
    const btn = document.getElementById('btn-mic');
    if (!btn) return;

    if (isMicOn) {
        btn.classList.add('active');
        btn.innerHTML = '🔇';
        btn.setAttribute('data-tooltip', currentMicSource === 'rust' ? '关闭 Rust 麦克风' : '关闭浏览器麦克风');
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🎤';
        btn.setAttribute('data-tooltip', currentMicSource === 'rust' ? '开启 Rust 麦克风' : '开启浏览器麦克风');
    }
}

function switchMicSource(source) {
    if (source !== 'browser' && source !== 'rust') return;
    if (currentMicSource === source) return;
    currentMicSource = source;

    const micSelect = document.getElementById('mic-select');
    if (micSelect) {
        // Tauri/Rust 模式现在也支持选择具体麦克风设备，所以不要因为 source === 'rust' 禁用下拉框。
        micSelect.disabled = !(room && room.localParticipant);
    }

    updateMicSourceButton();

    if (!room || !room.localParticipant) return;
    if (!isMicOn) return;

    if (source === 'browser') {
        stopRustMicShare().then(() => {
            room.localParticipant.setMicrophoneEnabled(true, getMicCaptureOptions()).catch((e) => {
                console.error('切换到浏览器麦克风失败:', e);
            });
        }).catch(console.error);
    } else {
        room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        startRustMicShare().catch((e) => {
            console.error('切换到 Rust 麦克风失败:', e);
        });
    }
}

async function initRustMicPipeline(sampleRate, wsUrl = 'ws://127.0.0.1:9002') {
    const targetSampleRate = Number(sampleRate);
    const resolvedSampleRate = Number.isFinite(targetSampleRate) && targetSampleRate >= 8000
        ? Math.round(targetSampleRate)
        : 48000;

    if (isRustMicPipelineReady && localRustMicAudioContext) {
        const currentRate = Number(localRustMicAudioContext.sampleRate || 0);
        if (Math.round(currentRate) === resolvedSampleRate) {
            return localRustMicTrack;
        }
        teardownRustMicPipeline();
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
        console.warn('当前环境不支持 AudioContext，无法初始化 Rust 麦克风管线');
        return null;
    }

    try {
        localRustMicAudioContext = new Ctx({ sampleRate: resolvedSampleRate });
        await localRustMicAudioContext.audioWorklet.addModule('./pcm-worker.js');

        localRustMicWorkletNode = new AudioWorkletNode(localRustMicAudioContext, 'pcm-ring-buffer-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                capacityFrames: resolvedSampleRate * 0.2 // 200ms 缓冲，降低延迟
            }
        });

        localRustMicDestination = localRustMicAudioContext.createMediaStreamDestination();
        
        // 1. 发送给 LiveKit 的主路
        localRustMicWorkletNode.connect(localRustMicDestination);

        // 🌟 2. 新增：开辟一条“耳返（监听）”旁路，连接到本地扬声器
        rustMicMonitorGain = localRustMicAudioContext.createGain();
        rustMicMonitorGain.gain.value = isMicMonitorOn ? 1.0 : 0.0;
        localRustMicWorkletNode.connect(rustMicMonitorGain);
        rustMicMonitorGain.connect(localRustMicAudioContext.destination);

        const tracks = localRustMicDestination.stream.getAudioTracks();
        localRustMicTrack = tracks.length > 0 ? tracks[0] : null;

        localRustMicSocket = new WebSocket(wsUrl);
        localRustMicSocket.binaryType = 'arraybuffer';

        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(new Error(`连接 ${wsUrl} 超时，9002 可能未启动或连接失败`));
                }, 2000);

                const fail = (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                };

                localRustMicSocket.onopen = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    console.log('[Rust PCM WS] 已连接', wsUrl);
                    resolve();
                };

                localRustMicSocket.onerror = () => {
                    fail(new Error(`无法连接 ${wsUrl}，9002 可能未启动或连接失败`));
                };

                localRustMicSocket.onclose = () => {
                    fail(new Error(`连接 ${wsUrl} 被关闭，9002 可能未启动或连接失败`));
                };
            });
        } catch (error) {
            console.error('[Rust PCM WS] 连接失败:', error);
            teardownRustMicPipeline();
            throw error;
        }

        localRustMicSocket.onmessage = async (event) => {
            if (!localRustMicWorkletNode) return;
            if (event.data instanceof ArrayBuffer) {
                localRustMicWorkletNode.port.postMessage(event.data, [event.data]);
                return;
            }
            if (event.data instanceof Blob) {
                const arr = await event.data.arrayBuffer();
                localRustMicWorkletNode.port.postMessage(arr, [arr]);
            }
        };

        localRustMicSocket.onerror = (err) => {
            console.error('[Rust PCM WS] 运行中连接错误:', err);
        };

        localRustMicSocket.onclose = () => {
            console.warn('[Rust PCM WS] 连接已关闭');
        };

        if (localRustMicAudioContext && localRustMicAudioContext.state === 'suspended') {
            await localRustMicAudioContext.resume();
        }

        if (!localRustMicTrack) {
            teardownRustMicPipeline();
            throw new Error('Rust 麦克风管线初始化失败：没有拿到有效的 MediaStreamTrack');
        }

        window.getRustMicTrack = () => localRustMicTrack;
        isRustMicPipelineReady = true;
        console.log(`[Rust PCM] 管线已初始化(sampleRate=${resolvedSampleRate})，可通过 window.getRustMicTrack() 获取 MediaStreamTrack`);

        return localRustMicTrack;
    } catch (error) {
        console.error('[Rust PCM] 管线初始化失败:', error);
        teardownRustMicPipeline();
        throw error;
    }
}

function teardownRustMicPipeline() {
    if (localRustMicSocket) {
        try {
            localRustMicSocket.onopen = null;
            localRustMicSocket.onmessage = null;
            localRustMicSocket.onerror = null;
            localRustMicSocket.onclose = null;

            if (
                localRustMicSocket.readyState === WebSocket.OPEN ||
                localRustMicSocket.readyState === WebSocket.CONNECTING
            ) {
                localRustMicSocket.close();
            }
        } catch (_) {}
        localRustMicSocket = null;
    }

    if (localRustMicTrack) {
        try { localRustMicTrack.stop(); } catch (_) {}
        localRustMicTrack = null;
    }

    if (rustMicMonitorGain) {
        try { rustMicMonitorGain.disconnect(); } catch (_) {}
        rustMicMonitorGain = null;
    }

    if (localRustMicWorkletNode) {
        try { localRustMicWorkletNode.disconnect(); } catch (_) {}
        localRustMicWorkletNode = null;
    }

    localRustMicDestination = null;

    if (localRustMicAudioContext) {
        localRustMicAudioContext.close().catch(() => {});
        localRustMicAudioContext = null;
    }

    isRustMicPipelineReady = false;
}

async function initLocalPcmPipeline(sampleRate, wsUrl = 'ws://127.0.0.1:9001') {
    const targetSampleRate = Number(sampleRate);
    const resolvedSampleRate = Number.isFinite(targetSampleRate) && targetSampleRate >= 8000
        ? Math.round(targetSampleRate)
        : 48000;

    if (isLocalPcmPipelineReady && localPcmAudioContext) {
        const currentRate = Number(localPcmAudioContext.sampleRate || 0);
        if (Math.round(currentRate) === resolvedSampleRate) {
            return localPcmTrack;
        }
        teardownLocalPcmPipeline();
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
        console.warn('当前环境不支持 AudioContext，无法初始化 PCM 管线');
        return null;
    }

    try {
        localPcmAudioContext = new Ctx({ sampleRate: resolvedSampleRate });
        await localPcmAudioContext.audioWorklet.addModule('./pcm-worker.js');

        localPcmWorkletNode = new AudioWorkletNode(localPcmAudioContext, 'pcm-ring-buffer-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
                capacityFrames: resolvedSampleRate * 0.4 // 400ms 缓冲，降低丢包风险
            }
        });

        localPcmDestination = localPcmAudioContext.createMediaStreamDestination();
        localPcmWorkletNode.connect(localPcmDestination);
        //localPcmWorkletNode.connect(localPcmAudioContext.destination);  这行代码是监听

        const tracks = localPcmDestination.stream.getAudioTracks();
        localPcmTrack = tracks.length > 0 ? tracks[0] : null;

        localPcmSocket = new WebSocket(wsUrl);
        localPcmSocket.binaryType = 'arraybuffer';

        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    reject(new Error(`连接 ${wsUrl} 超时，9001 可能未启动或连接失败`));
                }, 2000);

                const fail = (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                };

                localPcmSocket.onopen = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    console.log('[PCM WS] 已连接', wsUrl);
                    resolve();
                };

                localPcmSocket.onerror = () => {
                    fail(new Error(`无法连接 ${wsUrl}，9001 可能未启动或连接失败`));
                };

                localPcmSocket.onclose = () => {
                    fail(new Error(`连接 ${wsUrl} 被关闭，9001 可能未启动或连接失败`));
                };
            });
        } catch (error) {
            console.error('[PCM WS] 连接失败:', error);
            teardownLocalPcmPipeline();
            throw error;
        }

        localPcmSocket.onmessage = async (event) => {
            if (!localPcmWorkletNode) return;
            if (event.data instanceof ArrayBuffer) {
                localPcmWorkletNode.port.postMessage(event.data, [event.data]);
                return;
            }
            if (event.data instanceof Blob) {
                const arr = await event.data.arrayBuffer();
                localPcmWorkletNode.port.postMessage(arr, [arr]);
            }
        };

        localPcmSocket.onerror = (err) => {
            console.error('[PCM WS] 运行中连接错误:', err);
        };

        localPcmSocket.onclose = () => {
            console.warn('[PCM WS] 连接已关闭');
        };

        if (localPcmAudioContext && localPcmAudioContext.state === 'suspended') {
            await localPcmAudioContext.resume();
        }

        if (!localPcmTrack) {
            teardownLocalPcmPipeline();
            throw new Error('PCM 管线初始化失败：没有拿到有效的 MediaStreamTrack');
        }

        window.getLocalPcmTrack = getLocalPcmTrack;
        isLocalPcmPipelineReady = true;
        console.log(`[PCM] 管线已初始化(sampleRate=${resolvedSampleRate})，可通过 window.getLocalPcmTrack() 获取 MediaStreamTrack`);

        return localPcmTrack;
    } catch (error) {
        console.error('[PCM] 管线初始化失败:', error);
        teardownLocalPcmPipeline();
        throw error;
    }
}

function teardownLocalPcmPipeline() {
    if (localPcmSocket) {
        try {
            localPcmSocket.onopen = null;
            localPcmSocket.onmessage = null;
            localPcmSocket.onerror = null;
            localPcmSocket.onclose = null;

            if (
                localPcmSocket.readyState === WebSocket.OPEN ||
                localPcmSocket.readyState === WebSocket.CONNECTING
            ) {
                localPcmSocket.close();
            }
        } catch (_) {}
        localPcmSocket = null;
    }

    if (localPcmTrack) {
        try { localPcmTrack.stop(); } catch (_) {}
        localPcmTrack = null;
    }

    if (localPcmWorkletNode) {
        try { localPcmWorkletNode.disconnect(); } catch (_) {}
        localPcmWorkletNode = null;
    }

    localPcmDestination = null;

    if (localPcmAudioContext) {
        localPcmAudioContext.close().catch(() => {});
        localPcmAudioContext = null;
    }

    isLocalPcmPipelineReady = false;
}

async function startRustMicShare() {
    if (!room || !room.localParticipant) {
        throw new Error('未连接 LiveKit 房间');
    }

    let track = null;

    try {
        const sampleRate = await invoke('query_mic_sample_rate');
        await invoke('toggle_rust_mic', { enable: true });

        track = await initRustMicPipeline(sampleRate, 'ws://127.0.0.1:9002');
        if (!track) {
            throw new Error('未拿到 Rust 麦克风 MediaStreamTrack');
        }

        if (track.readyState !== 'live') {
            throw new Error(`Rust 麦克风 track 状态异常: ${track.readyState}`);
        }

        track.enabled = true;
        console.log('[Rust Mic] 准备发布到当前频道', {
            channel: currentChannel,
            trackId: track.id,
            readyState: track.readyState,
            enabled: track.enabled,
            muted: track.muted
        });

        if (localRustMicPublication) {
            try {
                await room.localParticipant.unpublishTrack(localRustMicPublication.track);
            } catch (e) {
                console.warn('取消旧 Rust 麦克风发布失败:', e);
            }
            localRustMicPublication = null;
        }

        localRustMicPublication = await room.localParticipant.publishTrack(track, {
            name: 'microphone',
            source: LivekitClient.Track.Source.Microphone
        });

        console.log('[Rust Mic] 已发布到当前频道', {
            channel: currentChannel,
            publicationSid: localRustMicPublication?.sid,
            trackSid: localRustMicPublication?.trackSid,
            source: localRustMicPublication?.source,
            isMuted: localRustMicPublication?.isMuted
        });

        isRustMicOn = true;
        return localRustMicPublication;
    } catch (error) {
        console.error('启动 Rust 麦克风失败:', error);

        await invoke('toggle_rust_mic', { enable: false }).catch(() => {});
        teardownRustMicPipeline();

        localRustMicPublication = null;
        isRustMicOn = false;

        throw error;
    }
}

async function stopRustMicShare() {
    await invoke('toggle_rust_mic', { enable: false }).catch(() => {});

    try {
        if (localRustMicPublication && room && room.localParticipant) {
            await room.localParticipant.unpublishTrack(localRustMicPublication.track);
        }
    } catch (e) {
        console.warn('取消发布 Rust 麦克风失败:', e);
    } finally {
        localRustMicPublication = null;
        teardownRustMicPipeline();
        isRustMicOn = false;
        isMicOn = false;
    }
}

async function toggleRustMicShare() {
    const btn = document.getElementById('btn-rust-mic');
    if (!isRustMicOn) {
        try {
            await startRustMicShare();
            btn.classList.add('active');
            btn.innerHTML = '🔇 <span>关闭麦克风</span>';
        } catch (error) {
            console.error('启动麦克风失败:', error);
            alert(`启动麦克风失败：${error?.message || error}`);
            isRustMicOn = false;
        }
    } else {
        await stopRustMicShare();
        btn.classList.remove('active');
        btn.innerHTML = '🎙️ <span>开启麦克风</span>';
    }
}

function renderChannelList() {
    const list = document.getElementById('channel-list');
    if (!list) return;
    list.innerHTML = channels.map(name => {
        const active = currentChannel === name ? 'active' : '';
        const escapedName = name.replace(/'/g, "\\'");
        const participants = Array.isArray(channelParticipants[name]) ? channelParticipants[name] : [];
        const participantsHTML = participants.length > 0
            ? participants.map(p => sanitizeText(p)).join('、')
            : '暂无在线成员';
        const participantsClass = participants.length > 0 ? 'channel-participants' : 'channel-participants empty';
        return `
            <div class="channel-row">
                <button class="channel-item ${active}" onclick="switchChannel('${escapedName}')"># ${sanitizeText(name)}</button>
                <div class="${participantsClass}">${participantsHTML}</div>
            </div>
        `;
    }).join('');
}

async function refreshRoomsFromServer() {
    const serverConfig = getServerConfig();
    const response = await fetch(`${serverConfig.apiBase}/api/rooms`);
    if (!response.ok) throw new Error(`获取房间失败: ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) return;

    const nextChannels = [];
    const nextParticipants = {};
    rows.forEach((row) => {
        const roomName = (row && row.name ? String(row.name) : '').trim();
        if (!roomName) return;
        nextChannels.push(roomName);
        nextParticipants[roomName] = Array.isArray(row.participants) ? row.participants : [];
    });

    if (nextChannels.length > 0) channels = nextChannels;

    Object.keys(channelParticipants).forEach((key) => delete channelParticipants[key]);
    Object.keys(nextParticipants).forEach((key) => {
        channelParticipants[key] = nextParticipants[key];
    });

    renderChannelList();
}

// 新增：独立的异步轮询工作函数
async function pollRooms() {
    if (!isInLobby || !isPolling) return;

    try {
        // 核心：必须使用 await！等待当前请求彻底拿到结果
        await refreshRoomsFromServer();
    } catch (err) {
        console.warn('轮询房间列表失败，等待下一轮:', err);
    } finally {
        // 核心精髓：确认开关还开着，才安排下一次 3 秒后的任务
        if (isPolling) {
            roomPollTimer = setTimeout(pollRooms, 3000);
        }
    }
}

function startRoomPolling() {
    if (isPolling) return; // 防止重复启动
    isPolling = true;
    pollRooms();
}

function stopRoomPolling() {
    isPolling = false; // 切断开关
    if (roomPollTimer) {
        clearTimeout(roomPollTimer); // ⚠️ 注意：这里配套变成了 clearTimeout
        roomPollTimer = null;
    }
}

async function createChannel() {
    const value = prompt('输入新频道名（英文字母/数字/短横线）:');
    if (!value) return;
    const name = value.trim();
    if (!name) return;

    const serverConfig = getServerConfig();
    const action = {
        "action": "create_channel",
        "name": name
    };
    try {
        const response = await fetch(`${serverConfig.apiBase}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || '创建房间失败');
        }
        await refreshRoomsFromServer();
        await switchChannel(name);
    } catch (e) {
        console.error('创建房间失败:', e);
        alert(e.message || '创建房间失败，请稍后重试。');
    }
}

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
    isMicOn = false;
    isScreenOn = false;
    isAppAudioSharing = false;
    localAppAudioPublication = null;
    clearActiveSpeakerDebounceTimers();
    activeSpeakerIdentities.clear();
    clearRemoteGainNodes();
    hideLocalScreenPreview();

// 🌟 新增：重置左下角控制坞状态
    const uiName = document.getElementById('ui-username');
    if (uiName) uiName.innerText = '未连接大厅';
    const uiStatus = document.getElementById('ui-status');
    if (uiStatus) {
        uiStatus.innerText = '等待加入房间';
        uiStatus.style.color = '#b5bac1';
    }

    closeAppAudioModal();
}

function getMicCaptureOptions() {
    return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    };
}

function updateParticipantList() {
    const listEl = document.getElementById('participant-list');
    const htmlParts = []; // 修复 1：用数组收集 HTML，避免循环内 +=
    let count = 0;
    
    const renderUser = (p, isSelf) => {
        count++;
        const name = p.name || p.identity;
        const initial = name ? name.charAt(0).toUpperCase() : '?';
        const displayName = isSelf ? `${name} (我)` : name;
        const isSpeaking = activeSpeakerIdentities.has(p.identity);
        
        const volumes = ensureParticipantVolumeState(p.identity);
        
        let volumeControlsHTML = '';
        if (!isSelf) {
            // (保持你原有的音量控制代码不变，这里省略中间拼接过程以节省篇幅)
            const micVol = volumes.mic;
            volumeControlsHTML += `<div style="display: flex; align-items: center; gap: 5px; font-size: 12px;"><span title="麦克风音量">🎤</span><input type="range" class="volume-slider" min="0" max="300" step="1" value="${gainToPercent(micVol)}" oninput="setParticipantVolume('${p.identity}', 'mic', this.value);this.nextElementSibling.innerText=this.value+'%'"><span style="width:38px; text-align:right; color:#b5bac1;">${gainToPercent(micVol)}%</span></div>`;
            
            const hasScreenAudio = Array.from(p.audioTrackPublications.values()).some(pub => pub.source === LivekitClient.Track.Source.ScreenShareAudio || pub.source === 'screen_share_audio');
            if (hasScreenAudio) {
                const screenVol = volumes.screen;
                volumeControlsHTML += `<div style="display: flex; align-items: center; gap: 5px; font-size: 12px;"><span title="共享音量">💻</span><input type="range" class="volume-slider" min="0" max="300" step="1" value="${gainToPercent(screenVol)}" oninput="setParticipantVolume('${p.identity}', 'screen', this.value);this.nextElementSibling.innerText=this.value+'%'"><span style="width:38px; text-align:right; color:#b5bac1;">${gainToPercent(screenVol)}%</span></div>`;
            }

            const hasAppAudio = Array.from(p.audioTrackPublications.values()).some(pub => {
                const pubName = pub?.trackName || pub?.name || '';
                return pubName === 'app-audio';
            });
            if (hasAppAudio) {
                const appAudioVol = volumes.appaudio;
                volumeControlsHTML += `<div style="display: flex; align-items: center; gap: 5px; font-size: 12px;"><span title="应用共享音量">🖥️</span><input type="range" class="volume-slider" min="0" max="300" step="1" value="${gainToPercent(appAudioVol)}" oninput="setParticipantVolume('${p.identity}', 'appaudio', this.value);this.nextElementSibling.innerText=this.value+'%'"><span style="width:38px; text-align:right; color:#b5bac1;">${gainToPercent(appAudioVol)}%</span></div>`;
            }
        }

        const isMicMuted = !p.isMicrophoneEnabled;
        const statusIcon = isMicMuted ? '<span style="color: #f23f42; font-size: 16px;" title="已闭麦">🔇</span>' : '<span style="color: #23a559; font-size: 16px;" title="已开麦">🎙️</span>';
        const userBottomHTML = volumeControlsHTML ? `<div class="user-bottom">${volumeControlsHTML}</div>` : '';

        // 修复 2：给最外层的 div 加上 id="user-item-${p.identity}"
        return `
            <div id="user-item-${p.identity}" class="user-item${isSpeaking ? ' active-speaker' : ''}">
                <div class="user-avatar">${initial}</div>
                <div class="user-info">
                    <div class="user-top">
                        <div class="user-name" title="${displayName}">${displayName} ${statusIcon}</div>
                        <div class="user-status"></div>
                    </div>
                    ${userBottomHTML}
                </div>
            </div>
        `;
    };
    
    if (room.localParticipant) htmlParts.push(renderUser(room.localParticipant, true));
    if (room.remoteParticipants) room.remoteParticipants.forEach(p => htmlParts.push(renderUser(p, false)));
    
    // 修复 3：在循环外一次性注入 DOM
    listEl.innerHTML = htmlParts.join('');
    document.getElementById('user-count').innerText = count;
}

// 新增：精准局部更新说话状态的函数
function updateActiveSpeakerUI() {
    // 找到当前列表中所有的成员 div
    document.querySelectorAll('.user-item').forEach(el => {
        // 从 id 中提取 identity，比如 "user-item-user123" -> "user123"
        const identity = el.id.replace('user-item-', '');
        // 精确判断他当前是否在说话
        if (activeSpeakerIdentities.has(identity)) {
            el.classList.add('active-speaker');
        } else {
            el.classList.remove('active-speaker');
        }
    });
}

async function updateMicList() {
    return updateMicListFromModule({
        isTauriClient,
        invoke,
        LivekitClient,
    });
}

async function switchMic(deviceId) {
    return switchMicFromModule(deviceId, {
        isTauriClient,
        invoke,
        LivekitClient,
        getRoom: () => room,
        isMicActive: () => isMicOn,
        isRustMicActive: () => isRustMicOn,
        hasLocalRustMicPublication: () => !!localRustMicPublication,
        stopRustMicShare,
        startRustMicShare,
        afterRustMicRestart: () => {
            isMicOn = true;
            isRustMicOn = true;

            const vadModule = document.getElementById('vad-module');
            const monitorBtn = document.getElementById('btn-mic-monitor');
            if (vadModule) vadModule.style.display = 'block';
            if (monitorBtn) monitorBtn.style.display = 'flex';

            updateMicSourceButton();
        },
    });
}

async function updateAudioOutputList() {
    return updateAudioOutputListFromModule({
        selectedAudioOutputId,
    });
}

async function switchAudioOutput(deviceId) {
    selectedAudioOutputId = await switchAudioOutputFromModule(deviceId, {
        getRemoteAudioContext: () => remoteAudioContext,
        getLocalRustMicAudioContext: () => localRustMicAudioContext,
    });
}

async function joinRoom(options = {}) {
    const autoJoinFirstChannel = options.autoJoinFirstChannel !== false;
    const username = document.getElementById('username').value.trim();
    if (!username) return alert('起个响亮的名字吧！');

    // join button is a user gesture, use it to unlock audio context when needed.
    ensureAudioContext();
    if (localPcmAudioContext && localPcmAudioContext.state === 'suspended') {
        localPcmAudioContext.resume().catch(() => {});
    }

    localStorage.setItem('lk_username', username);
    const serverConfig = getServerConfig();
    localStorage.setItem('lk_server_ip', serverConfig.persistValue);

    isInLobby = true;
    document.getElementById('btn-connect').innerText = '🏛️ 已进入大厅';
    document.getElementById('btn-connect').style.backgroundColor = '#1a6334';
    document.getElementById('header').innerText = '# 🏛️ DoNiChannel 电竞大厅（选择左侧语音分组）';

    await refreshRoomsFromServer().catch((err) => {
        console.warn('进入大厅时拉取房间列表失败:', err);
        renderChannelList();
    });
    startRoomPolling();

    // 大厅本身不是 LiveKit 房间，不能单独发布麦克风。
    // 因此这里自动进入第一个语音频道；connectToChannel() 会自动开麦。
    if (AUTO_JOIN_FIRST_CHANNEL_AFTER_LOBBY && autoJoinFirstChannel && !room && Array.isArray(channels) && channels.length > 0) {
        await switchChannel(channels[0]);
    }
}

async function switchChannel(roomName) {
    if (!isInLobby) {
        await joinRoom({ autoJoinFirstChannel: false });
        if (!isInLobby) return;
    }

    if (isSwitchingChannel) return;

    if (currentChannel === roomName && room) return;
    isSwitchingChannel = true;

    const isInitialChannelJoin = !room;
    const shouldRestoreMic = isInitialChannelJoin
        ? true
        : (isMicOn || isRustMicOn || !!localRustMicPublication);
    shouldRestoreMicAfterChannelSwitch = shouldRestoreMic;

    try {
        if (room) {
            try {
                if (isTauriClient && (isMicOn || isRustMicOn || localRustMicPublication)) {
                    await stopRustMicShare();
                } else if (!isTauriClient && isMicOn && room.localParticipant) {
                    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
                    isMicOn = false;
                }

                if (isAppAudioSharing) {
                    await stopAppAudioShare();
                }

                if (isScreenOn && room.localParticipant) {
                    await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
                    isScreenOn = false;
                }
            } catch (e) {
                console.warn('切换频道前停止本地资源失败:', e);
            }

            try {
                await room.disconnect();
            } catch (e) {
                console.warn('断开旧频道失败:', e);
            }

            room = null;
            resetRoomUIAfterDisconnect();
        }

        currentChannel = roomName;
        renderChannelList();

        await connectToChannel(roomName, { autoMic: false });

        if (shouldRestoreMicAfterChannelSwitch && room && room.localParticipant) {
            try {
                if (isTauriClient) {
                    await updateMicList().catch((e) => console.warn('恢复麦克风前刷新设备列表失败:', e));
                    await startRustMicShare();

                    const vadModule = document.getElementById('vad-module');
                    const monitorBtn = document.getElementById('btn-mic-monitor');
                    if (vadModule) vadModule.style.display = 'block';
                    if (monitorBtn) monitorBtn.style.display = 'flex';
                } else {
                    await room.localParticipant.setMicrophoneEnabled(true, getMicCaptureOptions());
                }

                isMicOn = true;
                updateMicSourceButton();
                console.log('[Channel Switch] 麦克风已在新频道重新发布');
            } catch (e) {
                console.error('[Channel Switch] 新频道恢复麦克风失败:', e);
                isMicOn = false;
                isRustMicOn = false;
                updateMicSourceButton();
                alert(`切换频道后恢复麦克风失败：${e.message || e}`);
            }
        }
    } finally {
        shouldRestoreMicAfterChannelSwitch = false;
        isSwitchingChannel = false;
        updateMicSourceButton();
    }
}

async function connectToChannel(targetRoomName, options = {}) {
    const autoMic = options.autoMic !== false;
    const username = document.getElementById('username').value.trim();
    if (!username) return;
    const serverConfig = getServerConfig();

    try {
        const response = await fetch(`${serverConfig.apiBase}/api/get_token?user=${encodeURIComponent(username)}&room=${encodeURIComponent(targetRoomName)}`);
        const data = await response.json();
        const token = data.token;

        room = new LivekitClient.Room({
            // 🌟 补丁 1：开启自适应流（极其重要！）
            // 效果：如果远端用户的窗口被缩得很小，服务器会自动只发给他模糊的低分辨率视频，极大节省你的服务器上行带宽。
            adaptiveStream: true, 
            
            // 🌟 补丁 2：开启动态多播
            // 效果：如果房间里暂时没有人把你的屏幕画面切出来看，服务器会直接通知你的客户端“暂停上传画面”，直到有人看为止。
            dynacast: true,       
            
            audioCaptureDefaults: getMicCaptureOptions(),
            publishDefaults: {
                videoCodec: 'h264',
                
                // 🌟 补丁 3：开启音频 DTX (非连续传输)
                // 效果：当你麦克风没声音（没说话）时，系统彻底停止发送音频 UDP 包，减轻校园网 Wi-Fi 的空口负担，防卡顿！
                dtx: true,        
                
                // 原有的高音质配置保持不变
                audioPreset: (LivekitClient.AudioPresets && (LivekitClient.AudioPresets.musicHighQuality || LivekitClient.AudioPresets.music)) || undefined
            }
        });

        // 🌟 核心修改：接收到视频流时，包装盒子并打上名字标签
        room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === 'video') {
                const isRemoteScreen = isScreenShareSource(publication?.source) && participant?.identity !== room.localParticipant?.identity;
                const videoEl = track.attach();
                
                // 创建包装盒
                const wrapper = document.createElement('div');
                wrapper.className = 'video-wrapper';
                wrapper.id = 'video-wrapper-' + track.sid; // 使用 track.sid 精准绑定包装盒
                wrapper.dataset.videoIdentity = participant.identity; // 用于离线时清理整个盒子
                wrapper.title = "双击全屏放大观看";
                
                // 获取分享者的名字
                const displayName = participant.name || participant.identity || '未知成员';
                
                // 创建名字标签
                const nameLabel = document.createElement('div');
                nameLabel.className = 'video-name-label';
                nameLabel.innerText = `${displayName} 的屏幕`;

                // 本地屏蔽按钮：仅对远端屏幕共享显示，点击后取消订阅以节省本地带宽
                if (isRemoteScreen) {
                    localScreenControls[participant.identity] = {
                        publication,
                        displayName,
                        isBlocked: false
                    };

                    removeLocalScreenRestoreCard(participant.identity);

                    const toggleBtn = document.createElement('button');
                    toggleBtn.className = 'screen-local-toggle-btn';
                    toggleBtn.innerText = '屏蔽屏幕';
                    toggleBtn.onclick = async (event) => {
                        event.stopPropagation();
                        await toggleLocalScreenSubscription(participant.identity);
                    };
                    wrapper.appendChild(toggleBtn);
                }
                
                // 双击全屏事件现在绑定在包装盒上（这样全屏时名字标签也能显示！）
                // 🌟 完美版：单击切换“内部焦点视图 (Pin)” 🌟
                wrapper.onclick = (e) => {
                    // 1. 拦截冒泡：如果点的是内部的按钮，直接无视
                    if (e.target.tagName.toLowerCase() === 'button') return;

                    // 2. 清除之前的计时器（防抖核心）
                    if (clickTimer) clearTimeout(clickTimer);

                    // 3. 设定 250ms 的延迟。如果 250ms 内没有第二下点击，才算真正判定为“单击”
                    clickTimer = setTimeout(() => {
                        const container = document.getElementById('video-container');
                        const isAlreadyFocused = wrapper.classList.contains('focused');

                        // 暴力清除：把所有人的 focused 状态都扒掉
                        document.querySelectorAll('.video-wrapper.focused').forEach(el => {
                            el.classList.remove('focused');
                        });

                        // 状态反转
                        if (!isAlreadyFocused) {
                            wrapper.classList.add('focused');
                            container.classList.add('has-focus');
                        } else {
                            container.classList.remove('has-focus');
                        }
                    }, 250); // 250ms 是操作系统判断双击的标准宽容度
                };

                // 🌟 完美版：双击全屏 (OS级) 🌟
                wrapper.ondblclick = () => {
                    // 核心必杀技：一监听到双击，立刻把刚启动的单击倒计时掐死！防止触发画面闪烁
                    if (clickTimer) clearTimeout(clickTimer);

                    // 走原有的系统级全屏逻辑
                    if (!document.fullscreenElement) {
                        if (wrapper.requestFullscreen) wrapper.requestFullscreen();
                        else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
                    } else {
                        if (document.exitFullscreen) document.exitFullscreen();
                    }
                };
                
                // 把视频和名字放进盒子里
                wrapper.appendChild(videoEl);
                wrapper.appendChild(nameLabel);
                
                // 把盒子放入主界面
                document.getElementById('video-container').appendChild(wrapper);

            } else if (track.kind === 'audio') {
                const audioEl = track.attach();
                // Prevent double output from native <audio>; route sound only through AudioContext.
                audioEl.muted = true;
                audioEl.volume = 0;
                audioEl.dataset.audioIdentity = participant.identity;

                const source = isAppAudioPublication(track, publication)
                    ? 'appaudio'
                    : ((track.source === LivekitClient.Track.Source.ScreenShareAudio || track.source === 'screen_share_audio') ? 'screen' : 'mic');
                audioEl.dataset.audioSource = source;

                ensureParticipantVolumeState(participant.identity);
                // 交给 GainNode 处理，支持 100% 以上的本地增益；音量会从 localStorage 恢复
                addRemoteGainNode(participant.identity, source, track, audioEl);
                
                document.getElementById('audio-container').appendChild(audioEl);
                if (typeof audioEl.setSinkId === 'function') {
                    audioEl.setSinkId(selectedAudioOutputId).catch((e) => {
                        console.warn('新音频轨道切换输出设备失败:', e);
                    });
                }
            }
        });

        // 🌟 核心修改：如果有人单独关掉了屏幕共享，要把他的包装盒一起删掉
        room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach(element => element.remove());
            removeRemoteAudioRouteByTrackSid(track.sid);
            
            // 精准狙击并删除对应的包装盒
            const wrapper = document.getElementById('video-wrapper-' + track.sid);
            if (wrapper) wrapper.remove();

            // 如果是本地手动屏蔽导致的取消订阅，保留恢复卡片；其它情况不处理
        });

        // 退出房间暴力清场，利用之前的 dataset 删除整个盒子
        room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
            document.querySelectorAll(`[data-video-identity="${participant.identity}"]`).forEach(el => el.remove());
            document.querySelectorAll(`[data-audio-identity="${participant.identity}"]`).forEach(el => el.remove());
            removeLocalScreenRestoreCard(participant.identity);
            delete localScreenControls[participant.identity];
            updateParticipantList();
        });

        room.on(LivekitClient.RoomEvent.ParticipantConnected, updateParticipantList);
        // 活跃说话者检测：根据音频能量水平更新状态，带防抖避免频闪
        room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, (speakers) => {
            const nextActiveIdentities = new Set();
            (speakers || []).forEach((participant) => {
                if (!participant || !participant.identity) return;
                const audioLevel = Number(participant.audioLevel || 0);
                if (audioLevel >= ACTIVE_SPEAKER_LEVEL_THRESHOLD) {
                    nextActiveIdentities.add(participant.identity);
                }
            });

            let hasImmediateChange = false;
            nextActiveIdentities.forEach((identity) => {
                if (markParticipantAsActiveSpeaker(identity)) {
                    hasImmediateChange = true;
                }
            });

            Array.from(activeSpeakerIdentities).forEach((identity) => {
                if (!nextActiveIdentities.has(identity)) {
                    scheduleParticipantActiveSpeakerOff(identity);
                }
            });

            // 终极修复：把原来的 updateParticipantList(); 替换成局部更新函数
            if (hasImmediateChange) {
                updateActiveSpeakerUI();
            }
        });

        // 监听静音状态变化以刷新列表
        room.on(LivekitClient.RoomEvent.TrackMuted, (pub) => { if(pub.kind === 'audio') updateParticipantList(); });
        room.on(LivekitClient.RoomEvent.TrackUnmuted, (pub) => { if(pub.kind === 'audio') updateParticipantList(); });
        room.on(LivekitClient.RoomEvent.LocalTrackMuted, (pub) => { if(pub.kind === 'audio') updateParticipantList(); });
        room.on(LivekitClient.RoomEvent.LocalTrackUnmuted, (pub) => { if(pub.kind === 'audio') updateParticipantList(); });
        room.on(LivekitClient.RoomEvent.LocalTrackPublished, (pub) => {
            if (isScreenShareSource(pub?.source) && pub.track) {
                showLocalScreenPreview(pub.track);
            }
        });
        room.on(LivekitClient.RoomEvent.LocalTrackUnpublished, (pub) => {
            if (isScreenShareSource(pub?.source)) {
                hideLocalScreenPreview();
            }
        });
        room.on(LivekitClient.RoomEvent.TrackPublished, (pub) => { if(pub.kind === 'audio') updateParticipantList(); });
        room.on(LivekitClient.RoomEvent.TrackUnpublished, (pub, participant) => {
            if(pub.kind === 'audio') updateParticipantList();

            if (isScreenShareSource(pub?.source)) {
                const identity = participant?.identity || Object.keys(localScreenControls).find(key => {
                    return localScreenControls[key]?.publication?.trackSid === pub?.trackSid;
                });

                if (identity) {
                    removeLocalScreenRestoreCard(identity);
                    delete localScreenControls[identity];
                }
            }
        });

        // 监听文字聊天消息
        room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant) => {
            try {
                const text = new TextDecoder().decode(payload);
                const data = JSON.parse(text);
                if (data.msg) {
                    renderChatMessage(participant ? (participant.name || participant.identity) : '未知', data.msg, false);
                }
            } catch(e) { console.error('Data channel 解析失败:', e); }
        });

        await room.connect(serverConfig.livekitWs, token);
        document.getElementById('header').innerText = `# 🔊 ${targetRoomName} 语音分组`;
        document.getElementById('ui-username').innerText = username;
        document.getElementById('ui-status').innerText = '已连接: ' + targetRoomName;
        document.getElementById('ui-status').style.color = '#23a559'; // 变成绿色

        document.getElementById('username').disabled = true;
        
        document.getElementById('btn-mic').disabled = false;
        document.getElementById('mic-select').disabled = false;
        document.getElementById('audio-output-select').disabled = false;
        document.getElementById('btn-screen').disabled = false;
        updateMicSourceButton();
        document.getElementById('screen-res').disabled = false;
        document.getElementById('screen-fps').disabled = false;
        document.getElementById('screen-bitrate').disabled = false;
        document.getElementById('btn-app-audio').disabled = false;
        document.getElementById('btn-leave').style.display = 'flex';

        // 先同步麦克风设备，再自动开麦；否则 Tauri/Rust 可能仍会录系统默认麦克风。
        await updateMicList();

        // 智能自动开麦（进入语音频道后自动发布麦克风；大厅本身没有 LiveKit 房间，无法单独发布音轨）
        try {
            if (autoMic && !isMicOn) {
                await updateMicList().catch((e) => console.warn('自动开麦前刷新设备列表失败:', e));
                await toggleMic();
            }
        } catch (e) {
            console.warn('自动开麦失败:', e);
        }

        document.getElementById('chat-input').disabled = false;
        document.getElementById('btn-send').disabled = false;

        updateParticipantList();
        await updateAudioOutputList();
        await switchAudioOutput(document.getElementById('audio-output-select').value || selectedAudioOutputId);
        updateAppAudioButtons();

    } catch (error) {
        console.error('频道连接失败:', error);
        alert('连接服务器失败，请检查网络。');
        currentChannel = null;
        renderChannelList();
        document.getElementById('header').innerText = '# 🏛️ DoNiChannel 电竞大厅（连接失败，请重试）';
    }
}

async function toggleMic() {
    const btn = document.getElementById('btn-mic');
    const vadModule = document.getElementById('vad-module');
    const monitorBtn = document.getElementById('btn-mic-monitor');

    if (!isMicOn) {
        try {
            if (isTauriClient) {
                // 🚀 客户端模式：启动 Rust 硬核麦克风 (绝对不能丢了这句！)
                await startRustMicShare();
                if (vadModule) vadModule.style.display = 'block'; 
                if (monitorBtn) monitorBtn.style.display = 'flex'; // 显示耳返开关
            } else {
                // 🌐 网页模式：启动普通浏览器麦克风
                await room.localParticipant.setMicrophoneEnabled(true, getMicCaptureOptions());
                if (vadModule) vadModule.style.display = 'none'; 
            }
            
            isMicOn = true;
            btn.classList.add('active');
            btn.innerHTML = '🔇';
            btn.setAttribute('data-tooltip', isTauriClient ? '关闭 Rust 麦克风' : '关闭浏览器麦克风');
        } catch (e) {
            console.error("开麦失败:", e);
            alert(`麦克风启动失败: ${e.message || e}`);
        }
    } else {
        try {
            if (isTauriClient) {
                // 停止 Rust 底层麦克风
                await stopRustMicShare();
                if (vadModule) vadModule.style.display = 'none';
                if (monitorBtn) monitorBtn.style.display = 'none'; // 隐藏耳返开关
            } else {
                await room.localParticipant.setMicrophoneEnabled(false);
            }
            
            isMicOn = false;
            btn.classList.remove('active');
            btn.innerHTML = '🎤';
            btn.setAttribute('data-tooltip', isTauriClient ? '开启 Rust 麦克风' : '开启浏览器麦克风');
        } catch (e) {
            console.error("关麦失败:", e);
        }
    }
    await updateMicList();
}

async function leaveRoom() {
    // 1. 优先优雅关闭 Rust 底层引擎，防止残留线程
    if (isTauriClient && isMicOn) {
        await stopRustMicShare();
    }
    
    stopAppAudioShare();
    stopRoomPolling();
    stopScreenBitrateMonitor();
    hideLocalScreenPreview();
    
    if (room) room.disconnect();
    teardownLocalPcmPipeline();
    
    // 2. 给 Rust 留出 100 毫秒的垃圾回收时间，然后再刷新页面
    setTimeout(() => {
        window.location.reload(); 
    }, 100);
}

/*
// Tauri v2 标准的 invoke 引入方式
const { invoke } = window.__TAURI__.core;

// 阶段一测试函数
async function testRadar() {
    try {
        console.log(" Rust扫描进程...");
        const processes = await invoke('get_active_processes');
        
        console.log("活跃进程：");
        console.table(processes); // 以表格形式漂亮地打印出来
        
    } catch (error) {
        console.error("扫描失败:", error);
    }
}

// 页面加载后直接执行测试
testRadar();
*/

function toggleMicMonitor() {
    isMicMonitorOn = !isMicMonitorOn;
    const btn = document.getElementById('btn-mic-monitor');
    
    if (rustMicMonitorGain) {
        rustMicMonitorGain.gain.value = isMicMonitorOn ? 1.0 : 0.0;
    }
    
    // UI 状态联动：纯图标变化与 Tooltip
    if (btn) {
        btn.classList.toggle('active', isMicMonitorOn);
        btn.setAttribute('data-tooltip', isMicMonitorOn ? '监听开' : '监听关');
    }
}




// ===== Vue3 迁移入口：DOM 已由 App.vue 渲染后调用 =====
function initLegacyDomBlock1() {
    const savedUser = localStorage.getItem('lk_username');
    if (savedUser) document.getElementById('username').value = savedUser;

    const savedServerIp = localStorage.getItem('lk_server_ip');
    document.getElementById('server-ip').value = savedServerIp || DEFAULT_SERVER_IP;

    renderChannelList();
    updateMicList().catch((e) => console.warn('初始化麦克风列表失败:', e));
    updateAudioOutputList();

}

function initLegacyDomBlock2() {
    const slider = document.getElementById('vad-slider-input');
    const marker = document.getElementById('vad-threshold-marker');
    const text = document.getElementById('vad-threshold-text');
    const fillBar = document.getElementById('vad-fill-bar');
    const boostSlider = document.getElementById('vad-boost-input');
    const boostText = document.getElementById('vad-boost-text');

    // 1. 监听滑块：拖动时通知 Rust 更改阈值
    if (slider) {
        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            marker.style.left = val + '%';
            text.innerText = val + '%';
            
            // 🌟 遥控器核心：把数据发给 Rust
            invoke('set_mic_vad_threshold', { val: parseFloat(val) }).catch(console.error);
        });
    }

    //音频增益
    if (boostSlider) {
        boostSlider.addEventListener('input', (e) => {
            // 将 10~50 的整数，转成 1.0 ~ 5.0 的浮点数
            const val = parseInt(e.target.value) / 10.0;
            boostText.innerText = val.toFixed(1) + 'x';
            
            // 通知 Rust 实时修改底层放大倍数
            invoke('set_mic_boost', { val: val }).catch(err => console.error("设置增益失败:", err));
        });
    }

    // 2. 监听 Rust 发来的实时音量
    listen('mic_volume', (event) => {
        const volumePercent = event.payload; // Rust 算好的 0-100 数字
        if (fillBar) {
            fillBar.style.width = volumePercent + '%';
            // 如果低于黄线（滑块值），可以变灰，表示被 Rust 拦截了
            const threshold = parseFloat(slider.value);
            fillBar.style.background = volumePercent < threshold ? '#4f545c' : '#23a559';
        }
    });

    if (!hasRegisteredRustMicErrorListener) {
        hasRegisteredRustMicErrorListener = true;

        listen('mic_error', (event) => {
            const now = Date.now();
            if (now - lastRustMicErrorAt < 1500) {
                return;
            }
            lastRustMicErrorAt = now;

            const message = event && event.payload
                ? String(event.payload)
                : '未知麦克风错误';

            console.error('[Rust Mic Error]', message);

            const fillBar = document.getElementById('vad-fill-bar');
            if (fillBar) {
                fillBar.style.width = '0%';
            }

            const vadModule = document.getElementById('vad-module');
            if (vadModule) {
                vadModule.style.display = 'none';
            }

            const monitorBtn = document.getElementById('btn-mic-monitor');
            if (monitorBtn) {
                monitorBtn.style.display = 'none';
            }

            isRustMicOn = false;
            isMicOn = false;

            updateMicSourceButton();

            alert(`Rust 麦克风捕获失败：${message}`);
        });
    }

}

let __legacyDomInitialized = false;

export function initLegacyDom() {
    if (__legacyDomInitialized) return;
    __legacyDomInitialized = true;
    initLegacyDomBlock1();
    initLegacyDomBlock2();

}

// 动态 innerHTML 里还有 onclick="..."，所以这些函数仍然挂到 window，保证渐进迁移期间不坏。
Object.assign(window, {
    joinRoom,
    createChannel,
    switchChannel,
    toggleMic,
    toggleMicMonitor,
    toggleScreen,
    handleAppAudioClick,
    leaveRoom,
    closeAppAudioModal,
    confirmAppAudioSelection,
    toggleAppAudioProcessSelection,
    switchMic,
    switchAudioOutput,
    sendChatMessage,
    toggleLocalScreenSubscription,
    setParticipantVolume,
    openAppAudioModal,
    stopAppAudioShare,
    renderChatMessage,
    switchMicSource,
});

export {
    joinRoom,
    createChannel,
    switchMic,
    switchAudioOutput,
    toggleMic,
    toggleMicMonitor,
    toggleScreen,
    handleAppAudioClick,
    leaveRoom,
    closeAppAudioModal,
    confirmAppAudioSelection,
    sendChatMessage,
};
