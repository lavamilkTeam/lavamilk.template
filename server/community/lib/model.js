// Shared, bounded model transport for reviews and chat. Model credentials stay here.
export function createModel(config = {}, transport) {
  let busy = false;
  const enabled = !!(config.url && config.model);
  return {
    ...config,
    enabled,
    async send(request, signal) {
      if (!enabled) throw new Error('modelUnavailable');
      if (busy) return { statusCode: 503, json: {} };
      busy = true;
      try {
        const timeout = AbortSignal.timeout(Math.min(request.timeout || 90, 90) * 1000);
        const response = await transport(config.url, {
          method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: 'Bearer ' + config.key } : {}) },
          body: request.body,
        });
        return { statusCode: response.status, json: response.ok ? await response.json() : {} };
      } finally { busy = false; }
    },
  };
}

export function createChat(model, now) {
  const recent = new Map();
  return async function chat(input, user, signal) {
    if (!model.enabled) throw new Error('modelUnavailable');
    const messages = input?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 21 || messages.length % 2 !== 1 ||
      messages.some((m, i) => !m || m.role !== (i % 2 ? 'assistant' : 'user') ||
        typeof m.content !== 'string' || !m.content.trim() || m.content.length > 6000) ||
      messages.reduce((n, m) => n + m.content.length, 0) > 12000) throw new Error('invalidMessage');
    for (const [id, time] of recent) if (now() - time >= 3000) recent.delete(id);
    if (recent.has(user.id) || recent.size >= 1024) throw Object.assign(new Error('rateLimit'), { retryAfter: 3 });
    recent.set(user.id, now());
    try {
      const response = await model.send({ timeout: 90, body: JSON.stringify({
        model: model.model, stream: false, max_tokens: 700,
        ...(model.provider === 'llamacpp' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        messages: [{ role: 'system', content: 'You are Lavamilk AI, a helpful assistant powered by Gemma. Answer in the language used by the user. Be clear and concise. You have no tools, browsing or access to private files. Do not claim to have performed actions or read content that was not provided.' },
          ...messages.map(({ role, content }) => ({ role, content }))],
      }) }, signal);
      if (response.statusCode === 503 || response.statusCode === 429) throw new Error('modelBusy');
      const choice = response.json?.choices?.[0];
      if (response.statusCode !== 200 || typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('modelUnavailable');
      if (Buffer.byteLength(choice.message.content)>65536) throw new Error('modelUnavailable');
      const tokens = value => Number.isSafeInteger(value) && value>=0 && value<=4294967295 ? value : null;
      return { message: choice.message.content, truncated: choice.finish_reason === 'length', model: model.model,
        inputTokens:tokens(response.json.usage?.prompt_tokens),outputTokens:tokens(response.json.usage?.completion_tokens) };
    } catch (error) {
      if (['modelBusy', 'modelUnavailable'].includes(error.message)) throw error;
      throw new Error('modelUnavailable', { cause: error });
    }
  };
}
