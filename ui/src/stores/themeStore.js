import { reactive } from 'vue';

const THEME_STORAGE_KEY = 'donichannel_theme_v1';

export const themes = [
  {
    id: 'doni-dark',
    name: 'DoNi Dark',
    desc: '默认深色，清晰稳定',
    accent: '#5865f2',
  },
  {
    id: 'midnight-purple',
    name: 'Midnight Purple',
    desc: '紫蓝电竞风格',
    accent: '#8b5cf6',
  },
  {
    id: 'glass-dark',
    name: 'Glass Dark',
    desc: '轻毛玻璃浮层',
    accent: '#22d3ee',
  },
  {
    id: 'soft-graphite',
    name: 'Soft Graphite',
    desc: '柔和低对比灰黑',
    accent: '#f59e0b',
  },
];

function safeLoadThemeId() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return themes.some((theme) => theme.id === saved) ? saved : 'doni-dark';
}

export const themeStore = reactive({
  activeTheme: safeLoadThemeId(),
});

export function applyThemeToDocument(themeId = themeStore.activeTheme) {
  const nextTheme = themes.some((theme) => theme.id === themeId) ? themeId : 'doni-dark';
  themeStore.activeTheme = nextTheme;

  const root = document.documentElement;
  themes.forEach((theme) => root.classList.remove(`theme-${theme.id}`));
  root.classList.add(`theme-${nextTheme}`);
  root.dataset.theme = nextTheme;
}

export function setTheme(themeId) {
  const nextTheme = themes.some((theme) => theme.id === themeId) ? themeId : 'doni-dark';
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyThemeToDocument(nextTheme);
}

export function getActiveTheme() {
  return themes.find((theme) => theme.id === themeStore.activeTheme) || themes[0];
}

applyThemeToDocument(themeStore.activeTheme);
