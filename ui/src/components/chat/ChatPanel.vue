<script setup>
defineEmits(['send']);
</script>

<template>
  <!-- 保留 #chat-messages 作为 DataChannel 消息渲染容器；发送事件交给 chat.js 处理。 -->
  <aside id="chat-panel" class="chat-sidebar">
    <header class="chat-header">
      <div>
        <div class="chat-title">局域网聊天</div>
        <div class="chat-subtitle">当前语音频道内可见</div>
      </div>
    </header>

    <div id="chat-messages" class="chat-messages">
      <div class="chat-empty-state">
        <div class="chat-empty-icon">💬</div>
        <div class="chat-empty-title">欢迎来到聊天室</div>
        <div class="chat-empty-desc">发送第一条消息，和队友同步战术。</div>
      </div>
    </div>

    <div class="chat-input-area">
      <input id="chat-input" type="text" placeholder="输入消息..." disabled @keydown.enter="$emit('send')">
      <button id="btn-send" disabled @click="$emit('send')">发送</button>
    </div>
  </aside>
</template>
