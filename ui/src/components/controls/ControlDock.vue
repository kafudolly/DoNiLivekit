<script setup>
import { computed } from 'vue';
import BaseAvatar from '../common/BaseAvatar.vue';
import { getSelfDisplayName, profileStore } from '../../stores/profileStore.js';

const emit = defineEmits([
  'toggle-mic',
  'toggle-monitor',
  'toggle-screen',
  'app-audio-click',
  'leave',
  'open-settings',
]);

const displayName = computed(() => getSelfDisplayName('未连接大厅'));
</script>

<template>
  <!-- 左下角控制坞：保留按钮 id，供 rustMic/screenShare/appAudio 模块同步状态。 -->
  <div id="user-control-panel" class="user-control-dock modern-control-dock">
    <div class="user-profile">
      <BaseAvatar
        :name="displayName"
        :color="profileStore.avatarColor"
        :preset="profileStore.avatarPreset"
        :avatarUrl="profileStore.avatarUrl"
        size="md"
        online
      />
      <div class="info">
        <div id="ui-username" class="name">{{ displayName }}</div>
        <div id="ui-status" class="status">等待加入房间</div>
      </div>
      <button class="user-settings-btn" title="设置" @click="emit('open-settings')">⚙</button>
    </div>

    <div class="action-grid">
      <button id="btn-mic" class="grid-btn" disabled data-tooltip="开启麦克风" @click="emit('toggle-mic')">🎤</button>
      <button id="btn-mic-monitor" class="grid-btn" style="display: none;" data-tooltip="监听耳返" @click="emit('toggle-monitor')">🎧</button>

      <div class="screen-btn-wrapper">
        <button id="btn-screen" class="grid-btn" disabled data-tooltip="共享屏幕" @click="emit('toggle-screen')">💻</button>
        <div class="screen-settings-popup">
          <div class="popup-title">共享画质设置</div>
          <select id="screen-res" disabled>
            <option value="1280x720">720P 流畅</option>
            <option value="1920x1080" selected>1080P 高清</option>
            <option value="2560x1440">2K 超清</option>
          </select>
          <div class="screen-setting-row">
            <select id="screen-fps" disabled>
              <option value="30" selected>30 FPS</option>
              <option value="60">60 FPS</option>
            </select>
            <select id="screen-bitrate" disabled>
              <option value="2500">2.5 Mbps</option>
              <option value="5000" selected>5.0 Mbps</option>
              <option value="8000">8.0 Mbps</option>
              <option value="15000">15.0 Mbps</option>
              <option value="20000">20.0 Mbps</option>
              <option value="25000">25.0 Mbps</option>
              <option value="30000">30.0 Mbps</option>
            </select>
          </div>
        </div>
      </div>

      <button id="btn-app-audio" class="grid-btn" disabled data-tooltip="共享应用音频" @click="emit('app-audio-click')">🎵</button>
      <button class="grid-btn" data-tooltip="设置中心" @click="emit('open-settings')">⚙</button>
      <button id="btn-leave" class="grid-btn danger-btn" style="display: none;" data-tooltip="断开连接" @click="emit('leave')">🚪</button>
    </div>
  </div>
</template>
