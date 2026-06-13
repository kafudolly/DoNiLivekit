import { USER_VOLUME_STORAGE_KEY } from '../shared/constants.js';

export function normalizeGainValue(rawValue) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) return 1;

    // Support both legacy 0~3 gain values and current 0~300 percent slider values.
    const gain = n > 3 ? n / 100 : n;
    return Math.max(0, Math.min(gain, 3));
}

export function gainToPercent(gain) {
    return Math.round(Math.max(0, Math.min(gain, 3)) * 100);
}

export function getDefaultVolumeState() {
    return { mic: 1, screen: 1, appaudio: 1 };
}

export function loadUserVolumesFromStorage() {
    try {
        const raw = localStorage.getItem(USER_VOLUME_STORAGE_KEY);
        if (!raw) return {};

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};

        const normalized = {};
        Object.entries(parsed).forEach(([identity, value]) => {
            if (!identity || !value || typeof value !== 'object') return;

            normalized[identity] = getDefaultVolumeState();
            ['mic', 'screen', 'appaudio'].forEach((source) => {
                if (value[source] !== undefined) {
                    normalized[identity][source] = normalizeGainValue(value[source]);
                }
            });
        });

        return normalized;
    } catch (e) {
        console.warn('读取成员音量设置失败，使用默认音量:', e);
        return {};
    }
}

export function saveUserVolumesToStorage(userVolumes) {
    try {
        localStorage.setItem(USER_VOLUME_STORAGE_KEY, JSON.stringify(userVolumes));
    } catch (e) {
        console.warn('保存成员音量设置失败:', e);
    }
}

export function ensureParticipantVolumeState(userVolumes, identity) {
    const key = String(identity || 'unknown');

    if (!userVolumes[key]) {
        userVolumes[key] = getDefaultVolumeState();
    }

    ['mic', 'screen', 'appaudio'].forEach((source) => {
        if (userVolumes[key][source] === undefined) {
            userVolumes[key][source] = 1;
        } else {
            userVolumes[key][source] = normalizeGainValue(userVolumes[key][source]);
        }
    });

    return userVolumes[key];
}
