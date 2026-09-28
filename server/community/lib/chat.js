import { createChat } from './model.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const object = input => input && typeof input === 'object' && !Array.isArray(input);
const only = (input, keys) => object(input) && Object.keys(input).every(key=>keys.includes(key));
export function createChatRoutes(store, model, kick) {
  return async (path,method,url,user,readBody) => {
    if (path === '/me/profile') {
      if (method === 'GET') return { profile: await store.profile(user) };
      if (method === 'PATCH') {
        const input = await readBody();
        if (!only(input,['displayName','locale']) || typeof input.displayName !== 'string' || input.displayName.length>80 || !['zh-CN','en'].includes(input.locale)) throw new Error('invalidMessage');
        await store.preferences(user,{displayName:input.displayName.trim() || null,locale:input.locale});
        return {profile:await store.profile(user)};
      }
      throw new Error('notFound');
    }
    const parts = path.split('/').filter(Boolean);
    if (parts[0]!=='chat' || parts[1]!=='conversations') throw new Error('notFound');
    if (parts.length===2) {
      if (method==='GET') {
        const state=url.searchParams.get('state') || 'active';
        let cursor=null;
        if (url.searchParams.has('cursor')) {
          try { cursor=JSON.parse(Buffer.from(url.searchParams.get('cursor'),'base64url').toString()); } catch { throw new Error('invalidMessage'); }
          if (!Array.isArray(cursor) || cursor.length!==2 || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/.test(cursor[0]) || !uuid(cursor[1])) throw new Error('invalidMessage');
        }
        if (!['active','archived'].includes(state)) throw new Error('invalidMessage');
        return store.conversations(user,state,cursor);
      }
      if (method==='POST') {
        const input=await readBody();
        if (!only(input,['id']) || !uuid(input.id)) throw new Error('invalidMessage');
        return {conversation:await store.createConversation(user,input.id)};
      }
      throw new Error('notFound');
    }
    const id=parts[2];
    if (!uuid(id)) throw new Error('notFound');
    if (parts.length===3) {
      if (method==='DELETE') { await store.deleteConversation(user,id); return {ok:true}; }
      if (method==='PATCH') {
        const input=await readBody();
        if (!only(input,['title','state','expectedRevision']) || !/^\d{1,15}$/.test(String(input.expectedRevision)) ||
          (input.title!==undefined && (typeof input.title!=='string' || !input.title.trim() || input.title.length>160)) ||
          (input.state!==undefined && !['active','archived'].includes(input.state))) throw new Error('invalidMessage');
        return {conversation:await store.editConversation(user,id,input)};
      }
    }
    if (parts[3]==='turns') {
      if (parts.length===4 && method==='GET') {
        const before=url.searchParams.get('before');
        if (before && !/^[1-9]\d{0,14}$/.test(before)) throw new Error('invalidMessage');
        return store.turns(user,id,before);
      }
      if (parts.length===4 && method==='POST') {
        if (!model.enabled) throw new Error('modelUnavailable');
        const input=await readBody();
        if (!only(input,['content','clientRequestId']) || !uuid(input.clientRequestId) || typeof input.content!=='string' ||
          !input.content.trim() || input.content.length>6000 || Buffer.byteLength(input.content)>24000) throw new Error('invalidMessage');
        const turn=await store.enqueue(user,id,{...input,content:input.content.trim()},model); kick();
        return {turn};
      }
      if (parts.length===6 && uuid(parts[4]) && ['retry','cancel'].includes(parts[5]) && method==='POST') {
        const input=await readBody();
        if (!only(input,parts[5]==='retry'?['expectedAttempt']:[]) || (parts[5]==='retry' && (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt<1))) throw new Error('invalidMessage');
        await store.changeTurn(user,id,parts[4],parts[5],input.expectedAttempt); kick(); return {ok:true};
      }
    }
    throw new Error('notFound');
  };
}

export function createChatWorker(store,model,now) {
  const chat=createChat(model,now);
  let closed=false, running=null, controller=null;
  async function process() {
    await store.recoverTurns();
    const turn=await store.claimTurn();
    if (!turn) return;
    const requestController=new AbortController();
    controller=requestController;
    const heartbeat=setInterval(()=>{ store.leaseActive(turn).then(active=>{if(!active)requestController.abort();}).catch(()=>requestController.abort()); },1000);
    heartbeat.unref();
    const started=Date.now();
    try {
      if (turn.model!==model.model || turn.provider!==(model.provider || 'openai-compatible') || turn.prompt_version!=='v1') throw new Error('modelUnavailable');
      const result=await chat({messages:await store.context(turn)},turn.user,requestController.signal);
      await store.completeTurn(turn,{...result,latencyMs:Date.now()-started},null);
    } catch (error) {
      await store.completeTurn(turn,null,closed?'interrupted':['modelBusy','rateLimit'].includes(error.message)?error.message:'modelUnavailable');
    } finally { clearInterval(heartbeat); controller=null; }
  }
  function kick() {
    if (closed || running) return;
    running=process().catch(()=>{}).finally(()=>{running=null;});
  }
  const timer=setInterval(kick,500); timer.unref(); kick();
  return { kick, async close() { closed=true; clearInterval(timer); controller?.abort(); await running; } };
}
