// Shared Manille rules and card definitions. No AI or UI dependencies.
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

export function best(items, key, direction = 1) {
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
  // Following trump must not force us to overtake our winning partner.
  if (partnerWinning && following.length) return following;
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
    choices = partnerWinning ? [...hand] : winningTrumps.length ? winningTrumps : [...hand];
  }
  if (trumpsPlayed.length) {
    const withoutLowerTrumps = choices.filter(card => card.suit !== trump || strength(card) > highest);
    return withoutLowerTrumps.length ? withoutLowerTrumps : choices;
  }
  return choices;
}

export const matchPoints = (raw, trump = null, joined = false) => Math.max(raw - 30, 0) * (trump === NULL_TRUMP || joined ? 2 : 1);

export function ruleHint(hand, trick, trump) {
  if (!trick.length) return {key: 'ruleLead'};
  const choices = legalCards(hand, trick, trump);
  const led = trick[0][1].suit;
  const partnerWinning = winningPlay(trick, trump)[0] === ((trick.at(-1)[0] + 1) % 4 + 2) % 4;
  if (hand.some(card => card.suit === led)) {
    const bestFollowing = Math.max(...trick.filter(([, card]) => card.suit === led).map(([, card]) => strength(card)));
    if (partnerWinning) return {key: 'rulePartnerFollow', params: {suit: led}};
    if (led !== trump && winningPlay(trick, trump)[1].suit === trump) return {key: 'ruleTrumpedFollow', params: {suit: led}};
    if (choices.some(card => strength(card) > bestFollowing)) return {key: 'ruleHigher', params: {suit: led}};
    return {key: 'ruleFollow', params: {suit: led}};
  }
  if (trump === NULL_TRUMP) return {key: 'ruleNull'};
  if (partnerWinning && choices.some(card => card.suit !== trump)) return {key: 'rulePartnerVoid'};
  const highest = Math.max(-1, ...trick.filter(([, card]) => card.suit === trump).map(([, card]) => strength(card)));
  if (choices.some(card => card.suit === trump)) {
    return choices.some(card => strength(card) > highest)
      ? {key: 'ruleWinningTrump'} : {key: 'ruleForcedTrump'};
  }
  return {key: hand.some(card => card.suit === trump) ? 'ruleCannotOvertrump' : 'ruleDiscard'};
}
