<script setup>
// 语言切换器：原生 select，跟随 vue-i18n，选择后写入 localStorage
import { useI18n } from 'vue-i18n'
import { LOCALES, setLocale } from '../i18n'

const { locale } = useI18n()
/** @param {Event} event */
function changeLocale(event) {
  if (event.target instanceof HTMLSelectElement) setLocale(event.target.value)
}
</script>

<template>
  <select
    :value="locale"
    :aria-label="$t('lang.label')"
    @change="changeLocale"
    class="cursor-pointer appearance-none rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
  </select>
</template>
