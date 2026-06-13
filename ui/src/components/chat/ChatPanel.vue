<script setup>
defineEmits(['send']);
</script>

<template>
  <!-- 保留 #chat-messages 作为 DataChannel 消息渲染容器；发送事件交给 chat.js 处理。 -->
  <aside id="chat-panel">
    <div class="chat-header">💬 局域网聊天</div>
    <div id="chat-messages">
      <div style="font-size: 12px; color: #80848e; text-align: center; margin-top: 10px;">欢迎来到聊天室</div>
    </div>
    <div class="chat-input-area">
      <input id="chat-input" type="text" placeholder="输入消息..." disabled @keydown.enter="$emit('send')">
      <button id="btn-send" disabled @click="$emit('send')">发送</button>
    </div>
  </aside>
</template>
