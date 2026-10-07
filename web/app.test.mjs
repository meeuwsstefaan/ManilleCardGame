// Exercise the real app handlers with a small DOM and controlled timers.
import test from 'node:test';
import assert from 'node:assert/strict';

class Element {
  constructor() {
    this.children = []; this.handlers = {}; this.disabled = false; this.hidden = false;
    this.checked = false; this.value = ''; this.textContent = ''; this.className = '';
    this.classList = {toggle() {}};
  }
  append(...items) { this.children.push(...items); }
  prepend(item) { this.children.unshift(item); item.parent = this; }
  replaceChildren(...items) { this.children = items; }
  get lastChild() { return this.children.at(-1); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  setAttribute() {}
  addEventListener(event, handler) { this.handlers[event] = handler; }
  click() { if (!this.disabled) this.handlers.click?.(); }
}

test('app pauses for joining, counts deals once, stops the match, and resets', async () => {
  const saved = {document: globalThis.document, setTimeout, clearTimeout, confirm: globalThis.confirm, random: Math.random};
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  let seed = 42, pending = null;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  globalThis.document = {getElementById: get, createElement: () => new Element()};
  globalThis.setTimeout = handler => { pending = handler; return 1; };
  globalThis.clearTimeout = () => { pending = null; };
  globalThis.confirm = () => true;
  get('show-hands').checked = true; get('speed').value = '200';
  const hand = () => get('seat-0').children[1].children;
  const score = () => [Number(get('our-score').textContent), Number(get('their-score').textContent)];
  try {
    await import('./app.mjs');
    assert.equal(get('suit-buttons').children.length, 5);
    assert.equal(get('trump-picker').hidden, false);
    get('suit-buttons').children[4].click(); // Human declares Null.
    assert.match(get('trump').textContent, /Null.*×2/);
    assert.equal(get('join-picker').hidden, true);
    assert.deepEqual(score(), [0, 0]);
    let joined = 0, passed = 0, completed = 0, observedJoin = false;
    for (let actions = 0; actions < 20000; actions++) {
      if (!get('redeal').hidden) { get('redeal').click(); continue; }
      if (!get('join-picker').hidden) {
        observedJoin = true;
        assert.equal(pending, null);
        assert.ok(hand().every(button => button.disabled));
        assert.equal(get('step').disabled, true);
        get('step').click(); assert.equal(get('join-picker').hidden, false);
        if (joined === 0) {
          get('join-trump').click(); joined++;
          assert.match(get('trump').textContent, /joined.*×2/);
        } else { get('pass-trump').click(); passed++; }
        assert.equal(get('join-picker').hidden, true);
        continue;
      }
      if (String(get('status').textContent).startsWith('Match complete:')) {
        assert.ok(Math.max(...score()) >= 101);
        assert.equal(get('next-deal').disabled, true);
        assert.equal(get('step').disabled, true);
        assert.equal(get('auto').disabled, true);
        assert.equal(pending, null);
        const final = score(); get('next-deal').click(); assert.deepEqual(score(), final);
        break;
      }
      if (!get('next-deal').disabled) {
        completed++;
        const raw = String(get('deal-score').textContent).match(/Your team (\d+).*Opponents (\d+)/);
        const double = String(get('trump').textContent).includes('×2');
        const earned = raw.slice(1).map(value => Math.max(Number(value) - 30, 0) * (double ? 2 : 1));
        const before = score();
        assert.match(get('history').children[0].textContent, new RegExp(`counted points \\+${earned[0]} / \\+${earned[1]}`));
        get('show-hands').handlers.change(); assert.deepEqual(score(), before);
        get('next-deal').click(); assert.deepEqual(score(), before);
        continue;
      }
      if (!get('trump-picker').hidden) { get('suit-buttons').children[4].click(); continue; }
      const playable = hand().find(button => !button.disabled);
      if (playable) playable.click();
      else get('step').click();
    }
    assert.match(get('status').textContent, /^Match complete:/);
    assert.ok(completed > 1); assert.ok(observedJoin); assert.equal(joined, 1); assert.ok(passed > 0);
    get('new-game').click();
    assert.deepEqual(score(), [0, 0]);
    assert.equal(get('deal-number').textContent, 'Deal 1');
    assert.equal(get('join-picker').hidden, true);
    assert.equal(get('trump-picker').hidden, false);
  } finally {
    globalThis.document = saved.document; globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout; globalThis.confirm = saved.confirm; Math.random = saved.random;
  }
});
