<script setup>
import { computed } from 'vue';
import { appStore } from '../../stores/appStore.js';
import { presenceStore } from '../../stores/presenceStore.js';

const emit = defineEmits(['switch-channel']);

/**
 * 频道列表 Vue 渲染层。
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

function handleSwitchChannel(channel) {
  const channelName = getChannelName(channel);
  if (!channelName) return;
  emit('switch-channel', channelName);
}
</script>

<template>
  <div id="channel-list">
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
        # {{ getChannelName(channel) }}
      </button>

      <div
        class="channel-participants"
        :class="{ empty: getMembers(channel).length === 0 }"
      >
        <template v-if="getMembers(channel).length > 0">
          <span
            v-for="(member, index) in getMembers(channel)"
            :key="getMemberKey(member, index)"
            class="channel-member-name"
          >
            {{ getMemberName(member) }}<span v-if="index < getMembers(channel).length - 1">、</span>
          </span>
        </template>
        <template v-else>
          暂无在线成员
        </template>
      </div>
    </div>
  </div>
</template>
