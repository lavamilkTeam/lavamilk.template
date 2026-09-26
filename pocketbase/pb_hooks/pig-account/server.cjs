// Public persistence boundary used by PocketBase routes; runtime seams are injected.
const domain = require('./index.cjs');
const CACHE = 6 * 3600000;
// PocketBase JSON fields are raw bytes in JSVM; decode at the storage boundary.
function json(record, field) { return JSON.parse(record.getString(field) || 'null'); }
function find(app, account) {
  return app.findRecordsByFilter('pig_accounts', 'account = {:account}', '', 1, 0, { account })[0];
}
function view(record, cached) {
  const job = json(record, 'job');
  // A refresh can coexist with the last completed report. Scan callers need
  // progress until the replacement is committed; report readers keep old data.
  if (!cached && job?.phase) return { status: 'pending', phase: job.phase, repositories: job.repositories?.length || 0 };
  const report = json(record, 'report');
  if (report?.account) return { status: 'done', report, cached: !!cached };
  return { status: 'pending', phase: job.phase, repositories: job.repositories?.length || 0 };
}
function scan(app, input, env) {
  const account = domain.normalizeAccount(input);
  let claimed, immediate;
  // Claim work before external requests. Concurrent requests reuse the same job.
  app.runInTransaction(tx => {
    let row = find(tx, account);
    if (row && row.getFloat('completedAt') > env.now - CACHE) {
      immediate = view(row, true); return;
    }
    if (row && row.getFloat('lockedUntil') > env.now) {
      const code = row.getString('failure');
      if (code) throw new Error(code);
      immediate = view(row, false); return;
    }
    if (!row) {
      row = env.record(tx.findCollectionByNameOrId('pig_accounts'));
      row.set('account', account);
    }
    let job = json(row, 'job');
    if (!job?.phase || Date.parse(job.startedAt) < env.now - CACHE) {
      job = domain.begin(account, env.now);
    }
    row.set('job', job);
    row.set('failure', '');
    row.set('lockedUntil', env.now + 120000);
    tx.save(row);
    claimed = { job, lock: env.now + 120000 };
  });
  if (immediate) return immediate;
  let result, failure;
  try { result = domain.next(claimed.job, env); }
  catch (e) { failure = ['notFound', 'rateLimit', 'github', 'tooLarge', 'unsupportedAccount'].includes(e.message) ? e.message : 'github'; }
  let response;
  app.runInTransaction(tx => {
    const row = find(tx, account);
    // A stale worker must never overwrite a newer lease.
    if (row.getFloat('lockedUntil') !== claimed.lock) { response = view(row, false); return; }
    row.set('failure', failure || '');
    row.set('lockedUntil', failure ? env.now + 60000 : 0);
    if (result) {
      if (result.phase === 'done') {
        row.set('report', result.report);
        row.set('job', null);
        row.set('completedAt', env.now);
        row.set('score', result.report.score);
        row.set('eligible', result.report.ranked ? result.report.eligible : 0);
      } else row.set('job', result);
    }
    tx.save(row);
    response = view(row, false);
  });
  if (failure) throw new Error(failure);
  return response;
}
function getReport(app, account) {
  const row = find(app, domain.normalizeAccount(account));
  const report = row ? json(row, 'report') : null;
  if (!report?.account) throw new Error('notFound');
  return { report };
}
function leaderboard(app, now) {
  return { items: app.findRecordsByFilter('pig_accounts', 'eligible >= 20 && completedAt >= {:cutoff}', '-score,account', 50, 0,
    { cutoff: now - 7 * 86400000 }).map(r => {
    const report = json(r, 'report');
    return { account: report.account, kind: report.kind, score: report.score, tier: report.tier,
      eligible: report.eligible, repositories: report.repositoryStats.total, scannedAt: report.scannedAt };
  }) };
}
module.exports = { scan, getReport, leaderboard };
