<script setup>
// Dashboard and prompt composition adapted from nuxt-ui-templates/chat-vue (MIT).
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import * as api from './api.js';
const ChatMarkdown = defineAsyncComponent(() => import('./ChatMarkdown.vue'));
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
const turns = ref(/** @type {api.Turn[]} */ ([]));
const messages = computed(() => turns.value.flatMap(turn => turn.messages));
/** @type {import('vue').Ref<HTMLElement | null>} */
const transcript = ref(null);
const followLatest = ref(true);
function trackScroll() {
  const el = transcript.value;
  if (el) followLatest.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
}
watch(() => messages.value.length, async () => {
  const follow = followLatest.value;
  await nextTick();
  const el = transcript.value;
  if (!el) return;
  if (!messages.value.length) { el.scrollTop = 0; followLatest.value = true; }
  else if (follow) el.querySelector('article:last-of-type')?.scrollIntoView({ block: 'start' });
});
/** @type {import('vue').Ref<{id:string,login:string} | null>} */
const user = ref(null);
const model = ref('');
const loginEnabled = ref(false);
const checking = ref(true);
const submitting = ref(false);
const error = ref('');
const conversations = ref(/** @type {api.Conversation[]} */ ([]));
const selected = ref(/** @type {api.Conversation|null} */ (null));
const before = ref(/** @type {string|null} */ (null));
const listCursor = ref(/** @type {string|null} */ (null));
const archived = ref(false);
const titleDraft = ref('');
const editingTitle = ref(false);
const deleting = ref(false);
const profileOpen = ref(false);
const displayName = ref('');
const githubName = ref('');
const bio = ref('');
const activeTurn = computed(() => turns.value.find(turn => ['pending','running'].includes(turn.status)));
const failedTurn = computed(() => ['failed','cancelled'].includes(turns.value.at(-1)?.status || '') ? turns.value.at(-1) : null);
const pending = computed(() => submitting.value || !!activeTurn.value);
const truncated = computed(() => turns.value.at(-1)?.finishReason === 'length');
let generation = 0, sessionGeneration = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let poll = null;
/** @type {{id:string,content:string}|null} */
let draftRequest = null;
/** @type {BroadcastChannel | null} */
let authChannel = null;
const ready = computed(() => !!user.value && !!model.value && !checking.value && selected.value?.state !== 'archived');
const status = computed(() => checking.value ? label('正在连接…', 'Connecting…') :
  !user.value ? label('登录 GitHub 后开始对话。', 'Sign in with GitHub to start chatting.') :
  !model.value ? label('模型暂不可用。', 'The model is unavailable.') :
  pending.value ? label('正在生成，刷新后仍可查看进度。', 'Generating. You can reload without losing progress.') :
  label('对话已保存在你的账户中。', 'Conversations are saved to your account.'));
/** @param {unknown} cause */
function showError(cause) {
  const code = cause instanceof Error ? cause.message : 'offline';
  if (code === 'authRequired') { user.value=null; reset(); conversations.value=[]; authChannel?.postMessage('changed'); }
  error.value = code === 'modelBusy' || code === 'rateLimit' || code === 'conversationBusy' ?
    label('生成服务忙或已有对话正在生成，请稍后重试。', 'Generation is busy or another conversation is running. Please retry shortly.') :
    code === 'conflict' ? label('记录已更新，请刷新后重试。', 'This conversation changed. Refresh and retry.') :
    code === 'authRequired' ? label('登录已过期，请重新登录。', 'Your session expired. Please sign in again.') :
    label('操作失败，已保存的记录不会丢失，请重试。', 'The request failed. Saved messages are safe; please retry.');
}
function reset() {
  generation++; if (poll) clearTimeout(poll); poll=null;
  selected.value=null; turns.value=[]; before.value=null; submitting.value=false;
  input.value=''; error.value=''; draftRequest=null; editingTitle.value=false; deleting.value=false; sidebarOpen.value=false;
  profileOpen.value=false; displayName.value=''; githubName.value=''; bio.value='';
}
function newChat() {
  if (user.value) localStorage.removeItem('lavamilk-chat-selected:'+user.value.id);
  reset();
}
async function refreshList(more = false) {
  const version=generation;
  const data=await api.list(archived.value?'archived':'active',more?listCursor.value:null);
  if (version!==generation || !user.value) return;
  conversations.value=more?[...conversations.value,...(/** @type {api.Conversation[]} */ (data.items)).filter(item=>!conversations.value.some(old=>old.id===item.id))]:data.items;
  listCursor.value=data.cursor;
}
async function refreshCurrent() {
  if (!selected.value || !user.value) return;
  const id=selected.value.id, version=generation;
  try {
    const data=await api.history(id);
    if (version!==generation) return;
    const oldest=turns.value[0]?.turnNo;
    const older=turns.value.filter(turn=>BigInt(turn.turnNo)<BigInt(data.items[0]?.turnNo || '0'));
    turns.value=[...older,...data.items]; selected.value=data.conversation;
    if (!oldest || !older.length) before.value=data.before;
  } catch (cause) {
    if (version!==generation) return;
    if (cause instanceof Error && cause.message==='notFound') { newChat(); await refreshList(); return; }
    showError(cause);
  } finally {
    if (version===generation && user.value && selected.value) {
      if (poll) clearTimeout(poll);
      poll=setTimeout(refreshCurrent,activeTurn.value?1000:5000);
    }
  }
}
/** @param {api.Conversation} conversation */
async function openConversation(conversation) {
  reset(); selected.value=conversation;
  if (user.value) localStorage.setItem('lavamilk-chat-selected:'+user.value.id,conversation.id);
  await refreshCurrent();
}
async function olderMessages() {
  if (!selected.value || !before.value) return;
  const version=generation;
  try {
    const data=await api.history(selected.value.id,before.value);
    if (version!==generation) return;
    followLatest.value=false;
    turns.value=[...(/** @type {api.Turn[]} */ (data.items)).filter(turn=>!turns.value.some(old=>old.id===turn.id)),...turns.value]; before.value=data.before;
  } catch (cause) { if(version===generation)showError(cause); }
}
async function loadSession() {
  const version=++sessionGeneration;
  try {
    const data=await api.session();
    if (version!==sessionGeneration) return;
    const changed=user.value?.id!==data.user?.id;
    if (changed) { reset(); conversations.value=[]; }
    user.value=data.user; model.value=data.model || ''; loginEnabled.value=data.loginEnabled;
    if (user.value) {
      await refreshList();
      if (version!==sessionGeneration) return;
      if (!selected.value) {
        const saved=localStorage.getItem('lavamilk-chat-selected:'+user.value.id);
        if (saved) await openConversation(conversations.value.find(c=>c.id===saved) || {id:saved,title:'',state:'active',revision:'1',updatedAt:''});
      } else await refreshCurrent();
    }
  } catch (cause) { if(version===sessionGeneration) { user.value=null; reset(); conversations.value=[]; showError(cause); } }
  finally { if(version===sessionGeneration)checking.value=false; }
}
async function submit() {
  if (!ready.value || pending.value || !input.value.trim()) return;
  const text=input.value.trim();
  if (text.length>6000) {error.value=label('问题最多 6000 字符。','Prompts may contain at most 6000 characters.');return;}
  const version=generation;
  submitting.value=true; error.value=''; followLatest.value=true;
  try {
    if (!selected.value) {
      const id=crypto.randomUUID();
      const data=await api.create(id);
      if (version!==generation || !user.value) return;
      selected.value=data.conversation; localStorage.setItem('lavamilk-chat-selected:'+user.value.id,id);
    }
    if (!selected.value) return;
    if (!draftRequest || draftRequest.content!==text) draftRequest={id:crypto.randomUUID(),content:text};
    await api.send(selected.value.id,{content:text,clientRequestId:draftRequest.id});
    if (version!==generation) return;
    input.value=''; draftRequest=null;
    await refreshCurrent(); await refreshList();
  } catch (cause) { if(version===generation)showError(cause); }
  finally { if(version===generation)submitting.value=false; }
}
async function stop() {
  if (!selected.value || !activeTurn.value) return;
  const version=generation;
  try { await api.changeTurn(selected.value.id,activeTurn.value.id,'cancel'); if(version===generation)await refreshCurrent(); }
  catch (cause) { if(version===generation)showError(cause); }
}
async function retry() {
  if (failedTurn.value && selected.value) {
    const version=generation;
    try { await api.changeTurn(selected.value.id,failedTurn.value.id,'retry',failedTurn.value.attempt); if(version===generation){error.value='';await refreshCurrent();} }
    catch(cause){if(version===generation)showError(cause);}
  } else if (input.value.trim()) await submit();
  else await loadSession();
}
async function updateConversation(state = '') {
  if (!selected.value) return;
  const version=generation;
  try {
    const data=await api.edit(selected.value,state?{state}:{title:titleDraft.value.trim()});
    if(version!==generation)return;
    selected.value=data.conversation;editingTitle.value=false;await refreshList();
  } catch(cause){if(version===generation)showError(cause);}
}
async function deleteConversation() {
  if (!selected.value) return;
  const version=generation;
  try {await api.remove(selected.value.id);if(version===generation){newChat();await refreshList();}}
  catch(cause){if(version===generation)showError(cause);}
}
async function switchList() {
  archived.value=!archived.value;
  try {await refreshList();}catch(cause){showError(cause);}
}
async function openProfile() {
  const version=generation;
  try {const {profile}=await api.profile();if(version!==generation)return;
    displayName.value=profile.displayName || '';githubName.value=profile.name || '';bio.value=profile.bio || '';profileOpen.value=true;
  }catch(cause){if(version===generation)showError(cause);}
}
async function saveProfile() {
  const version=generation;
  try {await api.saveProfile({displayName:displayName.value,locale:english?'en':'zh-CN'});if(version===generation)profileOpen.value=false;}
  catch(cause){if(version===generation)showError(cause);}
}
onMounted(() => {
  loadSession(); window.addEventListener('focus',loadSession);
  if(typeof BroadcastChannel!=='undefined'){authChannel=new BroadcastChannel('lavamilk-session');authChannel.onmessage=loadSession;}
});
onUnmounted(()=>{sessionGeneration++;reset();window.removeEventListener('focus',loadSession);authChannel?.close();});

</script>

<template>
  <UApp :toaster="{ position: 'top-right' }">
    <UDashboardGroup unit="rem">
      <UDashboardSidebar v-model:open="sidebarOpen" :min-size="12" :default-size="16" collapsible resizable class="chat-sidebar bg-muted/40 py-3">
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
            <UButton color="neutral" variant="ghost" size="xs" class="mt-2" :label="archived ? label('查看活动对话','Show active') : label('查看归档','Show archived')" @click="switchList" />
            <p v-if="!conversations.length" class="mt-4 text-sm text-dimmed">{{ label('还没有对话','No conversations yet') }}</p>
            <button v-for="conversation in conversations" :key="conversation.id" type="button" class="mt-2 block w-full truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-muted" :class="{'bg-muted':selected?.id===conversation.id}" @click="openConversation(conversation)">{{ conversation.title }}</button>
            <UButton v-if="listCursor" color="neutral" variant="ghost" size="xs" :label="label('更多对话','More conversations')" @click="refreshList(true).catch(showError)" />
          </div>
        </template>
        <template #footer="{ collapsed }">
          <div class="flex items-center gap-2 rounded-lg px-2 py-3 text-sm text-muted">
            <UIcon name="i-lucide-user-round" class="size-5 shrink-0" />
            <button v-if="!collapsed" type="button" :disabled="!user" :aria-label="label('账户资料','Account profile')" @click="openProfile">{{ user?.login || label('未登录', 'Not signed in') }}</button>
          </div>
        </template>
      </UDashboardSidebar>
      <div class="flex min-w-0 flex-1 overflow-hidden bg-default">
        <UDashboardPanel id="agent-chat" class="min-h-0" :ui="{ body: 'min-h-0 flex-1 overflow-hidden p-0 sm:p-0' }">
          <template #header>
            <UDashboardNavbar :title="label('AI智能体', 'AI Agents')" class="chat-navbar" :ui="{ right: 'gap-2' }">
              <template #right>
                <template v-if="selected">
                  <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" :aria-label="label('重命名对话','Rename conversation')" @click="titleDraft=selected.title;editingTitle=!editingTitle" />
                  <UButton icon="i-lucide-archive" color="neutral" variant="ghost" :disabled="pending" :aria-label="selected.state==='archived'?label('恢复对话','Restore conversation'):label('归档对话','Archive conversation')" @click="updateConversation(selected.state==='archived'?'active':'archived')" />
                  <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" :aria-label="label('删除对话','Delete conversation')" @click="deleting=!deleting" />
                </template>
                <UBadge color="neutral" variant="subtle">Gemma</UBadge>
                <UButton :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" color="neutral" variant="ghost" :aria-label="label('切换主题', 'Toggle theme')" @click="colorMode = dark ? 'light' : 'dark'" />
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <div ref="transcript" class="conversation-scroll" @scroll.passive="trackScroll">
              <div class="conversation-content" :class="{ 'conversation-empty': !messages.length && !profileOpen && !editingTitle && !deleting }">
                <div v-if="profileOpen" class="mb-5 space-y-3">
                  <h2>{{ label('账户资料','Account profile') }}</h2><p>{{ githubName || user?.login }}</p><p class="text-sm text-muted">{{ bio }}</p>
                  <label class="block">{{ label('站内昵称','Display name') }}<input v-model="displayName" maxlength="80" class="mt-2 block w-full rounded border border-default px-3 py-2" /></label>
                  <UButton :label="label('保存资料','Save profile')" @click="saveProfile" /><UButton color="neutral" variant="ghost" :label="label('关闭','Close')" @click="profileOpen=false" />
                </div>
                <div v-if="editingTitle" class="mb-4 flex gap-2"><input v-model="titleDraft" maxlength="160" :aria-label="label('对话标题','Conversation title')" class="min-w-0 flex-1 rounded border border-default px-2" /><UButton :label="label('保存标题','Save title')" @click="updateConversation()" /></div>
                <div v-if="deleting" class="mb-4 flex flex-wrap items-center gap-2"><span>{{ label('删除后将从列表隐藏。','This conversation will be removed from your list.') }}</span><UButton color="error" :label="label('确认删除','Confirm delete')" @click="deleteConversation" /><UButton color="neutral" :label="label('取消','Cancel')" @click="deleting=false" /></div>
                <UButton v-if="before" color="neutral" variant="ghost" :label="label('加载更早消息','Load earlier messages')" @click="olderMessages" />
                <div v-if="!messages.length && !profileOpen" class="space-y-7">
                  <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">{{ label('今天，想一起做点什么？', 'What shall we work on today?') }}</h1>
                  <div class="flex flex-wrap gap-2">
                    <UButton v-for="prompt in prompts" :key="prompt.text" :label="prompt.text" :icon="prompt.icon" color="neutral" variant="outline" size="sm" class="rounded-full" @click="input = prompt.text" />
                  </div>
                </div>
                <div v-else-if="messages.length" role="log" :aria-label="label('对话消息', 'Chat messages')" aria-live="polite" class="conversation-messages">
                  <article v-for="message in messages" :key="message.id" :class="message.role === 'user' ? 'message-user' : 'message-assistant'" :aria-label="message.role === 'user' ? label('你', 'You') : 'Gemma'">
                    <p v-if="message.role === 'user'" class="user-text">{{ message.content }}</p>
                    <ChatMarkdown v-else :content="message.content" />
                  </article>
                </div>
                <div v-if="pending" class="flex items-center gap-2 py-5 text-sm text-muted" aria-hidden="true"><span class="thinking-dot" />{{ label('正在思考', 'Thinking') }}</div>
                <p v-if="truncated" class="mt-4 text-xs text-muted">{{ label('回答达到长度上限，可以继续追问。', 'The reply reached its length limit. Ask a follow-up to continue.') }}</p>
              </div>
            </div>
          </template>
          <template #footer>
            <div class="composer-divider">
              <div class="composer-dock">
                <div v-if="!checking && !user && loginEnabled" class="mb-3">
                  <UButton to="/api/pig-king/auth/login?returnTo=/ai-agent" target="_top" color="neutral" :label="label('使用 GitHub 登录', 'Sign in with GitHub')" />
                </div>
                <div v-if="error || failedTurn" class="mb-3 flex items-center gap-3">
                  <p role="alert" class="text-sm text-error">{{ error || (failedTurn?.status==='cancelled'?label('生成已停止，问题已保存。','Generation stopped. Your question is saved.'):label('生成失败，问题已保存，可重试。','Generation failed. Your question is saved; retry when ready.')) }}</p>
                  <UButton v-if="!pending" color="neutral" variant="ghost" size="sm" :label="label('重试', 'Retry')" @click="retry" />
                </div>
                <UChatPrompt v-model="input" class="chat-composer" :disabled="pending" :autofocus="false" :maxrows="6" :placeholder="label('输入你的问题…', 'Ask anything…')" color="neutral" variant="subtle" :ui="{ root: 'rounded-none bg-transparent ring-0 shadow-none', base: 'px-1.5' }" @submit.prevent="submit">
                  <template #footer>
                    <span class="flex items-center gap-1.5 text-xs text-muted"><UIcon name="i-lucide-sparkles" class="size-3.5" />{{ model || 'Gemma' }}</span>
                    <UButton v-if="pending" type="button" icon="i-lucide-square" color="neutral" size="sm" class="rounded-full" :aria-label="label('停止生成', 'Stop generating')" @click="stop" />
                    <UButton v-else type="submit" :disabled="!ready || !input.trim()" icon="i-lucide-arrow-up" color="neutral" size="sm" class="rounded-full" :aria-label="label('发送', 'Send')" />
                  </template>
                </UChatPrompt>
                <p role="status" class="mt-2 text-center text-[11px] leading-relaxed text-dimmed">{{ status }}</p>
              </div>
            </div>
          </template>
        </UDashboardPanel>
      </div>
    </UDashboardGroup>
  </UApp>
</template>

<style scoped>
.conversation-scroll { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable both-edges; }
.conversation-content { width: 100%; max-width: 800px; margin: 0 auto; padding: 28px 28px 48px; }
.conversation-empty { min-height: 100%; display: flex; align-items: center; padding-bottom: 12vh; }
.chat-sidebar { border-right: 1px solid var(--ui-border); box-shadow: 2px 0 5px rgb(0 0 0 / 3%); }
.chat-navbar { border-bottom: 1px solid var(--ui-border); box-shadow: 0 2px 5px rgb(0 0 0 / 3%); z-index: 1; }
.conversation-messages { display: flex; flex-direction: column; gap: 24px; }
.conversation-messages > article + article { position: relative; padding-top: 24px; }
.conversation-messages > article + article::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: var(--ui-border); box-shadow: 0 2px 4px rgb(0 0 0 / 4%); }
.message-user { display: flex; justify-content: flex-end; scroll-margin-top: 24px; }
.user-text { max-width: 85%; width: fit-content; margin: 0; padding: 0; background: transparent; font-size: 15px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-assistant { min-width: 0; color: var(--ui-text-highlighted); scroll-margin-top: 24px; }
.composer-divider { flex-shrink: 0; border-top: 1px solid var(--ui-border); box-shadow: 0 -2px 7px rgb(0 0 0 / 3%); background: var(--ui-bg); }
.composer-dock { flex-shrink: 0; width: 100%; max-width: 800px; margin: 0 auto; padding: 12px 28px 14px; background: var(--ui-bg); }
.chat-composer { border: 0; border-radius: 0; padding: 6px 0; background: transparent; box-shadow: none; }
.chat-composer:focus-within { box-shadow: none; }
.thinking-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: breathe 1.5s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: .3; } }
@media (max-width: 640px) {
  .conversation-content { padding: 20px 18px 32px; }
  .composer-dock { padding: 10px 16px 12px; }
  .conversation-messages { gap: 26px; }
  .user-text { max-width: 92%; }
}
@media (prefers-reduced-motion: reduce) { .thinking-dot { animation: none; } }
</style>
