// Public sync boundary: callers supply content, credentials and HTTP transport.
// All source mapping and remote reads finish before the first content mutation.
const mappings = {
  features: (f, i) => ({ title: f.t, description: f.d, sort: i }),
  tiers: (t, i) => ({ name: t.n, price: t.p, description: t.d, features: t.f.join('\n'), cta: t.cta, highlight: t.hi, sort: i }),
  faqs: (q, i) => ({ question: q.q, answer: q.a, sort: i }),
  changelog: (c, i) => ({ date: c.date, title: c.title, body: c.body, sort: i }),
};

export async function syncContent({ content, base, email, password, fetch: transport = globalThis.fetch }) {
  if (!email || !password) throw new Error('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');
  if (!content?.site || typeof content.site !== 'object' || Array.isArray(content.site)) throw new Error('Missing site content');
  const desired = { settings: [content.site] };
  for (const [name, map] of Object.entries(mappings)) {
    if (!Array.isArray(content[name])) throw new Error(`Missing content list: ${name}`);
    desired[name] = content[name].map((row, index) => map(row, index));
  }
  async function request(path, method = 'GET', body = undefined, token = '') {
    const response = await transport(`${base}${path}`, {
      method, signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path} failed: HTTP ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  }
  const auth = await request('/collections/_superusers/auth-with-password', 'POST', { identity: email, password });
  if (typeof auth?.token !== 'string' || !auth.token) throw new Error('Missing authentication token');
  async function readAll(name) {
    const records = [];
    let page = 1, totalPages;
    do {
      const data = await request(`/collections/${name}/records?sort=${name === 'settings' ? 'id' : 'sort,id'}&perPage=200&page=${page}`, 'GET', undefined, auth.token);
      if (!Array.isArray(data?.items) || data.page !== page || !Number.isInteger(data.totalPages) || data.totalPages < 0 ||
          !Number.isInteger(data.totalItems) || data.totalItems < 0 || data.items.some(row => typeof row?.id !== 'string' || !row.id)) {
        throw new Error(`Invalid collection response: ${name}`);
      }
      if (totalPages !== undefined && totalPages !== data.totalPages) throw new Error(`Collection changed during read: ${name}`);
      totalPages = data.totalPages;
      records.push(...data.items);
      if (page >= totalPages && records.length !== data.totalItems) throw new Error(`Incomplete collection: ${name}`);
      page++;
    } while (page <= totalPages);
    if (new Set(records.map(row => row.id)).size !== records.length) throw new Error(`Duplicate record IDs: ${name}`);
    return records;
  }
  const snapshots = {};
  for (const name of Object.keys(desired)) snapshots[name] = await readAll(name);
  if (snapshots.settings.length > 1) throw new Error('Expected at most one settings record');
  const results = [];
  for (const [name, rows] of Object.entries(desired)) {
    const existing = snapshots[name];
    const result = { name, updated: 0, created: 0, removed: 0 };
    for (let i = 0; i < rows.length; i++) {
      const current = existing[i];
      await request(`/collections/${name}/records${current ? '/' + encodeURIComponent(current.id) : ''}`,
        current ? 'PATCH' : 'POST', rows[i], auth.token);
      current ? result.updated++ : result.created++;
    }
    for (const row of existing.slice(rows.length)) {
      await request(`/collections/${name}/records/${encodeURIComponent(row.id)}`, 'DELETE', undefined, auth.token);
      result.removed++;
    }
    results.push(result);
  }
  return results;
}
