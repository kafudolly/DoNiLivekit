<script setup>
import { computed } from 'vue';
import { getUserInitials } from '../../stores/profileStore.js';

const props = defineProps({
  name: {
    type: String,
    default: '',
  },
  color: {
    type: String,
    default: '#5865f2',
  },
  preset: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: 'md',
  },
  online: {
    type: Boolean,
    default: false,
  },
  muted: {
    type: Boolean,
    default: false,
  },
});

const text = computed(() => props.preset || getUserInitials(props.name));
</script>

<template>
  <span
    class="base-avatar"
    :class="[`size-${size}`, { online, muted }]"
    :style="{ '--avatar-color': color }"
    :title="name"
  >
    <span class="base-avatar-text">{{ text }}</span>
    <span v-if="online" class="base-avatar-status"></span>
  </span>
</template>
