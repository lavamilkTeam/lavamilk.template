<script setup>
// Dashboard and prompt composition adapted from nuxt-ui-templates/chat-vue (MIT).
import { computed, ref } from 'vue';
import { useColorMode } from '@vueuse/core';

const english = new URLSearchParams(window.location.search).get('lang') === 'en';
/** @param {string} zh @param {string} en */
const label = (zh, en) => english ? en : zh;
const sidebarOpen = ref(false);
const input = ref('');
const colorMode = useColorMode({ storageKey: 'lavamilk-agent-theme' });
const dark = computed(() => colorMode.value === 'dark');
const prompts = [
  { icon: 'i-lucide-code-2', text: label('帮我检查一段代码', 'Help me review some code') },
  { icon: 'i-lucide-lightbulb', text: label('把一个想法变成方案', 'Turn an idea into a plan') },
  { icon: 'i-lucide-file-text', text: label('总结一篇长文', 'Summarize a long article') },
  { icon: 'i-lucide-languages', text: label('帮我翻译和润色', 'Translate and polish my writing') },
];
function newChat() { input.value = ''; sidebarOpen.value = false; }
</script>

<template>
  <UApp :toaster="{ position: 'top-right' }">
    <UDashboardGroup unit="rem">
      <UDashboardSidebar v-model:open="sidebarOpen" :min-size="12" :default-size="16" collapsible resizable class="border-r-0 py-3">
        <template #header="{ collapsed }">
          <span v-if="!collapsed" class="flex items-center gap-2 font-semibold text-highlighted">
            <span class="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><UIcon name="i-lucide-sparkles" class="size-5" /></span>
            {{ label('AI智能体', 'AI Agents') }}
          </span>
          <UDashboardSidebarCollapse class="ms-auto" />
        </template>
        <template #default="{ collapsed }">
          <UButton :label="collapsed ? undefined : label('新建对话', 'New chat')" :aria-label="label('新建对话', 'New chat')" icon="i-lucide-circle-plus" color="neutral" variant="soft" class="w-full" @click="newChat" />
          <div v-if="!collapsed" class="mt-8 px-3">
            <p class="text-xs font-medium text-muted">{{ label('对话记录', 'Conversations') }}</p>
            <p class="mt-4 text-sm text-dimmed">{{ label('还没有对话', 'No conversations yet') }}</p>
          </div>
        </template>
        <template #footer="{ collapsed }">
          <div class="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted">
            <UIcon name="i-lucide-user-round" class="size-5 shrink-0" />
            <span v-if="!collapsed">{{ label('账户接入待配置', 'Account connection pending') }}</span>
          </div>
        </template>
      </UDashboardSidebar>
      <div class="m-3 flex min-w-0 flex-1 overflow-hidden rounded-xl bg-default shadow-sm ring ring-default lg:ml-0">
        <UDashboardPanel id="agent-chat" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <UDashboardNavbar :title="label('新对话', 'New conversation')" :ui="{ right: 'gap-2' }">
              <template #leading><UDashboardSidebarToggle /></template>
              <template #right>
                <UBadge color="neutral" variant="subtle">{{ label('预览', 'Preview') }}</UBadge>
                <UButton :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" color="neutral" variant="ghost" :aria-label="label('切换主题', 'Toggle theme')" @click="colorMode = dark ? 'light' : 'dark'" />
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <UContainer class="flex flex-1 flex-col justify-center gap-6 py-10 sm:gap-8">
              <div>
                <div class="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UIcon name="i-lucide-sparkles" class="size-7" /></div>
                <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">{{ label('今天，想一起做点什么？', 'What shall we work on today?') }}</h1>
              </div>
              <UChatPrompt v-model="input" :autofocus="false" :placeholder="label('输入你的问题…', 'Ask anything…')" color="neutral" variant="subtle" :ui="{ base: 'px-1.5' }" @submit.prevent>
                <template #footer>
                  <span class="flex items-center gap-1.5 text-xs text-muted"><UIcon name="i-lucide-box" class="size-4" />Codex API</span>
                  <UButton disabled icon="i-lucide-arrow-up" color="neutral" size="sm" :aria-label="label('模型接入待配置', 'Model connection pending')" />
                </template>
              </UChatPrompt>
              <div class="flex flex-wrap gap-2">
                <UButton v-for="prompt in prompts" :key="prompt.text" :label="prompt.text" :icon="prompt.icon" color="neutral" variant="outline" size="sm" class="rounded-full" @click="input = prompt.text" />
              </div>
              <p role="status" class="text-xs leading-relaxed text-muted">{{ label('模型接入待配置，暂时无法发送消息。', 'Model connection is pending. Sending messages is not available yet.') }}</p>
            </UContainer>
            <div class="pb-4 text-center text-[11px] text-dimmed">
              <a href="https://github.com/nuxt-ui-templates/chat-vue" target="_blank" rel="noopener noreferrer" class="hover:text-muted">Nuxt UI Chat</a> · Lavamilk
            </div>
          </template>
        </UDashboardPanel>
      </div>
    </UDashboardGroup>
  </UApp>
</template>
