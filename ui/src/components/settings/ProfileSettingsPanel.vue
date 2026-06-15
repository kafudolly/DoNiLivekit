<script setup>
import BaseAvatar from '../common/BaseAvatar.vue';
import {
  avatarColors,
  avatarPresets,
  profileStore,
  resetProfile,
  updateAvatarColor,
  updateAvatarPreset,
  updateDisplayName,
  updateStatusText,
  uploadAvatarImage,
} from '../../stores/profileStore.js';
import { ref } from 'vue';

const fileInput = ref(null);
const isUploading = ref(false);

const triggerUpload = () => {
  if (fileInput.value) {
    fileInput.value.click();
  }
};

const handleFileChange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  isUploading.value = true;
  await uploadAvatarImage(file);
  isUploading.value = false;
  
  // reset input so the same file can be uploaded again if needed
  if (fileInput.value) {
    fileInput.value.value = '';
  }
};
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
          style="position: absolute; bottom: -5px; right: -5px; background: var(--bg-modifier-hover); border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
          title="上传自定义头像"
        >
          📷
        </button>
        <input 
          type="file" 
          ref="fileInput" 
          accept="image/*" 
          style="display: none;"
          @change="handleFileChange"
        >
      </div>
      <div class="profile-preview-text">
        <div class="profile-preview-name">{{ profileStore.displayName || '未命名用户' }}</div>
        <div class="profile-preview-subtitle">资料会保存在本机，下次打开自动恢复。</div>
        <div v-if="isUploading" style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">正在上传...</div>
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
</template>
