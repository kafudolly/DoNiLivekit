<script setup>
import { nextTick, onMounted } from 'vue';
import SidebarPanel from './components/sidebar/SidebarPanel.vue';
import MainStage from './components/main/MainStage.vue';
import AppAudioModal from './components/modals/AppAudioModal.vue';
import ChatPanel from './components/chat/ChatPanel.vue';
import {
  initLegacyDom,
  joinRoom,
  createChannel,
  switchChannel,
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
} from './app/runtime.js';

// App.vue 只负责页面骨架和事件转发。
// 具体业务统一进入 app/runtime.js；不要在这里直接调用 LiveKit、Tauri 或 AudioWorklet。
onMounted(async () => {
  await nextTick();
  initLegacyDom();
});
</script>

<template>
  <div class="app-shell">
    <aside class="server-rail" aria-label="服务器栏">
      <button class="server-pill active" title="DoNiChannel">豆</button>
      <button class="server-pill muted" title="添加服务器">+</button>
      <div class="server-rail-spacer"></div>
      <button class="server-pill muted" title="设置">⚙</button>
    </aside>

    <SidebarPanel
      @join-room="joinRoom"
      @create-channel="createChannel"
      @switch-channel="switchChannel"
      @switch-mic="switchMic"
      @switch-output="switchAudioOutput"
      @toggle-mic="toggleMic"
      @toggle-monitor="toggleMicMonitor"
      @toggle-screen="toggleScreen"
      @app-audio-click="handleAppAudioClick"
      @leave="leaveRoom"
    />

    <MainStage />

    <ChatPanel @send="sendChatMessage" />

    <AppAudioModal
      @close="closeAppAudioModal"
      @confirm="confirmAppAudioSelection"
    />
  </div>
</template>
