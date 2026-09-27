<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
const { locale, t } = useI18n();
const source = computed(() => '/ai-chat/?lang=' + (locale.value === 'en' ? 'en' : 'zh-CN'));
</script>

<template>
  <iframe :src="source" :title="t('nav.aiAgent')" class="agent-frame" />
</template>

<style scoped>
.agent-frame { display: block; width: 100%; height: calc(100dvh - 57px); min-height: 480px; border: 0; }
</style>
