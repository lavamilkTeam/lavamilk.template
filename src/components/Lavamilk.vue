<script setup>
// Lavamilk — 官网单文件组件（基于 SaaS Design 的模板改造，MIT licensed）
import { computed, defineAsyncComponent, ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useSiteContent } from "../composables/useSiteContent";
import LanguageSwitcher from "./LanguageSwitcher.vue";
import CommunityMenu from "./CommunityMenu.vue";

const PigKing = defineAsyncComponent(() => import('../features/pig-king/PigKing.vue'));

const props = defineProps({ onSignIn: Function, onSignUp: Function });

const { t, tm, locale } = useI18n();

// 站点内容：英文读 CMS（后台可编辑），其它语言读语言包
const { site, features, tiers, faqs, changelog } = useSiteContent();

const page = ref(window.location.hash === "#pig-king" ? "pig-king" : "home");
const open = ref(false);
const year = new Date().getFullYear();

const go = (p) => {
  page.value = p;
  open.value = false;
  if (typeof window !== "undefined") window.scrollTo({ top: 0 });
};

const logos = ["Northwind", "Vela", "Cobalt", "Mainsail", "Brightline", "Orbit", "Tidewater"];

// 顶部横幅指向的开源仓库
const REPO_URL = "https://github.com/lavamilkTeam/lavamilk.template";
// 「开始部署」按钮跳转的开源仓库
const SMT_REPO_URL = "https://github.com/lavamilkTeam/LavamilkSMT";
// 线上社群（QQ 群邀请链接）
const COMMUNITY_URL = "https://qm.qq.com/q/fWFuAJosL0";
// 社区地址暂留空，填写后菜单自动启用跳转。
const LAVAPIGGY_URL = "";

// 暂时隐藏的页面：代码、文案、CMS 数据全部保留，只是不显示入口。
// 想重新放出，把对应项从这个数组里删掉即可。
const HIDDEN_PAGES = ["pricing", "changelog"];

const NAV = computed(() =>
  [
    { label: t("nav.product"), p: "features" },
    { label: t("nav.docs"), p: "docs" },
    { label: t("nav.pricing"), p: "pricing" },
    { label: t("nav.changelog"), p: "changelog" },
  ].filter((n) => !HIDDEN_PAGES.includes(n.p))
);

const FOOT = computed(() =>
  tm("footer.cols").map((col) => ({
    ...col,
    links: col.links.filter((l) => !HIDDEN_PAGES.includes(l.p)),
  }))
);
const docGroups = computed(() => tm("docsGroups"));
const aboutStats = computed(() => tm("aboutStats"));
const posts = computed(() => tm("posts"));
const roles = computed(() => tm("roles"));
const contacts = computed(() => tm("contacts"));

const legalTitle = (p) => t("legalTitles." + p);
const PAGE_TITLE_KEYS = {
  features: "page.features.title", docs: "page.docs.title", pricing: "page.pricing.title",
  changelog: "page.changelog.title", about: "page.about.title", blog: "page.blog.title", post: "page.post.title",
  careers: "page.careers.title", contact: "page.contact.title", "pig-king": "pig.board",
};
watchEffect(() => {
  document.documentElement.lang = locale.value;
  const title = ["privacy", "terms", "security"].includes(page.value) ? legalTitle(page.value)
    : PAGE_TITLE_KEYS[page.value] ? t(PAGE_TITLE_KEYS[page.value]) : "";
  document.title = title ? `${title} | ${site.value.name}` : site.value.name;
});
// 价格以 $ 开头才显示周期（"定制"/"Custom" 不显示）
const isMonthly = (p) => typeof p === "string" && p.trim().startsWith("$");
</script>

<template>
  <div class="min-h-screen bg-background font-sans text-foreground">
    <!-- HOME -->
    <template v-if="page === 'home'">
      <a :href="REPO_URL" target="_blank" rel="noopener noreferrer" class="block cursor-pointer border-b border-border bg-muted/60 transition-colors hover:bg-muted">
        <div class="flex w-full items-center justify-center gap-2 px-6 py-2 text-center text-xs sm:text-sm">
          <span class="rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-background">{{ t('banner.badge') }}</span>
          <span class="font-medium">{{ t('banner.text') }}</span>
          <span class="font-semibold underline underline-offset-4">{{ t('action.readMore') }}</span>
        </div>
      </a>

      <!-- HEADER -->
      <header class="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div class="flex h-14 w-full items-center justify-between px-6">
          <div class="flex items-center gap-8">
            <a href="#" @click.prevent="go('home')" class="flex cursor-pointer items-center gap-2">
              <img src="/lavamilk-logo.png" alt="Lavamilk" class="brand-logo h-[38px] w-auto" />
            </a>
            <nav class="hidden items-center gap-6 lg:flex">
              <a v-for="n in NAV" :key="n.label" href="#" @click.prevent="go(n.p)" :class="'cursor-pointer text-[13px] transition-colors hover:text-foreground ' + (page === n.p ? 'text-foreground' : 'text-muted-foreground')">{{ n.label }}</a>
              <CommunityMenu :active="page === 'pig-king'" :community-url="LAVAPIGGY_URL" @navigate="go" />
            </nav>
          </div>
          <div class="flex items-center gap-2">
            <LanguageSwitcher class="hidden sm:block" />
            <button type="button" @click="go('pig-king')" class="hidden cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground sm:inline-block">{{ t('action.signIn') }}</button>
            <a :href="SMT_REPO_URL" target="_blank" rel="noopener noreferrer" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-background hover:opacity-90">{{ t('action.startDeploying') }}</a>
            <button class="-mr-1 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" @click="open = !open" aria-label="Menu">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path v-if="open" d="M18 6 6 18M6 6l12 12" /><path v-else d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          </div>
        </div>
        <nav v-if="open" class="space-y-1 border-t border-border px-6 py-3 lg:hidden">
          <a v-for="n in NAV" :key="n.label" href="#" @click.prevent="go(n.p)" class="block cursor-pointer rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted">{{ n.label }}</a>
          <CommunityMenu mobile :active="page === 'pig-king'" :community-url="LAVAPIGGY_URL" @navigate="go" />
          <div class="pt-1"><LanguageSwitcher /></div>
        </nav>
      </header>

      <main class="w-full">
        <section class="border-b border-border px-6 pb-16 pt-16 text-center sm:px-16 sm:pt-24 lg:px-28">
          <h1 class="df-rise mx-auto max-w-3xl text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-6xl">{{ site.heroTitle }}</h1>
          <div class="df-rise-2 mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a :href="SMT_REPO_URL" target="_blank" rel="noopener noreferrer" class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90">{{ t('action.startDeploying') }} <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg></a>
            <a href="#" @click.prevent="go('docs')" class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold hover:bg-muted">{{ t('action.readDocs') }}</a>
          </div>
          <div class="df-rise-2 mx-auto mt-10 max-w-md overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm">
            <div class="flex items-center gap-1.5 border-b border-border bg-muted px-3.5 py-2">
              <span class="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" /><span class="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" /><span class="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              <span class="ml-2 font-mono text-[11px] text-muted-foreground">bash</span>
            </div>
            <div class="px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
              <p><span class="text-muted-foreground">$</span> lavamilk deploy</p>
              <p class="mt-1 text-muted-foreground">{{ t('term.building') }} <span class="text-foreground">{{ t('term.doneIn') }}</span></p>
              <p class="text-muted-foreground">{{ t('term.deployedTo') }} <span class="text-foreground underline underline-offset-2">lavamilk.app/acme</span></p>
            </div>
          </div>
        </section>

        <section class="border-b border-border px-6 py-9">
          <div class="relative overflow-hidden" :style="{ maskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)' }">
            <div class="df-marquee flex w-max items-center gap-x-14 opacity-55"><span v-for="(n, i) in [...logos, ...logos]" :key="i" class="shrink-0 text-base font-bold tracking-tight">{{ n }}</span></div>
          </div>
        </section>

        <section class="border-b border-border px-6 py-16 sm:px-16 lg:px-28">
          <div class="max-w-2xl">
            <h2 class="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">{{ t('home.featuresTitle') }}</h2>
          </div>
          <div class="mt-9 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="f in features" :key="f.t" class="flex flex-col bg-card p-6">
              <span class="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground"><svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" /></svg></span>
              <h3 class="mt-4 text-base font-semibold tracking-tight">{{ f.t }}</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ f.d }}</p>
            </div>
          </div>
        </section>

        <section class="border-b border-border px-6 py-12 text-center sm:px-16 lg:px-28">
          <h2 class="text-2xl font-bold tracking-[-0.02em]">{{ t('home.communityTitle') }}</h2>
        </section>

        <section class="px-6 py-20 text-center sm:px-16 lg:px-28">
          <h2 class="mx-auto max-w-2xl text-3xl font-bold tracking-[-0.02em] sm:text-4xl">{{ t('home.joinTitle') }}</h2>
          <div class="mt-8 flex justify-center">
            <a :href="COMMUNITY_URL" target="_blank" rel="noopener noreferrer" class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-foreground px-6 py-3 text-sm font-semibold text-background hover:opacity-90">{{ t('action.readMore') }}</a>
          </div>
        </section>
      </main>
    </template>

    <!-- SUB PAGES -->
    <template v-else>
      <!-- HEADER -->
      <header class="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div class="flex h-14 w-full items-center justify-between px-6">
          <div class="flex items-center gap-8">
            <a href="#" @click.prevent="go('home')" class="flex cursor-pointer items-center gap-2">
              <img src="/lavamilk-logo.png" alt="Lavamilk" class="brand-logo h-[38px] w-auto" />
            </a>
            <nav class="hidden items-center gap-6 lg:flex">
              <a v-for="n in NAV" :key="n.label" href="#" @click.prevent="go(n.p)" :class="'cursor-pointer text-[13px] transition-colors hover:text-foreground ' + (page === n.p ? 'text-foreground' : 'text-muted-foreground')">{{ n.label }}</a>
              <CommunityMenu :active="page === 'pig-king'" :community-url="LAVAPIGGY_URL" @navigate="go" />
            </nav>
          </div>
          <div class="flex items-center gap-2">
            <LanguageSwitcher class="hidden sm:block" />
            <button type="button" @click="go('pig-king')" class="hidden cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground sm:inline-block">{{ t('action.signIn') }}</button>
            <a :href="SMT_REPO_URL" target="_blank" rel="noopener noreferrer" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-background hover:opacity-90">{{ t('action.startDeploying') }}</a>
            <button class="-mr-1 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" @click="open = !open" aria-label="Menu">
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path v-if="open" d="M18 6 6 18M6 6l12 12" /><path v-else d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          </div>
        </div>
        <nav v-if="open" class="space-y-1 border-t border-border px-6 py-3 lg:hidden">
          <a v-for="n in NAV" :key="n.label" href="#" @click.prevent="go(n.p)" class="block cursor-pointer rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted">{{ n.label }}</a>
          <CommunityMenu mobile :active="page === 'pig-king'" :community-url="LAVAPIGGY_URL" @navigate="go" />
          <div class="pt-1"><LanguageSwitcher /></div>
        </nav>
      </header>

      <main class="w-full">
        <!-- FEATURES -->
        <PigKing v-if="page === 'pig-king'" />
        <template v-else-if="page === 'features'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.features.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
              <div v-for="f in features" :key="f.t" class="bg-card p-7">
                <span class="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-foreground"><svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" /></svg></span>
                <h3 class="mt-4 text-lg font-semibold tracking-tight">{{ f.t }}</h3>
                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ f.d }}</p>
              </div>
            </div>
          </section>
        </template>

        <!-- DOCS -->
        <template v-else-if="page === 'docs'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.docs.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="grid gap-10 lg:grid-cols-[200px_1fr]">
              <aside class="space-y-5 text-sm">
                <div v-for="g in docGroups" :key="g.h">
                  <p class="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{{ g.h }}</p>
                  <ul class="mt-2 space-y-1.5"><li v-for="i in g.items" :key="i"><a href="#" @click.prevent class="cursor-pointer text-muted-foreground hover:text-foreground">{{ i }}</a></li></ul>
                </div>
              </aside>
              <div>
                <h2 class="text-2xl font-bold tracking-tight">{{ t('page.docs.quickstartTitle') }}</h2>
                <div class="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
                  <p>{{ t('page.docs.intro') }}</p>
                  <div class="overflow-hidden rounded-lg border border-border bg-card font-mono text-[12.5px]">
                    <div class="border-b border-border bg-muted px-3.5 py-2 text-[11px] text-muted-foreground">{{ t('page.docs.terminal') }}</div>
                    <pre class="overflow-x-auto px-4 py-3.5 leading-relaxed text-foreground/80"><code>npm i -g lavamilk-cli
lavamilk login
lavamilk deploy</code></pre>
                  </div>
                  <h2>{{ t('page.docs.whatNextTitle') }}</h2>
                  <p>{{ t('page.docs.whatNextBody') }}</p>
                  <h2>{{ t('page.docs.nextStepsTitle') }}</h2>
                  <p>{{ t('page.docs.nextStepsBody') }}</p>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- PRICING -->
        <template v-else-if="page === 'pricing'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.pricing.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="grid items-start gap-5 lg:grid-cols-3">
              <div v-for="tr in tiers" :key="tr.n" :class="'rounded-2xl border p-6 ' + (tr.hi ? 'border-foreground bg-card shadow-lg' : 'border-border bg-card')">
                <div class="flex items-center justify-between"><h3 class="text-lg font-bold tracking-tight">{{ tr.n }}</h3><span v-if="tr.hi" class="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">{{ t('page.pricing.popular') }}</span></div>
                <p class="mt-1 text-sm text-muted-foreground">{{ tr.d }}</p>
                <div class="mt-4 flex items-baseline gap-1"><span class="text-4xl font-extrabold tracking-tight">{{ tr.p }}</span><span v-if="isMonthly(tr.p)" class="text-sm text-muted-foreground">{{ t('page.pricing.perMonth') }}</span></div>
                <button type="button" @click="onSignUp && onSignUp()" :class="'mt-5 inline-flex w-full cursor-pointer items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold ' + (tr.hi ? 'bg-foreground text-background hover:opacity-90' : 'border border-border hover:bg-muted')">{{ tr.cta }}</button>
                <ul class="mt-6 space-y-2.5 text-sm text-muted-foreground"><li v-for="x in tr.f" :key="x" class="flex gap-2"><svg class="mt-0.5 h-4 w-4 shrink-0 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7" /></svg> {{ x }}</li></ul>
              </div>
            </div>
            <div class="mx-auto mt-14 max-w-2xl">
              <h2 class="text-center text-xl font-bold tracking-tight">{{ t('page.pricing.faqTitle') }}</h2>
              <div class="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
                <div v-for="f in faqs" :key="f.q" class="bg-card p-5"><p class="text-sm font-semibold">{{ f.q }}</p><p class="mt-1.5 text-sm text-muted-foreground">{{ f.a }}</p></div>
              </div>
            </div>
          </section>
        </template>

        <!-- CHANGELOG -->
        <template v-else-if="page === 'changelog'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.changelog.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="mx-auto max-w-2xl space-y-8">
              <article v-for="c in changelog" :key="c.title" class="border-b border-border pb-8 last:border-0">
                <p class="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{{ c.date }}</p>
                <h2 class="mt-2 text-xl font-bold tracking-tight">{{ c.title }}</h2>
                <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ c.body }}</p>
              </article>
            </div>
          </section>
        </template>

        <!-- ABOUT -->
        <template v-else-if="page === 'about'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.about.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="grid items-center gap-10 lg:grid-cols-2">
              <div class="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-muted-foreground">
                <p>{{ t('page.about.body1') }}</p>
                <p>{{ t('page.about.body2') }}</p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div v-for="s in aboutStats" :key="s.l" class="rounded-2xl border border-border bg-card p-6"><p class="text-4xl font-extrabold tracking-tight">{{ s.n }}</p><p class="mt-1 text-sm text-muted-foreground">{{ s.l }}</p></div>
              </div>
            </div>
          </section>
        </template>

        <!-- BLOG -->
        <template v-else-if="page === 'blog'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.blog.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <a v-for="p in posts" :key="p.title" href="#" @click.prevent="go('post')" class="group cursor-pointer rounded-xl border border-border bg-card p-6 transition-colors hover:bg-muted/50">
                <span class="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{{ p.tag }} &middot; {{ p.read }}</span>
                <h3 class="mt-3 text-lg font-semibold leading-snug tracking-tight">{{ p.title }}</h3>
                <span class="mt-4 inline-flex items-center gap-1 text-sm font-medium">{{ t('action.readPost') }} <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg></span>
              </a>
            </div>
          </section>
        </template>

        <!-- POST -->
        <template v-else-if="page === 'post'">
          <section class="border-b border-border px-6 py-16 sm:px-16 lg:px-28">
            <div class="mx-auto max-w-2xl">
              <a href="#" @click.prevent="go('blog')" class="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground">{{ t('action.backToBlog') }}</a>
              <p class="mt-6 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{{ t('page.post.metaTag') }} &middot; {{ t('page.post.metaRead') }}</p>
              <h1 class="mt-3 text-3xl font-bold tracking-[-0.02em] sm:text-4xl">{{ t('page.post.title') }}</h1>
            </div>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
              <p>{{ t('page.post.body1') }}</p>
              <h2>{{ t('page.post.h2a') }}</h2>
              <p>{{ t('page.post.body2') }}</p>
              <h2>{{ t('page.post.h2b') }}</h2>
              <p>{{ t('page.post.body3') }}</p>
            </div>
          </section>
        </template>

        <!-- CAREERS -->
        <template v-else-if="page === 'careers'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.careers.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="mx-auto max-w-2xl divide-y divide-border overflow-hidden rounded-xl border border-border">
              <a v-for="r in roles" :key="r.t" href="#" @click.prevent="go('contact')" class="flex cursor-pointer items-center justify-between gap-4 bg-card p-5 transition-colors hover:bg-muted/50">
                <div><p class="text-sm font-semibold tracking-tight">{{ r.t }}</p><p class="mt-0.5 text-xs text-muted-foreground">{{ r.team }} &middot; {{ r.loc }}</p></div>
                <span class="inline-flex items-center gap-1 text-sm font-medium">{{ t('action.apply') }} <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg></span>
              </a>
            </div>
          </section>
        </template>

        <!-- CONTACT -->
        <template v-else-if="page === 'contact'">
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ t('page.contact.title') }}</h1>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3">
              <div v-for="c in contacts" :key="c.h" class="rounded-xl border border-border bg-card p-6"><p class="text-base font-semibold tracking-tight">{{ c.h }}</p><p class="mt-1.5 text-sm text-muted-foreground">{{ c.d }}</p><p class="mt-3 font-mono text-[13px] text-foreground">{{ c.v }}</p></div>
            </div>
          </section>
        </template>

        <!-- LEGAL: privacy / terms / security -->
        <template v-else>
          <section class="border-b border-border px-6 py-16 text-center sm:px-16 lg:px-28">
            <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-[-0.03em] sm:text-5xl">{{ legalTitle(page) }}</h1>
            <p class="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">{{ t('page.legal.updated') }}</p>
          </section>
          <section class="px-6 py-14 sm:px-16 lg:px-28">
            <div class="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
              <p>{{ t('page.legal.intro', { doc: legalTitle(page).toLowerCase() }) }}</p>
              <h2>{{ t('page.legal.overviewTitle') }}</h2>
              <p>{{ t('page.legal.overviewBody') }}</p>
              <h2>{{ t('page.legal.dataTitle') }}</h2>
              <p>{{ t('page.legal.dataBody') }}</p>
              <h2>{{ t('page.legal.contactTitle') }}</h2>
              <p>{{ t('page.legal.contactBody') }}</p>
            </div>
          </section>
        </template>
      </main>
    </template>

    <!-- FOOTER -->
    <footer class="border-t border-border bg-card">
      <div class="w-full px-6 py-14">
        <div class="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div class="lg:col-span-2">
            <a href="#" @click.prevent="go('home')" class="flex cursor-pointer items-center gap-2">
              <img src="/lavamilk-logo.png" alt="Lavamilk" class="brand-logo h-7 w-auto" />
            </a>
            <p class="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">{{ site.footerBlurb }}</p>
            <div class="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1">
              <span class="h-1.5 w-1.5 rounded-full bg-foreground" />
              <span class="font-mono text-[11px] text-muted-foreground">{{ t('footer.status') }}</span>
            </div>
          </div>
          <div v-for="col in FOOT" :key="col.h">
            <p class="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{{ col.h }}</p>
            <ul class="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li v-for="l in col.links" :key="l.label"><a href="#" @click.prevent="go(l.p)" class="cursor-pointer hover:text-foreground">{{ l.label }}</a></li>
            </ul>
          </div>
        </div>
        <div class="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">{{ t('footer.copyright', { year, name: site.name }) }}</div>
      </div>
    </footer>
  </div>
</template>

<style>
@keyframes df-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
@keyframes df-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
.df-rise { animation: df-rise .7s cubic-bezier(.16,1,.3,1) both }
.df-rise-2 { animation: df-rise .7s cubic-bezier(.16,1,.3,1) .08s both }
.df-marquee { animation: df-marquee 26s linear infinite }
@media (prefers-reduced-motion: reduce) { .df-rise, .df-rise-2, .df-marquee { animation: none } }
</style>
