import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncContent } from '../index.mjs';

const content = { site: { name: 'Demo' }, features: [{ t: 'Title', d: 'Description' }], tiers: [], faqs: [], changelog: [] };
const options = { content, base: 'http://cms.test/api', email: 'test@example.com', password: 'test-only' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function cms(read) {
  const writes = [];
  return { writes, fetch: async (url, opts) => {
    if (url.endsWith('auth-with-password')) return json({ token: 'test-token' });
    assert.equal(opts.headers.Authorization, 'test-token');
    if (opts.method === 'GET') return read(new URL(url));
    writes.push({ url, ...opts });
    return opts.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'saved' });
  } };
}
const empty = url => json({ items: [], page: Number(url.searchParams.get('page')), totalPages: 0, totalItems: 0 });

test('any failed preflight read, including the last collection, prevents all content writes', async () => {
  for (const failure of [json({ message: 'unavailable' }, 503), json({}), json({ items: [], page: 1, totalPages: 1, totalItems: 5 })]) {
    const api = cms(url => url.pathname.includes('/changelog/') ? failure : empty(url));
    await assert.rejects(syncContent({ ...options, fetch: api.fetch }));
    assert.equal(api.writes.length, 0);
  }
});
test('network failure aborts before writes and missing source lists cannot silently delete CMS data', async () => {
  const api = cms(() => { throw new Error('offline'); });
  await assert.rejects(syncContent({ ...options, fetch: api.fetch }), /offline/);
  await assert.rejects(syncContent({ ...options, content: { site: {} }, fetch: api.fetch }), /Missing content list/);
  assert.equal(api.writes.length, 0);
});
test('sync reads every page before updating, creating or removing records', async () => {
  let reads = 0;
  const api = cms(url => {
    reads++;
    if (!url.pathname.includes('/features/')) return empty(url);
    const page = Number(url.searchParams.get('page'));
    const items = page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: 'id' + i })) : [{ id: 'id200' }];
    return json({ items, page, totalPages: 2, totalItems: 201 });
  });
  const result = await syncContent({ ...options, fetch: async (url, opts) => {
    if (opts.method !== 'GET' && !url.endsWith('auth-with-password')) assert.equal(reads, 6);
    return api.fetch(url, opts);
  } });
  assert.deepEqual(result.find(r => r.name === 'features'), { name: 'features', updated: 1, created: 0, removed: 200 });
  assert.equal(api.writes[0].method, 'POST');
  assert.equal(api.writes[1].method, 'PATCH');
  assert(api.writes.at(-1).url.endsWith('/id200'));
});
test('failed mutation stops the sync and does not report success', async () => {
  const api = cms(empty);
  let mutations = 0;
  await assert.rejects(syncContent({ ...options, fetch: (url, opts) => {
    if (opts.method !== 'GET' && !url.endsWith('auth-with-password')) { mutations++; return json({}, 503); }
    return api.fetch(url, opts);
  } }), /HTTP 503/);
  assert.equal(mutations, 1);
});
