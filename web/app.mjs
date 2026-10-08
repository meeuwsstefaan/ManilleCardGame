import {Deal, Match, TRUMP_CHOICES, NULL_TRUMP, makeDeck, cardId, hinduShuffle, points, legalCards, winningPlay, chooseComputerCard, chooseComputerTrump, chooseComputerJoin, ruleHint} from './engine.mjs';
import {setupHistoryPanel} from './history-panel.mjs';
import {createI18n} from './i18n.mjs';
import {setupAnalytics} from './analytics.mjs';
let languageStorage;
try { languageStorage = localStorage; } catch { /* Browser storage is optional. */ }
const i18n = createI18n(document, languageStorage);
setupHistoryPanel(document, i18n);
const analytics = setupAnalytics(document, i18n, languageStorage);
const $ = id => document.getElementById(id);
const symbols = {Clubs:'♣', Diamonds:'♦', Hearts:'♥', Spades:'♠'};
const message = (key, params = {}) => ({key, params});
const show = (id, key, params = {}) => i18n.label($(id), key, params);
const DECK_STORAGE_KEY = 'manille.lastCollectedDeck.v1';
function restoreCollectedDeck() {
  try {
    const cards = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY));
    const expected = new Set(makeDeck().map(cardId));
    if (!Array.isArray(cards) || cards.length !== 32 || new Set(cards.map(cardId)).size !== 32
        || cards.some(card => !expected.has(cardId(card)))) return null;
    return cards.map(({suit, rank}) => ({suit, rank}));
  } catch { return null; }
}
let lastCollectedDeck = restoreCollectedDeck();
let deal, dealNumber = 1, match = new Match(), joinPending = false, running = true, timer = null;
let shuffleStage = true, shuffleDealer = 0, shuffleDeck = [], shuffleCount = 0, deckOrigin = '';
let shuffling = false, shuffleTimer = null;
const PACKET_MS = 160;
const COLLECT_MS = 1500;
let collecting = false, trickCollected = false;
let lastHand = null, showingLastHand = false;

function log(key, params = {}) {
  const item = document.createElement('li');
  i18n.label(item, key, params);
  $('history').prepend(item);
  while ($('history').children.length > 100) $('history').lastChild.remove();
}

function clearTimer() { clearTimeout(timer); timer = null; }

function cardView(card, {hidden = false, legal = false, winner = false, previous = false, onPlay = null} = {}) {
  const element = document.createElement(onPlay ? 'button' : 'div');
  element.className = `card${['Diamonds','Hearts'].includes(card.suit) ? ' red' : ''}${hidden ? ' back' : ''}${legal ? ' legal' : ''}${winner ? ' winner' : ''}`;
  if (hidden) {
    element.innerHTML = '<span class="suit" aria-hidden="true">♠</span>';
    i18n.aria(element, 'faceDown');
  } else {
    const rank = document.createElement('span'); rank.className = 'rank';
    i18n.compact(rank, 'rankShort', {rank: card.rank});
    const suit = document.createElement('span'); suit.className = 'suit'; suit.textContent = symbols[card.suit]; suit.setAttribute('aria-hidden', 'true');
    const value = document.createElement('span'); value.className = 'value'; value.textContent = points(card) + ' pt';
    element.append(rank, suit, value);
    i18n.aria(element, 'cardAccessible', {card, points: points(card), legal, winner, previous});
    i18n.title(element, 'cardName', {card});
  }
  if (onPlay) { element.disabled = !legal; element.addEventListener('click', onPlay); }
  return element;
}

function waitingForHuman() {
  return shuffleStage || collecting || showingLastHand || deal.zeroPointPlayers.length > 0 || joinPending || (!deal.finished && (deal.trump === null ? deal.dealer === 0 : deal.trick.length < 4 && deal.currentPlayer === 0));
}

function renderDeckPreview() {
  $('deck-preview').replaceChildren();
  shuffleDeck.forEach((card, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span'); number.textContent = index + 1;
    item.append(number, cardView(card)); $('deck-preview').append(item);
  });
}

function renderShuffle() {
  // Always derive the visible preview from the very deck that will be dealt.
  renderDeckPreview();
  const order = shuffleCount ? message('shuffledOrder', {count: shuffleCount}) : deckOrigin;
  show('deck-order-note', 'deckOrder', {order});
  $('trick').replaceChildren();
  show('trick-label', 'prepareDeal', {number: dealNumber});
  show('table-message', 'deckInstructions');
  $('our-score').textContent = match.totals[0]; $('their-score').textContent = match.totals[1];
  show('deal-number', 'dealNumber', {number: dealNumber}); show('trump', 'shuffleTitle');
  show('dealer', 'dealer', {player: shuffleDealer});
  show('deal-score', 'readyCards');
  $('trump-picker').hidden = true; $('join-picker').hidden = true; $('redeal').hidden = true;
  $('next-deal').disabled = true; $('auto').disabled = true; $('step').disabled = true;
  $('shuffle-deck').disabled = shuffling; $('deal-cards').disabled = shuffling;
  $('new-game').disabled = shuffling;
  show('shuffle-note', shuffling ? 'shuffling' : 'shuffleCount', {count: shuffleCount});
  show('status', shuffling ? 'waitShuffle' : 'startShuffle');
}

function render() {
  $('show-last-hand').disabled = !lastHand || shuffleStage || collecting;
  i18n.label($('show-last-hand'), showingLastHand ? 'back' : 'lastHand');
  $('show-last-hand').setAttribute('aria-pressed', String(showingLastHand));
  i18n.aria($('trick'), showingLastHand ? 'previousTrick' : 'currentTrick');
  $('table').classList.toggle('shuffle-mode', shuffleStage);
  $('table').classList.toggle('collecting', collecting);
  $('show-hands').disabled = collecting;
  $('speed').disabled = collecting;
  $('shuffle-panel').hidden = !shuffleStage; $('trick').hidden = shuffleStage;
  for (let player = 0; player < 4; player++) $(`seat-${player}`).hidden = shuffleStage;
  if (shuffleStage) { renderShuffle(); return; }
  $('new-game').disabled = collecting;
  const complete = deal.trick.length === 4;
  const active = !showingLastHand && deal.trump !== null && !joinPending && !complete && !deal.finished ? deal.currentPlayer : null;
  const choices = active !== null ? legalCards(deal.hands[active], deal.trick, deal.trump) : [];

  for (let player = 0; player < 4; player++) {
    const seat = $(`seat-${player}`);
    seat.classList.toggle('active', active === player || joinPending && player === 0 || !deal.zeroPointPlayers.length && deal.trump === null && deal.dealer === player);
    seat.replaceChildren();

    const title = document.createElement('h2');
    const name = document.createElement('span'); i18n.label(name, 'player', {player}); title.append(name);
    const badge = document.createElement('span');
    badge.className = 'badge';
    i18n.label(badge, player === deal.dealer ? 'dealerBadge' : 'team', {team: player % 2 + 1});
    title.append(badge);

    const hand = document.createElement('div');
    hand.className = 'hand';
    deal.hands[player].forEach(card => hand.append(cardView(card, {
      hidden: player !== 0 && !$('show-hands').checked,
      legal: choices.includes(card) && (player === 0 || $('show-hands').checked),
      onPlay: player === 0 ? () => playHuman(card) : null,
    })));
    seat.append(title, hand);
  }

  const displayedTrick = showingLastHand ? lastHand.trick : deal.trick;
  const winner = showingLastHand ? lastHand.winner : deal.trick.length ? winningPlay(deal.trick, deal.trump)[0] : null;
  $('trick').replaceChildren();

  for (let player = 0; player < 4; player++) {
    const slot = document.createElement('div'); slot.className = `trick-slot ${['south', 'west', 'north', 'east'][player]}`;
    const label = document.createElement('span'); i18n.label(label, 'player', {player}); slot.append(label);
    const played = displayedTrick.find(([who]) => who === player);
    if (played && (showingLastHand || !trickCollected)) slot.append(cardView(played[1], {winner: player === winner, previous: showingLastHand}));
    else { const empty = document.createElement('div'); empty.className = 'empty-card'; slot.append(empty); }
    $('trick').append(slot);
  }

  show('trick-label', showingLastHand ? 'lastTrickNumber' : 'trickNumber', {number: showingLastHand ? lastHand.number : deal.trickNumber});
  if (showingLastHand) show('table-message', 'lastWinner', {player: winner, points: lastHand.trick.reduce((sum, [, card]) => sum + points(card), 0)});
  else if (complete) show('table-message', 'pointsWon', {player: winner, points: deal.trick.reduce((sum, [, card]) => sum + points(card), 0)});
  else if (winner !== null) show('table-message', 'winning', {player: winner});
  else show('table-message', 'tableTip');
  $('our-score').textContent = match.totals[0]; $('their-score').textContent = match.totals[1];
  show('deal-number', 'dealNumber', {number: dealNumber});
  show('trump', deal.trump === null ? 'chooseTrumpTitle' : deal.trump === NULL_TRUMP ? 'nullTrump' : 'trumpSuit', {suit: deal.trump, joined: deal.joinedBy !== null});
  show('dealer', 'dealer', {player: deal.dealer});
  show('deal-score', 'rawScores', {ours: deal.scores[0], theirs: deal.scores[1]});
  $('trump-picker').hidden = deal.zeroPointPlayers.length > 0 || deal.trump !== null || deal.dealer !== 0;
  $('join-picker').hidden = !joinPending;
  $('redeal').hidden = !deal.zeroPointPlayers.length;
  $('next-deal').disabled = collecting || !deal.finished || match.winner !== null;
  $('step').disabled = deal.finished || waitingForHuman();
  i18n.label($('auto'), running ? 'pause' : 'resume');
  $('auto').disabled = collecting || showingLastHand || deal.finished || deal.zeroPointPlayers.length > 0;

  if (showingLastHand) show('status', 'reviewStatus');
  else if (collecting) show('status', 'collecting', {player: winner});
  else if (match.winner !== null) show('status', 'matchComplete', {team: match.winner, score: match.totals[match.winner]});
  else if (deal.zeroPointPlayers.length) show('status', 'zeroHand', {players: deal.zeroPointPlayers});
  else if (joinPending) show('status', 'joinStatus', {suit: deal.trump});
  else if (deal.finished) show('status', 'dealComplete', {ours: deal.scores[0], theirs: deal.scores[1]});
  else if (!deal.trump) show('status', deal.dealer === 0 ? 'humanTrump' : 'computerTrump', {player: deal.dealer, running});
  else if (complete) show('status', 'trickComplete', {running});
  else if (active === 0) show('status', 'yourTurn', {rule: ruleHint(deal.hands[0], deal.trick, deal.trump), recommend: deal.dealer === 0 && choices.some(card => card.suit === deal.trump)});
  else show('status', 'computerTurn', {player: active, running});
}

function schedule() {
  clearTimer();
  if (!shuffleStage && running && !deal.finished && !waitingForHuman()) timer = setTimeout(advance, deal.trick.length === 4 ? Math.max(1400, Number($('speed').value)) : Number($('speed').value));
}

function afterAction() {
  render();
  if (!shuffleStage && deal.trick.length === 4 && !trickCollected && !collecting) collectTrick();
  schedule();
}

function collectTrick() {
  clearTimer(); collecting = true; render();
  const winner = winningPlay(deal.trick, deal.trump)[0];
  const layer = $('trick-collection');
  layer.setAttribute('data-winner', winner);
  const origin = layer.getBoundingClientRect();
  const center = $('trick').getBoundingClientRect();
  const target = $(`seat-${winner}`).getBoundingClientRect();
  // Place the winning card on top of the gathered stack.
  const plays = [...deal.trick].sort(([a], [b]) => Number(a === winner) - Number(b === winner));
  layer.replaceChildren();
  plays.forEach(([player, card], index) => {
    const source = $('trick').children[player].children[1].getBoundingClientRect();
    const face = cardView(card, {winner: player === winner});
    face.className += ' collection-card';
    face.style.width = `${source.width}px`; face.style.height = `${source.height}px`;
    const offset = index * 3;
    const positions = {
      'from-x': source.left - origin.left,
      'from-y': source.top - origin.top,
      'stack-x': center.left + center.width / 2 - origin.left - source.width / 2 + offset,
      'stack-y': center.top + center.height / 2 - origin.top - source.height / 2 + offset,
      'target-x': target.left + target.width / 2 - origin.left - source.width / 2 + offset,
      'target-y': target.top + target.height / 2 - origin.top - source.height / 2 + offset,
    };
    for (const [name, value] of Object.entries(positions)) face.style.setProperty(`--${name}`, `${value}px`);
    face.style.setProperty('--collect-duration', `${COLLECT_MS}ms`);
    layer.append(face);
  });
  setTimeout(() => {
    layer.replaceChildren(); collecting = false; trickCollected = true;
    lastHand = {trick: deal.trick.map(([player, card]) => [player, {...card}]), winner, number: deal.trickNumber};
    if (deal.finished) {
      lastCollectedDeck = [...deal.gameDeck];
      try { localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(lastCollectedDeck)); }
      catch { /* In-memory collection order still works when storage is unavailable. */ }
    }
    render(); schedule();
  }, COLLECT_MS);
}

function play(card) {
  const player = deal.currentPlayer;
  const rule = ruleHint(deal.hands[player], deal.trick, deal.trump);
  deal.play(card);
  if (player === 0) analytics.humanPlayed();
  log('played', {player, card, points: points(card), rule});

  if (deal.trick.length === 4) {
    const winner = winningPlay(deal.trick, deal.trump)[0];
    log('trickWon', {player: winner, number: deal.trickNumber, points: deal.trick.reduce((sum, [, card]) => sum + points(card), 0)});
  }
  if (deal.finished) {
    const earned = match.scoreDeal(deal);
    analytics.completeDeal();
    log('dealScored', {scores: deal.scores, earned, totals: match.totals});
    if (match.winner !== null) log('matchWon', {team: match.winner});
  }
}

function playHuman(card) {
  if (shuffleStage || collecting || showingLastHand || joinPending || deal.trump === null || deal.finished || deal.trick.length === 4 || deal.currentPlayer !== 0) return;
  play(card); afterAction();
}

function advance() {
  clearTimer();
  if (shuffleStage || deal.finished || waitingForHuman()) return;

  if (!deal.trump) {
    deal.chooseTrump(chooseComputerTrump(deal.hands[deal.dealer]));
    log('trumpChosen', {player: deal.dealer, suit: deal.trump});
    offerJoin();
  } else if (deal.trick.length === 4) { deal.nextTrick(); trickCollected = false; }
  else play(chooseComputerCard(deal.currentPlayer, deal.hands[deal.currentPlayer], deal.trick, deal.trump, deal.dealer, deal.trumpedSuits[deal.currentPlayer % 2]));

  afterAction();
}

function startDeal(dealer, deck) {
  clearTimer(); joinPending = false; shuffleStage = false; trickCollected = false; deal = new Deal(dealer, Math.random, deck);
  analytics.beginDeal();
  log('dealStarted', {number: dealNumber, dealer, leader: deal.currentPlayer});
  afterAction();
}

function beginShuffle(dealer, deck, origin) {
  if (shuffling || collecting) return;
  lastHand = null; showingLastHand = false;
  clearTimer(); joinPending = false; shuffleStage = true;
  shuffleDealer = dealer; shuffleDeck = [...deck]; shuffleCount = 0; deckOrigin = origin;
  show('source-count', 'cardCount', {count: 32}); $('receiving-deck').hidden = true;
  $('shuffle-flight').replaceChildren();
  trickCollected = false;
  log('shuffleStarted', {number: dealNumber, player: dealer});
  afterAction();
}

function shuffleOnce() {
  if (!shuffleStage || shuffling) return;
  clearTimer(); shuffling = true;
  const result = [...shuffleDeck];
  const packets = hinduShuffle(result);
  let index = 0, received = 0;
  $('receiving-deck').hidden = false;
  function movePacket() {
    shuffleTimer = null;
    if (index === packets.length) {
      shuffleDeck = result; shuffling = false; shuffleCount++;
      show('source-count', 'cardCount', {count: 32}); $('receiving-deck').hidden = true;
      $('shuffle-flight').replaceChildren();
      log('shuffleFinished', {count: shuffleCount, packets: packets.length});
      afterAction(); return;
    }
    const size = packets[index++];
    show('source-count', 'cardCount', {count: 32 - received});
    show('received-count', 'cardCount', {count: received});
    const packet = cardView(shuffleDeck[received], {hidden: true});
    packet.className += ' shuffle-packet';
    const count = document.createElement('span'); count.className = 'packet-count'; count.textContent = size;
    packet.append(count); $('shuffle-flight').replaceChildren(packet);
    received += size;
    shuffleTimer = setTimeout(movePacket, PACKET_MS);
  }
  render(); movePacket();
}

function considerComputerJoins() {
  for (let player = 1; player < 4; player++) {
    if (player % 2 !== deal.dealer % 2 && chooseComputerJoin(deal.hands[player], deal.trump)) {
      deal.joinTrump(player);
      log('joined', {player, suit: deal.trump});
      break;
    }
  }
}

function offerJoin() {
  if (deal.trump === NULL_TRUMP) return;
  if (deal.dealer % 2 !== 0) joinPending = true;
  else considerComputerJoins();
}

TRUMP_CHOICES.forEach(suit => {
  const button = document.createElement('button');
  i18n.label(button, suit === NULL_TRUMP ? 'nullButton' : 'trumpSuit', {suit});
  button.addEventListener('click', () => {
    if (shuffleStage || deal.trump || deal.dealer !== 0) return;
    if (deal.zeroPointPlayers.length) return;
    deal.chooseTrump(suit); log('humanChose', {suit}); offerJoin(); afterAction();
  });
  $('suit-buttons').append(button);
});

$('join-trump').addEventListener('click', () => {
  if (!joinPending) return;
  deal.joinTrump(0); joinPending = false;
  log('joined', {player: 0, suit: deal.trump}); afterAction();
});
$('pass-trump').addEventListener('click', () => {
  if (!joinPending) return;
  log('passed', {suit: deal.trump}); considerComputerJoins(); joinPending = false; afterAction();
});
$('redeal').addEventListener('click', () => {
  if (!shuffleStage && deal.zeroPointPlayers.length) beginShuffle(deal.dealer, shuffleDeck, message('redealOrder'));
});

$('shuffle-deck').addEventListener('click', shuffleOnce);
$('deal-cards').addEventListener('click', () => {
  if (shuffleStage && !shuffling) startDeal(shuffleDealer, shuffleDeck);
});

$('show-last-hand').addEventListener('click', () => {
  if (!lastHand || shuffleStage || collecting) return;
  showingLastHand = !showingLastHand;
  clearTimer(); render(); schedule();
});
$('auto').addEventListener('click', () => { if (collecting || shuffleStage || showingLastHand) return; running = !running; afterAction(); });
$('step').addEventListener('click', () => { running = false; advance(); });
$('speed').addEventListener('change', schedule);
$('show-hands').addEventListener('change', render);

$('next-deal').addEventListener('click', () => {
  if (shuffleStage || collecting || !deal.finished || match.winner !== null) return;
  const previousDeal = dealNumber++;
  beginShuffle((deal.dealer + 1) % 4, deal.gameDeck, message('collectedOrder', {number: previousDeal}));
});

$('new-game').addEventListener('click', () => {
  if (shuffling || collecting) return;
  if (!confirm(i18n.text('newGameConfirm'))) return;
  match = new Match(); dealNumber = 1; $('history').replaceChildren();
  beginShuffle(0, lastCollectedDeck ?? shuffleDeck,
    lastCollectedDeck ? message('previousOrder') : message('retainedOrder'));
});

beginShuffle(0, lastCollectedDeck ?? makeDeck(),
  lastCollectedDeck ? message('previousOrder') : message('initialOrder'));
