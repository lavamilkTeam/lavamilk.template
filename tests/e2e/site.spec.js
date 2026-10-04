import { mockChat } from './chat-fixture.js';
import { test, expect } from '@playwright/test';

// Only external API responses are substituted; the production bundle and router run unchanged.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/collections/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/pig-king/auth/session', route => route.fulfill({ json: { user: null, loginEnabled: true } }));
  await page.route('**/api/pig-king/chat/session', route => route.fulfill({ json: { user: null, loginEnabled: true, model: 'gemma-4-12b' } }));
  await page.route('**/api/pig-king/account-leaderboard', route => route.fulfill({ json: { items: [] } }));
});

test('top navigation only exposes rankings and supports reload, back and forward', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const navigation = page.locator('header nav');
  await expect(navigation.getByRole('link')).toHaveCount(1);
  await expect(navigation.getByRole('link', { name: 'Pig Rankings', exact: true })).toBeVisible();
  await expect(page.locator('header a[href="/features"], header a[href="/docs"], header a[href="/ai-agent"]')).toHaveCount(0);
  await expect(page.locator('header .community-trigger')).toHaveCount(0);
  await navigation.getByRole('link').click();
  await expect(page).toHaveURL(/\/pig-king$/);
  await expect(navigation.getByRole('link')).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.locator('header a[href="/"]').click();
  await page.goBack();
  await expect(page).toHaveURL(/\/pig-king$/);
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  expect(errors).toEqual([]);
});

test('mobile rankings stay visible without a drawer and locale survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
  const ranking = page.locator('header nav a[href="/pig-king"]');
  await expect(ranking).toBeVisible();
  await ranking.click();
  await expect(page).toHaveURL(/\/pig-king$/);
  await page.locator('header select').selectOption('zh-CN');
  await page.reload();
  await expect(ranking).toHaveText('猪猪榜');
  await expect(ranking).toBeVisible();
  await expect(page.locator('header nav a')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ranking link, direct URL and legacy OAuth hash all resolve to the ranking page', async ({ page }) => {
  await page.goto('/');
  await page.locator('header a[href="/pig-king"]:visible').click();
  await expect(page).toHaveURL(/\/pig-king$/);
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.reload();
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.goto('/?pig_auth=oauthFailed&ref=legacy#pig-king');
  await expect(page).toHaveURL(/\/pig-king\?ref=legacy$/);
  await expect(page.getByRole('alert')).toContainText('GitHub authorization was not completed');
  await page.locator('header a[href="/"]').click();
  await page.goBack();
  await expect(page.locator('.pig-page')).toBeVisible();
});

test('unknown paths display a useful 404 page', async ({ page }) => {
  await page.goto('/not-a-page');
  await expect(page.locator('h1')).toHaveText('404');
  await page.getByRole('link', { name: 'Back to home', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
});

test('failed refresh retains the displayed report and the leaderboard', async ({ page }) => {
  const report = { account: 'demo', score: 55, tier: 'chaos', ranked: true, eligible: 22,
    repositoryStats: { total: 1, stars: 3 }, coverage: { prs: { total: 0 }, issues: { total: 0 } },
    ai: { status: 'unconfigured' }, metrics: [], repositories: [], prs: [], issues: [] };
  await page.route('**/api/pig-king/auth/session', route => route.fulfill({ json: { user: { login: 'demo', id: '1' }, loginEnabled: true } }));
  await page.route('**/api/pig-king/account-leaderboard', route => route.fulfill({ json: { items: [{ account: 'demo', score: 55, eligible: 22, tier: 'chaos' }] } }));
  await page.route('**/api/pig-king/account-report/demo', route => route.fulfill({ json: { report } }));
  await page.route('**/api/pig-king/account-scan', route => route.fulfill({ status: 502, json: { code: 'github' } }));
  await page.goto('/pig-king');
  await page.locator('.pig-rank-list button').click();
  await expect(page.locator('.pig-report h2')).toContainText('demo');
  await page.locator('.pig-form button[type="submit"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.pig-report h2')).toContainText('demo');
  await expect(page.locator('.pig-rank-list')).toContainText('demo');
});

test('AI agent remains accessible by URL and requires GitHub login before sending', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/ai-agent');
  const navigation = page.locator('header nav');
  await expect(navigation.getByRole('link')).toHaveCount(1);
  await expect(navigation.getByRole('link', { name: 'Pig Rankings', exact: true })).toBeVisible();
  const chat = page.frameLocator('iframe[title="AI Agents"]');
  await expect(chat.getByRole('heading', { name: 'What shall we work on today?' })).toBeVisible();
  await chat.getByRole('button', { name: 'Help me review some code' }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('Help me review some code');
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await chat.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('');
  await page.reload();
  await expect(chat.getByRole('heading', { name: 'What shall we work on today?' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('AI agent supports Chinese mobile direct access without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('header select').selectOption('zh-CN');
  await page.goto('/ai-agent');
  await expect(page.locator('header nav a')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
  const chat = page.frameLocator('iframe[title="AI智能体"]');
  await expect(chat.getByRole('heading', { name: '今天，想一起做点什么？' })).toBeVisible();
  await expect(chat.getByRole('status')).toContainText('登录 GitHub 后开始对话');
  const body = chat.locator('body');
  expect(await body.evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
});


test('one GitHub session covers header, ranking and Gemma chat, including sign out', async ({ page }) => {
  let user = { id: '1', login: 'demo', avatar: 'https://avatars.githubusercontent.com/u/1' };
  const {payloads} = await mockChat(page,{answer:'<script>literal text</script> Gemma reply'});
  await page.route('**/api/pig-king/auth/session', route => route.fulfill({ json: { user, loginEnabled: true } }));
  await page.route('**/api/pig-king/chat/session', route => route.fulfill({ json: { user, loginEnabled: true, model: 'gemma-4-12b' } }));
  await page.route('**/api/pig-king/auth/logout', route => { user = null; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/pig-king');
  await expect(page.locator('header summary')).toHaveText('demo');
  await expect(page.locator('.pig-identity strong')).toHaveText('demo');
  await page.goto('/ai-agent');
  const chat = page.frameLocator('iframe');
  await chat.getByRole('textbox').fill('Hello Gemma');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('log')).toContainText('<script>literal text</script> Gemma reply');
  await chat.getByRole('textbox').fill('Follow up');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('log').locator('article')).toHaveCount(4);
  expect(payloads[1].content).toBe('Follow up');
  expect(payloads[1].messages).toBeUndefined();
  await page.reload();
  await expect(chat.getByRole('log').locator('article')).toHaveCount(4);
  await page.locator('header summary').click();
  await page.locator('header').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(chat.getByRole('link', { name: 'Sign in with GitHub', exact: true })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(chat.getByRole('log')).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('Gemma failure preserves the prompt for retry and stop cancels generation', async ({ page }) => {
  await page.route('**/api/pig-king/chat/session', route => route.fulfill({ json: { user: { id:'1', login: 'demo' }, loginEnabled: true, model: 'gemma-4-12b' } }));
  await mockChat(page,{answer:'Recovered',failFirst:true,holdAfter:3});
  await page.goto('/ai-agent');
  const chat = page.frameLocator('iframe');
  await chat.getByRole('textbox').fill('Keep this question');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('alert')).toContainText('question is saved');
  await expect(chat.getByRole('log')).toContainText('Keep this question');
  await chat.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(chat.getByRole('log')).toContainText('Recovered');
  await chat.getByRole('textbox').fill('Stop this question');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(chat.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await chat.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await expect(chat.getByRole('alert')).toContainText('Generation stopped');
  await expect(chat.getByRole('log').locator('article')).toHaveCount(3);
  await page.reload();
  await expect(chat.getByRole('log')).toContainText('Stop this question');
});

for (const width of [1440, 390]) {
  test(`chat renders readable Markdown with a docked composer at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/pig-king/chat/session', route => route.fulfill({ json: { user: { id:'1', login: 'demo' }, loginEnabled: true, model: 'gemma-4-12b' } }));
    const answer = [
      '## Vue 3 的几种常见选择',
      '可以先区分 **应用框架** 和构建工具，再根据项目需求选择。',
      '- **Nuxt**：需要服务端渲染和文件路由时使用。\n- **Vite**：适合自己组合 Vue Router 和状态管理。',
      '### 一个简单的例子',
      '```javascript\nimport { ref } from "vue";\nconst message = ref("Hello Vue");\nconst longLine = "' + 'code'.repeat(45) + '";\n```',
      '| 需求 | 选择 |\n| --- | --- |\n| 完整应用 | Nuxt |\n| 轻量页面 | Vite |',
      ...Array.from({ length: 12 }, (_, i) => `### 建议 ${i + 1}\n\n从一个小页面开始，验证路由、数据加载和部署流程。确认这些基础能力之后，再按实际需求扩展。`),
      '<img src=x onerror="alert(1)">',
      '[unsafe](javascript:alert(1))',
      '![remote](https://example.com/tracker.png)',
      '[Vue documentation](https://vuejs.org/)',
    ].join('\n\n');
    await mockChat(page,{answer});
    await page.goto('/ai-agent');
    const chat = page.frameLocator('iframe');
    await chat.getByRole('textbox').fill('Vue 3 有哪些框架？');
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByRole('heading', { name: 'Vue 3 的几种常见选择' })).toBeVisible();
    const reply = chat.getByRole('article', { name: 'Gemma', exact: true });
    await expect(reply.locator('strong').first()).toHaveText('应用框架');
    await expect(reply.locator('pre code')).toContainText('import { ref }');
    await expect(reply.locator('table')).toHaveCount(1);
    await expect(reply.locator('img, script, a[href^="javascript:"]')).toHaveCount(0);
    await expect(reply.getByRole('link', { name: 'Vue documentation' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await reply.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const layout = await chat.locator('form').evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, height: window.innerHeight, overflow: document.body.scrollWidth > window.innerWidth }));
    expect(layout.bottom).toBeLessThanOrEqual(layout.height);
    expect(layout.top).toBeGreaterThan(0);
    expect(layout.overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
  });
}

test('saved conversations can be renamed, archived, restored and deleted without a profile entry', async ({page})=>{
  await page.route('**/api/pig-king/chat/session',route=>route.fulfill({json:{user:{id:'1',login:'demo'},loginEnabled:true,model:'gemma'}}));
  await mockChat(page);
  await page.goto('/ai-agent');
  const chat=page.frameLocator('iframe');
  await chat.getByRole('textbox').fill('Persistent question');
  await chat.getByRole('button',{name:'Send',exact:true}).click();
  await expect(chat.getByRole('log')).toContainText('Saved reply');
  await chat.getByRole('button',{name:'Rename conversation'}).click();
  await chat.getByRole('textbox',{name:'Conversation title'}).fill('My saved conversation');
  await chat.getByRole('button',{name:'Save title'}).click();
  await expect(chat.getByRole('button',{name:'My saved conversation',exact:true})).toBeVisible();
  await chat.getByRole('button',{name:'Archive conversation',exact:true}).click();
  await expect(chat.getByRole('button',{name:'Restore conversation',exact:true})).toBeVisible();
  await chat.getByRole('button',{name:'Show archived',exact:true}).click();
  await expect(chat.getByRole('button',{name:'My saved conversation',exact:true})).toBeVisible();
  await chat.getByRole('button',{name:'Restore conversation',exact:true}).click();
  await expect(chat.getByRole('button',{name:'Account profile',exact:true})).toHaveCount(0);
  await chat.getByRole('button',{name:'Delete conversation',exact:true}).click();
  await chat.getByRole('button',{name:'Confirm delete',exact:true}).click();
  await expect(chat.getByRole('log')).toHaveCount(0);
  await page.reload();await expect(chat.getByRole('log')).toHaveCount(0);
});
