// Browser port of the rules in this checkout's manille.py.
export const SUITS = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
export const NULL_TRUMP = 'Null';
export const TRUMP_CHOICES = [...SUITS, NULL_TRUMP];
export const MATCH_TARGET = 101;
export const RANKS = ['7', '8', '9', 'Jack', 'Queen', 'King', 'Ace', '10'];
export const POINTS = [0, 0, 0, 1, 2, 3, 4, 5];
export const NAMES = ['You', 'Florian', 'Your teammate', 'Odette'];
export const strength = card => RANKS.indexOf(card.rank);
export const points = card => POINTS[strength(card)];
export const cardId = card => `${card.suit}-${card.rank}`;
export const makeDeck = () => SUITS.flatMap(suit => RANKS.map(rank => ({suit, rank})));

export function hinduShuffle(deck, random = Math.random) {
  if (deck.length < 2) return deck.length ? [deck.length] : [];
  const randint = (low, high) => low + Math.floor(random() * (high - low + 1));
  const remainder = Math.min(randint(3, 6), deck.length - 1);
  let received = [], cursor = 0;
  const packets = [];
  while (deck.length - cursor > remainder) {
    const size = randint(1, Math.min(5, deck.length - cursor - remainder));
    received = [...deck.slice(cursor, cursor + size), ...received];
    packets.push(size);
    cursor += size;
  }
  deck.splice(0, deck.length, ...deck.slice(cursor), ...received);
  return [...packets, remainder];
}

const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

function best(items, key, direction = 1) {
  return items.reduce((a, b) => compare(key(b), key(a)) * direction > 0 ? b : a);
}

export function winningPlay(trick, trump) {
  if (!trick.length) throw new Error('An empty trick has no winner.');
  return best(trick, ([, card]) => [card.suit === trump ? 2 : card.suit === trick[0][1].suit ? 1 : 0, strength(card)]);
}

export function legalCards(hand, trick, trump) {
  if (!trick.length) return [...hand];
  const player = (trick.at(-1)[0] + 1) % 4;
  const partnerWinning = winningPlay(trick, trump)[0] === (player + 2) % 4;
  const following = hand.filter(card => card.suit === trick[0][1].suit);
  const trumpsPlayed = trick.filter(([, card]) => card.suit === trump);
  const highest = Math.max(-1, ...trumpsPlayed.map(([, card]) => strength(card)));
  const winningTrumps = hand.filter(card => card.suit === trump && strength(card) > highest);
  let choices;
  if (following.length) {
    const bestFollowing = Math.max(...trick.filter(([, card]) => card.suit === trick[0][1].suit).map(([, card]) => strength(card)));
    const higher = following.filter(card => strength(card) > bestFollowing);
    choices = partnerWinning || (trumpsPlayed.length && trick[0][1].suit !== trump)
      ? following : higher.length ? higher : following;
  } else {
    const trumps = hand.filter(card => card.suit === trump);
    choices = partnerWinning ? [...hand] : winningTrumps.length ? winningTrumps : trumps.length ? trumps : [...hand];
  }
  if (trumpsPlayed.length) {
    const withoutLowerTrumps = choices.filter(card => card.suit !== trump || strength(card) > highest);
    return withoutLowerTrumps.length ? withoutLowerTrumps : choices;
  }
  return choices;
}

export function chooseComputerCard(player, hand, trick, trump, trumpChooser = null, opponentTrumpedSuits = new Set()) {
  let choices = legalCards(hand, trick, trump);
  if (trump === NULL_TRUMP) {
    // An opponent's opening 10 cannot be beaten without trump; save points.
    const opponentLedTen = trick.length && trick[0][1].rank === '10'
      && trick[0][0] % 2 !== player % 2;
    return best(choices, card => [points(card), strength(card)], opponentLedTen ? -1 : 1);
  }
  if (player === trumpChooser) {
    const trumps = choices.filter(card => card.suit === trump);
    if (trumps.length) choices = trumps;
  } else if (trumpChooser !== null && player % 2 !== trumpChooser % 2) {
    const nonTrumps = choices.filter(card => card.suit !== trump);
    if (nonTrumps.length) choices = nonTrumps;
  }
  const alternatives = choices.filter(card => !opponentTrumpedSuits.has(card.suit));
  if (alternatives.length) choices = alternatives;
  const cheap = card => [points(card), Number(card.suit === trump), strength(card)];
  const partnerWinning = trick.length && winningPlay(trick, trump)[0] === (player + 2) % 4;
  const fives = choices.filter(card => points(card) === 5);
  if (fives.length && (!trick.length || partnerWinning)) return best(fives, card => [Number(card.suit === trump)], -1);

  if (!trick.length) return best(choices, cheap, -1);

  if (winningPlay(trick, trump)[0] % 2 === player % 2) {
    return best(choices, card => [points(card), Number(card.suit !== trump), strength(card)]);
  }

  const winners = choices.filter(card => winningPlay([...trick, [player, card]], trump)[0] === player);
  return best(winners.length ? winners : choices, cheap, -1);
}

export function chooseComputerTrump(hand) {
  const highCards = hand.filter(card => ['Ace', '10'].includes(card.rank));
  if (highCards.length >= 4 && new Set(highCards.map(card => card.suit)).size >= 3
      && hand.reduce((sum, card) => sum + points(card), 0) >= 24) return NULL_TRUMP;
  return best(SUITS, suit => {
    const cards = hand.filter(card => card.suit === suit);
    return [
      cards.reduce((sum, card) => sum + points(card), 0),
      cards.length,
      cards.reduce((sum, card) => sum + strength(card), 0)
    ];
  });
}

export function chooseComputerJoin(hand, trump) {
  const trumps = hand.filter(card => card.suit === trump);
  return SUITS.includes(trump) && trumps.length >= 5
    && trumps.reduce((sum, card) => sum + points(card), 0) >= 10
    && trumps.some(card => card.rank === '10');
}

export const matchPoints = (raw, trump = null, joined = false) => Math.max(raw - 30, 0) * (trump === NULL_TRUMP || joined ? 2 : 1);

export class Match {
  constructor() {
    this.totals = [0, 0];
    this.winner = null;
    this.scoredDeals = new WeakSet();
  }

  scoreDeal(deal) {
    if (!deal.finished) throw new Error('Only a completed deal can count toward the match.');
    if (this.scoredDeals.has(deal)) return [0, 0];
    if (this.winner !== null) throw new Error('The match has already ended.');
    const earned = deal.scores.map(raw => matchPoints(raw, deal.trump, deal.joinedBy !== null));
    this.totals = this.totals.map((total, i) => total + earned[i]);
    this.scoredDeals.add(deal);
    this.winner = this.totals.findIndex(total => total >= MATCH_TARGET);
    if (this.winner === -1) this.winner = null;
    return earned;
  }
}

export function ruleHint(hand, trick, trump) {
  if (!trick.length) return 'Lead any card.';
  const choices = legalCards(hand, trick, trump);
  const led = trick[0][1].suit;
  const partnerWinning = winningPlay(trick, trump)[0] === ((trick.at(-1)[0] + 1) % 4 + 2) % 4;
  if (hand.some(card => card.suit === led)) {
    const bestFollowing = Math.max(...trick.filter(([, card]) => card.suit === led).map(([, card]) => strength(card)));
    if (partnerWinning && led !== trump) return `Follow ${led.toLowerCase()}; a higher card is optional while your teammate wins.`;
    if (led !== trump && winningPlay(trick, trump)[1].suit === trump) return `The trick has been trumped; follow ${led.toLowerCase()} with any card of that suit.`;
    if (choices.some(card => strength(card) > bestFollowing)) return `Follow ${led.toLowerCase()} with a higher card.`;
    return `Follow ${led.toLowerCase()}.`;
  }
  if (trump === NULL_TRUMP) return 'Null: you cannot follow suit; play any card.';
  if (partnerWinning && choices.some(card => card.suit !== trump)) return 'Your teammate is winning; trumping is optional. Lower trumps are allowed only when forced.';
  const highest = Math.max(-1, ...trick.filter(([, card]) => card.suit === trump).map(([, card]) => strength(card)));
  if (choices.some(card => card.suit === trump)) {
    return choices.some(card => strength(card) > highest)
      ? 'You cannot follow suit; play a winning trump.' : 'You must play trump; no higher trump is available.';
  }
  return 'You cannot follow suit and have no trump; play any card.';
}

export class Deal {
  constructor(dealer = 0, random = Math.random, suppliedDeck = null) {
    if (!Number.isInteger(dealer) || dealer < 0 || dealer > 3) throw new Error('Invalid dealer.');

    this.dealer = dealer;
    const deck = suppliedDeck === null ? makeDeck() : [...suppliedDeck];
    const expected = new Set(makeDeck().map(cardId));
    if (deck.length !== 32 || new Set(deck.map(cardId)).size !== 32 || deck.some(card => !expected.has(cardId(card)))) {
      throw new Error('A deal requires all 32 unique Manille cards.');
    }

    for (let i = suppliedDeck === null ? deck.length - 1 : 0; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    this.hands = [[], [], [], []];
    let cursor = 0;
    for (const packet of [3, 2, 3]) {
      for (let offset = 1; offset <= 4; offset++) {
        this.hands[(dealer + offset) % 4].push(...deck.slice(cursor, cursor + packet));
        cursor += packet;
      }
    }
    this.hands.forEach(hand => hand.sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || strength(b) - strength(a)));

    this.trump = null;
    this.zeroPointPlayers = this.hands.flatMap((hand, player) => hand.every(card => points(card) === 0) ? [player] : []);
    this.joinedBy = null;
    this.trumpedSuits = [new Set(), new Set()];
    this.leader = (dealer + 1) % 4;
    this.trick = [];
    this.captured = [[], []];
    this.gameDeck = [];
    this.scores = [0, 0];
    this.trickNumber = 1;
    this.finished = false;
  }

  get currentPlayer() {
    return (this.leader + this.trick.length) % 4;
  }

  chooseTrump(suit) {
    if (this.zeroPointPlayers.length || this.trump !== null || !TRUMP_CHOICES.includes(suit)) throw new Error('Choose a valid trump once per deal.');
    this.trump = suit;
  }

  joinTrump(player) {
    if (!Number.isInteger(player) || player < 0 || player > 3 || this.zeroPointPlayers.length
        || !SUITS.includes(this.trump) || player % 2 === this.dealer % 2 || this.joinedBy !== null
        || this.trick.length || this.trickNumber !== 1 || this.finished) {
      throw new Error('Only an opponent can join suit trump once, before play begins.');
    }
    this.joinedBy = player;
  }

  play(card) {
    if (this.zeroPointPlayers.length || this.trump === null || this.finished || this.trick.length === 4) throw new Error('The deal is not waiting for a card.');

    const player = this.currentPlayer;
    const actual = this.hands[player].find(candidate => cardId(candidate) === cardId(card));

    if (!actual || !legalCards(this.hands[player], this.trick, this.trump).includes(actual)) throw new Error('Illegal card.');

    this.hands[player].splice(this.hands[player].indexOf(actual), 1);
    this.trick.push([player, actual]);
    if (this.trick.length >= 2 && SUITS.includes(this.trump)
        && this.trick[0][1].suit !== this.trump && actual.suit === this.trump) {
      this.trumpedSuits[1 - player % 2].add(this.trick[0][1].suit);
    }

    if (this.trick.length === 4) {
      const team = winningPlay(this.trick, this.trump)[0] % 2;
      this.captured[team].push(...this.trick.map(([, played]) => played));
      this.gameDeck.push(...this.trick.map(([, played]) => played));
      this.scores[team] += this.trick.reduce((sum, [, played]) => sum + points(played), 0);
      this.finished = this.hands.every(hand => !hand.length);

      if (this.finished && (this.scores[0] + this.scores[1] !== 60 || this.captured.flat().length !== 32 || new Set(this.gameDeck.map(cardId)).size !== 32)) {
        throw new Error('Cards or points were lost.');
      }
    }
  }

  nextTrick() {
    if (!this.trump || this.finished || this.trick.length !== 4) throw new Error('There is no next trick ready.');

    this.leader = winningPlay(this.trick, this.trump)[0];
    this.trick = [];
    this.trickNumber++;
  }
}
