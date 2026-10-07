import {Deal, Match, TRUMP_CHOICES, NULL_TRUMP, MATCH_TARGET, NAMES, makeDeck, cardId, hinduShuffle, points, legalCards, winningPlay, chooseComputerCard, chooseComputerTrump, chooseComputerJoin, ruleHint} from './engine.mjs';
const $ = id => document.getElementById(id);
const symbols = {Clubs:'♣', Diamonds:'♦', Hearts:'♥', Spades:'♠'};
const ranks = {Jack:'J', Queen:'Q', King:'K', Ace:'A'};
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

function log(message) {
  const item = document.createElement('li');
  item.textContent = message;
  $('history').prepend(item);
  while ($('history').children.length > 100) $('history').lastChild.remove();
}

function clearTimer() { clearTimeout(timer); timer = null; }

function cardView(card, {hidden = false, legal = false, winner = false, onPlay = null} = {}) {
  const element = document.createElement(onPlay ? 'button' : 'div');
  element.className = `card${['Diamonds','Hearts'].includes(card.suit) ? ' red' : ''}${hidden ? ' back' : ''}${legal ? ' legal' : ''}${winner ? ' winner' : ''}`;
  if (hidden) {
    element.innerHTML = '<span class="suit" aria-hidden="true">♠</span>';
    element.setAttribute('aria-label', 'Face-down card');
  } else {
    element.innerHTML = `<span class="rank">${ranks[card.rank] || card.rank}</span><span class="suit" aria-hidden="true">${symbols[card.suit]}</span><span class="value">${points(card)} pt</span>`;
    element.setAttribute('aria-label', `${card.rank} of ${card.suit}, ${points(card)} points${legal ? ', legal to play' : ''}${winner ? ', currently winning the trick' : ''}`);
  }
  if (onPlay) { element.disabled = !legal; element.addEventListener('click', onPlay); }
  return element;
}

function waitingForHuman() {
  return shuffleStage || collecting || deal.zeroPointPlayers.length > 0 || joinPending || (!deal.finished && (deal.trump === null ? deal.dealer === 0 : deal.trick.length < 4 && deal.currentPlayer === 0));
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
  const order = shuffleCount ? `Shuffled order · shuffle ${shuffleCount}` : deckOrigin;
  $('deck-order-note').textContent = `${order} · 1–32 · left to right, then the next row`;
  $('trick').replaceChildren();
  $('trick-label').textContent = `PREPARE DEAL ${dealNumber}`;
  $('table-message').textContent = 'Read the cards below from left to right. Card 1 is dealt first.';
  $('our-score').textContent = match.totals[0]; $('their-score').textContent = match.totals[1];
  $('deal-number').textContent = `Deal ${dealNumber}`; $('trump').textContent = 'Shuffle the deck';
  $('dealer').textContent = `Dealer: ${NAMES[shuffleDealer]}`;
  $('deal-score').textContent = '32 cards ready. Match scores are unchanged.';
  $('trump-picker').hidden = true; $('join-picker').hidden = true; $('redeal').hidden = true;
  $('next-deal').disabled = true; $('auto').disabled = true; $('step').disabled = true;
  $('shuffle-deck').disabled = shuffling; $('deal-cards').disabled = shuffling;
  $('new-game').disabled = shuffling;
  $('shuffle-note').textContent = shuffling ? 'Shuffling packets…' : `${shuffleCount} ${shuffleCount === 1 ? 'shuffle' : 'shuffles'} completed. Click the deck to shuffle again, or deal.`;
  $('status').textContent = shuffling ? 'Wait for the shuffle to finish.' : 'Click the deck for a Hindu shuffle, then choose Deal cards.';
}

function render() {
  $('table').classList.toggle('shuffle-mode', shuffleStage);
  $('table').classList.toggle('collecting', collecting);
  $('show-hands').disabled = collecting;
  $('speed').disabled = collecting;
  $('shuffle-panel').hidden = !shuffleStage; $('trick').hidden = shuffleStage;
  for (let player = 0; player < 4; player++) $(`seat-${player}`).hidden = shuffleStage;
  if (shuffleStage) { renderShuffle(); return; }
  $('new-game').disabled = collecting;
  const complete = deal.trick.length === 4;
  const active = deal.trump !== null && !joinPending && !complete && !deal.finished ? deal.currentPlayer : null;
  const choices = active !== null ? legalCards(deal.hands[active], deal.trick, deal.trump) : [];

  for (let player = 0; player < 4; player++) {
    const seat = $(`seat-${player}`);
    seat.classList.toggle('active', active === player || joinPending && player === 0 || !deal.zeroPointPlayers.length && deal.trump === null && deal.dealer === player);
    seat.replaceChildren();

    const title = document.createElement('h2');
    title.textContent = NAMES[player];
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = player === deal.dealer ? 'DEALER' : `TEAM ${player % 2 + 1}`;
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

  const winner = deal.trick.length ? winningPlay(deal.trick, deal.trump)[0] : null;
  $('trick').replaceChildren();

  for (let player = 0; player < 4; player++) {
    const slot = document.createElement('div'); slot.className = `trick-slot ${['south', 'west', 'north', 'east'][player]}`;
    const label = document.createElement('span'); label.textContent = NAMES[player]; slot.append(label);
    const played = deal.trick.find(([who]) => who === player);
    if (played && !trickCollected) slot.append(cardView(played[1], {winner: player === winner}));
    else { const empty = document.createElement('div'); empty.className = 'empty-card'; slot.append(empty); }
    $('trick').append(slot);
  }

  $('trick-label').textContent = `TRICK ${deal.trickNumber} OF 8`;
  $('table-message').textContent = complete ? `${NAMES[winner]} wins ${deal.trick.reduce((sum,[,card]) => sum + points(card),0)} points.` : winner !== null ? `${NAMES[winner]} ${winner === 0 ? 'are' : 'is'} winning the trick.` : '10 is high. Your teammate sits opposite.';
  $('our-score').textContent = match.totals[0];
  $('their-score').textContent = match.totals[1];
  $('deal-number').textContent = `Deal ${dealNumber}`;
  $('trump').textContent = deal.trump === null ? 'Choose trump' : deal.trump === NULL_TRUMP ? 'Null · no trump · ×2' : `${symbols[deal.trump]} ${deal.trump}${deal.joinedBy !== null ? ' · joined · ×2' : ''}`;
  $('dealer').textContent = `Dealer: ${NAMES[deal.dealer]}`;
  $('deal-score').textContent = `Deal points: Your team ${deal.scores[0]} · Opponents ${deal.scores[1]} / 60`;
  $('trump-picker').hidden = deal.zeroPointPlayers.length > 0 || deal.trump !== null || deal.dealer !== 0;
  $('join-picker').hidden = !joinPending;
  $('redeal').hidden = !deal.zeroPointPlayers.length;
  $('next-deal').disabled = collecting || !deal.finished || match.winner !== null;
  $('step').disabled = deal.finished || waitingForHuman();
  $('auto').textContent = running ? 'Pause computers' : 'Resume computers';
  $('auto').disabled = collecting || deal.finished || deal.zeroPointPlayers.length > 0;

  if (collecting) $('status').textContent = `Collecting the trick for ${NAMES[winner]}.`;
  else if (match.winner !== null) $('status').textContent = `Match complete: ${match.winner === 0 ? 'your team wins' : 'opponents win'} with ${match.totals[match.winner]} counted points (target ${MATCH_TARGET}). Select New game to play again.`;
  else if (deal.zeroPointPlayers.length) $('status').textContent = `${deal.zeroPointPlayers.map(player => NAMES[player]).join(', ')} received a zero-point hand. Redeal with the same dealer; match scores stay unchanged.`;
  else if (joinPending) $('status').textContent = `The opposing team chose ${deal.trump}. Join trump to double this deal's counted points for either team, or pass.`;
  else if (deal.finished) $('status').textContent = `Deal complete - ${deal.scores[0] === deal.scores[1] ? 'a tie' : deal.scores[0] > deal.scores[1] ? 'your team wins' : 'opponents win'}. Select Next deal to continue toward ${MATCH_TARGET}.`;
  else if (!deal.trump) $('status').textContent = deal.dealer === 0 ? 'You are the dealer. Choose trump to begin.' : `${NAMES[deal.dealer]} will choose trump.${running ? '' : ' Press Step or Resume.'}`;
  else if (complete) $('status').textContent = `Trick complete.${running ? ' The next trick starts shortly.' : ' Press Step to start the next trick.'}`;
  else if (active === 0) $('status').textContent = `Your turn. ${ruleHint(deal.hands[0], deal.trick, deal.trump)}${deal.dealer === 0 && choices.some(card => card.suit === deal.trump) ? ' As trump chooser, playing trump is recommended.' : ''} Click a gold-bordered card.`;
  else $('status').textContent = `${NAMES[active]}'s turn.${running ? '' : ' Computers paused. Press Step or Resume.'}`;
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
  log(`${NAMES[player]} ${player === 0 ? 'play' : 'plays'} ${card.rank} ${symbols[card.suit]} (${points(card)} pt). ${rule}`);

  if (deal.trick.length === 4) {
    const winner = winningPlay(deal.trick, deal.trump)[0];
    log(`${NAMES[winner]} ${winner === 0 ? 'win' : 'wins'} trick ${deal.trickNumber}: ${deal.trick.reduce((sum,[,played]) => sum + points(played),0)} points for Team ${winner % 2 + 1}.`);
  }
  if (deal.finished) {
    const earned = match.scoreDeal(deal);
    log(`Deal points ${deal.scores.join('–')}; counted points +${earned[0]} / +${earned[1]}. Match ${match.totals.join('–')} toward ${MATCH_TARGET}.`);
    if (match.winner !== null) log(`${match.winner === 0 ? 'Your team' : 'Opponents'} wins the match.`);
  }
}

function playHuman(card) {
  if (shuffleStage || collecting || joinPending || deal.trump === null || deal.finished || deal.trick.length === 4 || deal.currentPlayer !== 0) return;
  play(card); afterAction();
}

function advance() {
  clearTimer();
  if (shuffleStage || deal.finished || waitingForHuman()) return;

  if (!deal.trump) {
    deal.chooseTrump(chooseComputerTrump(deal.hands[deal.dealer]));
    log(`${NAMES[deal.dealer]} chooses ${deal.trump}: ${deal.trump === NULL_TRUMP ? 'strong high cards across suits; no trump and double counted points' : 'strongest suit by points, count, then rank'}.`);
    offerJoin();
  } else if (deal.trick.length === 4) { deal.nextTrick(); trickCollected = false; }
  else play(chooseComputerCard(deal.currentPlayer, deal.hands[deal.currentPlayer], deal.trick, deal.trump, deal.dealer, deal.trumpedSuits[deal.currentPlayer % 2]));

  afterAction();
}

function startDeal(dealer, deck) {
  clearTimer(); joinPending = false; shuffleStage = false; trickCollected = false; deal = new Deal(dealer, Math.random, deck);
  log(`Deal ${dealNumber}. ${NAMES[dealer]} ${dealer === 0 ? 'deal' : 'deals'}; ${NAMES[deal.currentPlayer]} ${deal.currentPlayer === 0 ? 'lead' : 'leads'} first.`);
  afterAction();
}

function beginShuffle(dealer, deck, origin) {
  if (shuffling || collecting) return;
  clearTimer(); joinPending = false; shuffleStage = true;
  shuffleDealer = dealer; shuffleDeck = [...deck]; shuffleCount = 0; deckOrigin = origin;
  $('source-count').textContent = '32 cards'; $('receiving-deck').hidden = true;
  $('shuffle-flight').replaceChildren();
  trickCollected = false;
  log(`Deal ${dealNumber}: ${NAMES[dealer]} ${dealer === 0 ? 'deal' : 'deals'}. Click the deck to shuffle, then deal this exact order.`);
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
      $('source-count').textContent = '32 cards'; $('receiving-deck').hidden = true;
      $('shuffle-flight').replaceChildren();
      log(`Hindu shuffle ${shuffleCount} complete. ${packets.length} packets moved; the new order is shown below.`);
      afterAction(); return;
    }
    const size = packets[index++];
    $('source-count').textContent = `${32 - received} cards`;
    $('received-count').textContent = `${received} cards`;
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
      log(`${NAMES[player]} joins ${deal.trump}: double counted points for this deal.`);
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
  button.textContent = suit === NULL_TRUMP ? 'Null (no trump · ×2)' : `${symbols[suit]} ${suit}`;
  button.addEventListener('click', () => {
    if (shuffleStage || deal.trump || deal.dealer !== 0) return;
    if (deal.zeroPointPlayers.length) return;
    deal.chooseTrump(suit); log(`You choose ${suit}${suit === NULL_TRUMP ? ': no trump; double counted points' : ' as trump'}.`); offerJoin(); afterAction();
  });
  $('suit-buttons').append(button);
});

$('join-trump').addEventListener('click', () => {
  if (!joinPending) return;
  deal.joinTrump(0); joinPending = false;
  log(`You join ${deal.trump}: double counted points for this deal.`); afterAction();
});
$('pass-trump').addEventListener('click', () => {
  if (!joinPending) return;
  log(`You pass on joining ${deal.trump}.`); considerComputerJoins(); joinPending = false; afterAction();
});
$('redeal').addEventListener('click', () => {
  if (!shuffleStage && deal.zeroPointPlayers.length) beginShuffle(deal.dealer, shuffleDeck, 'Retained order for this redeal');
});

$('shuffle-deck').addEventListener('click', shuffleOnce);
$('deal-cards').addEventListener('click', () => {
  if (shuffleStage && !shuffling) startDeal(shuffleDealer, shuffleDeck);
});

$('auto').addEventListener('click', () => { if (collecting || shuffleStage) return; running = !running; afterAction(); });
$('step').addEventListener('click', () => { running = false; advance(); });
$('speed').addEventListener('change', schedule);
$('show-hands').addEventListener('change', render);

$('next-deal').addEventListener('click', () => {
  if (shuffleStage || collecting || !deal.finished || match.winner !== null) return;
  const previousDeal = dealNumber++;
  beginShuffle((deal.dealer + 1) % 4, deal.gameDeck, `Collected order from Deal ${previousDeal}`);
});

$('new-game').addEventListener('click', () => {
  if (shuffling || collecting) return;
  if (!confirm('Start a new game and clear the scores?')) return;
  match = new Match(); dealNumber = 1; $('history').replaceChildren();
  beginShuffle(0, lastCollectedDeck ?? shuffleDeck,
    lastCollectedDeck ? 'Collected order from the previous deal' : 'Retained deck order');
});

beginShuffle(0, lastCollectedDeck ?? makeDeck(),
  lastCollectedDeck ? 'Collected order from the previous deal' : 'Initial deck order');
