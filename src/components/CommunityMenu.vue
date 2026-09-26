<script setup>
import { onMounted, onUnmounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

defineProps({ active: Boolean, mobile: Boolean, communityUrl: { type: String, default: '' } });
const { t } = useI18n();
const expanded = ref(false);
const root = ref(null);
const trigger = ref(null);
const panelId = useId();

function closeOutside(event) {
  if (!root.value?.contains(event.target)) expanded.value = false;
}

function leaveMenu(event) {
  if (!root.value?.contains(event.relatedTarget)) expanded.value = false;
}

function escapeMenu() {
  if (!expanded.value) return;
  expanded.value = false;
  trigger.value?.focus();
}

onMounted(() => document.addEventListener('pointerdown', closeOutside));
onUnmounted(() => document.removeEventListener('pointerdown', closeOutside));
</script>

<template>
  <div ref="root" class="community-menu" :class="{ 'community-menu-mobile': mobile }" @focusout="leaveMenu" @keydown.esc.stop.prevent="escapeMenu">
    <button ref="trigger" type="button" class="community-trigger" :class="{ 'community-active': active }" :aria-expanded="expanded" :aria-controls="panelId" @click="expanded = !expanded">
      {{ t('nav.community') }}
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" :class="{ 'community-chevron-open': expanded }"><path d="m4.5 6 3.5 3.5L11.5 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <div v-if="expanded" :id="panelId" class="community-panel">
      <RouterLink :to="{ name: 'pig-king' }" class="community-option" @click="expanded = false">{{ t('nav.pigKing') }}</RouterLink>
      <a v-if="communityUrl" :href="communityUrl" class="community-option" target="_blank" rel="noopener noreferrer" @click="expanded = false">{{ t('nav.lavapiggy') }}</a>
      <button v-else type="button" class="community-option" disabled>{{ t('nav.lavapiggy') }}</button>
    </div>
  </div>
</template>

<style scoped>
.community-menu { position: relative; }
.community-trigger { display: flex; align-items: center; gap: 5px; padding: 6px 0; cursor: pointer; color: var(--muted-foreground); font-size: 13px; transition: color 150ms; }
.community-trigger:hover, .community-active { color: var(--foreground); }
.community-trigger svg { width: 14px; height: 14px; transition: transform 150ms; }
.community-chevron-open { transform: rotate(180deg); }
.community-panel { position: absolute; top: calc(100% + 9px); left: -12px; z-index: 40; min-width: 196px; padding: 5px; border: 1px solid var(--border); border-radius: 9px; background: var(--card); box-shadow: var(--shadow-md); }
.community-option { display: block; width: 100%; padding: 10px 12px; border-radius: 5px; color: var(--foreground); text-align: left; font-size: 13px; white-space: nowrap; cursor: pointer; }
.community-option:hover, .community-option[aria-current='page'] { background: var(--muted); }
.community-option:disabled { color: var(--muted-foreground); cursor: default; }
.community-menu :is(button, a):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.community-menu-mobile .community-trigger { width: 100%; justify-content: space-between; padding: 8px; border-radius: 6px; font-size: 14px; }
.community-menu-mobile .community-trigger:hover { background: var(--muted); }
.community-menu-mobile .community-panel { position: static; margin: 4px 8px 8px; min-width: 0; box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .community-trigger, .community-trigger svg { transition: none; } }
</style>
