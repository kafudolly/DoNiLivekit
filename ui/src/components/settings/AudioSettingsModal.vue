<script setup>
import { computed, ref } from 'vue';
import ProfileSettingsPanel from './ProfileSettingsPanel.vue';
import { themes, themeStore, setTheme } from '../../stores/themeStore.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'switch-mic', 'switch-output']);

const activeTab = ref('profile');

const settingsTabs = [
  { id: 'profile', icon: '👤', title: '我的资料', desc: '头像、昵称、状态' },
  { id: 'devices', icon: '🎧', title: '音频设备', desc: '麦克风与扬声器' },
  { id: 'mic', icon: '🎙️', title: '麦克风处理', desc: '阈值、增益、降噪' },
  { id: 'about', icon: 'ℹ️', title: '关于', desc: '版本和使用建议' },
];

const activeTabInfo = computed(() => {
  return settingsTabs.find((tab) => tab.id === activeTab.value) || settingsTabs[0];
});

function closeModal() {
  emit('close');
}

const activeThemeId = computed(() => themeStore.activeTheme);

function chooseTheme(themeId) {
  setTheme(themeId);
}
</script>

<template>
  <!--
    设置中心始终挂载，只通过 hidden 控制显示。
    这样 runtime.initLegacyDom() 能稳定找到 mic-select、audio-output-select 和 VAD 滑块。
    各设置页也使用 v-show，不使用 v-if，避免 DOM id 因标签页切换而丢失。
  -->
  <div
    class="modal audio-settings-modal modern-settings-modal"
    :class="{ hidden: !props.open }"
    @click.self="closeModal"
  >
    <section class="modal-card settings-card settings-center-card">
      <header class="modal-header settings-header settings-center-header">
        <div>
          <div class="modal-title">设置中心</div>
          <div class="settings-subtitle">管理个人资料、音频设备、麦克风处理与界面偏好</div>
        </div>
        <button class="modal-close" title="关闭" @click="closeModal">×</button>
      </header>

      <div class="settings-center-layout">
        <aside class="settings-nav" aria-label="设置分类">
          <button
            v-for="tab in settingsTabs"
            :key="tab.id"
            type="button"
            class="settings-nav-item"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <span class="settings-nav-icon">{{ tab.icon }}</span>
            <span class="settings-nav-copy">
              <span class="settings-nav-title">{{ tab.title }}</span>
              <span class="settings-nav-desc">{{ tab.desc }}</span>
            </span>
          </button>
        </aside>

        <main class="settings-content-panel">
          <div class="settings-page-heading">
            <div class="settings-page-kicker">{{ activeTabInfo.icon }} {{ activeTabInfo.title }}</div>
            <div class="settings-page-desc">{{ activeTabInfo.desc }}</div>
          </div>

          <div class="settings-page-stack">
            <ProfileSettingsPanel v-show="activeTab === 'profile'" />

            <section v-show="activeTab === 'devices'" class="settings-section settings-page-section">
              <div class="settings-section-title">输入 / 输出设备</div>
              <p class="settings-section-desc">选择当前使用的麦克风和扬声器。Tauri 模式下麦克风由 Rust 侧采集。</p>

              <label class="settings-field modern-settings-field">
                <span>麦克风</span>
                <select
                  id="mic-select"
                  disabled
                  @change="$emit('switch-mic', $event.target.value)"
                >
                  <option value="">等待权限...</option>
                </select>
              </label>

              <label class="settings-field modern-settings-field">
                <span>扬声器</span>
                <select
                  id="audio-output-select"
                  disabled
                  @change="$emit('switch-output', $event.target.value)"
                >
                  <option value="default">默认扬声器</option>
                </select>
              </label>

              <div class="settings-tip-card">
                <strong>提示</strong>
                <span>如果设备列表不完整，先进入语音频道并允许音频权限，再重新打开设置中心。</span>
              </div>
            </section>

            <section v-show="activeTab === 'mic'" class="settings-section settings-page-section">
              <div class="settings-section-title">Rust 麦克风处理</div>
              <p class="settings-section-desc">调整静音门限和麦克风增益。增益过高可能导致炸麦，建议先从默认值开始微调。</p>

              <div id="vad-module" class="vad-container settings-vad-block modern-vad-block">
                <div class="vad-header">
                  <span>收音阈值</span>
                  <span id="vad-threshold-text">20%</span>
                </div>

                <div class="vad-track-wrapper">
                  <div id="vad-fill-bar" class="vad-fill-bar"></div>
                  <div id="vad-threshold-marker" class="vad-threshold-marker" style="left: 20%;"></div>
                  <input
                    id="vad-slider-input"
                    type="range"
                    min="0"
                    max="100"
                    value="20"
                    class="vad-slider-input"
                  >
                </div>

                <div class="settings-range-note">低于阈值的环境声会被压低。说话断续时可以适当降低。</div>

                <div class="vad-header vad-boost-header">
                  <span>麦克风增益</span>
                  <span id="vad-boost-text">5.0x</span>
                </div>

                <input
                  id="vad-boost-input"
                  type="range"
                  class="volume-slider"
                  min="10"
                  max="200"
                  value="50"
                >

                <div class="settings-range-note">增益越高声音越大，但也更容易触发限幅和失真。</div>
              </div>
            </section>

            <section v-show="activeTab === 'about'" class="settings-section settings-page-section settings-about-section">
              <div class="settings-section-title">关于 DoNiChannel</div>
              <p>DoNiChannel 是面向局域网语音、屏幕共享和应用音频共享的 Tauri 桌面客户端。</p>

              <div class="about-info-list">
                <div><span>前端</span><strong>Vue 3 + Vite</strong></div>
                <div><span>桌面端</span><strong>Tauri + Rust</strong></div>
                <div><span>实时通信</span><strong>LiveKit</strong></div>
                <div><span>后端</span><strong>FastAPI + Presence WebSocket</strong></div>
              </div>

              <div class="settings-tip-card warning">
                <strong>音频建议</strong>
                <span>如果出现回声，优先关闭耳返、避免外放，并确认应用音频没有采集到 DoNiChannel 自己。</span>
              </div>
            </section>
          </div>
        </main>
      </div>
    </section>
  </div>
</template>
