import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTracker, referralSource, setupAnalytics, VISITOR_KEY, EXCLUDE_KEY} from './analytics.mjs';
import {createI18n} from './i18n.mjs';

function storageFixture() {
  const values = new Map();
  return {values, getItem:key => values.get(key), setItem:(key,value) => values.set(key,value)};
}
test('tracks meaningful gameplay once; empty deals and zero-point redeals do not count', async () => {
  const events = [], storage = storageFixture();
  const tracker = createTracker({storage, hostname:'example.com', uuid:randomUUID,
    fetcher:async (url, request) => { events.push(JSON.parse(request.body)); return {ok:true}; }});
  tracker.beginDeal(); tracker.completeDeal(); // No human card: not a finished played deal.
  tracker.beginDeal(); tracker.humanPlayed(); tracker.humanPlayed();
  tracker.completeDeal(); tracker.completeDeal();
  tracker.beginDeal(); // Clicking Deal alone is not another played deal.
  await tracker.flush();
  assert.deepEqual(events.map(event => event.type), ['visit','start','complete']);
  tracker.humanPlayed(); await tracker.flush();
  assert.deepEqual(events.map(event => event.type), ['visit','start','complete','replay']);
  assert.ok(events.every(event => event.visitor === events[0].visitor));
});

test('visitor ID survives reload, expires after 30 days, and opt-out persists', async () => {
  let now = Date.parse('2026-10-08T12:00Z');
  const storage = storageFixture(), events = [];
  const options = {storage, now:() => now, uuid:randomUUID, fetcher:async (url, request) => {
    events.push(JSON.parse(request.body)); return {ok:true}; }};
  const first = createTracker(options); await first.flush();
  const second = createTracker(options); await second.flush();
  assert.equal(events[0].visitor, events[1].visitor);
  second.setExcluded(true); second.humanPlayed(); await second.flush();
  const excluded = createTracker(options); await excluded.flush();
  assert.equal(excluded.excluded,true); assert.equal(events.length,2);
  assert.equal(storage.getItem(EXCLUDE_KEY),'true');
  now += 31*86400000;
  excluded.setExcluded(false); await excluded.flush();
  assert.notEqual(events[0].visitor,events[2].visitor);
  assert.ok(JSON.parse(storage.getItem(VISITOR_KEY)).expires > now);
});

test('blocked storage and network failures never break game callbacks; localhost is disabled', async () => {
  const storage = {getItem(){throw Error();},setItem(){throw Error();}};
  let attempts = 0;
  const tracker = createTracker({storage, uuid:randomUUID, fetcher:async () => {attempts++; throw Error();}});
  tracker.beginDeal(); tracker.humanPlayed(); tracker.completeDeal();
  await tracker.flush(); assert.equal(attempts,6);
  const disabled = createTracker({enabled:false, fetcher:() => {throw Error('must not call');}});
  disabled.beginDeal(); disabled.humanPlayed(); disabled.completeDeal(); await disabled.flush();
});

test('referral collection strips paths, query strings and same-site referrals', () => {
  assert.equal(referralSource('https://www.reddit.com/r/cards?secret=1#private','example.com'),'reddit.com');
  assert.equal(referralSource('https://www.example.com/private','example.com'),'direct');
  assert.equal(referralSource('','example.com'),'direct');
});

function domFixture() {
  class Element {
    constructor() { this.attributes = {}; this.children = []; this.handlers = {}; this.hidden = false; }
    set textContent(value) { this.children = []; this.text = String(value); }
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this.text; }
    setAttribute(key,value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(key,callback) { this.handlers[key] = callback; }
  }
  const elements = new Map();
  const document = {documentElement:{dataset:{}}, defaultView:{location:{hostname:'example.com',port:''}}, referrer:'',
    getElementById(id) { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); },
    createElement() { return new Element(); },
    querySelectorAll(selector) {
      const all = new Set(); const visit = el => {all.add(el); el.children.forEach(visit);}; elements.forEach(visit);
      return [...all].filter(el => el.getAttribute(selector.slice(1,-1)) !== null);
    }};
  return document;
}

test('table fetches only when opened, translates live, closes and reports failures accurately', async () => {
  const document = domFixture(), storage = storageFixture(), i18n = createI18n(document,storage);
  let reads = 0, fail = false;
  const fetcher = async (url, request) => {
    if (request.method === 'POST') return {ok:true};
    reads++; if (fail) throw Error('offline');
    return {ok:true, json:async () => ({visitors:12,started:6,completed:4,replayed:2,
      sources:[{source:'direct',visitors:12}],from:'2026-09-25',to:'2026-10-08'})};
  };
  const tracker = setupAnalytics(document,i18n,storage,{fetcher,uuid:randomUUID});
  const get = id => document.getElementById(id);
  assert.equal(get('analytics-panel').hidden,true); assert.equal(reads,0);
  get('analytics-toggle').handlers.click();
  await tracker.flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads,1); assert.equal(get('analytics-visitors').textContent,'12');
  i18n.setLanguage('fr');
  assert.match(get('analytics-status').textContent,/actualisés/);
  assert.match(get('analytics-sources').textContent,/Accès direct/);
  i18n.setLanguage('zh-Hans');
  assert.equal(get('analytics-status').textContent, '统计数据已更新。');
  assert.match(get('analytics-sources').textContent, /直接访问/);
  assert.equal(get('analytics-visitors').textContent, '12');
  i18n.setLanguage('fr');
  get('analytics-toggle').handlers.click();
  assert.equal(get('analytics-panel').hidden,true);
  fail = true; get('analytics-toggle').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('analytics-visitors').textContent,'—');
  assert.match(get('analytics-status').textContent,/indisponibles/);
});
