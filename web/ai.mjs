// Computer strategies using only a player's hand and public observations.
import {SUITS, NULL_TRUMP, points, strength, legalCards, winningPlay, best} from './core.mjs';

export function chooseComputerCard(player, hand, trick, trump, trumpChooser = null, opponentTrumpedSuits = new Set()) {
  let choices = legalCards(hand, trick, trump);
  const partnerWinning = trick.length && winningPlay(trick, trump)[0] === (player + 2) % 4;
  if (partnerWinning) {
    return best(choices, card => [points(card), strength(card), Number(card.suit !== trump)]);
  }
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
  const fives = choices.filter(card => points(card) === 5);
  if (fives.length && !trick.length) return best(fives, card => [Number(card.suit === trump)], -1);

  if (!trick.length) return best(choices, cheap, -1);

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

export function recordTrumpedSuit(trick, trump, trumpedSuits) {
  if (trick.length < 2 || !SUITS.includes(trump)) return;
  const ledSuit = trick[0][1].suit;
  const [player, card] = trick.at(-1);
  if (ledSuit !== trump && card.suit === trump) {
    trumpedSuits[1 - player % 2].add(ledSuit);
  }
}
