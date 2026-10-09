import test from 'node:test';
import assert from 'node:assert/strict';
import {Deal, Match, NULL_TRUMP, TRUMP_CHOICES, makeDeck, cardId, legalCards,
  hinduShuffle, winningPlay, chooseComputerCard, chooseComputerTrump, chooseComputerJoin, matchPoints, ruleHint} from './engine.mjs';

const card = (suit, rank) => ({suit, rank});
const hearts = rank => card('Hearts', rank);
const clubs = rank => card('Clubs', rank);
const spades = rank => card('Spades', rank);
const ids = cards => cards.map(cardId);

test('winning partner gets the highest legal rank before all suit preferences', () => {
  for (let player = 0; player < 4; player++) {
    const trick = [[(player + 2) % 4, clubs('10')], [(player + 3) % 4, clubs('7')]];
    for (const chooser of [player, (player + 1) % 4]) {
      for (const trump of ['Hearts', NULL_TRUMP]) {
        const hand = [hearts('Ace'), spades('10')];
        assert.deepEqual(chooseComputerCard(player, hand, trick, trump, chooser, new Set(['Spades'])), spades('10'));
        assert.deepEqual(chooseComputerCard(player, [hearts('10'), spades('7')], trick, trump, chooser), hearts('10'));
        assert.deepEqual(chooseComputerCard(player, [clubs('8'), clubs('9'), spades('10')], trick, trump, chooser), clubs('9'));
      }
    }
    assert.deepEqual(chooseComputerCard(player, [spades('7'), hearts('9')], trick, 'Hearts'), hearts('9'));
    assert.deepEqual(chooseComputerCard(player, [hearts('10'), spades('10')], trick, 'Hearts'), spades('10'));
    const trumped = [[(player + 1) % 4, clubs('7')], [(player + 2) % 4, hearts('10')], [(player + 3) % 4, clubs('8')]];
    assert.deepEqual(chooseComputerCard(player, [hearts('Ace'), spades('7')], trumped, 'Hearts'), spades('7'));
  }
});
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function ready(dealer = 0, seed = 42) {
  const rng = random(seed);
  let deal;
  do { deal = new Deal(dealer, rng); } while (deal.zeroPointPlayers.length);
  return deal;
}

test('Hindu shuffle moves actual packets and preserves order within each packet', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const original = makeDeck(); const shuffled = [...original];
    const packets = hinduShuffle(shuffled, random(seed));
    assert.equal(packets.reduce((a, b) => a + b, 0), 32);
    assert.ok(packets.at(-1) >= 3 && packets.at(-1) <= 6);
    assert.ok(packets.slice(0, -1).every(size => size >= 1 && size <= 5));
    let cursor = 0, result = [];
    for (const size of packets) {
      result = [...original.slice(cursor, cursor + size), ...result]; cursor += size;
    }
    assert.deepEqual(ids(shuffled), ids(result));
    assert.equal(new Set(ids(shuffled)).size, 32);
  }
});

test('a supplied deck is dealt exactly as previewed and is not shuffled or mutated', () => {
  const deck = makeDeck(); hinduShuffle(deck, random(42));
  const original = [...deck];
  const deal = new Deal(2, () => { throw new Error('Must not shuffle again.'); }, deck);
  assert.deepEqual(deck, original);
  const expected = [[], [], [], []]; let cursor = 0;
  for (const packet of [3, 2, 3]) for (let offset = 1; offset <= 4; offset++) {
    expected[(2 + offset) % 4].push(...deck.slice(cursor, cursor + packet)); cursor += packet;
  }
  for (let player = 0; player < 4; player++) assert.deepEqual(new Set(ids(deal.hands[player])), new Set(ids(expected[player])));
  assert.throws(() => new Deal(0, Math.random, deck.slice(1)));
  assert.throws(() => new Deal(0, Math.random, [...deck.slice(1), deck[1]]));
});

test('opponent winning: following with a higher card is mandatory', () => {
  const hand = [clubs('7'), clubs('Ace'), hearts('10')];
  assert.deepEqual(ids(legalCards(hand, [[0, clubs('King')]], 'Hearts')), ids([clubs('Ace')]));
  assert.deepEqual(ruleHint(hand, [[0, clubs('King')]], 'Hearts'), {key: 'ruleHigher', params: {suit: 'Clubs'}});
});

test('winning partner permits a lower follow and a discard when void', () => {
  const trick = [[0, clubs('King')], [1, clubs('7')]];
  assert.deepEqual(ids(legalCards([clubs('8'), clubs('Ace')], trick, 'Hearts')), ids([clubs('8'), clubs('Ace')]));
  assert.deepEqual(ids(legalCards([hearts('7'), spades('10')], trick, 'Hearts')), ids([hearts('7'), spades('10')]));
});

test('a trumped non-trump lead allows any follow', () => {
  const hand = [clubs('7'), clubs('Ace'), hearts('10')];
  assert.deepEqual(ids(legalCards(hand, [[0, clubs('King')], [1, hearts('8')]], 'Hearts')), ids(hand.slice(0, 2)));
});

test('discard instead of undertrumping an opponent unless only trumps remain', () => {
  const hand = [hearts('7'), spades('10')];
  const trick = [[0, clubs('King')], [1, spades('8')], [2, hearts('Ace')]];
  assert.deepEqual(ids(legalCards(hand, trick, 'Hearts')), ids([spades('10')]));
  assert.deepEqual(ruleHint(hand, trick, 'Hearts'), {key: 'ruleCannotOvertrump'});
  assert.deepEqual(legalCards([hearts('7')], trick, 'Hearts'), [hearts('7')]);
  assert.deepEqual(ruleHint([hearts('7')], trick, 'Hearts'), {key: 'ruleForcedTrump'});
});

test('opponent trump blocks lower trumps in every seat and play position', () => {
  for (let player = 0; player < 4; player++) {
    for (const fourth of [false, true]) {
      const trick = [
        ...(!fourth ? [] : [[(player + 1) % 4, clubs('9')]]),
        [(player + 2) % 4, clubs('King')], [(player + 3) % 4, hearts('Ace')],
      ];
      const lower = hearts('7'), discard = spades('10');
      const deal = ready();
      deal.chooseTrump('Hearts');
      deal.leader = trick[0][0];
      deal.trick = [...trick];
      deal.hands[player] = [lower, discard];
      assert.deepEqual(legalCards(deal.hands[player], trick, 'Hearts'), [discard]);
      assert.deepEqual(chooseComputerCard(player, deal.hands[player], trick, 'Hearts'), discard);
      assert.throws(() => deal.play(lower), /Illegal card/);
      assert.deepEqual(deal.hands[player], [lower, discard]);
      deal.play(discard);
      assert.deepEqual(deal.trick.at(-1), [player, discard]);
    }
  }
});

test('lower trump is excluded with a winning partner when a discard exists', () => {
  const trick = [[0, clubs('King')], [1, hearts('Ace')], [2, clubs('8')]];
  assert.deepEqual(ids(legalCards([hearts('7'), spades('10')], trick, 'Hearts')), ids([spades('10')]));
  assert.deepEqual(ids(legalCards([hearts('7')], trick, 'Hearts')), ids([hearts('7')]));
});

test('winning partner permits any trump follower in every seat and play position', () => {
  for (let player = 0; player < 4; player++) {
    for (const fourth of [false, true]) {
      const trick = [
        ...(fourth ? [[(player + 1) % 4, hearts('9')]] : []),
        [(player + 2) % 4, hearts('Ace')], [(player + 3) % 4, hearts('8')],
      ];
      const hand = [hearts('7'), hearts('10'), clubs('10')];
      assert.deepEqual(legalCards(hand, trick, 'Hearts'), hand.slice(0, 2));
      assert.deepEqual(ruleHint(hand, trick, 'Hearts'), {key: 'rulePartnerFollow', params: {suit: 'Hearts'}});
      const deal = ready();
      deal.chooseTrump('Hearts');
      deal.leader = trick[0][0];
      deal.trick = [...trick];
      deal.hands[player] = [...hand];
      assert.throws(() => deal.play(clubs('10')), /Illegal card/);
      deal.play(hearts('7'));
      assert.deepEqual(deal.trick.at(-1), [player, hearts('7')]);
      assert.equal(winningPlay(deal.trick, 'Hearts')[0], (player + 2) % 4);
    }
  }
});

test('opponent overtaking partner restores mandatory overtrumping', () => {
  const trick = [[1, hearts('7')], [2, hearts('King')], [3, hearts('Ace')]];
  const hand = [hearts('8'), hearts('10'), clubs('10')];
  assert.deepEqual(legalCards(hand, trick, 'Hearts'), [hearts('10')]);
  assert.deepEqual(ruleHint(hand, trick, 'Hearts'), {key: 'ruleHigher', params: {suit: 'Hearts'}});
});

test('Null has no trump and computer picks highest-value legal card', () => {
  const trick = [[0, clubs('King')]];
  assert.equal(winningPlay([...trick, [1, hearts('10')]], NULL_TRUMP)[0], 0);
  const hand = [hearts('7'), spades('10'), hearts('Ace')];
  assert.deepEqual(legalCards(hand, trick, NULL_TRUMP), hand);
  assert.deepEqual(chooseComputerCard(1, hand, trick, NULL_TRUMP), spades('10'));
  assert.deepEqual(chooseComputerCard(1, [clubs('7'), clubs('Ace'), spades('10')], trick, NULL_TRUMP), clubs('Ace'));
});

test('Null saves points against an opponent opening 10 in every seat, respecting follow suit', () => {
  for (let leader = 0; leader < 4; leader++) {
    const trick = [[leader, clubs('10')]];
    for (let offset = 1; offset <= 3; offset++) {
      const player = (leader + offset) % 4;
      for (const [hand, cheap, valuable] of [
        [['King', '9', '7', '8'].map(clubs), clubs('7'), clubs('King')],
        [['10', '9', '7', '8'].map(hearts), hearts('7'), hearts('10')],
        [[clubs('King'), clubs('Jack'), hearts('7')], clubs('Jack'), clubs('King')],
      ]) {
        assert.deepEqual(chooseComputerCard(player, hand, trick, NULL_TRUMP),
          offset === 2 ? valuable : cheap);
      }
      trick.push([player, spades(String(6 + offset))]);
    }
  }
});

test('computers choose Null and join only with desktop thresholds', () => {
  const strongNull = [clubs('10'), clubs('Ace'), hearts('10'), hearts('Ace'), spades('10'), spades('Ace'), clubs('7'), hearts('7')];
  assert.equal(chooseComputerTrump(strongNull), NULL_TRUMP);
  const strongTrump = ['10', 'Ace', 'King', '9', '8'].map(hearts);
  assert.equal(chooseComputerJoin(strongTrump, 'Hearts'), true);
  assert.equal(chooseComputerJoin(strongTrump.slice(0, 4), 'Hearts'), false);
  assert.equal(chooseComputerJoin(strongTrump, NULL_TRUMP), false);
});

test('only opponents join suit trump once and before the first play', () => {
  for (let dealer = 0; dealer < 4; dealer++) {
    for (let player = -1; player <= 4; player++) {
      const deal = ready(dealer);
      assert.throws(() => deal.joinTrump(player));
      deal.chooseTrump('Hearts');
      if (player >= 0 && player < 4 && player % 2 !== dealer % 2) {
        deal.joinTrump(player);
        assert.equal(deal.joinedBy, player);
        assert.throws(() => deal.joinTrump((player + 2) % 4));
      } else assert.throws(() => deal.joinTrump(player));
    }
  }
  const nullDeal = ready(); nullDeal.chooseTrump(NULL_TRUMP);
  assert.throws(() => nullDeal.joinTrump(1));
  const started = ready(); started.chooseTrump('Hearts'); started.play(started.hands[1][0]);
  assert.throws(() => started.joinTrump(1));
  while (started.trick.length < 4) started.play(legalCards(started.hands[started.currentPlayer], started.trick, started.trump)[0]);
  started.nextTrick(); assert.throws(() => started.joinTrump(3));
});

test('match counts only excess above 30 and doubles once', () => {
  for (const [raw, normal] of [[0, 0], [20, 0], [30, 0], [31, 1], [40, 10], [60, 30]]) {
    assert.equal(matchPoints(raw, 'Hearts'), normal);
    assert.equal(matchPoints(raw, NULL_TRUMP), normal * 2);
    assert.equal(matchPoints(raw, 'Hearts', true), normal * 2);
    assert.equal(matchPoints(raw, NULL_TRUMP, true), normal * 2);
  }
});

test('completed deals score once and match stops at or beyond 101', () => {
  const match = new Match();
  assert.throws(() => match.scoreDeal(ready()));
  const finish = (scores, trump = 'Hearts', joinedBy = null) => ({finished: true, scores, trump, joinedBy});
  const tie = finish([30, 30]); assert.deepEqual(match.scoreDeal(tie), [0, 0]);
  const first = finish([60, 0], NULL_TRUMP);
  assert.deepEqual(match.scoreDeal(first), [60, 0]);
  assert.deepEqual(match.scoreDeal(first), [0, 0]);
  const last = finish([51, 9], 'Hearts', 1);
  assert.deepEqual(match.scoreDeal(last), [42, 0]);
  assert.deepEqual(match.totals, [102, 0]); assert.equal(match.winner, 0);
  assert.deepEqual(match.scoreDeal(last), [0, 0]);
  assert.throws(() => match.scoreDeal(finish([40, 20])));
  const exact = new Match(); exact.totals = [100, 0]; exact.scoreDeal(finish([31, 29])); assert.equal(exact.winner, 0);
  const opponents = new Match(); opponents.totals = [0, 100]; opponents.scoreDeal(finish([29, 31])); assert.equal(opponents.winner, 1);
});

test('3–2–3 packets and zero-point hands match desktop deal setup', () => {
  const deal = new Deal(0, () => 0.999999);
  const deck = makeDeck();
  const expected = [...deck.slice(0, 3), ...deck.slice(12, 14), ...deck.slice(20, 23)];
  assert.deepEqual(new Set(ids(deal.hands[1])), new Set(ids(expected)));
  const rng = random(4);
  let zero;
  for (let i = 0; i < 10000; i++) {
    const candidate = new Deal(0, rng);
    if (candidate.zeroPointPlayers.length) { zero = candidate; break; }
  }
  assert.ok(zero);
  assert.throws(() => zero.chooseTrump('Hearts'));
  assert.throws(() => zero.play(zero.hands[1][0]));
});

test('many complete deals preserve all 32 cards and 60 points in every contract', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const deal = ready(seed % 4, seed);
    deal.chooseTrump(TRUMP_CHOICES[seed % TRUMP_CHOICES.length]);
    if (deal.trump !== NULL_TRUMP && seed % 2) deal.joinTrump((deal.dealer + 1) % 4);
    const playedOrder = [];
    while (!deal.finished) {
      if (deal.trick.length === 4) deal.nextTrick();
      const player = deal.currentPlayer;
      const chosen = chooseComputerCard(player, deal.hands[player], deal.trick, deal.trump, deal.dealer, deal.trumpedSuits[player % 2]);
      playedOrder.push(chosen); deal.play(chosen);
    }
    assert.equal(deal.scores[0] + deal.scores[1], 60);
    assert.equal(new Set(ids(deal.captured.flat())).size, 32);
    assert.equal(deal.trickNumber, 8);
    assert.deepEqual(deal.gameDeck, playedOrder);
    assert.throws(() => deal.play(deal.trick[0][1]));
  }
});
