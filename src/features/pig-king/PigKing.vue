<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { getAccountLeaderboard, getAccountReport, scanAccount, getSession, loginGitHub, logoutGitHub } from './api.js';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const user = ref(null);
const authLoading = ref(true);
const loginEnabled = ref(false);
const loading = ref(false);
const error = ref('');
const report = ref(null);
const board = ref([]);
const boardLoading = ref(false);
const boardError = ref(false);
const selected = computed(() => report.value?.account);
const progress = ref({ phase: 'profile', repositories: 0, processed: 0 });
const aiSummary = computed(() => report.value?.ai?.[locale.value.startsWith('zh') ? 'zh' : 'en']);
const controller = new AbortController();
onUnmounted(() => controller.abort());
const sourceGroups = computed(() => report.value ? [
  { id: 'commits', title: 'Commits', items: (report.value.commits || []).map(c=>({title:c.commit.message.split('\n')[0],url:c.url})) },
  { id: 'prs', title: 'Pull requests', items: report.value.prs },
  { id: 'issues', title: 'Issues', items: report.value.issues },
] : []);
const icons = ['☾', '↻', '…', '↩'];
const knownErrors = ['invalidAccount', 'unsupportedAccount', 'tooLarge', 'notFound', 'rateLimit', 'github', 'offline', 'authRequired', 'forbidden', 'identityChanged', 'accountNotAllowed', 'authUnavailable', 'oauthFailed'];

async function refreshBoard() {
  boardLoading.value = true;
  boardError.value = false;
  try { board.value = await getAccountLeaderboard(); }
  catch (_) { boardError.value = true; }
  finally { boardLoading.value = false; }
}

async function scan() {
  if (loading.value || !user.value) return;
  loading.value = true;
  error.value = '';
  try {
    progress.value = { phase: 'profile', repositories: 0, processed: 0 };
    const data = await scanAccount(value => { progress.value = value; }, controller.signal);
    report.value = data.report;
    await refreshBoard();
  } catch (e) {
    if (e.message === 'authRequired') user.value = null;
    error.value = knownErrors.includes(e.message) ? e.message : 'offline';
  }
  finally { loading.value = false; }
}

async function showReport(item) {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await getAccountReport(item.account);
    report.value = data.report;
  } catch (_) { error.value = 'offline'; }
  finally { loading.value = false; }
}

async function refreshSession() {
  try { const session = await getSession(); user.value = session.user; loginEnabled.value = session.loginEnabled; }
  catch (_) { error.value = 'offline'; }
  finally { authLoading.value = false; }
}
async function logout() {
  try { await logoutGitHub(); user.value = null; report.value = null; }
  catch (_) { error.value = 'offline'; }
}
onMounted(() => {
  if (route.query.pig_auth) {
    const authError = String(route.query.pig_auth);
    error.value = knownErrors.includes(authError) ? authError : 'oauthFailed';
    const query = { ...route.query };
    delete query.pig_auth;
    router.replace({ query });
  }
  refreshSession(); refreshBoard();
});
</script>

<template>
  <div class="pig-page">
    <section class="pig-hero">
      <div class="pig-hero-copy">
        <h1>{{ t('pig.title') }}<br /><span>{{ t('pig.titleAccent') }}</span></h1>
      </div>
      <div class="pig-mascot" aria-hidden="true">
        <span class="pig-halo"></span>
        <img src="/emoji/noto-pig.svg" alt="" width="256" height="256" />
        <span class="pig-orbit orbit-b">{{ t('pig.mascot') }}</span>
      </div>
    </section>

    <section class="pig-workspace">
      <form class="pig-form" @submit.prevent="scan" :aria-busy="loading">
        <p v-if="authLoading" role="status" class="pig-hint">{{ t('pig.authLoading') }}</p>
        <div v-else-if="user" class="pig-input-row pig-identity">
          <img :src="user.avatar" alt="" width="44" height="44" />
          <strong>{{ user.login }}</strong>
          <button class="pig-primary" :disabled="loading" type="submit"><span v-if="loading" class="pig-spinner" aria-hidden="true"></span>{{ t(loading ? 'pig.scanning' : 'pig.scan') }}</button>
          <button type="button" class="pig-text-button" :disabled="loading" @click="logout">{{ t('pig.logout') }}</button>
        </div>
        <div v-else class="pig-input-row">
          <button class="pig-primary" type="button" :disabled="!loginEnabled" @click="loginGitHub">{{ t('pig.githubLogin') }}</button>
          <span v-if="!loginEnabled" class="pig-hint">{{ t('pig.errors.authUnavailable') }}</span>
        </div>
        <p v-if="loading" role="status" class="pig-hint">{{ t(`pig.progress.${progress.phase}`, { count: progress.repositories, processed: progress.processed || 0 }) }}</p>
        <p v-if="error" role="alert" class="pig-error">{{ t(`pig.errors.${error}`) }}</p>
      </form>

      <section v-if="report" class="pig-report" aria-live="polite">
        <div class="pig-report-top">
          <div><h2><a :href="`https://github.com/${report.account}`" target="_blank" rel="noopener noreferrer">{{ report.account }} ↗</a></h2></div>
          <div class="pig-score"><strong>{{ report.score }}</strong><span>/ 100</span></div>
        </div>
        <p v-if="!report.ranked" class="pig-unranked">{{ t('pig.unranked') }}</p>
        <div class="pig-account-stats">
          <div><strong>{{ report.repositoryStats.total }}</strong><span>{{ t('pig.repos') }}</span></div>
          <div><strong>{{ report.repositoryStats.stars }}</strong><span>Stars</span></div>
          <div><strong>{{ report.coverage.prs.total }}</strong><span>Pull requests</span></div>
          <div><strong>{{ report.coverage.issues.total }}</strong><span>Issues</span></div>
        </div>
        <p v-if="Object.values(report.coverage).some(value => value?.incomplete)" class="pig-unranked">{{ t('pig.incomplete') }}</p>
        <section class="pig-ai">
          <h3>{{ t('pig.aiTitle') }}</h3>
          <template v-if="report.ai.status === 'ready' && aiSummary">
            <h4>{{ aiSummary.title }}</h4>
            <p class="pig-ai-summary">{{ aiSummary.summary }}</p>
            <ul><li v-for="(highlight, index) in aiSummary.highlights" :key="index"><p>{{ highlight.text }}</p><a v-for="source in highlight.sources" :key="source.id" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.kind }} · {{ source.id }} ↗</a></li></ul>
          </template>
          <p v-else class="pig-hint">{{ t(report.ai.status === 'unconfigured' ? 'pig.aiUnconfigured' : 'pig.aiUnavailable') }}</p>
        </section>
        <div class="pig-metrics">
          <article v-for="(metric, i) in report.metrics" :key="metric.id">
            <span class="pig-metric-icon" aria-hidden="true">{{ icons[i] }}</span>
            <h3>{{ t(`pig.rules.${metric.id}.title`) }}</h3>
            <p><strong>{{ metric.points }}</strong> / {{ metric.weight }} <span class="pig-hint">· {{ t('pig.hits', { count: metric.count }) }}</span></p>
            <div class="pig-meter" :aria-label="`${metric.points} / ${metric.weight}`" role="img"><span :style="{ width: `${metric.points / metric.weight * 100}%` }"></span></div>
            <ul v-if="metric.evidence.length" class="pig-evidence"><li v-for="commit in metric.evidence" :key="commit.sha"><a :href="commit.url" target="_blank" rel="noopener noreferrer"><code>{{ commit.sha.slice(0, 7) }}</code> {{ commit.message }}</a></li></ul>
            <p v-else class="pig-hint">{{ t('pig.noHits') }}</p>
          </article>
        </div>
        <div class="pig-sources">
          <details>
            <summary>{{ t('pig.repoDetails', { count: report.repositoryStats.total }) }}</summary>
            <ul><li v-for="repository in report.repositories" :key="repository.name"><a :href="`https://github.com/${repository.name}`" target="_blank" rel="noopener noreferrer">{{ repository.name }} ↗</a><span>{{ repository.language || '—' }} · {{ repository.stars }} stars <template v-if="repository.fork">· Fork</template></span></li></ul>
          </details>
          <details v-for="group in sourceGroups" :key="group.id">
            <summary>{{ group.title }} · {{ group.items.length }}</summary>
            <ul v-if="group.items.length"><li v-for="item in group.items" :key="item.url"><a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }} ↗</a><span>{{ item.state }}<template v-if="item.merged"> · merged</template></span></li></ul>
            <p v-else class="pig-hint">{{ t('pig.noActivity') }}</p>
          </details>
        </div>
      </section>

      <div class="pig-bottom-grid">
        <section class="pig-board">
          <div class="pig-section-heading"><h2>♛ {{ t('pig.board') }}</h2><button type="button" class="pig-text-button" @click="refreshBoard" :disabled="boardLoading">{{ t('pig.refresh') }} ↻</button></div>
          <p class="pig-hint">{{ t('pig.boardScope') }}</p>
          <p v-if="boardLoading" role="status" class="pig-empty">{{ t('pig.boardLoading') }}</p>
          <div v-else-if="boardError" role="status" class="pig-empty">{{ t('pig.boardError') }}</div>
          <ol v-else-if="board.length" class="pig-rank-list">
            <li v-for="(item, i) in board" :key="item.account" :class="{ 'pig-selected': selected === item.account }">
              <span class="pig-rank">{{ String(i + 1).padStart(2, '0') }}</span>
              <button type="button" :disabled="loading" @click="showReport(item)"><strong>{{ item.account }}</strong><span>{{ t('pig.hits', { count: item.eligible }) }}</span></button>
              <strong class="pig-rank-score">{{ item.score }}</strong>
            </li>
          </ol>
          <div v-else class="pig-empty"><span aria-hidden="true">♛</span><h3>{{ t('pig.emptyTitle') }}</h3><p>{{ t('pig.emptyBoard') }}</p></div>
        </section>
        <section class="pig-meme">
          <h2>
            <span lang="zh-CN">猪才不管怎么评分呢</span>
            <span lang="en" class="pig-meme-english">Pigs don’t care how you score.</span>
          </h2>
          <img src="/images/pig-score-meme-hd.png" :alt="t('pig.scoreMemeAlt')" loading="lazy" />
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pig-identity { align-items: center; flex-wrap: wrap; }.pig-identity img { border-radius: 50%; }.pig-identity strong { margin-right: auto; }
.pig-page { --pig-ink: #482c3a; --pig-pink: #a93f60; color: var(--pig-ink); background: #fffcfa; }
.pig-account-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0 12px; }
.pig-account-stats > div { background: white; border: 1px solid #ecdee3; border-radius: 8px; padding: 14px; display: grid; gap: 4px; }
.pig-account-stats strong { font-size: 26px; }.pig-account-stats span { font-size: 11px; color: #796570; }
.pig-ai { margin: 24px 0; padding: 22px; border: 1px solid #e6ccd6; border-radius: 10px; background: #fff; }
.pig-ai h3 { font-size: 12px; color: #a93f60; font-weight: 700; }.pig-ai h4 { margin-top: 12px; font-size: 23px; font-weight: 750; }
.pig-ai-summary, .pig-ai li { margin-top: 14px; font-size: 14px; line-height: 1.9; white-space: pre-line; overflow-wrap: anywhere; }
.pig-ai li a { display: inline-block; margin-right: 12px; font-size: 11px; color: #a93f60; text-decoration: underline; }
.pig-sources { margin-top: 24px; }.pig-sources details { border-top: 1px solid #e8d8de; padding: 14px 0; }
.pig-sources summary { cursor: pointer; font-size: 13px; font-weight: 650; }.pig-sources ul { max-height: 300px; overflow: auto; margin-top: 12px; }
.pig-sources li { padding: 8px 0; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; overflow-wrap: anywhere; }
.pig-sources a { min-width: 0; }.pig-sources a:hover { text-decoration: underline; }.pig-sources li span { color: #796570; font-size: 11px; }
@media (max-width: 540px) { .pig-account-stats { grid-template-columns: repeat(2, 1fr); }.pig-ai { padding: 16px; } }
/* The site's scroll-reveal plugin also visits nested sections. Interactive
   reports and form feedback must remain visible immediately after updates. */
.pig-page .reveal { opacity: 1; transform: none; transition: none; }
.pig-hero { display: grid; grid-template-columns: 1fr 300px; align-items: center; gap: 36px; padding: 62px 64px 54px; background: #f7e9e9; border-bottom: 1px solid #e7d7db; }
.pig-hero h1 { margin: 0; font-size: clamp(32px, 4.2vw, 54px); line-height: 1.18; font-weight: 750; letter-spacing: -.045em; }
.pig-hero h1 span { color: var(--pig-pink); }
.pig-mascot { position: relative; padding: 38px 22px 30px; }
.pig-mascot img { display: block; width: 100%; height: auto; transform: rotate(-7deg); }
.pig-halo { position: absolute; top: 20px; left: 50%; width: 48%; height: 30px; border: 5px solid #ffe664; border-radius: 50%; transform: translateX(-50%) rotate(6deg); box-shadow: 0 0 8px #fff17b, inset 0 0 6px #fff17b; }
.pig-orbit { position: absolute; z-index: 1; padding: 9px 12px; border: 1px solid #dfcbd1; border-radius: 7px; background: #fffcfa; font: 11px var(--font-mono); box-shadow: 0 4px 0 #e6d1d8; }
.orbit-b { bottom: 0; left: 50%; transform: translateX(-50%) rotate(-5deg); white-space: nowrap; font: 800 24px var(--font-sans); }
.pig-workspace { padding: 32px 48px 56px; }
.pig-form label { display: block; font-size: 13px; font-weight: 650; margin-bottom: 10px; }
.pig-input-row { display: flex; gap: 10px; }.pig-input-row input { width: 0; flex: 1; min-height: 50px; padding: 12px 16px; border: 1px solid #d9cbd0; border-radius: 8px; background: white; font: 12px var(--font-mono); color: var(--pig-ink); }
.pig-page button { cursor: pointer; }.pig-page button:disabled { opacity: .55; cursor: default; }.pig-page :is(button, input, a):focus-visible { outline: 3px solid #aa526e; outline-offset: 4px; }
.pig-primary { padding: 13px 24px; border-radius: 8px; background: var(--pig-ink); color: white; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 12px; }
.pig-hint { font-size: 11px; line-height: 1.8; color: #796570; margin-top: 9px; }.pig-error, .pig-unranked { padding: 12px 16px; background: #fff0ea; border: 1px solid #ebcbbc; border-radius: 6px; margin-top: 14px; font-size: 13px; }
.pig-report { border: 1px solid #dec7d0; border-radius: 12px; margin-top: 28px; padding: 24px; background: #fff7f8; }.pig-report-top { display: flex; justify-content: space-between; align-items: center; gap: 20px; }.pig-report h2 { font-size: 22px; font-weight: 700; margin: 7px 0; overflow-wrap: anywhere; }.pig-report-top p { font-size: 13px; color: var(--pig-pink); }.pig-score { white-space: nowrap; }.pig-score strong { font-size: 62px; line-height: 1; letter-spacing: -.07em; }.pig-score span { font-size: 12px; margin-left: 6px; }
.pig-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 22px; padding-top: 20px; border-top: 1px solid #e8d8de; }.pig-metrics article { min-width: 0; }.pig-metric-icon { color: var(--pig-pink); font-size: 24px; }.pig-metrics h3 { font-size: 12px; font-weight: 600; margin: 6px 0; }.pig-metrics p { font-size: 12px; }.pig-metrics p strong { font-size: 20px; }.pig-meter { height: 4px; background: #e9d7df; border-radius: 4px; margin: 12px 0; overflow: hidden; }.pig-meter span { display: block; height: 100%; background: #ba6582; }.pig-evidence { font-size: 10px; line-height: 1.9; color: #796570; overflow-wrap: anywhere; }.pig-evidence code { color: var(--pig-pink); }.pig-evidence a:hover { text-decoration: underline; }
.pig-bottom-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 28px; margin-top: 36px; }.pig-board, .pig-meme { border: 1px solid #e5dce0; border-radius: 10px; padding: 24px; min-width: 0; }.pig-section-heading { display: flex; justify-content: space-between; align-items: center; }.pig-board h2 { font-weight: 650; font-size: 22px; margin-top: 8px; }.pig-text-button { font-size: 11px; color: #796570; }.pig-empty { padding: 42px 0; text-align: center; font-size: 12px; color: #796570; }.pig-empty > span { font-size: 44px; color: #b38d78; }.pig-empty h3 { margin: 10px 0; font-size: 16px; color: var(--pig-ink); }.pig-rank-list { margin-top: 18px; }.pig-rank-list li { display: flex; align-items: center; gap: 12px; padding: 16px 6px; border-top: 1px solid #ece3e7; }.pig-rank { font: 13px var(--font-mono); color: #927b85; }.pig-rank-list button { flex: 1; min-width: 0; text-align: left; }.pig-rank-list button strong { display: block; font-size: 12px; overflow-wrap: anywhere; }.pig-rank-list button span { display: block; margin-top: 5px; font-size: 10px; color: #796570; }.pig-rank-score { font: 600 22px var(--font-mono); }.pig-selected { background: #f9ecef; }.pig-spinner { width: 13px; height: 13px; border: 2px solid #ffffff55; border-top-color: white; border-radius: 50%; animation: pig-spin 1s linear infinite; }@keyframes pig-spin { to { transform: rotate(360deg); } }
.pig-meme { display: flex; flex-direction: column; align-items: center; gap: 24px; background: #fff; container-type: inline-size; }
.pig-meme h2 { display: grid; gap: 10px; margin: 0; font-size: clamp(20px, 8cqw, 52px); font-weight: 950; line-height: 1.2; letter-spacing: -.055em; white-space: nowrap; text-align: center; color: #23191e; }
.pig-meme-english { font-size: clamp(13px, 4.4cqw, 26px); font-weight: 800; letter-spacing: -.035em; }
.pig-meme img { display: block; width: min(100%, 440px); height: auto; }
@media (max-width: 850px) { .pig-hero { padding: 40px 28px; grid-template-columns: 1fr 210px; gap: 12px; }.pig-workspace { padding: 28px; }.pig-bottom-grid { grid-template-columns: 1fr; }.pig-metrics { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .pig-hero { grid-template-columns: 1fr; padding: 32px 22px; }.pig-mascot { width: 200px; justify-self: center; }.pig-hero h1 { font-size: 38px; }.pig-workspace { padding: 22px 16px; }.pig-input-row { flex-direction: column; }.pig-input-row input { width: 100%; }.pig-report { padding: 18px; }.pig-report-top { align-items: flex-start; }.pig-report h2 { font-size: 17px; }.pig-score strong { font-size: 42px; }.pig-board, .pig-meme { padding: 20px; }.pig-metrics { gap: 16px; } }
@media (prefers-reduced-motion: reduce) { .pig-spinner { animation: none; } }
</style>
