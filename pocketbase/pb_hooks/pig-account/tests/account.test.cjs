const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAccount, begin, next } = require('../index.cjs');
const { scan, getReport, leaderboard } = require('../server.cjs');
const now = Date.parse('2026-09-24T00:00:00Z');
const repository = (i, extra = {}) => ({ full_name: 'demo/repo-' + i, owner: { login: 'demo' }, private: false, stargazers_count: i, language: 'JavaScript', ...extra });
const commits = Array.from({ length: 22 }, (_, i) => ({ sha: String(i), parents: [{}], repository: { full_name: 'demo/repo-0', private: false }, html_url: 'https://github.com/demo/repo-0/commit/' + i,
  author: { login: 'demo', type: 'User' }, commit: { message: 'fix', author: { date: '2026-09-22T04:00:00Z', name: 'Demo', email: 'do-not-send@example.com' } } }));
const pr = { title: 'Ship a thing', html_url: 'https://github.com/demo/repo-0/pull/1', state: 'closed', pull_request: { merged_at: '2026-09-20' } };
const issue = { title: 'A bug', html_url: 'https://github.com/demo/repo-0/issues/2', state: 'open' };
const response = (items, total = items.length, incomplete = false) => ({ items, total_count: total, incomplete_results: incomplete });
function complete(ai, kind = 'User') {
  const paths = [];
  const replies = [{ login: 'Demo', type: kind, public_repos: 1 }, [repository(0)], response(commits, 150), response([pr]), response([issue])];
  const github = path => { paths.push(path); return replies.shift(); };
  let state = begin('@Demo', now);
  while (state.phase !== 'done') state = next(state, { github, ai, now });
  return { report: state.report, paths };
}
test('only account names and GitHub profile URLs are accepted', () => {
  assert.equal(normalizeAccount(' https://github.com/Octocat/ '), 'octocat');
  assert.equal(normalizeAccount('@Octocat'), 'octocat');
  for (const input of ['', null, 'demo/repo', 'https://evil.test/demo', 'demo?x=y', 'demo--user', '-demo', 'a'.repeat(40)]) assert.throws(() => normalizeAccount(input), /invalidAccount/);
});
test('repository pagination enumerates beyond 100, deduplicates and filters private/non-owned repos', () => {
  let state = next(begin('demo', now), { now, github: () => ({ login: 'demo', type: 'User', public_repos: 103 }) });
  state = next(state, { now, github: path => { assert.match(path, /page=1/); return Array.from({ length: 100 }, (_, i) => repository(i)); } });
  assert.equal(state.phase, 'repos');
  state = next(state, { now, github: path => { assert.match(path, /page=2/); return [repository(100), repository(100), repository(101, { private: true }), repository(102, { owner: { login: 'someone' } })]; } });
  assert.equal(state.repositories.length, 101);
  assert.equal(state.phase, 'commits');
  assert.equal(state.repositoriesComplete, true);
});
test('account report separates samples from totals, uses cross-repo evidence and never retains emails', () => {
  const { report, paths } = complete();
  assert.equal(report.account, 'demo');
  assert.equal(report.score, 55);
  assert.equal(report.ranked, true);
  assert.equal(report.coverage.commits.total, 150);
  assert.equal(report.coverage.commits.sampled, 22);
  assert.equal(report.metrics[1].evidence[0].url, commits[0].html_url);
  assert.equal(report.prs[0].merged, true);
  assert.equal(report.ai.status, 'unconfigured');
  assert(!JSON.stringify(report).includes('do-not-send'));
  assert(paths.some(p => decodeURIComponent(p).includes('author:demo is:public')));
  assert(paths.some(p => decodeURIComponent(p).includes('is:issue created:')));
});
test('organization scans owned public repositories and scopes activity to the organization', () => {
  const { paths, report } = complete(null, 'Organization');
  assert.match(paths[1], /^\/orgs\/demo\/repos\?type=public/);
  assert(paths.slice(2).every(p => decodeURIComponent(p).includes('org:demo is:public')));
  assert.equal(report.kind, 'Organization');
});
test('AI receives bounded untrusted public evidence, and bilingual output uses only validated source IDs', () => {
  let calls = 0;
  const { report } = complete({ url: 'https://ai.example/v1/chat/completions', key: 'secret', model: 'test', send(req) {
    calls++;
    const input = JSON.parse(req.body);
    assert.equal(input.model, 'test');
    assert.match(input.messages[0].content, /untrusted/);
    assert(!req.body.includes('do-not-send'));
    const data = JSON.parse(input.messages[1].content);
    assert(data.evidence.some(e => e.kind === 'PR'));
    assert(data.evidence.some(e => e.kind === 'issue'));
    const value = { title: 'A pig', summary: 'A sample-based story', highlights: [{ text: 'A project', evidenceIds: ['E1'] }] };
    return { statusCode: 200, json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ zh: value, en: value }) } }] } };
  } });
  assert.equal(calls, 1);
  assert.equal(report.ai.status, 'ready');
  assert.equal(report.ai.zh.highlights[0].sources[0].url, 'https://github.com/demo/repo-0');
  assert(!JSON.stringify(report).includes('secret'));
});
test('unavailable or malformed AI cannot invent a completed summary or affect score', () => {
  for (const send of [() => { throw new Error('timeout'); }, () => ({ statusCode: 401 }), () => ({ statusCode: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"zh":{"title":"bad","summary":"bad","highlights":[{"text":"bad","evidenceIds":["E999"]}]},"en":{}}' } }] } })]) {
    const { report } = complete({ url: 'https://ai.example', key: 'secret', model: 'test', send });
    assert.equal(report.ai.status, 'unavailable');
    assert.equal(report.score, 55);
  }
});
function database() {
  const rows = [];
  class Record {
    data = {};
    set(k, v) { this.data[k] = v; }
    get(k) { return this.data[k]; }
    getFloat(k) { return this.data[k] || 0; }
    getString(k) { return ['job', 'report'].includes(k) ? JSON.stringify(this.data[k] || null) : this.data[k] || ''; }
  }
  const app = {
    runInTransaction(fn) { fn(app); },
    findCollectionByNameOrId() { return {}; },
    findRecordsByFilter(_, filter, sort, limit, offset, params) { return rows.filter(r => params.account ? r.get('account') === params.account : r.getFloat('eligible') >= 20 && r.getFloat('completedAt') >= params.cutoff); },
    save(row) { if (!rows.includes(row)) rows.push(row); },
  };
  return { app, rows, record: () => new Record() };
}
test('scan job persists, locks concurrent work, caches final result and ranks only eligible reports', () => {
  const db = database();
  const replies = [{ login: 'demo', type: 'User', public_repos: 1 }, [repository(0)], response(commits), response([pr]), response([issue])];
  let calls = 0;
  const env = { now, record: db.record, github() {
    calls++;
    const concurrent = scan(db.app, 'DEMO', env);
    assert.equal(concurrent.status, 'pending');
    return replies.shift();
  } };
  let result;
  for (let i = 0; i < 6; i++) result = scan(db.app, 'demo', env);
  assert.equal(result.status, 'done');
  assert.equal(calls, 5);
  assert.equal(db.rows.length, 1);
  assert.equal(scan(db.app, 'demo', env).cached, true);
  assert.equal(getReport(db.app, 'demo').report.account, 'demo');
  assert.equal(leaderboard(db.app, now).items.length, 1);
  assert.equal(leaderboard(db.app, now + 8 * 86400000).items.length, 0);
});
test('rate limits retain progress and prevent immediate upstream retries', () => {
  const db = database(); let calls = 0;
  const env = { now, record: db.record, github() { calls++; throw new Error('rateLimit'); } };
  assert.throws(() => scan(db.app, 'demo', env), /rateLimit/);
  assert.throws(() => scan(db.app, 'demo', env), /rateLimit/);
  assert.equal(calls, 1);
  env.now += 61000;
  env.github = () => ({ login: 'demo', type: 'User' });
  assert.equal(scan(db.app, 'demo', env).phase, 'repos');
});

test('local llama.cpp may be keyless only through a loopback endpoint', () => {
  let calls = 0;
  const ai = { url: 'http://127.0.0.1:18081/v1/chat/completions', provider: 'llamacpp', model: 'gemma-4-12b', send(req) {
    calls++;
    assert.equal(req.headers.Authorization, undefined);
    const payload = JSON.parse(req.body);
    assert.equal(payload.chat_template_kwargs.enable_thinking, false);
    assert.equal(payload.response_format.type, 'json_object');
    return { statusCode: 503 };
  } };
  assert.equal(complete(ai).report.ai.status, 'unavailable');
  assert.equal(calls, 1);
  for (const url of ['http://public.example/v1/chat/completions', 'http://127.0.0.1.evil.example/v1', 'http://127.0.0.1@evil.example/v1']) {
    complete({ ...ai, url });
    assert.equal(calls, 1);
  }
});

test('expired report stays readable and ranked through failed refresh, retries and concurrent scans', () => {
  const db = database();
  const original = complete().report;
  const row = db.record();
  for (const [key, value] of Object.entries({ account: 'demo', report: original, score: original.score,
    eligible: original.eligible, completedAt: now - 7 * 3600000 })) row.set(key, value);
  db.app.save(row);
  const env = { now, record: db.record, github() { throw new Error('github'); } };
  assert.throws(() => scan(db.app, 'demo', env), /github/);
  assert.deepEqual(getReport(db.app, 'demo').report, original);
  assert.equal(leaderboard(db.app, now).items.length, 1);
  assert.throws(() => scan(db.app, 'demo', env), /github/);
  env.now += 61000;
  const replies = [{ login: 'demo', type: 'User' }, [], response([]), response([]), response([])];
  env.github = () => {
    assert.equal(scan(db.app, 'demo', env).status, 'pending', 'Old report must not terminate a concurrent refresh');
    assert.deepEqual(getReport(db.app, 'demo').report, original);
    return replies.shift();
  };
  for (let i = 0; i < 5; i++) {
    assert.equal(scan(db.app, 'demo', env).status, 'pending');
    assert.deepEqual(getReport(db.app, 'demo').report, original);
    env.now += 3000;
  }
  const result = scan(db.app, 'demo', env);
  assert.equal(result.status, 'done');
  assert.equal(result.report.eligible, 0);
  assert.equal(getReport(db.app, 'demo').report.eligible, 0);
  assert.equal(leaderboard(db.app, env.now).items.length, 0);
  assert.equal(scan(db.app, 'demo', env).cached, true);
});
