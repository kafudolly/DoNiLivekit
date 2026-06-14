<script setup>
import ChannelList from './ChannelList.vue';
import ParticipantList from './ParticipantList.vue';
import VadPanel from './VadPanel.vue';
import ControlDock from '../controls/ControlDock.vue';

defineEmits([
  'join-room',
  'create-channel',
  'switch-channel',
  'switch-mic',
  'switch-output',
  'toggle-mic',
  'toggle-monitor',
  'toggle-screen',
  'app-audio-click',
  'leave',
]);
</script>

<template>
  <aside id="sidebar" class="channel-sidebar">
    <header class="sidebar-server-header">
      <div class="server-title-block">
        <div class="server-name">DoNiChannel</div>
        <div class="server-subtitle">局域网语音大厅</div>
      </div>
      <button class="server-header-btn" title="服务器菜单">⌄</button>
    </header>

    <div class="sidebar-scroll-area">
      <section id="login-section" class="login-card">
        <div class="section-label">连接信息</div>
        <input id="server-ip" type="text" placeholder="服务器IP:端口，例如 10.126.126.10:5000">
        <input id="username" type="text" placeholder="请输入你的开黑昵称...">
        <button id="btn-connect" class="primary-btn" @click="$emit('join-room')">进入大厅</button>
      </section>

      <section class="voice-channel-section">
        <div class="section-title-row channel-section-title">
          <div class="sidebar-title">语音频道</div>
          <button class="tiny-btn" title="创建频道" @click="$emit('create-channel')">+</button>
        </div>
        <ChannelList @switch-channel="$emit('switch-channel', $event)" />
      </section>

      <details class="sidebar-foldout members-foldout" open>
        <summary>
          <span>当前频道成员</span>
          <span class="summary-count" id="user-count">0</span>
        </summary>
        <ParticipantList />
      </details>

      <details class="sidebar-foldout audio-foldout">
        <summary>
          <span>音频设置</span>
          <span class="summary-hint">阈值 / 增益</span>
        </summary>
        <VadPanel />
      </details>
    </div>

    <ControlDock
      @switch-mic="$emit('switch-mic', $event)"
      @switch-output="$emit('switch-output', $event)"
      @toggle-mic="$emit('toggle-mic')"
      @toggle-monitor="$emit('toggle-monitor')"
      @toggle-screen="$emit('toggle-screen')"
      @app-audio-click="$emit('app-audio-click')"
      @leave="$emit('leave')"
    />
  </aside>
</template>
