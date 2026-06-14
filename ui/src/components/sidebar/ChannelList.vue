<script setup>
import { computed, reactive } from 'vue';
import { appStore } from '../../stores/appStore.js';
import { presenceStore } from '../../stores/presenceStore.js';
import {
  setParticipantVolume,
  getParticipantVolumePercent,
} from '../../app/runtime.js';

const emit = defineEmits(['switch-channel']);

/**
 * Discord 风格语音频道列表。
 *
 * 频道与频道成员只从 presenceStore 读取。
 * 成员音量控制直接调用 runtime 的远端音频 GainNode 控制逻辑。
 */
const fallbackChannels = [
  { id: 'day0', name: 'day0', type: 'voice', members: [] },
  { id: 'day1', name: 'day1', type: 'voice', members: [] },
  { id: 'day2', name: 'day2', type: 'voice', members: [] },
];

const channels = computed(() => {
  return presenceStore.channels.length > 0 ? presenceStore.channels : fallbackChannels;
});

const currentChannel = computed(() => appStore.connection.currentChannel || '');
const selfIdentity = computed(() => presenceStore.identity || '');
const selfDisplayName = computed(() => presenceStore.displayName || appStore.connection.username || '');

// 保存当前输入框显示值。实际音量仍由 runtime/userVolumes/localStorage 管理。
const volumeInputs = reactive({});

function getChannelId(channel) {
  return String(channel?.id || channel?.name || '').trim();
}

function getChannelName(channel) {
  return String(channel?.name || channel?.id || '').trim();
}

function getMembers(channel) {
  return Array.isArray(channel?.members) ? channel.members : [];
}

function getMemberIdentity(member) {
  if (!member) return '';
  if (typeof member === 'string') return member;
  return String(member.identity || member.name || member.displayName || '').trim();
}

function getMemberKey(member, index) {
  return getMemberIdentity(member) || `member-${index}`;
}

function getMemberName(member) {
  if (!member) return '';
  if (typeof member === 'string') return member;
  return String(member.displayName || member.name || member.identity || '').trim();
}

function getMemberInitial(member) {
  const name = getMemberName(member);
  return name ? name.slice(0, 1).toUpperCase() : '?';
}

function isSelf(member) {
  const identity = getMemberIdentity(member);
  const displayName = getMemberName(member);
  return Boolean(
    (selfIdentity.value && identity === selfIdentity.value) ||
    (selfDisplayName.value && displayName === selfDisplayName.value)
  );
}

function getVolumeCacheKey(member) {
  return getMemberName(member) || getMemberIdentity(member) || 'unknown';
}

function resolveSavedVolumePercent(member) {
  const identity = getMemberIdentity(member);
  const displayName = getMemberName(member);

  const identityPercent = identity ? getParticipantVolumePercent(identity, 'mic') : 100;
  const displayNamePercent = displayName && displayName !== identity
    ? getParticipantVolumePercent(displayName, 'mic')
    : identityPercent;

  // 新连接时 identity 可能变化；如果 displayName 有保存值，则优先用 displayName 恢复。
  if (displayNamePercent !== 100) return displayNamePercent;
  return identityPercent;
}

function getVolumeInputValue(member) {
  const cacheKey = getVolumeCacheKey(member);
  if (volumeInputs[cacheKey] === undefined) {
    volumeInputs[cacheKey] = String(resolveSavedVolumePercent(member));
  }
  return volumeInputs[cacheKey];
}

function clampVolumePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(Math.round(n), 300));
}

function applyMicVolume(member, value, { commit = true } = {}) {
  const identity = getMemberIdentity(member);
  const displayName = getMemberName(member);
  const cacheKey = getVolumeCacheKey(member);

  if (!identity || isSelf(member)) return;

  if (value === '') {
    volumeInputs[cacheKey] = '';
    return;
  }

  const percent = clampVolumePercent(value);
  if (percent === null) return;

  volumeInputs[cacheKey] = commit ? String(percent) : String(value);

  // 真实播放链路按 LiveKit identity 调整。
  setParticipantVolume(identity, 'mic', percent);

  // 额外按 displayName 存一份，用于对方重连、identity 变化后恢复上次音量。
  if (displayName && displayName !== identity) {
    setParticipantVolume(displayName, 'mic', percent);
  }
}

function handleMicVolumeInput(member, value) {
  applyMicVolume(member, value, { commit: false });
}

function commitMicVolume(member, value) {
  applyMicVolume(member, value, { commit: true });
}

function handleSwitchChannel(channel) {
  const channelName = getChannelName(channel);
  if (!channelName) return;
  emit('switch-channel', channelName);
}
</script>

<template>
  <div id="channel-list" class="voice-channel-list">
    <div
      v-for="channel in channels"
      :key="getChannelId(channel)"
      class="channel-row voice-channel-card"
      :class="{ active: currentChannel === getChannelName(channel) }"
    >
      <button
        type="button"
        class="channel-item voice-channel-button"
        :class="{ active: currentChannel === getChannelName(channel) }"
        @click="handleSwitchChannel(channel)"
      >
        <span class="channel-icon">🔊</span>
        <span class="channel-name">{{ getChannelName(channel) }}</span>
        <span class="channel-count">{{ getMembers(channel).length }}</span>
      </button>

      <div
        class="channel-participants voice-member-list"
        :class="{ empty: getMembers(channel).length === 0 }"
      >
        <template v-if="getMembers(channel).length > 0">
          <div
            v-for="(member, index) in getMembers(channel)"
            :key="getMemberKey(member, index)"
            class="voice-member-row"
            :class="{ self: isSelf(member) }"
          >
            <div class="voice-member-mainline">
              <span class="voice-member-avatar">{{ getMemberInitial(member) }}</span>
              <span class="voice-member-name">
                {{ getMemberName(member) }}<span v-if="isSelf(member)" class="self-tag">我</span>
              </span>
              <span class="voice-member-mic">🎙</span>
              <span class="voice-member-status" title="在线"></span>
            </div>

            <div v-if="!isSelf(member)" class="voice-member-volume-row">
              <span class="voice-member-volume-icon">🔉</span>
              <input
                class="voice-member-volume-slider"
                type="range"
                min="0"
                max="300"
                step="1"
                :value="getVolumeInputValue(member)"
                @input="handleMicVolumeInput(member, $event.target.value)"
              >
              <input
                class="voice-member-volume-number"
                type="number"
                min="0"
                max="300"
                step="1"
                :value="getVolumeInputValue(member)"
                @input="handleMicVolumeInput(member, $event.target.value)"
                @change="commitMicVolume(member, $event.target.value)"
                @blur="commitMicVolume(member, $event.target.value)"
              >
              <span class="voice-member-volume-unit">%</span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="voice-channel-empty">暂无成员</div>
        </template>
      </div>
    </div>
  </div>
</template>
