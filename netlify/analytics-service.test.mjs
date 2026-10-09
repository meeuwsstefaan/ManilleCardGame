import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHandler, eventKey, summarize, removeExpired} from './analytics-service.mjs';

const now = Date.parse('2026-10-08T12:00:00Z');
function storeFixture() {
  const keys = new Set();
  return {keys, async set(key, value, options) { assert.equal(options.onlyIfNew, true); keys.add(key); },
    async *list({prefix = ''}) {
      const selected = [...keys].filter(key => key.startsWith(prefix));
      for (let i = 0; i < selected.length; i += 2) yield {blobs: selected.slice(i, i + 2).map(key => ({key}))};
    }, async delete(key) { keys.delete(key); }};
}
const post = data => new Request('https://example.com/.netlify/functions/manille-analytics', {
  method: 'POST', headers: {'Origin': 'https://example.com', 'Content-Type': 'application/json'}, body: JSON.stringify(data)});

test('concurrent and duplicate events count unique visitors, starts, completed deals, replay and sources', async () => {
  const store = storeFixture(), handler = createHandler(() => store, {now: () => now});
  const a = randomUUID(), b = randomUUID(), deal = randomUUID();
  const events = [
    {type:'visit', visitor:a, source:'www.reddit.com'}, {type:'visit', visitor:b, source:'example.com'},
    {type:'start', visitor:a}, {type:'complete', visitor:a, deal}, {type:'replay', visitor:a},
  ];
  const responses = await Promise.all([...events, ...events].map(data => handler(post(data))));
  assert.ok(responses.every(response => response.status === 204));
  assert.equal(store.keys.size, 5);
  const result = await (await handler(new Request('https://example.com/api'))).json();
  assert.deepEqual(result, {days:14, from:'2026-09-25', to:'2026-10-08', visitors:2, started:1,
    completed:1, replayed:1, sources:[{source:'direct',visitors:1},{source:'reddit.com',visitors:1}]});
  assert.ok(!JSON.stringify(result).includes(a));
  assert.ok(!JSON.stringify(result).includes(deal));
});

test('window includes 14 UTC dates; visitor and deal IDs deduplicate across dates', () => {
  const visitor = randomUUID(), deal = randomUUID();
  const records = ['2026-09-24', '2026-09-25', '2026-10-08', '2026-10-09'].flatMap(date => [
    `${date}/visit/${visitor}/-/direct`, `${date}/complete/${visitor}/${deal}/-`,
  ]);
  const result = summarize(records, now);
  assert.equal(result.visitors, 1); assert.equal(result.completed, 1);
  assert.equal(summarize(records.slice(0,2), now).visitors, 0);
});

test('invalid payloads, cross-origin writes, wrong methods and full URLs are rejected', async () => {
  const handler = createHandler(() => storeFixture(), {now: () => now});
  for (const data of [null, {}, {type:'visit',visitor:'fake'}, {type:'complete', visitor:randomUUID()},
    {type:'visit',visitor:randomUUID(),source:'https://example.com/private?secret=1'},
    {type:'visit',visitor:randomUUID(),source:'<script>'}, {type:'visit',visitor:randomUUID(),name:'private'}]) {
    assert.equal((await handler(post(data))).status, 400);
  }
  const cross = post({type:'visit',visitor:randomUUID()}); cross.headers.set('Origin','https://evil.example');
  assert.equal((await handler(cross)).status,403);
  assert.equal((await handler(new Request('https://example.com/api',{method:'DELETE'}))).status,405);
  const large = post({extra:'x'.repeat(1025)});
  assert.equal((await handler(large)).status,413);
});

test('storage failure reports unavailable, never fabricated zeros', async () => {
  const handler = createHandler(() => { throw new Error('offline'); });
  assert.equal((await handler(new Request('https://example.com/api'))).status,503);
  assert.equal((await handler(post({type:'visit',visitor:randomUUID()}))).status,503);
});

test('retention removes only dated events older than 30 days', async () => {
  const store = storeFixture(), visitor = randomUUID();
  store.keys.add(eventKey({type:'visit',visitor}, 'example.com', now - 31*86400000));
  store.keys.add(eventKey({type:'visit',visitor}, 'example.com', now - 30*86400000));
  store.keys.add('unrelated');
  await removeExpired(store, now);
  assert.equal(store.keys.size, 2); assert.ok(store.keys.has('unrelated'));
});
