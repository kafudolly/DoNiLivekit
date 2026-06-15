import { reactive } from 'vue';
import { uploadAvatar, saveUserProfile, fetchUserProfile } from '../shared/apiClient.js';

const PROFILE_STORAGE_KEY = 'donichannel_profile_v1';
const CONNECTION_STORAGE_KEY = 'donichannel_connection_id_v1';

// 头像图片限制（压缩到 128×128，base64 不超过约 80KB）
const AVATAR_MAX_PX = 128;
const AVATAR_MAX_BYTES = 80 * 1024;

const DEFAULT_PROFILE = {
  userId: '',
  displayName: '',
  avatarColor: '#5865f2',
  avatarPreset: '🎮',
  avatarUrl: null,   // base64 data URL，优先级高于 avatarColor+avatarPreset
  statusText: '在线',
};

const AVATAR_COLORS = [
  '#5865f2',
  '#7c3aed',
  '#ec4899',
  '#f97316',
  '#22c55e',
  '#06b6d4',
  '#eab308',
  '#ef4444',
];

const AVATAR_PRESETS = ['🎮', '🎧', '⭐', '⚡', '🌙', '🐱', '🍡', '🧋'];

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/** 生成一个简单的唯一 ID（无外部依赖）。 */
function generateUserId() {
  return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

/** 生成一次前端会话级连接 ID，用于 WebSocket 连接管理。 */
function generateConnectionId() {
  return 'conn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

/**
 * 获取当前前端会话的 connectionId。
 * userId 是长期身份；connectionId 是本次客户端连接身份。
 */
export function getConnectionId() {
  let value = sessionStorage.getItem(CONNECTION_STORAGE_KEY);
  if (!value) {
    value = generateConnectionId();
    sessionStorage.setItem(CONNECTION_STORAGE_KEY, value);
  }
  return value;
}

/** 当前阶段 LiveKit identity 仍兼容使用 userId，后续可切换为 userId + connectionId。 */
export function getLivekitIdentity() {
  return profileStore.userId;
}

function loadProfile() {
  const saved = safeJsonParse(localStorage.getItem(PROFILE_STORAGE_KEY));
  const savedName = localStorage.getItem('lk_username') || '';

  const userId = saved?.userId || generateUserId();
  
  const loaded = {
    ...DEFAULT_PROFILE,
    ...(saved || {}),
    userId,
    displayName: (saved?.displayName || savedName || '').trim(),
    avatarUrl: saved?.avatarUrl ?? null,
  };

  // 立即保存 userId，避免每次刷新产生新身份
  if (!saved?.userId) {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(loaded));
  }
  
  return loaded;
}

export const profileStore = reactive(loadProfile());
export const avatarColors = AVATAR_COLORS;
export const avatarPresets = AVATAR_PRESETS;

export function saveProfile() {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
      userId: profileStore.userId,
      displayName: profileStore.displayName,
      avatarColor: profileStore.avatarColor,
      avatarPreset: profileStore.avatarPreset,
      avatarUrl: profileStore.avatarUrl ?? null,
      statusText: profileStore.statusText,
    }));
  } catch (e) {
    // avatarUrl 过大时 localStorage 可能写满，尝试不含图片的版本
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
        userId: profileStore.userId,
        displayName: profileStore.displayName,
        avatarColor: profileStore.avatarColor,
        avatarPreset: profileStore.avatarPreset,
        avatarUrl: null,
        statusText: profileStore.statusText,
      }));
    } catch (_) {
      // 静默失败
    }
  }
}

let profileSyncTimer = null;

function getProfilePayload() {
  return {
    userId: profileStore.userId,
    displayName: profileStore.displayName || localStorage.getItem('lk_username') || '未命名用户',
    avatarColor: profileStore.avatarColor || '#5865f2',
    avatarPreset: profileStore.avatarPreset || '',
    avatarUrl: profileStore.avatarUrl || '',
    statusText: profileStore.statusText || '在线',
  };
}

/** 将当前资料保存到后端。失败不影响本地资料。 */
export async function syncProfileToServer({ silent = true } = {}) {
  if (!profileStore.userId) return null;

  try {
    const res = await saveUserProfile(getProfilePayload());
    return res;
  } catch (error) {
    if (!silent) throw error;
    console.warn('[ProfileStore] 同步资料到服务器失败', error);
    return null;
  }
}

/** 延迟同步，避免用户连续改颜色/头像时频繁请求。 */
export function scheduleProfileSync(delayMs = 500) {
  clearTimeout(profileSyncTimer);
  profileSyncTimer = setTimeout(() => {
    profileSyncTimer = null;
    syncProfileToServer({ silent: true });
  }, delayMs);
}

/** 从服务器拉取当前 userId 的资料。当前阶段只在明确需要时调用，避免覆盖本地编辑。 */
export async function loadProfileFromServer({ merge = false } = {}) {
  if (!profileStore.userId) return null;
  const profile = await fetchUserProfile(profileStore.userId);
  if (!profile || !merge) return profile;

  profileStore.displayName = profile.displayName || profileStore.displayName;
  profileStore.avatarColor = profile.avatarColor || profileStore.avatarColor;
  profileStore.avatarPreset = profile.avatarPreset ?? profileStore.avatarPreset;
  profileStore.avatarUrl = profile.avatarUrl || profileStore.avatarUrl || null;
  profileStore.statusText = profile.statusText || profileStore.statusText || '在线';
  saveProfile();
  return profile;
}

export function updateDisplayName(value) {
  const displayName = String(value || '').trim().slice(0, 24);
  profileStore.displayName = displayName;

  // 当前阶段把 displayName 作为登录名使用，保证刷新后登录框和个人资料一致。
  if (displayName) {
    localStorage.setItem('lk_username', displayName);
    const input = document.getElementById('username');
    if (input && !input.disabled) input.value = displayName;
  }

  saveProfile();
  scheduleProfileSync();
}

export function updateAvatarColor(value) {
  if (!value) return;
  profileStore.avatarColor = value;
  saveProfile();
  scheduleProfileSync();
}

export function updateAvatarPreset(value) {
  profileStore.avatarPreset = value || '';
  saveProfile();
  scheduleProfileSync();
}

export function updateStatusText(value) {
  profileStore.statusText = String(value || '').trim().slice(0, 20) || '在线';
  saveProfile();
  scheduleProfileSync();
}

export function getSelfDisplayName(fallback = '') {
  return profileStore.displayName || fallback || localStorage.getItem('lk_username') || '未命名用户';
}

export function getUserInitials(name) {
  const clean = String(name || '').trim();
  if (!clean) return '?';

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }

  return clean.slice(0, 1).toUpperCase();
}

export function getStableAvatarColor(seed) {
  const text = String(seed || '').trim();
  if (!text) return DEFAULT_PROFILE.avatarColor;

  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function updateAvatarUrl(value) {
  profileStore.avatarUrl = value || null;
  saveProfile();
  scheduleProfileSync();
}


export async function uploadAvatarImage(file) {
  if (!file || !file.type.startsWith('image/')) return null;

  try {
    const res = await uploadAvatar(file);
    if (res.ok && res.url) {
      updateAvatarUrl(res.url);
      return res.url;
    }
  } catch (error) {
    console.error('[ProfileStore] 上传头像失败', error);
    alert('上传头像失败: ' + error.message);
  }
  return null;
}

export function resetProfile() {
  Object.assign(profileStore, {
    ...DEFAULT_PROFILE,
    userId: profileStore.userId, // 保留 userId，不重置
    displayName: localStorage.getItem('lk_username') || '',
  });
  saveProfile();
  scheduleProfileSync();
}
