import { reactive } from 'vue';

const PROFILE_STORAGE_KEY = 'donichannel_profile_v1';

const DEFAULT_PROFILE = {
  displayName: '',
  avatarColor: '#5865f2',
  avatarPreset: '🎮',
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

function loadProfile() {
  const saved = safeJsonParse(localStorage.getItem(PROFILE_STORAGE_KEY));
  const savedName = localStorage.getItem('lk_username') || '';

  return {
    ...DEFAULT_PROFILE,
    ...(saved || {}),
    displayName: (saved?.displayName || savedName || '').trim(),
  };
}

export const profileStore = reactive(loadProfile());
export const avatarColors = AVATAR_COLORS;
export const avatarPresets = AVATAR_PRESETS;

export function saveProfile() {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
    displayName: profileStore.displayName,
    avatarColor: profileStore.avatarColor,
    avatarPreset: profileStore.avatarPreset,
    statusText: profileStore.statusText,
  }));
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

export function resetProfile() {
  Object.assign(profileStore, {
    ...DEFAULT_PROFILE,
    displayName: localStorage.getItem('lk_username') || '',
  });
  saveProfile();
}
