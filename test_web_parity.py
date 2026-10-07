"""Compare browser decisions with this checkout's desktop rules (requires Node.js)."""
import json
from pathlib import Path
import random
import shutil
import subprocess
import unittest

from manille import (
    BoardDeal, TRUMP_CHOICES, choose_computer_card, choose_computer_join,
    choose_computer_trump, hindu_shuffle, legal_cards, make_deck, match_points, winning_play,
)


def card_json(card):
    return {"suit": card.suit, "rank": card.rank}


@unittest.skipUnless(shutil.which("node"), "Node.js is required for browser parity checks")
class BrowserParityTests(unittest.TestCase):
    def test_browser_hindu_shuffle_matches_desktop_packets_and_order(self):
        class DrawRandom:
            def __init__(self, draws):
                self.draws = iter(draws)

            def randint(self, low, high):
                return low + int(next(self.draws) * (high - low + 1))

        rng = random.Random(20261007)
        cases = []
        for _ in range(100):
            draws = [rng.random() for _ in range(64)]
            deck = make_deck()
            rng.shuffle(deck)
            original = [card_json(card) for card in deck]
            packets = hindu_shuffle(deck, DrawRandom(draws))
            cases.append({"draws": draws, "deck": original, "packets": packets,
                          "result": [card_json(card) for card in deck]})
        script = """
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hinduShuffle} from './web/engine.mjs';
for (const c of JSON.parse(fs.readFileSync(0, 'utf8'))) {
  let index = 0;
  assert.deepEqual(hinduShuffle(c.deck, () => c.draws[index++]), c.packets);
  assert.deepEqual(c.deck, c.result);
}
"""
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            input=json.dumps(cases), text=True, capture_output=True,
            cwd=Path(__file__).resolve().parent, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_browser_matches_desktop_across_complete_deals(self):
        cases = []
        rng = random.Random(20261007)
        for index in range(100):
            dealer = index % 4
            deal = BoardDeal(dealer, rng)
            while deal.zero_point_players:
                deal = BoardDeal(dealer, rng)
            trump = TRUMP_CHOICES[index % len(TRUMP_CHOICES)]
            deal.choose_trump(trump)
            while not deal.finished:
                if len(deal.trick) == 4:
                    deal.next_trick()
                player = deal.current_player
                hand = deal.hands[player]
                avoided = deal.trumped_suits[player % 2]
                chosen = choose_computer_card(player, hand, deal.trick, trump, dealer, avoided)
                cases.append({
                    "player": player, "hand": [card_json(card) for card in hand],
                    "trick": [[who, card_json(card)] for who, card in deal.trick],
                    "trump": trump, "dealer": dealer, "avoided": sorted(avoided),
                    "legal": [card_json(card) for card in legal_cards(hand, deal.trick, trump)],
                    "chosen": card_json(chosen), "computerTrump": choose_computer_trump(hand),
                    "join": choose_computer_join(hand, trump),
                    "winner": winning_play(deal.trick, trump)[0] if deal.trick else None,
                })
                deal.play(chosen)
        expected_scores = [
            match_points(raw, trump, joined)
            for raw in range(61) for trump in TRUMP_CHOICES for joined in (False, True)
        ]
        script = """
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as engine from './web/engine.mjs';
const {cases, scores} = JSON.parse(fs.readFileSync(0, 'utf8'));
for (const [index, c] of cases.entries()) {
  const context = `case ${index}: ${JSON.stringify(c)}`;
  assert.deepEqual(engine.legalCards(c.hand, c.trick, c.trump), c.legal, context);
  assert.deepEqual(engine.chooseComputerCard(c.player, c.hand, c.trick, c.trump, c.dealer, new Set(c.avoided)), c.chosen, context);
  assert.equal(engine.chooseComputerTrump(c.hand), c.computerTrump, context);
  assert.equal(engine.chooseComputerJoin(c.hand, c.trump), c.join, context);
  if (c.trick.length) assert.equal(engine.winningPlay(c.trick, c.trump)[0], c.winner, context);
}
const actualScores = [];
for (let raw = 0; raw <= 60; raw++) for (const trump of engine.TRUMP_CHOICES)
  for (const joined of [false, true]) actualScores.push(engine.matchPoints(raw, trump, joined));
assert.deepEqual(actualScores, scores);
console.log(`${cases.length} card decisions and ${scores.length} scoring cases match Python.`);
"""
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", script],
            input=json.dumps({"cases": cases, "scores": expected_scores}),
            text=True, capture_output=True, cwd=Path(__file__).resolve().parent, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
