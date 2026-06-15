<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import BaseAvatar from '../common/BaseAvatar.vue';
import {
  avatarColors,
  avatarPresets,
  loadAvatarHistory,
  profileStore,
  resetProfile,
  selectAvatarHistory,
  updateAvatarColor,
  updateAvatarPreset,
  updateDisplayName,
  updateStatusText,
  uploadAvatarImage,
} from '../../stores/profileStore.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const CROP_VIEW_SIZE = 280;
const OUTPUT_SIZE = 512;

const fileInput = ref(null);
const cropImage = ref(null);
const isUploading = ref(false);
const cropModalOpen = ref(false);
const cropObjectUrl = ref('');
const cropFile = ref(null);
const cropScale = ref(1);
const cropOffset = reactive({ x: 0, y: 0 });
const dragState = reactive({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
const cropInfo = reactive({ naturalWidth: 1, naturalHeight: 1, baseScale: 1 });

const historyItems = computed(() => Array.isArray(profileStore.avatarHistory) ? profileStore.avatarHistory : []);
const isGifUpload = (file) => file?.type === 'image/gif' || String(file?.name || '').toLowerCase().endsWith('.gif');

const triggerUpload = () => {
  if (fileInput.value) fileInput.value.click();
};

function revokeCropUrl() {
  if (cropObjectUrl.value) {
    URL.revokeObjectURL(cropObjectUrl.value);
    cropObjectUrl.value = '';
  }
}

function resetCropState() {
  cropScale.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
  dragState.active = false;
  cropInfo.naturalWidth = 1;
  cropInfo.naturalHeight = 1;
  cropInfo.baseScale = 1;
}

function clampCropOffset() {
  const scaledWidth = cropInfo.naturalWidth * cropInfo.baseScale * cropScale.value;
  const scaledHeight = cropInfo.naturalHeight * cropInfo.baseScale * cropScale.value;
  const maxX = Math.max(0, (scaledWidth - CROP_VIEW_SIZE) / 2);
  const maxY = Math.max(0, (scaledHeight - CROP_VIEW_SIZE) / 2);
  cropOffset.x = Math.max(-maxX, Math.min(maxX, cropOffset.x));
  cropOffset.y = Math.max(-maxY, Math.min(maxY, cropOffset.y));
}

const cropImageStyle = computed(() => {
  const width = cropInfo.naturalWidth * cropInfo.baseScale;
  const height = cropInfo.naturalHeight * cropInfo.baseScale;
  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px)) scale(${cropScale.value})`,
  };
});

const onCropImageLoad = () => {
  const img = cropImage.value;
  if (!img) return;
  cropInfo.naturalWidth = img.naturalWidth || 1;
  cropInfo.naturalHeight = img.naturalHeight || 1;
  cropInfo.baseScale = Math.max(
    CROP_VIEW_SIZE / cropInfo.naturalWidth,
    CROP_VIEW_SIZE / cropInfo.naturalHeight,
  );
  cropScale.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
  clampCropOffset();
};

const onScaleInput = (event) => {
  cropScale.value = Number(event.target.value || 1);
  clampCropOffset();
};

const onPointerDown = (event) => {
  event.preventDefault();
  dragState.active = true;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.originX = cropOffset.x;
  dragState.originY = cropOffset.y;
  event.currentTarget.setPointerCapture?.(event.pointerId);
};

const onPointerMove = (event) => {
  if (!dragState.active) return;
  cropOffset.x = dragState.originX + (event.clientX - dragState.startX);
  cropOffset.y = dragState.originY + (event.clientY - dragState.startY);
  clampCropOffset();
};

const onPointerUp = (event) => {
  dragState.active = false;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
};

function openCropModal(file) {
  revokeCropUrl();
  resetCropState();
  cropFile.value = file;
  cropObjectUrl.value = URL.createObjectURL(file);
  cropModalOpen.value = true;
}

function closeCropModal() {
  cropModalOpen.value = false;
  cropFile.value = null;
  revokeCropUrl();
  resetCropState();
  if (fileInput.value) fileInput.value.value = '';
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('头像裁剪失败，浏览器没有生成图片数据'));
    }, type, quality);
  });
}

async function confirmCropUpload() {
  const img = cropImage.value;
  if (!img || !cropFile.value) return;

  isUploading.value = true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const scaledWidth = cropInfo.naturalWidth * cropInfo.baseScale * cropScale.value;
    const scaledHeight = cropInfo.naturalHeight * cropInfo.baseScale * cropScale.value;
    const left = (CROP_VIEW_SIZE - scaledWidth) / 2 + cropOffset.x;
    const top = (CROP_VIEW_SIZE - scaledHeight) / 2 + cropOffset.y;
    const ratio = OUTPUT_SIZE / CROP_VIEW_SIZE;

    ctx.drawImage(
      img,
      left * ratio,
      top * ratio,
      scaledWidth * ratio,
      scaledHeight * ratio,
    );

    const blob = await canvasToBlob(canvas, 'image/webp', 0.9);
    const file = new File([blob], `avatar-${Date.now()}.webp`, { type: 'image/webp' });
    await uploadAvatarImage(file);
    closeCropModal();
  } catch (error) {
    console.error('[AvatarCrop] 裁剪上传失败', error);
    alert('头像裁剪上传失败: ' + error.message);
  } finally {
    isUploading.value = false;
  }
}

const handleFileChange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    event.target.value = '';
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    alert('图片不能超过 10MB');
    event.target.value = '';
    return;
  }

  if (isGifUpload(file)) {
    // GIF 直接上传，保留动图。裁剪 GIF 会丢失动画帧，后续若需要可单独做 GIF 裁剪方案。
    isUploading.value = true;
    await uploadAvatarImage(file);
    isUploading.value = false;
    event.target.value = '';
    return;
  }

  openCropModal(file);
};

onMounted(() => {
  loadAvatarHistory();
});

onBeforeUnmount(() => {
  revokeCropUrl();
});
</script>

<template>
  <section class="settings-section profile-settings-panel">
    <div class="settings-section-title">我的资料</div>

    <div class="profile-preview-card">
      <div class="profile-avatar-wrapper" style="position: relative; display: inline-block;">
        <BaseAvatar
          :name="profileStore.displayName || 'rain'"
          :color="profileStore.avatarColor"
          :preset="profileStore.avatarPreset"
          :avatarUrl="profileStore.avatarUrl"
          size="xl"
          online
        />
        <button
          type="button"
          class="avatar-upload-btn"
          @click="triggerUpload"
          :disabled="isUploading"
          title="上传自定义头像"
        >
          📷
        </button>
        <input
          type="file"
          ref="fileInput"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style="display: none;"
          @change="handleFileChange"
        >
      </div>
      <div class="profile-preview-text">
        <div class="profile-preview-name">{{ profileStore.displayName || '未命名用户' }}</div>
        <div class="profile-preview-subtitle">资料会保存在本机和服务器，下次打开自动恢复。</div>
        <div v-if="isUploading" class="avatar-upload-hint">正在处理头像...</div>
      </div>
    </div>

    <label class="settings-field profile-field">
      <span>显示名</span>
      <input
        class="settings-text-input"
        type="text"
        maxlength="24"
        :value="profileStore.displayName"
        placeholder="输入你的昵称"
        @input="updateDisplayName($event.target.value)"
      >
    </label>

    <label class="settings-field profile-field">
      <span>状态文字</span>
      <input
        class="settings-text-input"
        type="text"
        maxlength="20"
        :value="profileStore.statusText"
        placeholder="在线"
        @input="updateStatusText($event.target.value)"
      >
    </label>

    <div v-if="historyItems.length" class="profile-choice-group">
      <div class="profile-choice-title">历史头像</div>
      <div class="avatar-history-grid">
        <button
          v-for="item in historyItems"
          :key="item.avatarUrl"
          type="button"
          class="avatar-history-btn"
          :class="{ active: profileStore.avatarUrl === item.avatarUrl }"
          @click="selectAvatarHistory(item.avatarUrl)"
          title="使用这个历史头像"
        >
          <BaseAvatar
            :name="profileStore.displayName || 'rain'"
            :color="profileStore.avatarColor"
            :preset="profileStore.avatarPreset"
            :avatarUrl="item.avatarUrl"
            size="md"
          />
        </button>
      </div>
    </div>

    <div class="profile-choice-group">
      <div class="profile-choice-title">头像样式</div>
      <div class="avatar-preset-grid">
        <button
          v-for="preset in avatarPresets"
          :key="preset"
          type="button"
          class="avatar-preset-btn"
          :class="{ active: profileStore.avatarPreset === preset }"
          @click="updateAvatarPreset(preset)"
        >
          {{ preset }}
        </button>
        <button
          type="button"
          class="avatar-preset-btn text-mode"
          :class="{ active: !profileStore.avatarPreset }"
          @click="updateAvatarPreset('')"
        >
          字母
        </button>
      </div>
    </div>

    <div class="profile-choice-group">
      <div class="profile-choice-title">头像颜色</div>
      <div class="avatar-color-grid">
        <button
          v-for="color in avatarColors"
          :key="color"
          type="button"
          class="avatar-color-btn"
          :class="{ active: profileStore.avatarColor === color }"
          :style="{ backgroundColor: color }"
          @click="updateAvatarColor(color)"
        />
      </div>
    </div>

    <button type="button" class="profile-reset-btn" @click="resetProfile">
      恢复默认资料
    </button>
  </section>

  <div v-if="cropModalOpen" class="avatar-crop-backdrop" @click.self="closeCropModal">
    <div class="avatar-crop-modal">
      <div class="avatar-crop-title">裁剪头像</div>
      <div
        class="avatar-crop-frame"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <img
          ref="cropImage"
          :src="cropObjectUrl"
          class="avatar-crop-image"
          :style="cropImageStyle"
          draggable="false"
          @load="onCropImageLoad"
        >
        <div class="avatar-crop-mask"></div>
      </div>
      <label class="avatar-crop-slider">
        <span>缩放</span>
        <input type="range" min="1" max="3" step="0.01" :value="cropScale" @input="onScaleInput">
      </label>
      <div class="avatar-crop-tip">拖动图片选择区域，确认后会生成 512×512 WebP 小图。</div>
      <div class="avatar-crop-actions">
        <button type="button" class="profile-reset-btn" @click="closeCropModal" :disabled="isUploading">取消</button>
        <button type="button" class="profile-reset-btn primary" @click="confirmCropUpload" :disabled="isUploading">
          {{ isUploading ? '上传中...' : '确认上传' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.avatar-upload-btn {
  position: absolute;
  bottom: -5px;
  right: -5px;
  background: var(--bg-modifier-hover);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.avatar-upload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.avatar-upload-hint {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 4px;
}

.avatar-history-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.avatar-history-btn {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: rgba(255,255,255,0.04);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.avatar-history-btn.active {
  border-color: var(--brand, #5865f2);
  box-shadow: 0 0 0 2px rgba(88,101,242,0.25);
}

.avatar-crop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.58);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-crop-modal {
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 20px;
  border-radius: 18px;
  background: var(--bg-primary, #313338);
  color: var(--text-normal, #f2f3f5);
  box-shadow: 0 24px 80px rgba(0,0,0,0.45);
}

.avatar-crop-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 14px;
}

.avatar-crop-frame {
  position: relative;
  width: 280px;
  height: 280px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 22px;
  background: #111214;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.avatar-crop-frame:active {
  cursor: grabbing;
}

.avatar-crop-image {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center center;
  max-width: none;
  pointer-events: none;
  user-select: none;
}

.avatar-crop-mask {
  pointer-events: none;
  position: absolute;
  inset: 0;
  border-radius: 22px;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.85), inset 0 0 0 999px rgba(0,0,0,0.02);
}

.avatar-crop-slider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-muted, #b5bac1);
}

.avatar-crop-slider input {
  flex: 1;
}

.avatar-crop-tip {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-muted, #b5bac1);
  line-height: 1.5;
}

.avatar-crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.profile-reset-btn.primary {
  background: var(--brand, #5865f2);
  color: white;
}
</style>
