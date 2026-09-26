/// <reference path="../pb_data/types.d.ts" />
routerAdd('POST', '/api/pig-king/account-scan', (e) => {
  const service = require(__hooks + '/pig-account/server.cjs');
  try {
    const github = (path) => {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Lavamilk-Pig-King', 'X-GitHub-Api-Version': '2022-11-28' };
      const token = $os.getenv('PIG_GITHUB_TOKEN');
      if (token) headers.Authorization = 'Bearer ' + token;
      let response;
      try { response = $http.send({ url: 'https://api.github.com' + path, headers, timeout: 12 }); }
      catch (error) { throw new Error('github', { cause: error }); }
      if (response.statusCode === 404) throw new Error('notFound');
      if ([403, 429].includes(response.statusCode)) throw new Error('rateLimit');
      if (response.statusCode !== 200) throw new Error('github');
      return response.json;
    };
    return e.json(200, service.scan(e.app, e.requestInfo().body.account, {
      now: Date.now(), github, record: collection => new Record(collection),
      ai: { url: $os.getenv('PIG_AI_URL'), key: $os.getenv('PIG_AI_KEY'), model: $os.getenv('PIG_AI_MODEL'), provider: $os.getenv('PIG_AI_PROVIDER'), send: request => $http.send(request) },
    }));
  } catch (error) {
    const codes = { invalidAccount: 400, unsupportedAccount: 422, notFound: 404, rateLimit: 429, tooLarge: 422, github: 502 };
    return e.json(codes[error.message] || 500, { code: codes[error.message] ? error.message : 'offline' });
  }
}, $apis.bodyLimit(512));

routerAdd('GET', '/api/pig-king/account-leaderboard', (e) => {
  return e.json(200, require(__hooks + '/pig-account/server.cjs').leaderboard(e.app, Date.now()));
});
routerAdd('GET', '/api/pig-king/account-report/{account}', (e) => {
  try { return e.json(200, require(__hooks + '/pig-account/server.cjs').getReport(e.app, e.request.pathValue('account'))); }
  catch (_) { return e.json(404, { code: 'notFound' }); }
});
