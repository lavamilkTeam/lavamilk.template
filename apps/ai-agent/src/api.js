// All account and conversation data crosses this same-origin HTTP boundary.
/** @typedef {{id:string,title:string,state:string,revision:string,updatedAt:string}} Conversation */
/** @typedef {{id:string,role:string,content:string}} Message */
/** @typedef {{id:string,turnNo:string,status:string,attempt:number,error:string|null,finishReason:string|null,messages:Message[]}} Turn */
/** @param {string} path @param {RequestInit} [options] */
async function request(path, options = {}) {
  const response = await fetch('/api/pig-king/' + path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code || 'offline');
  return data;
}
export const session = () => request('chat/session');
export const profile = () => request('me/profile');
/** @param {{displayName:string,locale:string}} input */
export const saveProfile = input => request('me/profile', {method:'PATCH',body:JSON.stringify(input)});
/** @param {string} state @param {string|null} [cursor] */
export const list = (state, cursor) => request('chat/conversations?' + new URLSearchParams({state,...(cursor ? {cursor} : {})}));
/** @param {string} id */
export const create = id => request('chat/conversations', {method:'POST',body:JSON.stringify({id})});
/** @param {string} id @param {string|null} [before] */
export const history = (id, before) => request('chat/conversations/' + id + '/turns' + (before ? '?before='+before : ''));
/** @param {string} id @param {{content:string,clientRequestId:string}} input */
export const send = (id, input) => request('chat/conversations/'+id+'/turns', {method:'POST',body:JSON.stringify(input)});
/** @param {string} id @param {string} turn @param {'retry'|'cancel'} action @param {number} [attempt] */
export const changeTurn = (id,turn,action,attempt) => request(`chat/conversations/${id}/turns/${turn}/${action}`, {method:'POST',body:JSON.stringify(action==='retry'?{expectedAttempt:attempt}:{})});
/** @param {Conversation} conversation @param {{title?:string,state?:string}} input */
export const edit = (conversation,input) => request('chat/conversations/'+conversation.id, {method:'PATCH',body:JSON.stringify({...input,expectedRevision:conversation.revision})});
/** @param {string} id */
export const remove = id => request('chat/conversations/'+id, {method:'DELETE'});
