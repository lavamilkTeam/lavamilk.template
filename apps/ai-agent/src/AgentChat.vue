<script setup>
// Dashboard and prompt composition adapted from nuxt-ui-templates/chat-vue (MIT).
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { session, send } from './api.js';
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
/** @type {import('vue').Ref<{role: string, content: string}[]>} */
const messages = ref([]);
/** @type {import('vue').Ref<{login: string} | null>} */
const user = ref(null);
const model = ref('');
const loginEnabled = ref(false);
const checking = ref(true);
const pending = ref(false);
const error = ref('');
const truncated = ref(false);
/** @type {AbortController | null} */
let controller = null;
/** @type {BroadcastChannel | null} */
let authChannel = null;
const ready = computed(() => !!user.value && !!model.value && !checking.value);
const status = computed(() => checking.value ? label('正在连接…', 'Connecting…') :
  !user.value ? label('登录 GitHub 后开始对话。', 'Sign in with GitHub to start chatting.') :
  !model.value ? label('模型暂不可用。', 'The model is unavailable.') :
  pending.value ? label('Gemma 正在思考…', 'Gemma is thinking…') :
  label('对话仅保留在当前页面，刷新后清空。', 'Conversations stay on this page and clear on reload.'));
async function loadSession() {
  try {
    const data = await session();
    if (user.value && user.value.login !== data.user?.login) newChat();
    user.value = data.user; model.value = data.model || ''; loginEnabled.value = data.loginEnabled;
  } catch { error.value = label('连接失败，请重试。', 'Connection failed. Please retry.'); }
  finally { checking.value = false; }
}
function stop() { controller?.abort(); }
function newChat() {
  stop(); controller = null; pending.value = false;
  input.value = ''; messages.value = []; error.value = ''; truncated.value = false; sidebarOpen.value = false;
}
async function submit() {
  if (!ready.value || pending.value || !input.value.trim()) return;
  const text = input.value.trim();
  const history = [...messages.value, { role: 'user', content: text }];
  if (text.length > 6000 || history.length > 21 || history.reduce((n, m) => n + m.content.length, 0) > 12000) {
    error.value = label('内容过长，请缩短问题或新建对话。', 'This conversation is too long. Shorten your prompt or start a new chat.'); return;
  }
  const request = new AbortController(); controller = request;
  const previous = messages.value;
  messages.value = history; input.value = ''; error.value = ''; truncated.value = false; pending.value = true;
  try {
    const result = await send(history, request.signal);
    if (controller !== request) return;
    messages.value = [...history, { role: 'assistant', content: result.message }];
    truncated.value = result.truncated;
  } catch (e) {
    if (controller !== request) return;
    messages.value = previous; input.value = text;
    if (request.signal.aborted) return;
    const code = e instanceof Error ? e.message : 'offline';
    if (code === 'authRequired') { user.value = null; authChannel?.postMessage('changed'); }
    error.value = code === 'modelBusy' || code === 'rateLimit' ?
      label('模型正忙，请稍后重试。', 'The model is busy. Please retry shortly.') :
      code === 'authRequired' ? label('登录已过期，请重新登录。', 'Your session expired. Please sign in again.') :
      label('生成失败，问题已保留，可以重试。', 'Generation failed. Your prompt is preserved; you can retry.');
  } finally {
    if (controller === request) { pending.value = false; controller = null; }
  }
}
onMounted(() => {
  loadSession();
  window.addEventListener('focus', loadSession);
  if (typeof BroadcastChannel !== 'undefined') {
    authChannel = new BroadcastChannel('lavamilk-session');
    authChannel.onmessage = loadSession;
  }
});
onUnmounted(() => { stop(); window.removeEventListener('focus', loadSession); authChannel?.close(); });
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
            <p class="mt-4 text-sm text-dimmed">{{ messages.length ? label('当前对话', 'Current conversation') : label('还没有对话', 'No conversations yet') }}</p>
          </div>
        </template>
        <template #footer="{ collapsed }">
          <div class="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted">
            <UIcon name="i-lucide-user-round" class="size-5 shrink-0" />
            <span v-if="!collapsed">{{ user?.login || label('未登录', 'Not signed in') }}</span>
          </div>
        </template>
      </UDashboardSidebar>
      <div class="m-3 flex min-w-0 flex-1 overflow-hidden rounded-xl bg-default shadow-sm ring ring-default lg:ml-0">
        <UDashboardPanel id="agent-chat" class="min-h-0" :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <UDashboardNavbar :title="label('新对话', 'New conversation')" :ui="{ right: 'gap-2' }">
              <template #leading><UDashboardSidebarToggle /></template>
              <template #right>
                <UBadge color="neutral" variant="subtle">Gemma</UBadge>
                <UButton :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" color="neutral" variant="ghost" :aria-label="label('切换主题', 'Toggle theme')" @click="colorMode = dark ? 'light' : 'dark'" />
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <UContainer class="flex flex-1 flex-col justify-center gap-6 py-10 sm:gap-8">
              <div v-if="!messages.length">
                <div class="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UIcon name="i-lucide-sparkles" class="size-7" /></div>
                <h1 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">{{ label('今天，想一起做点什么？', 'What shall we work on today?') }}</h1>
              </div>
              <div v-if="messages.length" role="log" :aria-label="label('对话消息', 'Chat messages')" aria-live="polite" class="space-y-5">
                <article v-for="(message, index) in messages" :key="index" class="rounded-xl p-4" :class="message.role === 'user' ? 'bg-elevated' : 'bg-muted'">
                  <p class="mb-2 text-xs font-semibold text-muted">{{ message.role === 'user' ? (user?.login || label('你', 'You')) : 'Gemma' }}</p>
                  <p class="whitespace-pre-wrap break-words text-sm leading-relaxed text-highlighted [overflow-wrap:anywhere]">{{ message.content }}</p>
                </article>
              </div>
              <p v-if="truncated" class="text-xs text-muted">{{ label('回答达到长度上限，可以继续追问。', 'The reply reached its length limit. Ask a follow-up to continue.') }}</p>
              <UChatPrompt v-model="input" :disabled="pending" :autofocus="false" :placeholder="label('输入你的问题…', 'Ask anything…')" color="neutral" variant="subtle" :ui="{ base: 'px-1.5' }" @submit.prevent="submit">
                <template #footer>
                  <span class="flex items-center gap-1.5 text-xs text-muted"><UIcon name="i-lucide-box" class="size-4" />{{ model || 'Gemma' }}</span>
                  <UButton v-if="pending" type="button" icon="i-lucide-square" color="neutral" size="sm" :aria-label="label('停止生成', 'Stop generating')" @click="stop" />
                  <UButton v-else type="submit" :disabled="!ready || !input.trim()" icon="i-lucide-arrow-up" color="neutral" size="sm" :aria-label="label('发送', 'Send')" />
                </template>
              </UChatPrompt>
              <div v-if="!messages.length" class="flex flex-wrap gap-2">
                <UButton v-for="prompt in prompts" :key="prompt.text" :label="prompt.text" :icon="prompt.icon" color="neutral" variant="outline" size="sm" class="rounded-full" :disabled="pending" @click="input = prompt.text" />
              </div>
              <div v-if="!checking && !user && loginEnabled">
                <UButton to="/api/pig-king/auth/login?returnTo=/ai-agent" target="_top" color="neutral" :label="label('使用 GitHub 登录', 'Sign in with GitHub')" />
              </div>
              <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
              <UButton v-if="error && !pending" color="neutral" variant="outline" class="self-start" :label="label('重试', 'Retry')" @click="ready ? submit() : loadSession()" />
              <p role="status" class="text-xs leading-relaxed text-muted">{{ status }}</p>
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
