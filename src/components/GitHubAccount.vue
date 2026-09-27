<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGitHubSession } from '../composables/useGitHubSession.js';
const { t } = useI18n();
const { user, loading, loginEnabled, authError, refresh, login, logout } = useGitHubSession();
const failed = ref(false);
async function signOut() {
  failed.value = false;
  try { await logout(); } catch { failed.value = true; }
}
</script>

<template>
  <div class="relative text-[13px]">
    <details v-if="user">
      <summary class="max-w-28 cursor-pointer truncate rounded-md px-2 py-1.5 font-medium">{{ user.login }}</summary>
      <div class="absolute right-0 top-full z-50 mt-2 min-w-36 rounded-md border border-border bg-card p-2 shadow-md">
        <button class="w-full cursor-pointer rounded px-2 py-2 text-left hover:bg-muted" @click="signOut">{{ t('pig.logout') }}</button>
        <p v-if="failed" role="alert" class="px-2 py-1">{{ t('pig.errors.offline') }}</p>
      </div>
    </details>
    <button v-else-if="authError" class="cursor-pointer rounded-md px-2 py-1.5" @click="refresh">{{ t('pig.refresh') }}</button>
    <button v-else type="button" class="cursor-pointer rounded-md px-2 py-1.5 font-medium text-muted-foreground hover:text-foreground disabled:opacity-50" :disabled="loading || !loginEnabled" @click="login()">{{ t('action.signIn') }}</button>
  </div>
</template>
