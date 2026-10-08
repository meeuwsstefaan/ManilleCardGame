// Exercise the real app handlers with a small DOM and controlled timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NAMES, makeDeck, winningPlay} from './engine.mjs';

class Element {
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  constructor() {
    this.children = []; this.handlers = {}; this.disabled = false; this.hidden = false;
    this.checked = false; this.value = ''; this.textContent = ''; this.className = '';
    this.classList = {toggle() {}}; this.attributes = {};
    this.style = {properties: {}, setProperty(name, value) { this.properties[name] = value; }};
    this.rect = {left: 0, top: 0, width: 68, height: 96};
  }
  append(...items) { this.children.push(...items); }
  prepend(item) { this.children.unshift(item); item.parent = this; }
  replaceChildren(...items) { this.children = items; }
  get lastChild() { return this.children.at(-1); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getBoundingClientRect() { return this.rect; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  click() { if (!this.disabled) this.handlers.click?.(); }
}

test('app shuffles and deals the preview, pauses for joining, scores once, and resets', async () => {
  const saved = {document: globalThis.document, setTimeout, clearTimeout, confirm: globalThis.confirm, random: Math.random, localStorage: globalThis.localStorage, fetch: globalThis.fetch};
  const analyticsEvents = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/.netlify/functions/manille-analytics');
    if (options.method === 'POST') analyticsEvents.push(JSON.parse(options.body));
    return {ok: true, json: async () => ({visitors:1,started:0,completed:0,replayed:0,sources:[],from:'2026-10-01',to:'2026-10-14'})};
  };
  const stored = new Map();
  stored.set('manille.language', 'en');
  globalThis.localStorage = {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)};
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  let seed = 42, pending = null, pendingId = null, timerId = 0;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  globalThis.document = {getElementById: get, createElement: () => new Element(), documentElement: {dataset: {}},
    defaultView: {location: {hostname:'example.com',port:''}, addEventListener() {}}, referrer: 'https://reddit.com/r/cards',
    querySelectorAll: selector => {
      const all = new Set();
      const visit = el => { if (all.has(el)) return; all.add(el); el.children.forEach(visit); };
      elements.forEach(visit);
      return [...all].filter(el => el.getAttribute(selector.slice(1, -1)) !== null);
    }};
  globalThis.setTimeout = handler => { pending = handler; pendingId = ++timerId; return pendingId; };
  globalThis.clearTimeout = id => { if (id === pendingId) pending = null; };
  globalThis.confirm = () => true;
  get('show-hands').checked = true; get('speed').value = '200';
  for (let player = 0; player < 4; player++) {
    get(`seat-${player}`).rect = {left: player * 150, top: player * 100, width: 200, height: 100};
  }
  const hand = () => get('seat-0').children[1].children;
  const score = () => [Number(get('our-score').textContent), Number(get('their-score').textContent)];
  const faceName = face => face.attributes['aria-label'].split(',')[0];
  const preview = () => get('deck-preview').children.map(item => faceName(item.children[1]));
  let lastTrick = null, lastWinner = null, reviews = 0;
  function checkLanguageSwitch() {
    const before = {timer: pending, scores: score(), history: [...get('history').children],
      texts: get('history').children.map(el => el.textContent), status: get('status').textContent,
      faces: [...get('trick-collection').children], trick: [...get('trick').children]};
    get('language').handlers.change({target: {value: 'nl'}});
    assert.notEqual(get('status').textContent, before.status);
    assert.notEqual(get('history').children[0].textContent, before.texts[0]);
    assert.equal(pending, before.timer);
    assert.deepEqual(score(), before.scores);
    assert.deepEqual(get('history').children, before.history);
    assert.deepEqual(get('trick-collection').children, before.faces);
    assert.deepEqual(get('trick').children, before.trick);
    get('language').handlers.change({target: {value: 'fr'}});
    assert.notEqual(get('status').textContent, before.status);
    assert.notEqual(get('history').children[0].textContent, before.texts[0]);
    assert.equal(pending, before.timer);
    assert.deepEqual(score(), before.scores);
    assert.deepEqual(get('history').children, before.history);
    assert.deepEqual(get('trick-collection').children, before.faces);
    assert.deepEqual(get('trick').children, before.trick);
    assert.equal(document.documentElement.lang, 'fr');
    get('language').handlers.change({target: {value: 'zh-Hans'}});
    assert.equal(document.documentElement.lang, 'zh-Hans');
    assert.notEqual(get('status').textContent, before.status);
    assert.notEqual(get('history').children[0].textContent, before.texts[0]);
    assert.equal(pending, before.timer);
    assert.deepEqual(score(), before.scores);
    assert.deepEqual(get('history').children, before.history);
    assert.deepEqual(get('trick-collection').children, before.faces);
    assert.deepEqual(get('trick').children, before.trick);
    get('language').handlers.change({target: {value: 'both'}});
    assert.equal(get('status').children[1].lang, 'en');
    get('language').handlers.change({target: {value: 'en'}});
    assert.deepEqual(get('history').children.map(el => el.textContent), before.texts);
    assert.equal(get('status').textContent, before.status);
  }
  function reviewLastHand() {
    const snapshot = () => get('trick').children.map(slot => slot.children[1].attributes['aria-label']);
    const before = {cards: snapshot(), score: score(), label: get('trick-label').textContent,
      history: get('history').children.length, auto: get('auto').textContent, scheduled: Boolean(pending)};
    assert.equal(get('show-last-hand').disabled, false);
    get('show-last-hand').click();
    assert.equal(get('show-last-hand').textContent, 'Back to Game');
    assert.equal(get('show-last-hand').attributes['aria-pressed'], 'true');
    assert.match(get('trick-label').textContent, /^LAST HAND: TRICK/);
    assert.equal(pending, null, 'review pauses automatic play');
    assert.equal(get('step').disabled, true);
    assert.equal(get('auto').disabled, true);
    assert.ok(hand().every(button => button.disabled));
    const slots = get('trick').children;
    for (const [player, card] of lastTrick) {
      assert.equal(faceName(slots[player].children[1]), `${card.rank} of ${card.suit}`);
    }
    assert.deepEqual(slots.flatMap((slot, player) => slot.children[1].className.includes('winner') ? [player] : []), [lastWinner]);
    assert.match(slots[lastWinner].children[1].attributes['aria-label'], /won the last trick/);
    if (!reviews) checkLanguageSwitch();
    get('show-hands').handlers.change();
    get('speed').handlers.change();
    assert.equal(pending, null, 'settings cannot restart play during review');
    get('show-last-hand').click();
    assert.equal(get('show-last-hand').textContent, 'Show Last Hand');
    assert.equal(get('show-last-hand').attributes['aria-pressed'], 'false');
    assert.deepEqual(snapshot(), before.cards, 'restore even a partially played current trick');
    assert.deepEqual(score(), before.score);
    assert.equal(get('history').children.length, before.history);
    assert.equal(get('trick-label').textContent, before.label);
    assert.equal(get('auto').textContent, before.auto);
    assert.equal(Boolean(pending), before.scheduled, 'preserve pause/resume state');
    reviews++;
  }
  function shuffleAndDeal() {
    assert.equal(get('show-last-hand').disabled, true);
    lastTrick = null;
    assert.equal(get('deck-preview').children.length, 32);
    assert.equal(new Set(preview()).size, 32);
    assert.equal(get('step').disabled, true); assert.equal(get('auto').disabled, true);
    assert.equal(pending, null);
    checkLanguageSwitch();
    for (let repeat = 0; repeat < 2; repeat++) {
      const before = preview();
      get('shuffle-deck').click();
      assert.equal(get('deal-cards').disabled, true);
      assert.equal(get('shuffle-deck').disabled, true);
      assert.equal(get('new-game').disabled, true);
      const seedAfterClick = seed;
      const animation = pending;
      const historyBeforeLanguage = [...get('history').children];
      for (const language of ['nl', 'fr', 'zh-Hans', 'both', 'en']) {
        get('language').handlers.change({target: {value: language}});
        assert.equal(pending, animation, 'language changes preserve the shuffle timer');
        assert.deepEqual(get('deck-preview').children.map(item => {
          const card = JSON.parse(item.children[1].getAttribute('data-i18n-aria-values')).card;
          return `${card.rank} of ${card.suit}`;
        }), before, 'language changes preserve the deck');
        assert.deepEqual(get('history').children, historyBeforeLanguage);
        assert.equal(get('deal-cards').disabled, true);
      }
      get('shuffle-deck').click(); get('deal-cards').click(); get('new-game').click();
      assert.equal(seed, seedAfterClick);
      assert.deepEqual(preview(), before);
      let ticks = 0;
      while (pending) {
        assert.deepEqual(preview(), before); // Only publish the order on completion.
        assert.ok(++ticks <= 32);
        const callback = pending; pending = null; callback();
      }
      assert.equal(get('deal-cards').disabled, false);
      assert.notDeepEqual(preview(), before);
      assert.match(get('shuffle-note').textContent, new RegExp(`^${repeat + 1} shuffle`));
      assert.match(get('deck-order-note').textContent, /^Shuffled order/);
    }
    const order = preview();
    const dealerName = get('dealer').textContent.slice('Dealer: '.length);
    const dealer = NAMES.indexOf(dealerName);
    const expectedHands = [[], [], [], []]; let cursor = 0;
    for (const packet of [3, 2, 3]) for (let offset = 1; offset <= 4; offset++) {
      expectedHands[(dealer + offset) % 4].push(...order.slice(cursor, cursor + packet)); cursor += packet;
    }
    const priorScore = score();
    get('deal-cards').click();
    assert.equal(get('shuffle-panel').hidden, true);
    assert.deepEqual(score(), priorScore);
    for (let player = 0; player < 4; player++) {
      assert.deepEqual(new Set(get(`seat-${player}`).children[1].children.map(faceName)), new Set(expectedHands[player]));
    }
  }
  try {
    await import('./app.mjs');
    assert.equal(get('analytics-panel').hidden, true);
    const timerBeforeAnalytics = pending;
    get('analytics-toggle').click();
    assert.equal(get('analytics-panel').hidden, false);
    get('analytics-toggle').click();
    assert.equal(get('analytics-panel').hidden, true);
    assert.equal(pending, timerBeforeAnalytics, 'analytics must not change the game timer');
    assert.equal(get('suit-buttons').children.length, 5);
    assert.equal(get('shuffle-panel').hidden, false);
    assert.deepEqual(preview(), makeDeck().map(card => `${card.rank} of ${card.suit}`));
    shuffleAndDeal();
    while (!get('redeal').hidden) { get('redeal').click(); shuffleAndDeal(); }
    assert.equal(get('trump-picker').hidden, false);
    checkLanguageSwitch();
    // Concealed hands must stay concealed, including labels and tooltips.
    get('show-hands').checked = false;
    get('show-hands').handlers.change();
    for (const language of ['nl', 'fr', 'zh-Hans', 'both', 'en']) {
      get('language').handlers.change({target: {value: language}});
      for (const player of [1, 2, 3]) for (const card of get(`seat-${player}`).children[1].children) {
        assert.equal(card.getAttribute('data-i18n-aria'), 'faceDown');
        assert.equal(card.getAttribute('title'), null);
        assert.equal(card.getAttribute('data-i18n-aria-values'), '{}');
      }
    }
    get('show-hands').checked = true;
    get('show-hands').handlers.change();
    get('suit-buttons').children[4].click(); // Human declares Null.
    assert.match(get('trump').textContent, /Null.*×2/);
    assert.equal(get('join-picker').hidden, true);
    assert.deepEqual(score(), [0, 0]);
    let joined = 0, passed = 0, completed = 0, observedJoin = false;
    const observedTrickSizes = new Set();
    let collected = [], collections = 0, finalCollections = 0;
    for (let actions = 0; actions < 20000; actions++) {
      if (!get('shuffle-panel').hidden) {
        if (collected.length === 32) assert.deepEqual(preview(), collected);
        collected = []; shuffleAndDeal(); continue;
      }
      const slots = get('trick').children;
      assert.deepEqual(slots.map(slot => slot.className), ['trick-slot south', 'trick-slot west', 'trick-slot north', 'trick-slot east']);
      const trick = slots.flatMap((slot, player) => {
        const face = slot.children[1];
        const match = face.attributes['aria-label']?.match(/^(.+) of (\w+),/);
        return match ? [[player, {rank: match[1], suit: match[2]}]] : [];
      });
      // Restore chronological order using the newest play messages.
      const order = get('history').children.map(item => NAMES.find(name => item.textContent.startsWith(`${name} play `) || item.textContent.startsWith(`${name} plays `))).filter(Boolean).slice(0, trick.length).reverse();
      trick.sort((a, b) => order.indexOf(NAMES[a[0]]) - order.indexOf(NAMES[b[0]]));
      const highlighted = slots.flatMap((slot, player) => slot.children[1].className.split(' ').includes('winner') ? [player] : []);
      if (trick.length) {
        const trumpText = String(get('trump').textContent);
        const trump = ['Clubs', 'Diamonds', 'Hearts', 'Spades', 'Null'].find(suit => trumpText.includes(suit));
        assert.deepEqual(highlighted, [winningPlay(trick, trump)[0]]);
        assert.match(slots[highlighted[0]].children[1].attributes['aria-label'], /currently winning the trick/);
        observedTrickSizes.add(trick.length);
        if (trick.length === 4 && collected.length === (Number(String(get('trick-label').textContent).match(/\d+/)[0]) - 1) * 4) {
          collected.push(...trick.map(([, card]) => `${card.rank} of ${card.suit}`));
        }
      } else assert.deepEqual(highlighted, []);
      if (get('trick-collection').children.length) {
        const layer = get('trick-collection');
        assert.equal(layer.children.length, 4);
        assert.equal(layer.attributes['data-winner'], highlighted[0]);
        assert.equal(layer.children.at(-1).className.includes('winner'), true);
        const target = get(`seat-${highlighted[0]}`).rect;
        assert.equal(layer.children[0].style.properties['--target-x'], `${target.left + target.width / 2 - 34}px`);
        assert.equal(layer.children[0].style.properties['--target-y'], `${target.top + target.height / 2 - 48}px`);
        const before = score(), label = get('trick-label').textContent;
        if (!collections) checkLanguageSwitch();
        for (const id of ['next-deal', 'step', 'auto', 'new-game', 'show-last-hand']) {
          assert.equal(get(id).disabled, true); get(id).click();
        }
        assert.equal(get('trick-label').textContent, label); assert.deepEqual(score(), before);
        assert.ok(pending, 'collection must finish even while computers are paused');
        const callback = pending; pending = null; callback();
        lastTrick = trick; lastWinner = highlighted[0];
        reviewLastHand();
        assert.equal(layer.children.length, 0);
        assert.deepEqual(score(), before);
        assert.ok(get('trick').children.every(slot => slot.children[1].className === 'empty-card'));
        collections++;
        if (String(label).includes('8 OF 8')) finalCollections++;
        continue;
      }
      if (lastTrick) reviewLastHand();
      if (!get('redeal').hidden) { get('redeal').click(); continue; }
      if (!get('join-picker').hidden) {
        checkLanguageSwitch();
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
        checkLanguageSwitch();
        assert.ok(Math.max(...score()) >= 101);
        assert.equal(get('next-deal').disabled, true);
        assert.equal(get('step').disabled, true);
        assert.equal(get('auto').disabled, true);
        assert.equal(pending, null);
        const final = score(); get('next-deal').click(); assert.deepEqual(score(), final);
        break;
      }
      if (!get('next-deal').disabled) {
        checkLanguageSwitch();
        completed++;
        const raw = String(get('deal-score').textContent).match(/Your team (\d+).*Opponents (\d+)/);
        const double = String(get('trump').textContent).includes('×2');
        const earned = raw.slice(1).map(value => Math.max(Number(value) - 30, 0) * (double ? 2 : 1));
        const before = score();
        assert.match(get('history').children[0].textContent, new RegExp(`counted points \\+${earned[0]} / \\+${earned[1]}`));
        get('show-hands').handlers.change(); assert.deepEqual(score(), before);
        assert.equal(collected.length, 32);
        get('next-deal').click(); assert.deepEqual(score(), before);
        assert.deepEqual(preview(), collected);
        assert.notDeepEqual(preview(), makeDeck().map(card => `${card.rank} of ${card.suit}`));
        assert.match(get('deck-order-note').textContent, /^Collected order from Deal/);
        get('show-hands').handlers.change();
        assert.deepEqual(preview(), collected, 'redrawing must keep the collected order');
        continue;
      }
      if (!get('trump-picker').hidden) { get('suit-buttons').children[4].click(); continue; }
      const playable = hand().find(button => !button.disabled);
      if (playable) playable.click();
      else get('step').click();
    }
    assert.match(get('status').textContent, /^Match complete:/);
    assert.deepEqual([...observedTrickSizes].sort(), [1, 2, 3, 4]);
    assert.equal(collections, (completed + 1) * 8);
    assert.equal(finalCollections, completed + 1);
    assert.ok(reviews > collections, 'also review while a new trick is in progress');
    assert.ok(completed > 1); assert.ok(observedJoin); assert.equal(joined, 1); assert.ok(passed > 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(analyticsEvents.filter(event => event.type === 'visit').length, 1);
    assert.equal(analyticsEvents.filter(event => event.type === 'start').length, 1);
    assert.equal(analyticsEvents.filter(event => event.type === 'replay').length, 1);
    const completions = analyticsEvents.filter(event => event.type === 'complete');
    assert.equal(completions.length, completed + 1, 'each finished deal counted once despite reviews and language changes');
    assert.equal(new Set(completions.map(event => event.deal)).size, completed + 1);
    get('show-last-hand').click();
    get('new-game').click();
    assert.equal(get('show-last-hand').disabled, true);
    assert.equal(get('show-last-hand').attributes['aria-pressed'], 'false');
    assert.deepEqual(score(), [0, 0]);
    assert.equal(get('deal-number').textContent, 'Deal 1');
    assert.equal(get('join-picker').hidden, true);
    assert.equal(get('shuffle-panel').hidden, false);
    assert.deepEqual(preview(), collected, 'New game must retain the last collected deck');
    assert.match(get('deck-order-note').textContent, /^Collected order/);
    const persisted = JSON.parse(stored.get('manille.lastCollectedDeck.v1'));
    assert.deepEqual(persisted.map(card => `${card.rank} of ${card.suit}`), collected);

    // A fresh page module has no previous deal in memory: recover the saved deck.
    elements.clear();
    get('show-hands').checked = true; get('speed').value = '200';
    await import('./app.mjs?reload-test');
    assert.deepEqual(preview(), collected, 'page refresh must restore collection order');
    assert.deepEqual(score(), [0, 0]);

    // Exercise autoplay through a whole match with the real scheduler and AI.
    assert.equal(get('autoplay-hand').checked, false);
    const toggleAutoplay = value => {
      get('autoplay-hand').checked = value;
      get('autoplay-hand').handlers.change();
    };
    toggleAutoplay(true);
    assert.equal(pending, null, 'autoplay leaves dealing manual');
    let autoDeals = 0, autoJoins = 0, autoCards = 0, autoTrump = 0;
    for (let action = 0; action < 20000; action++) {
      if (!get('shuffle-panel').hidden) {
        shuffleAndDeal();
        continue;
      }
      if (!get('redeal').hidden) { get('redeal').click(); continue; }
      if (get('trick-collection').children.length) {
        const animation = pending;
        toggleAutoplay(false); toggleAutoplay(true);
        assert.equal(pending, animation, 'toggle preserves collection animation');
        const callback = pending; pending = null; callback();
        continue;
      }
      if (String(get('status').textContent).startsWith('Match complete:')) break;
      if (!get('next-deal').disabled) {
        autoDeals++;
        assert.equal(pending, null, 'next deal stays manual');
        get('next-deal').click(); continue;
      }
      // Pause and hand control back before each decision, then restore autoplay.
      if (get('auto').textContent === 'Pause computers') get('auto').click();
      assert.equal(pending, null);
      toggleAutoplay(false);
      if (!get('trump-picker').hidden) {
        autoTrump++;
        assert.equal(get('step').disabled, true);
      } else if (!get('join-picker').hidden) {
        autoJoins++;
        assert.equal(get('step').disabled, true);
      } else if (hand().some(card => !card.disabled)) autoCards++;
      toggleAutoplay(true);
      assert.equal(pending, null, 'autoplay respects Pause');
      assert.equal(get('trump-picker').hidden, true);
      assert.equal(get('join-picker').hidden, true);
      assert.ok(hand().every(card => !card.handlers.click), 'autoplay cards cannot be clicked');
      assert.equal(get('step').disabled, false);
      if (action % 2) {
        get('step').click();
      } else {
        get('auto').click();
        assert.ok(pending, 'Resume schedules autoplay');
        const callback = pending; pending = null; callback();
      }
    }
    assert.match(get('status').textContent, /^Match complete:/);
    assert.ok(autoDeals > 0);
    assert.ok(autoTrump > 0, 'computer chose trump for seat zero');
    assert.ok(autoJoins > 0, 'computer handled joining for seat zero');
    assert.ok(autoCards >= 8, 'computer played seat zero cards');
    assert.equal(pending, null);

    // Reject incomplete or corrupt saved decks rather than dropping cards.
    stored.set('manille.lastCollectedDeck.v1', JSON.stringify(persisted.slice(1)));
    elements.clear();
    await import('./app.mjs?invalid-storage-test');
    assert.deepEqual(preview(), makeDeck().map(card => `${card.rank} of ${card.suit}`));
  } finally {
    globalThis.document = saved.document; globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout; globalThis.confirm = saved.confirm; Math.random = saved.random;
    globalThis.localStorage = saved.localStorage;
    globalThis.fetch = saved.fetch;
  }
});
