import unittest
from unittest.mock import patch

import random

from manille import (
    BoardDeal,
    Card,
    ManilleGame,
    NULL_TRUMP,
    choose_computer_card,
    choose_computer_join,
    choose_computer_trump,
    deal_hands,
    legal_cards,
    make_deck,
    match_points,
    winning_play,
)


class ManilleTests(unittest.TestCase):
    def test_only_opponents_can_join_suit_trump_once_before_play(self):
        for dealer in range(4):
            for player in (-1, 0, 1, 2, 3, 4):
                with self.subTest(dealer=dealer, player=player):
                    deal = BoardDeal(dealer, random.Random(42))
                    with self.assertRaises(ValueError):
                        deal.join_trump(player)  # Trump is not declared yet.
                    deal.choose_trump("Hearts")
                    if player in range(4) and player % 2 != dealer % 2:
                        deal.join_trump(player)
                        self.assertEqual(deal.joined_by, player)
                        with self.assertRaises(ValueError):
                            deal.join_trump((player + 2) % 4)
                        self.assertEqual(deal.joined_by, player)
                    else:
                        with self.assertRaises(ValueError):
                            deal.join_trump(player)
                        self.assertIsNone(deal.joined_by)
        deal = BoardDeal(0, random.Random(42))
        deal.choose_trump(NULL_TRUMP)
        with self.assertRaises(ValueError):
            deal.join_trump(1)
        deal = BoardDeal(0, random.Random(42))
        deal.choose_trump("Hearts")
        deal.play(deal.hands[1][0])
        with self.assertRaises(ValueError):
            deal.join_trump(1)
        while len(deal.trick) < 4:
            player = deal.current_player
            deal.play(choose_computer_card(player, deal.hands[player], deal.trick, deal.trump))
        deal.next_trick()
        with self.assertRaises(ValueError):
            deal.join_trump(3)  # An empty later trick does not reopen joining.

    def test_join_doubles_excess_points_once(self):
        for raw, expected in ((0, 0), (20, 0), (30, 0), (31, 2), (40, 20), (60, 60)):
            self.assertEqual(match_points(raw, "Hearts", joined=True), expected)
            self.assertEqual(match_points(raw, NULL_TRUMP, joined=True), expected)

    def test_computer_joins_only_a_long_strong_trump_suit(self):
        strong = [Card("Hearts", rank) for rank in ("10", "Ace", "King", "9", "8")]
        strong += [Card("Clubs", "7"), Card("Diamonds", "8"), Card("Spades", "9")]
        self.assertTrue(choose_computer_join(strong, "Hearts"))
        self.assertFalse(choose_computer_join(strong, NULL_TRUMP))
        self.assertFalse(choose_computer_join(strong, "Clubs"))
        self.assertFalse(choose_computer_join(strong[:4], "Hearts"))
        weak = [Card("Hearts", rank) for rank in ("7", "8", "9", "Jack", "Queen")]
        self.assertFalse(choose_computer_join(weak, "Hearts"))

    def test_console_human_join_and_pass_score_the_deal(self):
        for choice, joined in (("1", True), ("2", False)):
            game = ManilleGame(human=True, seed=42)
            game.dealer = 1
            with (
                patch("manille.choose_computer_trump", return_value="Hearts"),
                patch("manille.choose_computer_join", return_value=False),
                patch("builtins.input", return_value=choice) as prompt,
                patch("builtins.print"),
                patch("manille.choose_human_card", side_effect=lambda hand, trick, trump: legal_cards(hand, trick, trump)[0]),
            ):
                raw = game.play_deal(verbose=False)
            self.assertEqual(game.joined_by, 0 if joined else None)
            self.assertEqual(game.scores, [match_points(p, "Hearts", joined) for p in raw])
            self.assertIn("Join trump?", prompt.call_args.args[0])

    def test_three_two_three_packets_start_left_of_every_dealer(self):
        deck = make_deck()
        expected_packets = (
            deck[0:3] + deck[12:14] + deck[20:23],
            deck[3:6] + deck[14:16] + deck[23:26],
            deck[6:9] + deck[16:18] + deck[26:29],
            deck[9:12] + deck[18:20] + deck[29:32],
        )
        for dealer in range(4):
            with self.subTest(dealer=dealer):
                hands = deal_hands(deck, dealer)
                for offset, expected in enumerate(expected_packets, start=1):
                    self.assertEqual(hands[(dealer + offset) % 4], expected)
                self.assertEqual(len(set(sum(hands, []))), 32)
                self.assertTrue(all(len(hand) == 8 for hand in hands))

    def test_dealing_supplied_deck_preserves_exact_order_without_reshuffling(self):
        deck = list(reversed(make_deck()))
        original = list(deck)
        rng = random.Random(42)
        with patch.object(rng, "shuffle", side_effect=AssertionError("Unexpected shuffle")):
            for dealer in range(4):
                deal = BoardDeal(dealer, rng, deck=deck)
                for player in range(4):
                    packet_position = (player - dealer - 1) % 4
                    start_three = packet_position * 3
                    start_two = 12 + packet_position * 2
                    final_three = 20 + packet_position * 3
                    expected = set(
                        deck[start_three:start_three + 3]
                        + deck[start_two:start_two + 2]
                        + deck[final_three:final_three + 3]
                    )
                    self.assertEqual(set(deal.hands[player]), expected)
                    self.assertEqual(len(deal.hands[player]), 8)
        self.assertEqual(deck, original)
        for invalid in (deck[:-1], deck[:-1] + [deck[0]]):
            with self.assertRaises(ValueError):
                BoardDeal(0, rng, deck=invalid)

    def test_null_doubles_only_points_above_30(self):
        for raw, expected in ((0, 0), (20, 0), (30, 0), (31, 2), (40, 20), (60, 60)):
            with self.subTest(raw=raw):
                self.assertEqual(match_points(raw, NULL_TRUMP), expected)

    def test_null_follow_suit_and_only_led_suit_can_win(self):
        # Player 3 follows an opponent who is winning the led suit.
        trick = [(0, Card("Clubs", "7")), (1, Card("Hearts", "10")),
                 (2, Card("Diamonds", "7"))]
        following = [Card("Clubs", "8"), Card("Spades", "10")]
        self.assertEqual(legal_cards(following, trick, NULL_TRUMP), [following[0]])
        void = [Card("Hearts", "Ace"), Card("Spades", "10")]
        self.assertEqual(legal_cards(void, trick, NULL_TRUMP), void)
        self.assertEqual(winning_play(trick, NULL_TRUMP)[0], 0)
        self.assertEqual(winning_play(trick + [(3, following[0])], NULL_TRUMP)[0], 3)

    def test_five_point_priority_on_leads_and_with_winning_partner(self):
        for trump in ("Hearts", "Clubs", "Spades", "Diamonds", NULL_TRUMP):
            for trick in (
                [],
                [(0, Card("Hearts", "10"))],
                [(3, Card("Hearts", "10")), (0, Card("Hearts", "7"))],
            ):
                player = (trick[-1][0] + 1) % 4 if trick else 1
                hand = [Card("Clubs", "7"), Card("Clubs", "Ace"), Card("Clubs", "10")]
                with self.subTest(trump=trump, trick=trick):
                    expected = hand[0] if trump != NULL_TRUMP and len(trick) == 1 else hand[2]
                    self.assertEqual(choose_computer_card(player, hand, trick, trump), expected)

    def test_opponent_winning_computer_conserves_points_with_legal_cards(self):
        cases = (
            # Void without trump: save both the 10 and Ace.
            ([(0, Card("Clubs", "10"))],
             [Card("Spades", "10"), Card("Diamonds", "Ace"), Card("Diamonds", "7")],
             Card("Diamonds", "7")),
            # Must follow even though the opponent's trump cannot be beaten.
            ([(3, Card("Clubs", "7")), (0, Card("Hearts", "King"))],
             [Card("Clubs", "10"), Card("Clubs", "Jack"), Card("Spades", "7")],
             Card("Clubs", "Jack")),
            # Take the trick with the cheapest higher card of the led suit.
            ([(0, Card("Clubs", "Jack"))],
             [Card("Clubs", "10"), Card("Clubs", "Queen"), Card("Spades", "7")],
             Card("Clubs", "Queen")),
            # Mandatory trump: take the trick cheaply, keeping the trump 10.
            ([(0, Card("Clubs", "Ace"))],
             [Card("Hearts", "10"), Card("Hearts", "7"), Card("Spades", "7")],
             Card("Hearts", "7")),
            # Overtrump with the cheapest winning trump, even with a cheap discard.
            ([(3, Card("Clubs", "7")), (0, Card("Hearts", "King"))],
             [Card("Hearts", "10"), Card("Hearts", "Ace"), Card("Spades", "7")],
             Card("Hearts", "Ace")),
            # Forced lower trump: save the Queen when the 8 is legal.
            ([(3, Card("Clubs", "7")), (0, Card("Hearts", "King"))],
             [Card("Hearts", "Queen"), Card("Hearts", "8"), Card("Spades", "7")],
             Card("Hearts", "8")),
            # A high-value card must still be played when it is the only legal card.
            ([(0, Card("Clubs", "Ace"))],
             [Card("Clubs", "10"), Card("Spades", "7")],
             Card("Clubs", "10")),
        )
        for rotation in range(4):
            for trick, hand, expected in cases:
                rotated = [((p + rotation) % 4, card) for p, card in trick]
                player = (rotated[-1][0] + 1) % 4
                with self.subTest(player=player, trick=rotated, hand=hand):
                    self.assertEqual(choose_computer_card(player, hand, rotated, "Hearts"), expected)
                    self.assertIn(expected, legal_cards(hand, rotated, "Hearts"))

    def test_five_point_priority_preserves_follow_suit_and_overtrumping(self):
        for trump in ("Hearts", NULL_TRUMP):
            trick = [(0, Card("Clubs", "Ace"))]
            hand = [Card("Clubs", "7"), Card("Spades", "10")]
            self.assertEqual(choose_computer_card(1, hand, trick, trump), hand[0])
        trick = [(0, Card("Clubs", "7")), (1, Card("Hearts", "King"))]
        hand = [Card("Hearts", "Ace"), Card("Spades", "10")]
        self.assertEqual(choose_computer_card(2, hand, trick, "Hearts"), hand[0])

    def test_equal_five_point_cards_conserve_trump(self):
        hand = [Card("Hearts", "10"), Card("Clubs", "10")]
        self.assertEqual(choose_computer_card(0, hand, [], "Hearts"), hand[1])

    def test_null_computer_prioritizes_high_values_on_every_turn(self):
        for trick in (
            [],
            [(0, Card("Clubs", "10"))],  # Opponent winning; cannot win.
            [(3, Card("Clubs", "10")), (0, Card("Clubs", "7"))],  # Partner winning.
        ):
            player = (trick[-1][0] + 1) % 4 if trick else 1
            hand = [Card("Hearts", rank) for rank in
                    ("7", "8", "9", "Jack", "Queen", "King", "Ace", "10")]
            for rank in ("10", "Ace", "King", "Queen", "Jack", "9", "8", "7"):
                with self.subTest(trick=trick, rank=rank):
                    card = choose_computer_card(player, hand, trick, NULL_TRUMP)
                    self.assertEqual(card.rank, rank)
                    hand.remove(card)

    def test_null_high_value_strategy_respects_legal_cards(self):
        trick = [(0, Card("Clubs", "10"))]
        hand = [Card("Clubs", "8"), Card("Clubs", "King"),
                Card("Hearts", "10"), Card("Diamonds", "Ace")]
        self.assertEqual(choose_computer_card(1, hand, trick, NULL_TRUMP), hand[1])
        trick = [(0, Card("Clubs", "7"))]
        self.assertEqual(choose_computer_card(1, hand, trick, NULL_TRUMP), hand[1])

    def test_computer_selects_null_for_distributed_high_cards(self):
        hand = [
            Card("Clubs", "10"), Card("Clubs", "Ace"),
            Card("Diamonds", "10"), Card("Diamonds", "King"),
            Card("Hearts", "Ace"), Card("Hearts", "Queen"),
            Card("Spades", "Ace"), Card("Spades", "7"),
        ]
        self.assertEqual(choose_computer_trump(hand), NULL_TRUMP)
        concentrated = [Card("Clubs", rank) for rank in ("10", "Ace", "King", "Queen", "Jack")]
        concentrated += [Card("Hearts", "7"), Card("Diamonds", "8"), Card("Spades", "9")]
        self.assertEqual(choose_computer_trump(concentrated), "Clubs")

    def test_null_deals_match_console_and_double_totals(self):
        rng = random.Random(42)
        console = ManilleGame(human=False, seed=42)
        expected_totals = [0, 0]
        with patch("manille.choose_computer_trump", return_value=NULL_TRUMP):
            for deal_number in range(5):
                board = BoardDeal(deal_number % 4, rng)
                board.choose_trump(NULL_TRUMP)
                with self.assertRaises(ValueError):
                    board.choose_trump("Clubs")
                while not board.finished:
                    if len(board.trick) == 4:
                        board.next_trick()
                    player = board.current_player
                    board.play(choose_computer_card(
                        player, board.hands[player], board.trick, NULL_TRUMP
                    ))
                self.assertEqual(sum(board.scores), 60)
                captured = sum(board.captured, [])
                self.assertEqual(len(set(captured)), 32)
                self.assertEqual(board.scores, console.play_deal(verbose=False))
                expected_totals = [
                    old + 2 * max(raw - 30, 0)
                    for old, raw in zip(expected_totals, board.scores)
                ]
                self.assertEqual(console.scores, expected_totals)

    def test_human_can_choose_null_in_console(self):
        game = ManilleGame(seed=42)
        with (
            patch("builtins.input", return_value="5"),
            patch("builtins.print"),
            patch("manille.choose_human_card", side_effect=lambda hand, trick, trump:
                  legal_cards(hand, trick, trump)[0]) as chooser,
        ):
            raw = game.play_deal(verbose=False)
        self.assertTrue(all(call.args[2] == NULL_TRUMP for call in chooser.call_args_list))
        self.assertEqual(game.scores, [2 * max(points - 30, 0) for points in raw])

    def test_only_deal_points_above_30_count(self):
        for raw, expected in ((0, 0), (20, 0), (29, 0), (30, 0), (31, 1), (40, 10), (60, 30)):
            with self.subTest(raw=raw):
                self.assertEqual(match_points(raw), expected)

    def test_deck_and_points(self):
        deck = make_deck()
        self.assertEqual(len(set(deck)), 32)
        self.assertEqual(sum(card.points for card in deck), 60)

    def test_follow_suit_is_mandatory_even_after_an_opponent_trumps(self):
        hand = [Card("Clubs", "7"), Card("Hearts", "10")]
        trick = [
            (0, Card("Clubs", "Ace")),
            (1, Card("Hearts", "8")),
        ]
        self.assertEqual(
            legal_cards(hand, trick, "Hearts"), [hand[0]]
        )
        self.assertEqual(choose_computer_card(2, hand, trick, "Hearts"), hand[0])
        board = BoardDeal(0, random.Random(42))
        board.choose_trump("Hearts")
        board.leader = 0
        board.trick = list(trick)
        board.hands[2] = list(hand)
        with self.assertRaises(ValueError):
            board.play(hand[1])
        self.assertEqual(board.hands[2], hand)
        board.play(hand[0])
        self.assertEqual(winning_play(board.trick, "Hearts")[0], 1)

    def test_no_other_suit_can_replace_following_suit(self):
        trick = [(0, Card("Clubs", "7")), (1, Card("Hearts", "King"))]
        hand = [
            Card("Clubs", "Ace"), Card("Hearts", "8"),
            Card("Hearts", "Ace"), Card("Spades", "10"),
        ]
        self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[0]])
        board = BoardDeal(0, random.Random(42))
        board.choose_trump("Hearts")
        board.leader = 0
        board.trick = list(trick)
        board.hands[2] = list(hand)
        for illegal in hand[1:]:
            with self.assertRaises(ValueError):
                board.play(illegal)
        self.assertEqual(board.hands[2], hand)
        board.play(hand[0])
        self.assertEqual(winning_play(board.trick, "Hearts")[0], 1)

    def test_cannot_trump_when_able_to_follow_before_first_trump(self):
        hand = [Card("Clubs", "7"), Card("Hearts", "10")]
        trick = [(0, Card("Clubs", "Ace"))]
        self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[0]])

    def test_overtrump_must_beat_highest_trump_already_played(self):
        trick = [
            (0, Card("Clubs", "7")), (1, Card("Hearts", "King")),
            (2, Card("Hearts", "Ace")),
        ]
        hand = [Card("Diamonds", "8"), Card("Hearts", "Queen"), Card("Hearts", "10")]
        self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[2]])

    def test_void_requires_trump(self):
        hand = [Card("Hearts", "7"), Card("Spades", "10")]
        self.assertEqual(
            legal_cards(
                hand, [(0, Card("Clubs", "10"))], "Hearts"
            ),
            [hand[0]],
        )

    def test_overtrump_or_play_lower_trump_when_void(self):
        trick = [
            (0, Card("Clubs", "7")),
            (1, Card("Hearts", "King")),
        ]
        hand = [
            Card("Hearts", "8"),
            Card("Hearts", "Ace"),
            Card("Spades", "10"),
        ]
        self.assertEqual(
            legal_cards(hand, trick, "Hearts"), [hand[1]]
        )
        hand.remove(hand[1])
        self.assertEqual(
            legal_cards(hand, trick, "Hearts"), [hand[0]]
        )
        self.assertEqual(
            legal_cards([hand[1]], trick, "Hearts"),
            [hand[1]],
        )

    def test_trump_and_ten_rank(self):
        trick = [
            (0, Card("Clubs", "Ace")),
            (1, Card("Clubs", "10")),
            (2, Card("Spades", "10")),
        ]
        self.assertEqual(
            winning_play(trick, "Hearts")[0], 1
        )
        trick.append((3, Card("Hearts", "7")))
        self.assertEqual(
            winning_play(trick, "Hearts")[0], 3
        )

    def test_feed_partner_with_high_value_card(self):
        trick = [
            (0, Card("Clubs", "10")),
            (1, Card("Clubs", "7")),
        ]
        hand = [Card("Clubs", "Ace"), Card("Clubs", "8")]
        self.assertEqual(
            choose_computer_card(2, hand, trick, "Hearts"),
            hand[0],
        )

    def test_partner_winning_led_suit_still_requires_trump_when_void(self):
        trick = [
            (0, Card("Clubs", "10")),
            (1, Card("Spades", "7")),
        ]
        hand = [Card("Hearts", "7"), Card("Diamonds", "10")]
        self.assertEqual(
            choose_computer_card(2, hand, trick, "Hearts"),
            hand[0],
        )

    def test_partner_winning_trump_excludes_avoidable_lower_trumps_for_each_player(self):
        for player in range(4):
            with self.subTest(player=player):
                trick = [
                    ((player - 3) % 4, Card("Clubs", "7")),
                    ((player - 2) % 4, Card("Hearts", "King")),
                    ((player - 1) % 4, Card("Clubs", "8")),
                ]
                hand = [
                    Card("Hearts", "8"), Card("Hearts", "Ace"),
                    Card("Diamonds", "10"),
                ]
                self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[1]])
                self.assertEqual(
                    choose_computer_card(player, hand, trick, "Hearts"),
                    hand[1],
                )
                for card in (hand[1],):
                    board = BoardDeal(0, random.Random(42))
                    board.choose_trump("Hearts")
                    board.leader = trick[0][0]
                    board.trick = list(trick)
                    board.hands[player] = list(hand)
                    with self.assertRaises(ValueError):
                        board.play(hand[0])
                    with self.assertRaises(ValueError):
                        board.play(hand[2])
                    self.assertEqual(board.hands[player], hand)
                    board.play(card)
                    self.assertEqual(
                        winning_play(board.trick, "Hearts")[0],
                        player,
                    )

    def test_lower_trumps_are_legal_only_when_no_legal_alternative_remains(self):
        for winning_player in (1, 2):
            # Player 3 acts next; player 1 is their partner, player 2 is an opponent.
            trick = [
                (0, Card("Clubs", "7")),
                (1, Card("Hearts", "King") if winning_player == 1 else Card("Clubs", "8")),
                (2, Card("Hearts", "King") if winning_player == 2 else Card("Clubs", "8")),
            ]
            lower = [Card("Hearts", "7"), Card("Hearts", "Queen")]
            discard = Card("Diamonds", "10")
            with self.subTest(winner=winning_player):
                self.assertEqual(legal_cards(lower, trick, "Hearts"), lower)
                self.assertEqual(legal_cards(lower + [discard], trick, "Hearts"), lower)
                higher = Card("Hearts", "Ace")
                self.assertEqual(legal_cards(lower + [higher], trick, "Hearts"), [higher])

    def test_trump_lead_requires_higher_trump_if_available(self):
        trick = [(0, Card("Hearts", "King"))]
        lower = Card("Hearts", "8")
        higher = Card("Hearts", "Ace")
        discard = Card("Spades", "10")
        self.assertEqual(legal_cards([lower, higher, discard], trick, "Hearts"), [higher])
        # Following trump still takes priority over discarding another suit.
        self.assertEqual(legal_cards([lower, discard], trick, "Hearts"), [lower])

    def test_partner_winning_trump_does_not_override_following_suit(self):
        trick = [
            (1, Card("Clubs", "7")), (2, Card("Hearts", "King")),
            (3, Card("Clubs", "8")),
        ]
        hand = [Card("Clubs", "9"), Card("Diamonds", "10"), Card("Hearts", "Ace")]
        self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[0]])

    def test_partner_winning_led_suit_and_null_still_require_following(self):
        for player in range(4):
            for trump in ("Hearts", NULL_TRUMP):
                trick = [
                    ((player - 2) % 4, Card("Clubs", "10")),
                    ((player - 1) % 4, Card("Clubs", "7")),
                ]
                hand = [Card("Clubs", "8"), Card("Hearts", "7"), Card("Diamonds", "Ace")]
                self.assertEqual(legal_cards(hand, trick, trump), [hand[0]])
                for card in (hand[0],):
                    deal = BoardDeal(0, random.Random(42))
                    deal.choose_trump(trump)
                    deal.leader = trick[0][0]
                    deal.trick = list(trick)
                    deal.hands[player] = list(hand)
                    for illegal in hand[1:]:
                        with self.assertRaises(ValueError):
                            deal.play(illegal)
                    deal.play(card)
                    self.assertEqual(deal.trick[-1], (player, card))

    def test_following_requires_higher_card_except_with_winning_partner(self):
        for trump in ("Hearts", "Clubs", NULL_TRUMP):
            for partner_winning in (False, True):
                trick = [(1, Card("Clubs", "Queen") if not partner_winning else Card("Clubs", "7")),
                         (2, Card("Clubs", "Queen") if partner_winning else Card("Clubs", "7")),
                         (3, Card("Clubs", "8"))]
                hand = [Card("Clubs", "9"), Card("Clubs", "King"),
                        Card("Clubs", "Ace"), Card("Diamonds", "10")]
                with self.subTest(trump=trump, partner=partner_winning):
                    lower_allowed = partner_winning and trump != "Clubs"
                    self.assertEqual(legal_cards(hand, trick, trump),
                                     hand[:3] if lower_allowed else hand[1:3])
                    deal = BoardDeal(0, random.Random(42))
                    deal.choose_trump(trump)
                    deal.leader = 1
                    deal.trick = list(trick)
                    deal.hands[0] = list(hand)
                    for illegal in ([hand[3]] if lower_allowed else [hand[0], hand[3]]):
                        with self.assertRaises(ValueError):
                            deal.play(illegal)
                    deal.play(hand[0] if lower_allowed else hand[1])
                    self.assertEqual(deal.trick[-1][1], hand[0] if lower_allowed else hand[1])
                    # Without a higher led-suit card, lower followers remain legal.
                    self.assertEqual(legal_cards([hand[0], hand[3]], trick, trump), [hand[0]])

    def test_opponent_overtrumping_partner_requires_winning_trump(self):
        trick = [
            (1, Card("Clubs", "7")), (2, Card("Hearts", "King")),
            (3, Card("Hearts", "Ace")),
        ]
        hand = [
            Card("Hearts", "8"), Card("Hearts", "10"),
            Card("Diamonds", "10"),
        ]
        self.assertEqual(legal_cards(hand, trick, "Hearts"), [hand[1]])

    @patch("manille.choose_computer_join", return_value=False)
    @patch("manille.choose_computer_trump", return_value="Hearts")
    def test_many_deals_and_rotation(self, _chooser, _joiner):
        game = ManilleGame(human=False, seed=42)
        expected = [0, 0]
        for deal in range(100):
            raw = game.play_deal(verbose=False)
            self.assertEqual(
                sum(raw), 60
            )
            for team, points in enumerate(raw):
                if points > 30:
                    expected[team] += points - 30
            self.assertEqual(game.scores, expected)
            self.assertEqual(game.dealer, (deal + 1) % 4)
        self.assertLessEqual(sum(game.scores), 3000)

    def test_human_deal(self):
        game = ManilleGame(seed=42)
        # Select a legal card from the hand supplied by the game;
        # choose trump 1.
        with (
            patch("builtins.input", return_value="1"),
            patch("builtins.print"),
            patch(
                "manille.choose_human_card",
                side_effect=lambda hand, trick, trump:
                    legal_cards(hand, trick, trump)[0],
            ),
        ):
            self.assertEqual(
                sum(game.play_deal(verbose=False)), 60
            )

    def test_board_deals_match_console_and_preserve_every_card(self):
        rng = random.Random(42)
        console = ManilleGame(human=False, seed=42)
        for deal_number in range(100):
            board = BoardDeal(deal_number % 4, rng)
            self.assertEqual(
                board.current_player, (board.dealer + 1) % 4
            )
            self.assertTrue(
                all(len(hand) == 8 for hand in board.hands)
            )
            board.choose_trump(
                choose_computer_trump(board.hands[board.dealer])
            )
            while not board.finished:
                if len(board.trick) == 4:
                    winner = winning_play(
                        board.trick, board.trump
                    )[0]
                    board.next_trick()
                    self.assertEqual(
                        board.current_player, winner
                    )
                player = board.current_player
                board.play(
                    choose_computer_card(
                        player, board.hands[player],
                        board.trick, board.trump,
                    )
                )
                # Completed tricks are already in captured,
                # including the visible one.
                in_play = (
                    [card for _, card in board.trick]
                    if len(board.trick) < 4 else []
                )
                cards = (
                    sum(board.hands, [])
                    + sum(board.captured, [])
                    + in_play
                )
                self.assertEqual(len(cards), 32)
                self.assertEqual(len(set(cards)), 32)
            self.assertEqual(board.trick_number, 8)
            self.assertEqual(
                board.scores, console.play_deal(verbose=False)
            )
            # Keep the final trick on display.
            self.assertEqual(len(board.trick), 4)

    def test_board_rejects_invalid_actions_without_mutation(self):
        board = BoardDeal(0, random.Random(1))
        original = [list(hand) for hand in board.hands]
        with self.assertRaises(ValueError):
            board.play(board.hands[1][0])
        with self.assertRaises(ValueError):
            board.choose_trump("Invalid")
        board.choose_trump("Hearts")
        with self.assertRaises(ValueError):
            board.choose_trump("Clubs")
        with self.assertRaises(ValueError):
            board.next_trick()
        other_players_card = board.hands[0][0]
        with self.assertRaises(ValueError):
            board.play(other_players_card)
        self.assertEqual(board.hands, original)


if __name__ == "__main__":
    unittest.main()
