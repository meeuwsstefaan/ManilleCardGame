export const ANALYTICS_ENDPOINT = '/.netlify/functions/manille-analytics';
export const VISITOR_KEY = 'manille.analytics.visitor.v1';
export const EXCLUDE_KEY = 'manille.analytics.exclude.v1';
const MONTH = 30 * 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function referralSource(referrer, hostname) {
  try {
    const source = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    return source === hostname.toLowerCase().replace(/^www\./, '') ? 'direct' : source;
  } catch { return 'direct'; }
}

export function createTracker({storage, hostname = '', referrer = '', fetcher = globalThis.fetch,
  uuid = () => globalThis.crypto.randomUUID(), now = Date.now, enabled = true} = {}) {
  let excluded = false, identity, completedAny = false, currentDeal, played = false;
  const sent = new Set();
  let pending = Promise.resolve();
  try { excluded = storage?.getItem(EXCLUDE_KEY) === 'true'; } catch { /* Optional storage. */ }
  const source = referralSource(referrer, hostname);

  function visitor() {
    if (identity?.expires > now()) return identity.id;
    try { identity = JSON.parse(storage?.getItem(VISITOR_KEY) || 'null'); } catch { identity = null; }
    if (!identity || !UUID.test(identity.id || '') || !Number.isFinite(identity.expires) || identity.expires <= now() || identity.expires > now() + MONTH) {
      identity = {id: uuid(), expires: now() + MONTH};
      try { storage?.setItem(VISITOR_KEY, JSON.stringify(identity)); } catch { /* Page-only identity. */ }
    }
    return identity.id;
  }

  function send(type, deal) {
    if (!enabled || excluded || !fetcher) return;
    try {
      const id = visitor(), day = new Date(now()).toISOString().slice(0, 10);
      const key = `${day}/${id}/${type}/${deal || ''}`;
      if (sent.has(key)) return;
      sent.add(key);
      const payload = {type, visitor: id, ...(deal ? {deal} : {}), ...(type === 'visit' ? {source} : {})};
      pending = pending.then(async () => {
        if (excluded) { sent.delete(key); return; }
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetcher(ANALYTICS_ENDPOINT, {method: 'POST', credentials: 'omit',
              headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), keepalive: true,
              signal: AbortSignal.timeout(5000)});
            if (response.ok) return;
            if (response.status < 500) break;
          } catch { /* Retry once; never interfere with the game. */ }
        }
        sent.delete(key);
      }).catch(() => { sent.delete(key); });
    } catch { /* Analytics failure must not prevent a card being played. */ }
  }

  const api = {
    beginDeal() { try { currentDeal = uuid(); } catch { currentDeal = null; } played = false; },
    humanPlayed() {
      played = true;
      send('visit'); send('start');
      if (completedAny) send('replay');
    },
    completeDeal() {
      if (!played || !currentDeal) return;
      send('complete', currentDeal); completedAny = true;
    },
    setExcluded(value) {
      excluded = Boolean(value);
      try { storage?.setItem(EXCLUDE_KEY, String(excluded)); } catch { /* Optional storage. */ }
      if (!excluded) send('visit');
    },
    get excluded() { return excluded; },
    get enabled() { return enabled; },
    flush() { return pending; },
  };
  send('visit');
  return api;
}

export function setupAnalytics(document, i18n, storage, options = {}) {
  const location = document.defaultView?.location;
  const local = !location || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  // The dedicated preview server opts into a separate, in-memory data store.
  const enabled = Boolean(location) && (!local || location.port === '8767');
  const tracker = createTracker({storage, hostname: location?.hostname, referrer: document.referrer,
    enabled, ...options});
  const $ = id => document.getElementById(id);
  if (local && enabled) i18n.label($('analytics-window'), 'analyticsPreview');
  const panel = $('analytics-panel'), toggle = $('analytics-toggle'), status = $('analytics-status');
  const exclude = $('analytics-exclude');
  panel.hidden = true;
  exclude.checked = tracker.excluded;
  exclude.addEventListener('change', () => tracker.setExcluded(exclude.checked));
  let loading = false;

  async function refresh() {
    if (loading) return;
    if (!tracker.enabled) { i18n.label(status, 'analyticsLocal'); return; }
    loading = true; $('analytics-refresh').disabled = true;
    i18n.label(status, 'analyticsLoading');
    try {
      await tracker.flush();
      const response = await (options.fetcher || globalThis.fetch)(ANALYTICS_ENDPOINT,
        {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!['visitors', 'started', 'completed', 'replayed'].every(key => Number.isSafeInteger(data[key]) && data[key] >= 0)
        || !Array.isArray(data.sources) || !/^\d{4}-\d{2}-\d{2}$/.test(data.from) || !/^\d{4}-\d{2}-\d{2}$/.test(data.to)) throw new Error('Invalid response');
      for (const key of ['visitors', 'started', 'completed', 'replayed']) $('analytics-' + key).textContent = String(data[key]);
      const list = $('analytics-sources'); list.replaceChildren();
      if (!data.sources.length) i18n.label(status, 'analyticsEmpty');
      else i18n.label(status, 'analyticsLoaded');
      for (const entry of data.sources) {
        const row = document.createElement('li');
        const name = document.createElement('span');
        if (entry.source === 'direct') i18n.label(name, 'analyticsDirect');
        else name.textContent = entry.source;
        const count = document.createElement('strong'); count.textContent = String(entry.visitors);
        row.append(name, count); list.append(row);
      }
      $('analytics-period').textContent = `${data.from} – ${data.to} (UTC)`;
    } catch {
      for (const key of ['visitors', 'started', 'completed', 'replayed']) $('analytics-' + key).textContent = '—';
      $('analytics-sources').replaceChildren(); $('analytics-period').textContent = '—';
      i18n.label(status, 'analyticsUnavailable');
    } finally { loading = false; $('analytics-refresh').disabled = false; }
  }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) { void refresh(); panel.scrollIntoView?.({block: 'nearest'}); }
  });
  $('analytics-refresh').addEventListener('click', () => { void refresh(); });
  return tracker;
}
