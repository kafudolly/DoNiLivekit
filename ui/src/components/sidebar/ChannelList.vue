<script setup>
import { computed } from 'vue';
import { appStore } from '../../stores/appStore.js';
import { presenceStore } from '../../stores/presenceStore.js';

const emit = defineEmits(['switch-channel']);

/**
 * 语音频道列表。
 *
 * 频道和成员只从 presenceStore 读取。
 * 点击频道时只向上抛出 switch-channel，由 runtime/roomConnection 负责连接 LiveKit。
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

function getChannelId(channel) {
  return String(channel?.id || channel?.name || '').trim();
}

function getChannelName(channel) {
  return String(channel?.name || channel?.id || '').trim();
}

function getMembers(channel) {
  return Array.isArray(channel?.members) ? channel.members : [];
}

function getMemberKey(member, index) {
  if (typeof member === 'string') return `${member}-${index}`;
  return member?.identity || member?.displayName || `member-${index}`;
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

function handleSwitchChannel(channel) {
  const channelName = getChannelName(channel);
  if (!channelName) return;
  emit('switch-channel', channelName);
}
</script>

<template>
  <div id="channel-list" class="discord-channel-list">
    <div
      v-for="channel in channels"
      :key="getChannelId(channel)"
      class="channel-row"
    >
      <button
        type="button"
        class="channel-item"
        :class="{ active: currentChannel === getChannelName(channel) }"
        @click="handleSwitchChannel(channel)"
      >
        <span class="channel-icon">🔊</span>
        <span class="channel-name">{{ getChannelName(channel) }}</span>
        <span class="channel-member-count">{{ getMembers(channel).length }}</span>
      </button>

      <div
        class="channel-participants"
        :class="{ empty: getMembers(channel).length === 0 }"
      >
        <template v-if="getMembers(channel).length > 0">
          <button
            v-for="(member, index) in getMembers(channel)"
            :key="getMemberKey(member, index)"
            type="button"
            class="voice-member-item"
            title="语音频道成员"
          >
            <span class="voice-member-avatar">{{ getMemberInitial(member) }}</span>
            <span class="voice-member-name">{{ getMemberName(member) }}</span>
          </button>
        </template>
        <template v-else>
          <div class="voice-channel-empty">暂无成员</div>
        </template>
      </div>
    </div>
  </div>
</template>
