import { reactive } from 'vue';

const PROFILE_STORAGE_KEY = 'donichannel_profile_v1';

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
}

export function updateAvatarColor(value) {
  if (!value) return;
  profileStore.avatarColor = value;
  saveProfile();
}

export function updateAvatarPreset(value) {
  profileStore.avatarPreset = value || '';
  saveProfile();
}

export function updateStatusText(value) {
  profileStore.statusText = String(value || '').trim().slice(0, 20) || '在线';
  saveProfile();
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
}

import { uploadAvatar } from '../shared/apiClient.js';

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
}
