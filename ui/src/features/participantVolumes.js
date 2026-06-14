import { USER_VOLUME_STORAGE_KEY } from '../shared/constants.js';
import { logError } from '../shared/errors.js';

// 远端成员音量统一存成 0~3 的 gain 值；界面统一显示和输入 0~300%。

/**
 * 把界面百分比转换成 0~3 的 gain。
 *
 * 注意：这里不再兼容“3 表示 300%”的旧输入语义。
 * 前端所有音量滑块和数字输入都按百分比处理：
 * - 3   => 3%   => gain 0.03
 * - 100 => 100% => gain 1.0
 * - 300 => 300% => gain 3.0
 */
export function normalizeGainValue(rawValue) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(n / 100, 3));
}

/**
 * 修正 localStorage 里历史版本保存的 gain。
 *
 * 历史数据可能已经是 0~3 的 gain，新 UI 输入则是 0~300 的百分比。
 * 这个函数只用于读取旧数据，不用于处理新的 UI 输入。
 */
function normalizeStoredGainValue(rawValue) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) return 1;
    const gain = n > 3 ? n / 100 : n;
    return Math.max(0, Math.min(gain, 3));
}

export function gainToPercent(gain) {
    return Math.round(Math.max(0, Math.min(Number(gain) || 0, 3)) * 100);
}

export function getDefaultVolumeState() {
    return { mic: 1, screen: 1, appaudio: 1 };
}

/** 读取并修正 localStorage 中的成员音量配置，坏数据会被自动忽略。 */
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
                    normalized[identity][source] = normalizeStoredGainValue(value[source]);
                }
            });
        });

        return normalized;
    } catch (e) {
        logError('participantVolumes/loadUserVolumesFromStorage 读取成员音量设置失败，使用默认音量', e, 'warn');
        return {};
    }
}

/** 保存远端成员音量配置；保存失败只打印警告，不影响通话。 */
export function saveUserVolumesToStorage(userVolumes) {
    try {
        localStorage.setItem(USER_VOLUME_STORAGE_KEY, JSON.stringify(userVolumes));
    } catch (e) {
        logError('participantVolumes/saveUserVolumesToStorage 保存成员音量设置失败', e, 'warn');
    }
}

/** 确保某个成员拥有完整的 mic/screen/appaudio 音量字段。 */
export function ensureParticipantVolumeState(userVolumes, identity) {
    const key = String(identity || 'unknown');

    if (!userVolumes[key]) {
        userVolumes[key] = getDefaultVolumeState();
    }

    ['mic', 'screen', 'appaudio'].forEach((source) => {
        if (userVolumes[key][source] === undefined) {
            userVolumes[key][source] = 1;
        } else {
            userVolumes[key][source] = normalizeStoredGainValue(userVolumes[key][source]);
        }
    });

    return userVolumes[key];
}
