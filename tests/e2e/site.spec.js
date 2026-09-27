import { test, expect } from '@playwright/test';

// Only external API responses are substituted; the production bundle and router run unchanged.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/collections/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/pig-king/auth/session', route => route.fulfill({ json: { user: null, loginEnabled: true } }));
  await page.route('**/api/pig-king/account-leaderboard', route => route.fulfill({ json: { items: [] } }));
});

test('navigation uses shareable paths and supports reload, back and forward', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('header a[href="/features"]').click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator('h1')).toContainText('Built for desktop SMT');
  await page.locator('header a[href="/docs"]').click();
  await expect(page).toHaveURL(/\/docs$/);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Docs');
  await page.goBack();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator('h1')).toContainText('Built for desktop SMT');
  await page.goForward();
  await expect(page.locator('h1')).toHaveText('Docs');
  expect(errors).toEqual([]);
});

test('mobile menu closes after navigating and locale survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('header a[href="/docs"]:visible').click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.locator('header nav:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('header select:visible').selectOption('zh-CN');
  await page.reload();
  await expect(page.locator('h1')).not.toHaveText('Docs');
});

test('community link, direct URL and legacy OAuth hash all resolve to the ranking page', async ({ page }) => {
  await page.goto('/');
  await page.locator('header .community-trigger:visible').click();
  await page.locator('header a[href="/pig-king"]:visible').click();
  await expect(page).toHaveURL(/\/pig-king$/);
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.reload();
  await expect(page.locator('.pig-page')).toBeVisible();
  await page.goto('/?pig_auth=oauthFailed&ref=legacy#pig-king');
  await expect(page).toHaveURL(/\/pig-king\?ref=legacy$/);
  await expect(page.getByRole('alert')).toContainText('GitHub authorization was not completed');
  await page.locator('header a[href="/docs"]').click();
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

test('AI agent opens from Community, loads its local template and keeps sending unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const navigation = page.locator('header nav:visible');
  await navigation.getByRole('button', { name: 'Community', exact: true }).click();
  await navigation.getByRole('link', { name: 'AI Agents' }).click();
  await expect(page).toHaveURL(/\/ai-agent$/);
  await expect(navigation.getByRole('button', { name: 'Community', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation.getByRole('button', { name: 'Community', exact: true })).toHaveClass(/community-active/);
  const chat = page.frameLocator('iframe[title="AI Agents"]');
  await expect(chat.getByRole('heading', { name: 'What shall we work on today?' })).toBeVisible();
  await chat.getByRole('button', { name: 'Help me review some code' }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('Help me review some code');
  await expect(chat.getByRole('button', { name: 'Model connection pending' })).toBeDisabled();
  await chat.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(chat.getByRole('textbox')).toHaveValue('');
  await page.reload();
  await expect(chat.getByRole('heading', { name: 'What shall we work on today?' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('AI agent supports Chinese mobile navigation without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('header select:visible').selectOption('zh-CN');
  await page.getByRole('button', { name: '社区', exact: true }).click();
  await page.getByRole('link', { name: 'AI智能体', exact: true }).click();
  await expect(page.locator('header nav:visible')).toHaveCount(0);
  const chat = page.frameLocator('iframe[title="AI智能体"]');
  await expect(chat.getByRole('heading', { name: '今天，想一起做点什么？' })).toBeVisible();
  await expect(chat.getByRole('status')).toContainText('模型接入待配置');
  const body = chat.locator('body');
  expect(await body.evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
});
