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
} from '../../stores/profileStore.js';
</script>

<template>
  <section class="settings-section profile-settings-panel">
    <div class="settings-section-title">我的资料</div>

    <div class="profile-preview-card">
      <BaseAvatar
        :name="profileStore.displayName || 'rain'"
        :color="profileStore.avatarColor"
        :preset="profileStore.avatarPreset"
        size="xl"
        online
      />
      <div class="profile-preview-text">
        <div class="profile-preview-name">{{ profileStore.displayName || '未命名用户' }}</div>
        <div class="profile-preview-subtitle">资料会保存在本机，下次打开自动恢复。</div>
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
