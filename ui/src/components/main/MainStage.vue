<template>
  <!-- 主舞台：LiveKit 远端媒体由 livekitEvents.js 挂载到 #video-container/#audio-container。 -->
  <main id="main-area">
    <div id="header"># 🎮 直播与共享大厅</div>
    <div id="video-container"></div>
    <div id="audio-container"></div>

    <div id="local-screen-preview-box">
      <div id="local-screen-preview-title">本地屏幕预览（静音）</div>
      <video id="local-screen-preview" muted autoplay playsinline></video>
    </div>
  </main>
</template>
