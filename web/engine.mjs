// Deal and match coordination. Re-exports preserve existing app/test imports.
import {SUITS, TRUMP_CHOICES, MATCH_TARGET, makeDeck, cardId, strength, points, legalCards, winningPlay, matchPoints} from './core.mjs';
import {recordTrumpedSuit} from './ai.mjs';
export * from './core.mjs';
export {chooseComputerCard, chooseComputerTrump, chooseComputerJoin, recordTrumpedSuit} from './ai.mjs';

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
    recordTrumpedSuit(this.trick, this.trump, this.trumpedSuits);

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
