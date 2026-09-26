// Public application boundary: SQL persistence, OAuth and scan adapters are private.
import { openStore } from './lib/mysql.js';
import { createOAuth, cookie, hash, setCookie } from './lib/oauth.js';
import { begin, next, normalizeAccount } from './lib/scanner.js';

export async function createApplication(config, { fetch: transport = globalThis.fetch, now = Date.now } = {}) {
  const origin = new URL(config.origin).origin;
  const store = await openStore(config.databaseUrl);
  const oauth = createOAuth({ store, fetch:transport, origin, clientId:config.clientId, clientSecret:config.clientSecret, now });
  const codes = { authRequired:401, forbidden:403, accountNotAllowed:400, oauthFailed:400, authUnavailable:503,
    invalidAccount:400, unsupportedAccount:422, identityChanged:409, notFound:404, tooLarge:422, rateLimit:429, github:502, offline:503 };
  async function github(path) {
    let r;
    try { r = await transport('https://api.github.com'+path, { signal:AbortSignal.timeout(12000), headers:{
      Accept:'application/vnd.github+json','User-Agent':'Lavamilk-Community','X-GitHub-Api-Version':'2022-11-28',
      ...(config.githubToken ? {Authorization:'Bearer '+config.githubToken} : config.clientId && config.clientSecret ?
        {Authorization:'Basic '+Buffer.from(config.clientId+':'+config.clientSecret).toString('base64')} : {}) } }); }
    catch { throw new Error('github'); }
    if (r.status===404) throw new Error('notFound');
    if ([403,429].includes(r.status)) {
      const retry=Number(r.headers.get('retry-after')) || (Number(r.headers.get('x-ratelimit-remaining'))===0 ? Number(r.headers.get('x-ratelimit-reset'))-now()/1000 : 60);
      throw Object.assign(new Error('rateLimit'),{retryAfter:Math.max(3,Math.min(3600,Math.ceil(retry || 60)))});
    }
    if (!r.ok) throw new Error('github');
    return r.json();
  }
  const ai = { ...config.ai, async send(request) {
    const r = await transport(request.url, {method:request.method,headers:request.headers,body:request.body,signal:AbortSignal.timeout(request.timeout*1000)});
    return {statusCode:r.status,json:await r.json()};
  } };
  async function body(req) {
    let size=0, result='';
    for await (const chunk of req) { size+=chunk.length; if (size>512) throw new Error('accountNotAllowed'); result+=chunk; }
    try { return result ? JSON.parse(result) : {}; } catch { throw new Error('accountNotAllowed'); }
  }
  function json(res,status,data) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(data));
  }
  function redirect(res,location,cookies=[]) {
    res.writeHead(303,{'Location':location,'Set-Cookie':cookies,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();
  }
  async function handler(req,res) {
    try {
      const url = new URL(req.url,origin), path=url.pathname, method=req.method;
      if (method==='GET' && path==='/api/pig-king/health') { await store.health(); return json(res,200,{status:'ok',database:'mysql',oauthConfigured:oauth.enabled}); }
      if (method==='GET' && path==='/api/pig-king/auth/login') {
        try { const start=await oauth.start(); return redirect(res,start.url,[start.cookie]); }
        catch(e) { return redirect(res,origin+'/pig-king?pig_auth='+ (e.message==='authUnavailable'?'authUnavailable':'offline')); }
      }
      if (method==='GET' && path==='/api/pig-king/auth/callback') {
        try { return redirect(res,origin+'/pig-king',await oauth.finish(req,url.searchParams)); }
        catch { return redirect(res,origin+'/pig-king?pig_auth=oauthFailed',[setCookie('pig_oauth','',0,oauth.secure)]); }
      }
      if (method==='GET' && path==='/api/pig-king/account-leaderboard') return json(res,200,{items:await store.leaderboard()});
      if (method==='GET' && path.startsWith('/api/pig-king/account-report/')) {
        const report=await store.report(normalizeAccount(decodeURIComponent(path.slice('/api/pig-king/account-report/'.length))));
        if (!report) throw new Error('notFound');
        return json(res,200,{report});
      }
      const token=cookie(req,'pig_session');
      const user=token ? await store.session(hash(token),now()) : null;
      if (method==='GET' && path==='/api/pig-king/auth/session') return json(res,200,{user,loginEnabled:oauth.enabled});
      if (method==='POST' && ['/api/pig-king/account-scan','/api/pig-king/auth/logout'].includes(path)) {
        if (!user) throw new Error('authRequired');
        if (req.headers.origin !== origin) throw new Error('forbidden');
        if (path.endsWith('/logout')) {
          await store.logout(hash(token));res.setHeader('Set-Cookie',setCookie('pig_session','',0,oauth.secure));return json(res,200,{ok:true});
        }
        const input=await body(req);
        if (!input || Array.isArray(input) || Object.keys(input).length) throw new Error('accountNotAllowed');
        const claim=await store.claim(user,now(),begin);
        if (claim.response) return json(res,200,claim.response);
        let state, failure, retryAfter;
        try { state=await next(claim.state,{github,ai,now:now(),githubId:user.id}); }
        catch(e) { failure=codes[e.message] ? e.message : 'github'; retryAfter=e.retryAfter; }
        const result=await store.finish(user,claim.lease,state,failure,now(),retryAfter);
        if (failure) throw Object.assign(new Error(failure),{retryAfter});
        return json(res,200,result);
      }
      // Retired anonymous repository APIs must not bypass the login gate.
      return json(res,404,{code:'notFound'});
    } catch(e) { return json(res,codes[e.message] || 503,{code:codes[e.message] ? e.message : 'offline',...(e.message==='rateLimit'?{retryAfter:e.retryAfter || 5}:{})}); }
  }
  return { handler, close:()=>store.close(), importLegacy:reports=>store.importLegacy(reports) };
}
