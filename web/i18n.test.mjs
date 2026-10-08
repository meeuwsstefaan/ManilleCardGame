import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createI18n, formatMessage, LANGUAGE_STORAGE_KEY} from './i18n.mjs';
import en from './locales/en.mjs';
import nl from './locales/nl.mjs';
import fr from './locales/fr.mjs';
import {setupHistoryPanel} from './history-panel.mjs';
import {makeDeck, points} from './engine.mjs';

function fixture() {
  const elements = new Map();
  const make = () => ({
    tagName: 'BUTTON', attributes: {}, children: [], handlers: {}, style: {}, classList: {toggle() {}},
    set textContent(value) { this.children = []; this.valueText = value; },
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this.valueText; },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key] ?? null; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(key, value) { this.handlers[key] = value; },
  });
  const document = {
    documentElement: {dataset: {}}, createElement: make,
    getElementById(id) { if (!elements.has(id)) elements.set(id, make()); return elements.get(id); },
    querySelectorAll(selector) { return [...elements.values()].filter(e => e.getAttribute(selector.slice(1, -1)) !== null); },
  };
  const values = new Map();
  const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)};
  return {document, storage, values};
}

test('all static markup labels and locale keys have all three translations', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(nl).sort());
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) {
    assert.ok(en[key] && nl[key] && fr[key], key);
  }
  assert.match(html, /<option value="fr" lang="fr">Français<\/option>/);
});

test('French selection translates controls, attributes and nested messages and persists on reload', () => {
  const {document, storage, values} = fixture();
  const button = document.getElementById('deal-cards'); button.setAttribute('data-i18n', 'dealCards');
  const i18n = createI18n(document, storage);
  document.getElementById('language').handlers.change({target: {value: 'fr'}});
  assert.equal(button.textContent, 'Distribuer les cartes');
  assert.equal(button.getAttribute('lang'), 'fr');
  assert.equal(document.documentElement.lang, 'fr');
  assert.equal(document.title, 'Manille · la table de jeu');
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'fr');
  assert.equal(createI18n(document, storage).language, 'fr');
  assert.equal(i18n.text('deckOrder', {order: {key: 'initialOrder'}}), 'Ordre initial du paquet · 1–32 · de gauche à droite, puis à la ligne suivante');
  for (const [suit, name] of [['Clubs', 'trèfle'], ['Diamonds', 'carreau'], ['Hearts', 'cœur'], ['Spades', 'pique']]) {
    assert.equal(i18n.text('cardName', {card: {suit, rank: 'Queen'}}), 'Dame de ' + name);
  }
  for (const [rank, expected] of [['Jack', 'V'], ['Queen', 'D'], ['King', 'R'], ['Ace', 'A']]) {
    assert.equal(i18n.text('rankShort', {rank}), expected);
  }
  assert.equal(i18n.text('pointsWon', {player: 0, points: 1}), 'Vous remportez 1 point.');
  assert.equal(i18n.text('pointsWon', {player: 1, points: 2}), 'Florian remporte 2 points.');
});

test('default is bilingual; controls retain Dutch and English language spans', () => {
  const {document, storage, values} = fixture();
  const button = document.getElementById('deal-cards'); button.setAttribute('data-i18n', 'dealCards');
  const i18n = createI18n(document, storage);
  assert.equal(i18n.language, 'both');
  assert.deepEqual(button.children.map(c => [c.lang, c.textContent]), [['nl', 'Kaarten delen'], ['en', 'Deal cards']]);
  document.getElementById('language').handlers.change({target: {value: 'nl'}});
  assert.equal(button.textContent, 'Kaarten delen');
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'nl');
  i18n.setLanguage('en');
  assert.equal(button.textContent, 'Deal cards');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(createI18n(document, storage).language, 'en');
});

test('unavailable storage and invalid preferences still allow switching', () => {
  const {document, storage, values} = fixture();
  values.set(LANGUAGE_STORAGE_KEY, 'invalid');
  assert.equal(createI18n(document, storage).language, 'both');
  const blocked = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  const i18n = createI18n(document, blocked);
  i18n.setLanguage('nl'); assert.equal(i18n.text('pause'), 'Computers pauzeren');
  i18n.setLanguage('invalid'); assert.equal(i18n.language, 'nl');
});

test('language changes preserve docking state and history contents', () => {
  const {document, storage} = fixture();
  const i18n = createI18n(document, storage);
  const button = document.getElementById('history-dock'); i18n.label(button, 'dock');
  const history = document.getElementById('history'); history.textContent = 'Existing English event';
  setupHistoryPanel(document, i18n);
  button.handlers.click();
  i18n.setLanguage('nl');
  assert.equal(button.textContent, 'Zweven');
  assert.equal(button.attributes['aria-pressed'], 'false');
  button.handlers.click();
  assert.equal(button.textContent, 'Vastzetten');
  i18n.setLanguage('en'); assert.equal(button.textContent, 'Dock');
  i18n.setLanguage('fr'); assert.equal(button.textContent, 'Ancrer');
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(history.textContent, 'Existing English event');
});

test('recorded plays retain the original card and rule when history is translated', () => {
  const {document, storage} = fixture();
  const i18n = createI18n(document, storage);
  const event = document.getElementById('event');
  const card = {suit: 'Hearts', rank: 'King'};
  i18n.label(event, 'played', {player: 1, card, points: 3, rule: {key: 'ruleFollow', params: {suit: 'Hearts'}}});
  card.rank = '7'; // Later game mutations cannot rewrite an earlier event.
  i18n.setLanguage('nl');
  assert.equal(event.textContent, 'Florian speelt Harten heer ♥ (3 pt). Volg harten.');
  i18n.setLanguage('en');
  assert.equal(event.textContent, 'Florian plays King ♥ (3 pt). Follow hearts.');
  i18n.setLanguage('fr');
  assert.equal(event.textContent, 'Florian joue Roi de cœur ♥ (3 pt). Fournissez à cœur.');
});

test('every suit and face rank has Dutch names, compact bilingual ranks and accessible names', () => {
  const {document, storage} = fixture(); const i18n = createI18n(document, storage);
  for (const [suit, dutch] of [['Clubs', 'Klaveren'], ['Diamonds', 'Ruiten'], ['Hearts', 'Harten'], ['Spades', 'Schoppen']]) {
    assert.equal(formatMessage('suit', {suit}, 'nl'), dutch);
    assert.equal(formatMessage('cardName', {card: {suit, rank: 'Ace'}}, 'nl'), dutch + ' aas');
  }
  const rank = document.getElementById('rank');
  i18n.compact(rank, 'rankShort', {rank: 'King'}); assert.equal(rank.textContent, 'H/K');
  i18n.setLanguage('nl'); assert.equal(rank.textContent, 'H');
  i18n.setLanguage('en'); assert.equal(rank.textContent, 'K');
  assert.match(formatMessage('cardAccessible', {card: {suit: 'Spades', rank: 'Jack'}, points: 1, legal: true}, 'nl'), /Schoppen boer, 1 punt, mag gespeeld worden/);
});

test('all 32 card labels survive every language switch without changing identifiers', () => {
  const {document, storage} = fixture(); const i18n = createI18n(document, storage);
  const deck = makeDeck(), original = JSON.stringify(deck);
  for (const [index, card] of deck.entries()) {
    const face = document.getElementById(`card-${index}`);
    i18n.aria(face, 'cardAccessible', {card, points: points(card), legal: true});
    i18n.title(face, 'cardName', {card});
    i18n.compact(document.getElementById(`rank-${index}`), 'rankShort', {rank: card.rank});
  }
  for (const language of ['nl', 'en', 'fr', 'both', 'nl']) {
    i18n.setLanguage(language);
    const labels = deck.map((card, index) => document.getElementById(`card-${index}`).getAttribute('aria-label'));
    assert.equal(new Set(labels).size, 32);
    for (const [index, card] of deck.entries()) {
      const face = document.getElementById(`card-${index}`);
      assert.equal(face.getAttribute('title'), i18n.text('cardName', {card}));
      assert.match(labels[index], language === 'en' ? /legal to play/ : language === 'fr' ? /peut être jouée/ : /mag gespeeld worden/);
      if (language === 'nl' || language === 'fr') assert.doesNotMatch(labels[index], /Clubs|Diamonds|Hearts|Spades|Jack|Queen|King|Ace/);
    }
    assert.equal(JSON.stringify(deck), original);
  }
});

test('point counts and winner messages agree with their subjects', () => {
  for (const language of ['nl', 'en']) for (const count of [0, 1, 2, 60]) {
    const unit = language === 'nl' ? (count === 1 ? 'punt' : 'punten') : (count === 1 ? 'point' : 'points');
    for (const key of ['cardAccessible', 'pointsWon', 'lastWinner', 'trickWon']) {
      const text = formatMessage(key, {card: {suit: 'Hearts', rank: 'Jack'}, player: 0, number: 1, points: count}, language);
      assert.match(text, new RegExp(`\\b${count} ${unit}\\b`));
      if (count === 1) assert.doesNotMatch(text, /1 (points|punten)/);
    }
  }
  assert.equal(formatMessage('pointsWon', {player: 0, points: 1}), 'You win 1 point.');
  assert.equal(formatMessage('matchWon', {team: 1}), 'Opponents win the match.');
});

test('every message renders in all locales for all players and contracts', () => {
  for (const language of ['nl', 'en', 'fr']) for (const suit of ['Clubs', 'Diamonds', 'Hearts', 'Spades', 'Null']) {
    for (let player = 0; player < 4; player++) {
      const params = {suit, player, dealer: player, leader: (player + 1) % 4, players: [0, 2], team: player % 2,
        card: {suit: 'Hearts', rank: 'King'}, rank: 'King', count: 1, number: 8, packets: 10,
        points: 3, score: 101, ours: 40, theirs: 20, scores: [40, 20], earned: [10, 0], totals: [101, 80],
        rule: {key: 'ruleFollow', params: {suit: 'Hearts'}}, order: {key: 'initialOrder'}};
      for (const enabled of [false, true]) for (const key of Object.keys(en)) {
        // Null has its own labels and is never offered as a suit trump.
        if (key === 'trumpSuit' && suit === 'Null') continue;
        const text = formatMessage(key, {...params, running: enabled, joined: enabled, legal: enabled,
          winner: enabled, previous: enabled, recommend: enabled}, language);
        assert.equal(typeof text, 'string', `${language}:${key}`);
        assert.ok(text.trim(), `${language}:${key}`);
        assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, `${language}:${key}`);
      }
    }
  }
});
