export function getCleanMicDeviceLabel(device, index) {
    const rawName = String(device?.name || '').trim();

    // Windows Endpoint ID 会长得像 {0.0.1.00000000}.{...}，不适合直接显示给用户。
    // 但真实设备名可能较长，例如“默认值 - 麦克风 (HECATE G4 Pro) (35bb:a164)”，不能因为长就替换成“麦克风 1”。
    const looksLikeEndpointId =
        rawName.includes('{0.0.') ||
        rawName.includes('\\?') ||
        /^麦克风\s*\{0\.0\./i.test(rawName);

    if (rawName && !looksLikeEndpointId) return rawName;
    return `麦克风 ${index + 1}`;
}

export async function updateMicList({ isTauriClient, invoke, LivekitClient }) {
    const selectEl = document.getElementById('mic-select');
    if (!selectEl) return;

    try {
        selectEl.disabled = false;
        selectEl.innerHTML = '';

        if (isTauriClient) {
            const devices = await invoke('list_capture_devices');
            const rows = Array.isArray(devices) ? devices : [];

            if (rows.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.text = '未枚举到输入设备，使用系统默认麦克风';
                selectEl.appendChild(option);
            } else {
                rows.forEach((device, index) => {
                    const option = document.createElement('option');
                    option.value = device.id || '';
                    option.text = getCleanMicDeviceLabel(device, index);
                    option.title = device.name || device.id || option.text;
                    selectEl.appendChild(option);
                });
            }

            const savedMic = localStorage.getItem('lk_rust_mic_device_id') || '';
            const hasSaved = Array.from(selectEl.options).some(opt => opt.value === savedMic);
            selectEl.value = hasSaved ? savedMic : '';

            // 关键：开麦前先把选择同步给 Rust。否则 Rust 仍会录系统默认麦克风。
            await invoke('set_rust_mic_device_id', { deviceId: selectEl.value }).catch((e) => {
                console.warn('同步 Rust 麦克风设备失败:', e);
            });
            return;
        }

        const devices = await LivekitClient.Room.getLocalDevices('audioinput');
        if (devices.length === 0) {
            selectEl.innerHTML = '<option value="">未找到麦克风</option>';
            return;
        }

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `未知设备 (${device.deviceId.substring(0, 5)}...)`;
            selectEl.appendChild(option);
        });

        const savedMic = localStorage.getItem('lk_mic');
        if (savedMic && devices.some(d => d.deviceId === savedMic)) {
            selectEl.value = savedMic;
        }
    } catch (e) {
        console.error('获取麦克风列表失败:', e);
        selectEl.innerHTML = '<option value="">麦克风列表获取失败</option>';
    }
}

export async function switchMic(deviceId, context) {
    const {
        isTauriClient,
        invoke,
        getRoom,
        isMicActive,
        isRustMicActive,
        hasLocalRustMicPublication,
        stopRustMicShare,
        startRustMicShare,
        afterRustMicRestart,
    } = context;

    if (isTauriClient) {
        const normalized = deviceId || '';
        localStorage.setItem('lk_rust_mic_device_id', normalized);

        try {
            await invoke('set_rust_mic_device_id', { deviceId: normalized });

            const room = getRoom?.();
            const shouldRestart = !!(
                room &&
                room.localParticipant &&
                (isMicActive?.() || isRustMicActive?.() || hasLocalRustMicPublication?.())
            );

            // 如果当前已经开着 Rust 麦克风，切换设备必须重启采集线程和重新 publish。
            if (shouldRestart) {
                await stopRustMicShare();
                await startRustMicShare();
                afterRustMicRestart?.();
            }
        } catch (e) {
            console.error('切换 Rust 麦克风失败:', e);
            alert(`切换麦克风失败：${e.message || e}`);
        }

        return;
    }

    const room = getRoom?.();
    if (!room) return;
    localStorage.setItem('lk_mic', deviceId);
    try {
        await room.switchActiveDevice('audioinput', deviceId);
    } catch (e) {
        console.error('切换麦克风失败:', e);
        alert('切换失败，该设备可能被独占或拔出。');
    }
}

export async function updateAudioOutputList({ selectedAudioOutputId }) {
    const selectEl = document.getElementById('audio-output-select');
    if (!selectEl) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
        selectEl.innerHTML = '<option value="default">当前浏览器不支持输出设备切换</option>';
        return;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        selectEl.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.text = '默认扬声器';
        selectEl.appendChild(defaultOption);

        outputs.forEach((device) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `音频输出设备 (${device.deviceId.slice(0, 6)}...)`;
            selectEl.appendChild(option);
        });

        const hasSaved = Array.from(selectEl.options).some(opt => opt.value === selectedAudioOutputId);
        selectEl.value = hasSaved ? selectedAudioOutputId : 'default';
    } catch (e) {
        console.warn('枚举音频输出设备失败:', e);
        selectEl.innerHTML = '<option value="default">输出设备不可用</option>';
    }
}

export async function switchAudioOutput(deviceId, context) {
    const selectedAudioOutputId = deviceId || 'default';
    localStorage.setItem('lk_audio_output', selectedAudioOutputId);

    const remoteAudioContext = context.getRemoteAudioContext?.();
    if (remoteAudioContext && typeof remoteAudioContext.setSinkId === 'function') {
        try {
            await remoteAudioContext.setSinkId(selectedAudioOutputId);
        } catch (e) {
            console.warn('AudioContext.setSinkId 切换失败:', e);
        }
    }

    const localRustMicAudioContext = context.getLocalRustMicAudioContext?.();
    if (localRustMicAudioContext && typeof localRustMicAudioContext.setSinkId === 'function') {
        try {
            await localRustMicAudioContext.setSinkId(selectedAudioOutputId);
        } catch (e) {
            console.warn('Rust麦克风耳返 setSinkId 切换失败:', e);
        }
    }

    const audioEls = document.querySelectorAll('#audio-container audio');
    for (const audioEl of audioEls) {
        if (typeof audioEl.setSinkId === 'function') {
            try {
                await audioEl.setSinkId(selectedAudioOutputId);
            } catch (e) {
                console.warn('audio.setSinkId 切换失败:', e);
            }
        }
    }

    return selectedAudioOutputId;
}
