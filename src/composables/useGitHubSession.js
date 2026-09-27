import { onMounted, onUnmounted, ref } from 'vue';

const user = ref(null);
const loading = ref(true);
const loginEnabled = ref(false);
const authError = ref(false);
let pending;
let listeners = 0;
let channel;
async function refresh() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch('/api/pig-king/auth/session', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('offline');
      const data = await response.json();
      user.value = data.user; loginEnabled.value = data.loginEnabled; authError.value = false;
    } catch { authError.value = true; }
    finally { loading.value = false; pending = null; }
  })();
  return pending;
}
async function logout() {
  const response = await fetch('/api/pig-king/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok && response.status !== 401) throw new Error('offline');
  // Finish any older session read before publishing the signed-out state.
  if (pending) await pending;
  user.value = null;
  channel?.postMessage('changed');
}
function login(returnTo = window.location.pathname) {
  window.location.assign('/api/pig-king/auth/login?returnTo=' + encodeURIComponent(returnTo));
}
export function useGitHubSession() {
  onMounted(() => {
    if (!listeners++) {
      window.addEventListener('focus', refresh);
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('lavamilk-session');
        channel.onmessage = () => refresh();
      }
    }
    refresh();
  });
  onUnmounted(() => {
    if (!--listeners) { window.removeEventListener('focus', refresh); channel?.close(); channel = null; }
  });
  return { user, loading, loginEnabled, authError, refresh, login, logout };
}
