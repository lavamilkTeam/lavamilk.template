import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1) || '';
}
export function setCookie(name, value, seconds, secure) {
  return `${name}=${value}; Path=/api/pig-king; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
export function createOAuth({ store, fetch, origin, clientId, clientSecret, now = Date.now }) {
  const enabled = !!(clientId && clientSecret);
  const secure = new URL(origin).protocol === 'https:';
  const callback = origin + '/api/pig-king/auth/callback';
  return {
    enabled, secure,
    async start() {
      if (!enabled) throw new Error('authUnavailable');
      const state = random(), verifier = random();
      await store.saveOAuth(hash(state), verifier, now()+600000);
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({ client_id:clientId, redirect_uri:callback, state,
        scope: 'read:user', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' });
      return { url: url.href, cookie: setCookie('pig_oauth',state,600,secure) };
    },
    async finish(req, params) {
      const state = params.get('state') || '', browserState = cookie(req,'pig_oauth');
      if (!enabled || !/^[A-Za-z0-9_-]{43}$/.test(state) || state.length !== browserState.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(browserState))) throw new Error('oauthFailed');
      const verifier = await store.takeOAuth(hash(state), now());
      if (!verifier || !params.get('code') || params.has('error')) throw new Error('oauthFailed');
      const response = await fetch('https://github.com/login/oauth/access_token', { method:'POST', signal:AbortSignal.timeout(15000),
        headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({ client_id:clientId,client_secret:clientSecret,code:params.get('code'),redirect_uri:callback,code_verifier:verifier }) });
      if (!response.ok) throw new Error('oauthFailed');
      const data = await response.json();
      if (!data.access_token) throw new Error('oauthFailed');
      const profileResponse = await fetch('https://api.github.com/user', { signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+data.access_token,Accept:'application/vnd.github+json','User-Agent':'Lavamilk-Community'} });
      if (!profileResponse.ok) throw new Error('oauthFailed');
      const p = await profileResponse.json();
      if (p.type !== 'User' || !Number.isSafeInteger(p.id) || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(p.login)) throw new Error('unsupportedAccount');
      const token = random();
      // Keep only the approved profile fields; never retain access tokens or private emails.
      await store.signIn({ id:String(p.id), login:p.login.toLowerCase(), avatar:`https://avatars.githubusercontent.com/u/${p.id}`, profile: {name:p.name,bio:p.bio,company:p.company,location:p.location,blog:p.blog,created_at:p.created_at} },hash(token),now()+7*86400000);
      return [setCookie('pig_session',token,7*86400,secure),setCookie('pig_oauth','',0,secure)];
    },
  };
}
