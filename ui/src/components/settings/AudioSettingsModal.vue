<script setup>
defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['close', 'switch-mic', 'switch-output']);
</script>

<template>
  <!--
    音频设置面板始终挂载，只通过 hidden 控制显示。
    这样 runtime.initLegacyDom() 能稳定找到 mic-select、audio-output-select 和 VAD 滑块。 -->
  <div
    class="modal audio-settings-modal"
    :class="{ hidden: !open }"
    @click.self="$emit('close')"
  >
    <section class="modal-card settings-card">
      <header class="modal-header settings-header">
        <div>
          <div class="modal-title">音频设置</div>
          <div class="settings-subtitle">麦克风、扬声器、收音阈值和增益</div>
        </div>
        <button class="modal-close" title="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="settings-body">
        <section class="settings-section">
          <div class="settings-section-title">输入 / 输出设备</div>
          <label class="settings-field">
            <span>麦克风</span>
            <select
              id="mic-select"
              disabled
              @change="$emit('switch-mic', $event.target.value)"
            >
              <option value="">等待权限...</option>
            </select>
          </label>

          <label class="settings-field">
            <span>扬声器</span>
            <select
              id="audio-output-select"
              disabled
              @change="$emit('switch-output', $event.target.value)"
            >
              <option value="default">默认扬声器</option>
            </select>
          </label>
        </section>

        <section class="settings-section">
          <div class="settings-section-title">Rust 麦克风处理</div>

          <div id="vad-module" class="vad-container settings-vad-block">
            <div class="vad-header">
              <span>收音阈值（点击监听预览）</span>
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

            <div class="vad-header vad-boost-header">
              <span>麦克风增益（默认 5.0）</span>
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
          </div>
        </section>

        <section class="settings-section settings-note">
          <div class="settings-section-title">说明</div>
          <p>收音阈值用于控制静音门限，低于阈值的环境声会被压低。</p>
          <p>麦克风增益在 Rust 侧处理，当前默认值为 5.0x。</p>
          <p>如果扬声器切换失败，通常是系统或 WebView 不支持指定输出设备。</p>
        </section>
      </div>
    </section>
  </div>
</template>
