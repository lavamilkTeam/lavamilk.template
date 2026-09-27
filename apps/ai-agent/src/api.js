// Same-origin community API; no model URL or key is accepted from the browser.
export async function session() {
  const response = await fetch('/api/pig-king/chat/session', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('offline');
  return response.json();
}

/** @param {{role: string, content: string}[]} messages @param {AbortSignal} signal */
export async function send(messages, signal) {
  const response = await fetch('/api/pig-king/chat', {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code || 'offline');
  if (typeof data.message !== 'string' || !data.message.trim()) throw new Error('modelUnavailable');
  return data;
}
