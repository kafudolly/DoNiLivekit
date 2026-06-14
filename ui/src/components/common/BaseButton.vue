<script setup>
defineProps({
  variant: {
    type: String,
    default: 'secondary',
  },
  size: {
    type: String,
    default: 'md',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
</script>

<template>
  <button
    class="base-button"
    :class="[`variant-${variant}`, `size-${size}`]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
