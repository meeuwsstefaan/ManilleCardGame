// Append-only event keys avoid shared read/modify/write counters.
// The public response contains aggregates only, never browser IDs or raw events.
export const DAYS = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['visit', 'start', 'complete', 'replay']);
const DAY = 86400000;
const MAX_KEYS = 50000;
const dateKey = date => new Date(date).toISOString().slice(0, 10);

export function sourceName(value, ownHost) {
  if (!value || value === 'direct') return 'direct';
  if (typeof value !== 'string' || value.length > 253) throw new Error('Invalid source');
  // Hosts only. Never retain query strings, paths, user names or fragments.
  const host = value.toLowerCase().replace(/^www\./, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw new Error('Invalid source');
  return host === ownHost.toLowerCase().replace(/^www\./, '') ? 'direct' : host;
}

export function eventKey(data, ownHost, now = Date.now()) {
  if (!data || !TYPES.has(data.type) || !UUID.test(data.visitor || '')) throw new Error('Invalid event');
  if (Object.keys(data).some(key => !['type', 'visitor', 'deal', 'source'].includes(key))) throw new Error('Unexpected field');
  const deal = data.type === 'complete' ? data.deal : '-';
  if (data.type === 'complete' && !UUID.test(deal || '')) throw new Error('Invalid deal');
  const source = data.type === 'visit' ? sourceName(data.source, ownHost) : '-';
  return `${dateKey(now)}/${data.type}/${data.visitor.toLowerCase()}/${deal}/${source}`;
}

export function summarize(keys, now = Date.now()) {
  const start = dateKey(now - (DAYS - 1) * DAY), end = dateKey(now);
  const visitors = new Set(), starters = new Set(), replayers = new Set(), deals = new Set(), sources = new Map();
  for (const key of keys) {
    const [date, type, visitor, deal, source, extra] = key.split('/');
    if (extra || date < start || date > end || !TYPES.has(type) || !UUID.test(visitor || '')) continue;
    visitors.add(visitor);
    if (type === 'start' || type === 'complete' || type === 'replay') starters.add(visitor);
    if (type === 'replay') replayers.add(visitor);
    if (type === 'complete' && UUID.test(deal || '')) deals.add(`${visitor}/${deal}`);
    if (type === 'visit') {
      if (!sources.has(source)) sources.set(source, new Set());
      sources.get(source).add(visitor);
    }
  }
  return {days: DAYS, from: start, to: end, visitors: visitors.size, started: starters.size,
    completed: deals.size, replayed: replayers.size,
    sources: [...sources].map(([source, ids]) => ({source, visitors: ids.size}))
      .sort((a, b) => b.visitors - a.visitors || a.source.localeCompare(b.source))};
}

export async function recentKeys(store, now = Date.now()) {
  const keys = [];
  for (let offset = 0; offset < DAYS; offset++) {
    for await (const page of store.list({prefix: dateKey(now - offset * DAY) + '/', paginate: true})) {
      keys.push(...page.blobs.map(blob => blob.key));
      if (keys.length > MAX_KEYS) throw new Error('Reporting capacity exceeded');
    }
  }
  return keys;
}

export function createHandler(getStore, {now = Date.now} = {}) {
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  return async request => {
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) return json({error: 'Method not allowed'}, 405);
    try {
      if (request.method === 'GET') {
        return json(summarize(await recentKeys(getStore(), now()), now()));
      }
      // JSON + a same-origin check prevent a third-party page posting events.
      if (request.headers.get('origin') !== url.origin) return json({error: 'Origin not allowed'}, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({error: 'Expected JSON'}, 415);
      if (Number(request.headers.get('content-length')) > 1024) return json({error: 'Too large'}, 413);
      const body = await request.text();
      if (body.length > 1024) return json({error: 'Too large'}, 413);
      let key;
      try { key = eventKey(JSON.parse(body), url.hostname, now()); }
      catch { return json({error: 'Invalid event'}, 400); }
      await getStore().set(key, '', {onlyIfNew: true});
      return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store'}});
    } catch {
      // Never turn storage failure into a misleading table of zeros.
      return json({error: 'Analytics temporarily unavailable'}, 503);
    }
  };
}

export async function removeExpired(store, now = Date.now()) {
  const cutoff = dateKey(now - 30 * DAY);
  for await (const page of store.list({paginate: true})) {
    const expired = page.blobs.filter(({key}) => /^\d{4}-\d{2}-\d{2}\//.test(key) && key.slice(0, 10) < cutoff);
    for (let i = 0; i < expired.length; i += 20) {
      await Promise.all(expired.slice(i, i + 20).map(({key}) => store.delete(key)));
    }
  }
}
