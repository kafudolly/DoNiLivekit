<template>
  <!-- 主舞台：LiveKit 远端媒体由 livekitEvents.js 挂载到 #video-container/#audio-container。 -->
  <main id="main-area" class="main-stage">
    <header id="header" class="main-header">
      <div class="main-header-title">
        <span class="main-header-icon">#</span>
        <span class="main-header-text">语音主舞台</span>
      </div>
      <div class="main-header-actions">
        <span class="main-header-pill">屏幕共享 / 语音 / 应用音频</span>
      </div>
    </header>

    <!-- 不再放大块提示卡片。没有屏幕共享时保持干净舞台，媒体元素会由 LiveKit 逻辑动态挂载。 -->
    <div id="video-container" class="stage-video-container"></div>

    <div id="audio-container"></div>

    <div id="local-screen-preview-box">
      <div id="local-screen-preview-title">本地屏幕预览（静音）</div>
      <video id="local-screen-preview" muted autoplay playsinline></video>
    </div>
  </main>
</template>
