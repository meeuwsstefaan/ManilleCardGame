"""Board interaction smoke tests; skipped when Tk/a display is unavailable."""

import unittest
import time
from types import SimpleNamespace
from unittest.mock import patch

from manille import Card, ManilleBoard, NULL_TRUMP, match_points, winning_play


class BoardUITests(unittest.TestCase):
    def setUp(self):
        try:
            import tkinter as tk
            self.root = tk.Tk()
        except (ImportError, RuntimeError) as error:
            self.skipTest(str(error))
        except Exception as error:
            # TclError indicates an unavailable graphical display.
            if type(error).__name__ == "TclError":
                self.skipTest(str(error))
            raise
        self.addCleanup(self.root.destroy)

    def wait_for_collection(self, board):
        deadline = time.monotonic() + 2
        while board.animation_progress is not None:
            self.assertLess(time.monotonic(), deadline, "Animation stalled")
            self.root.update()
            time.sleep(0.001)

    def wait_for_shuffle(self, board):
        deadline = time.monotonic() + 2
        while board.shuffle_progress is not None:
            self.assertLess(time.monotonic(), deadline, "Shuffle stalled")
            self.root.update()
            time.sleep(0.001)

    def create_board(self, *args, stop_shuffle=True, **kwargs):
        board = ManilleBoard(*args, **kwargs)
        def cancel_timers():
            if board.root.winfo_exists():
                for attribute in ("pending", "animation_pending", "shuffle_pending"):
                    timer = getattr(board, attribute)
                    if timer is not None:
                        board.root.after_cancel(timer)
                        setattr(board, attribute, None)
        self.addCleanup(cancel_timers)
        if stop_shuffle:
            board.stop_shuffle()
        return board

    def step_and_wait(self, board):
        if board.shuffling:
            board.stop_shuffle()
        if board.join_pending:
            board.join_var.set(False)
            board.confirm_join()
        board.step()
        self.wait_for_collection(board)

    def test_human_join_checkbox_blocks_play_and_resumes_autoplay(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.deal.dealer = 1
        board.deal.leader = 0
        self.root.update()
        board.toggle_run()
        self.root.after_cancel(board.pending)
        with patch("manille.choose_computer_trump", return_value="Hearts"):
            board.tick()
        self.root.update_idletasks()
        self.assertTrue(board.join_pending)
        self.assertTrue(board.join_frame.winfo_ismapped())
        self.assertTrue(board.waiting_for_human())
        self.assertIsNone(board.pending)
        self.assertEqual(str(board.step_button["state"]), "disabled")
        self.assertFalse(board.hits)
        original = list(board.deal.hands[0])
        board.step()
        board.play_card(original[0], "Blocked during joining.")
        board.click_card(SimpleNamespace(x=140, y=660))
        self.assertEqual(board.deal.hands[0], original)
        self.assertFalse(board.deal.trick)
        board.join_checkbox.invoke()
        board.join_button.invoke()
        self.root.update_idletasks()
        self.assertEqual(board.deal.joined_by, 0)
        self.assertFalse(board.join_pending)
        self.assertFalse(board.join_frame.winfo_ismapped())
        self.assertIn(f"Joined by {board.names[0]}", board.summary.get())
        self.assertTrue(board.hits)
        self.assertTrue(board.running)
        board.confirm_join()  # Confirmation cannot double again.
        board.deal.scores = [40, 20]
        self.assertEqual(board.running_totals(), [20, 0])
        board.deal.scores = [30, 30]
        self.assertEqual(board.running_totals(), [0, 0])
        # Human card flight still works after the declaration.
        board.PLAY_SECONDS = 0.01
        x1, y1, x2, y2, card = board.hits[0]
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.wait_for_collection(board)
        self.assertEqual(board.deal.trick, [(0, card)])
        self.assertIsNotNone(board.pending)

    def test_human_can_pass_and_computer_teammate_can_join(self):
        for computer_joins in (False, True):
            board = self.create_board(self.root, human=True, seed=42)
            board.deal.dealer = 3
            board.deal.choose_trump("Hearts")
            board.offer_join()
            board.render()
            with patch("manille.choose_computer_join", return_value=computer_joins) as joiner:
                board.join_button.invoke()  # Unchecked means pass.
            self.assertEqual(board.deal.joined_by, 2 if computer_joins else None)
            self.assertFalse(board.join_pending)
            joiner.assert_called_once_with(board.deal.hands[2], "Hearts")

    def test_join_controls_are_hidden_for_declarers_teammates_and_null(self):
        for dealer, trump in ((0, "Hearts"), (2, "Hearts"), (1, NULL_TRUMP)):
            board = self.create_board(self.root, human=True, seed=42)
            board.deal.dealer = dealer
            with (
                patch("manille.choose_computer_trump", return_value=trump),
                patch("manille.choose_computer_join", return_value=False),
            ):
                if dealer == 0:
                    board.trump_var.set(trump)
                    board.set_human_trump()
                else:
                    board.step()
            self.assertFalse(board.join_pending)
            self.assertFalse(board.join_frame.winfo_ismapped())
            self.assertIsNone(board.deal.joined_by)

    def test_joined_deal_scores_once_collects_final_trick_and_resets(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.01
        self.root.update()
        with (
            patch("manille.choose_computer_trump", return_value="Hearts"),
            patch("manille.choose_computer_join", return_value=True) as joiner,
        ):
            board.step()
        self.assertEqual(board.deal.joined_by, 1)
        joiner.assert_called_once_with(board.deal.hands[1], "Hearts")
        for _ in range(50):
            if board.deal.finished:
                break
            self.step_and_wait(board)
        self.assertTrue(board.deal.finished)
        expected = [2 * max(p - 30, 0) for p in board.deal.scores]
        self.assertEqual(board.total, expected)
        self.assertEqual(board.running_totals(), expected)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))
        board.step()
        self.assertEqual(board.total, expected)
        names = board.names
        board.next_deal()
        self.assertFalse(board.join_pending)
        self.assertFalse(board.join_var.get())
        board.stop_shuffle()
        self.assertIsNone(board.deal.joined_by)
        self.assertEqual(board.names, names)
        self.assertEqual(board.running_totals(), expected)

    def test_joined_trick_reaches_101_and_animates_to_winner(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.01
        self.root.update()
        board.deal.choose_trump("Hearts")
        board.deal.join_trump(1)
        board.total = [99, 0]
        board.deal.scores = [30, 0]
        board.deal.leader = 0
        board.deal.trick = [(0, Card("Hearts", "Jack")), (1, Card("Clubs", "7")), (2, Card("Clubs", "8"))]
        last = Card("Clubs", "9")
        board.deal.hands[3] = [last]
        board.play_card(last, "Finish joined test trick.")
        self.assertEqual(board.running_totals(), [101, 0])
        self.assertEqual(board.match_winner, 0)
        self.wait_for_collection(board)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))
        board.play_card(last, "Must not score twice.")
        self.assertEqual(board.running_totals(), [101, 0])

    def test_each_deck_click_shuffles_once_then_deals_exact_frozen_deck(self):
        board = self.create_board(self.root, human=True, seed=42, stop_shuffle=False)
        board.SHUFFLE_SECONDS = 0.08
        self.root.update()
        self.assertTrue(board.shuffling)
        self.assertIsNone(board.deal)  # Only the Deal cards button deals.
        self.assertEqual(len(board.canvas.find_withtag("shuffle-card")), 32)
        self.assertFalse(board.hits)
        for button in (board.trump_button, board.step_button, board.run_button, board.next_button):
            self.assertEqual(str(button["state"]), "disabled")
        board.step()
        board.toggle_run()
        board.set_human_trump()
        board.play_card(Card("Clubs", "7"), "Cannot play while shuffling.")
        self.assertIsNone(board.deal)
        self.assertFalse(board.running)
        board.click_card(SimpleNamespace(x=5, y=5))
        self.assertTrue(board.shuffling)
        first_order = list(board.shuffle_deck)
        self.root.after(board.SHUFFLE_INTERVAL_MS * 2 + 20, self.root.quit)
        self.root.mainloop()
        self.assertEqual(board.shuffle_count, 0)
        self.assertEqual(board.shuffle_deck, first_order)
        self.assertIsNone(board.shuffle_pending)
        with patch.object(board.rng, "shuffle", wraps=board.rng.shuffle) as shuffle:
            for count in (1, 2):
                rectangle = board.canvas.find_withtag("shuffle-card")[-1]
                x1, y1, x2, y2 = board.canvas.coords(rectangle)
                board.canvas.event_generate("<Button-1>", x=int((x1 + x2) / 2), y=int((y1 + y2) / 2))
                self.assertIsNotNone(board.shuffle_progress)
                self.assertEqual(str(board.deal_button["state"]), "disabled")
                board.stop_shuffle()  # Cannot interrupt and deal mid-animation.
                board.click_card(SimpleNamespace(x=440, y=360))  # Busy clicks are ignored.
                self.assertIsNone(board.deal)
                self.root.after(25, self.root.quit)
                self.root.mainloop()
                moved = board.canvas.coords(board.canvas.find_withtag("shuffle-card")[-1])
                self.assertNotEqual(moved, [x1, y1, x2, y2])
                self.wait_for_shuffle(board)
                self.assertEqual(board.shuffle_count, count)
                self.assertEqual(shuffle.call_count, count)
                self.assertIsNone(board.shuffle_pending)
                self.assertTrue(board.shuffling)
                self.assertEqual(str(board.deal_button["state"]), "normal")
        self.assertNotEqual(board.shuffle_deck, first_order)
        frozen = list(board.shuffle_deck)
        self.assertEqual(len(set(frozen)), 32)
        self.assertEqual(sum(card.points for card in frozen), 60)
        with patch.object(board.rng, "shuffle", side_effect=AssertionError("Reshuffled after click")):
            board.deal_button.invoke()
            self.assertFalse(board.shuffling)
            self.assertIsNone(board.shuffle_pending)
            board.stop_shuffle()  # Repeated requests cannot deal twice.
            self.root.after(board.SHUFFLE_INTERVAL_MS * 2, self.root.quit)
            self.root.mainloop()
        for player in range(4):
            packet_position = (player - 1) % 4
            start_three = packet_position * 3
            start_two = 12 + packet_position * 2
            final_three = 20 + packet_position * 3
            expected = set(
                frozen[start_three:start_three + 3]
                + frozen[start_two:start_two + 2]
                + frozen[final_three:final_three + 3]
            )
            self.assertEqual(set(board.deal.hands[player]), expected)
        self.assertEqual(board.shuffle_deck, frozen)
        self.assertFalse(board.canvas.find_withtag("shuffle-card"))
        self.assertEqual(str(board.trump_button["state"]), "normal")
        self.assertEqual(str(board.deal_button["state"]), "disabled")

    def test_next_deal_waits_for_shuffle_click_and_preserves_names_and_totals(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.001
        board.names = ("Merlin", "Lyra", "Orion", "Nova")
        self.root.update()
        for _ in range(50):
            if board.deal.finished:
                break
            self.step_and_wait(board)
        self.assertTrue(board.deal.finished)
        totals = board.running_totals()
        names = board.names
        board.next_button.invoke()
        self.assertTrue(board.shuffling)
        self.assertEqual(board.deal_number, 2)
        self.assertIsNone(board.deal)
        self.assertEqual(board.shuffle_dealer, 1)
        self.assertEqual(board.running_totals(), totals)
        self.assertEqual(board.names, names)
        board.next_deal()
        board.step()
        self.assertEqual(board.deal_number, 2)
        self.assertIsNone(board.deal)
        self.root.update()
        x1, y1, x2, y2 = board.canvas.coords(board.canvas.find_withtag("shuffle-card")[0])
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.wait_for_shuffle(board)
        self.assertTrue(board.shuffling)
        board.deal_button.invoke()
        self.assertFalse(board.shuffling)
        self.assertEqual(board.running_totals(), totals)
        self.assertEqual(board.names, names)
        self.assertTrue(all(len(hand) == 8 for hand in board.deal.hands))
        board.step()
        self.assertIsNotNone(board.deal.trump)

    def test_closing_during_shuffle_cancels_the_timer(self):
        import tkinter as tk
        window = tk.Toplevel(self.root)
        board = self.create_board(window, stop_shuffle=False)
        board.shuffle_once()
        timer = board.shuffle_pending
        self.assertIsNotNone(timer)
        board.close()
        self.assertIsNone(board.shuffle_pending)
        self.assertNotIn(timer, self.root.tk.call("after", "info"))
        self.root.update()

    def test_step_through_complete_deal_and_rotate(self):
        board = self.create_board(
            self.root, human=False, seed=42, deal_limit=2
        )
        board.CAPTURE_SECONDS = 0.01
        self.root.update()
        self.assertEqual(len(board.deal.hands[0]), 8)
        board.step()  # Dealer selects trump.
        self.assertIsNotNone(board.deal.trump)
        for _ in range(50):
            if board.deal.finished:
                break
            self.step_and_wait(board)
            self.root.update_idletasks()
        self.assertTrue(board.deal.finished)
        self.assertEqual(sum(board.deal.scores), 60)
        multiplier = 2 if board.deal.trump == NULL_TRUMP or board.deal.joined_by is not None else 1
        first_total = [multiplier * max(points - 30, 0) for points in board.deal.scores]
        self.assertEqual(board.total, first_total)
        self.assertEqual(len(board.deal.trick), 4)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))

        board.step()  # Completed deal cannot be scored twice.
        self.assertEqual(board.total, first_total)

        board.next_button.invoke()
        board.next_deal()  # An unfinished deal cannot be skipped.
        self.wait_for_collection(board)
        board.stop_shuffle()
        self.assertEqual(board.deal.dealer, 1)
        self.assertEqual(board.deal_number, 2)
        while not board.deal.finished:
            self.step_and_wait(board)
        multiplier = 2 if board.deal.trump == NULL_TRUMP else 1
        self.assertEqual(board.total, [
            old + multiplier * max(raw - 30, 0)
            for old, raw in zip(first_total, board.deal.scores)
        ])
        self.assertEqual(
            str(board.next_button["state"]), "disabled"
        )
        board.next_deal()
        self.assertEqual(board.deal_number, 2)

    def test_human_clicks_and_pause_timer(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.CAPTURE_SECONDS = 0.01
        board.PLAY_SECONDS = 0.01
        self.root.update()
        board.step()
        self.assertIsNone(board.deal.trump)

        board.trump_var.set("Hearts")
        board.trump_button.invoke()
        self.assertEqual(board.deal.trump, "Hearts")

        board.toggle_run()
        self.assertIsNotNone(board.pending)
        board.toggle_run()
        self.assertIsNone(board.pending)
        self.assertFalse(board.running)

        for _ in range(50):
            if board.deal.finished:
                break
            if board.waiting_for_human():
                self.assertTrue(board.hits)
                x1, y1, x2, y2, card = board.hits[0]
                board.click_card(
                    SimpleNamespace(
                        x=(x1 + x2) / 2,
                        y=(y1 + y2) / 2,
                    )
                )
                self.assertNotIn(card, board.deal.hands[0])
                self.wait_for_collection(board)
            else:
                self.step_and_wait(board)
        self.assertTrue(board.deal.finished)
        self.assertEqual(sum(board.deal.scores), 60)
        self.assertEqual(board.total, [match_points(raw, board.deal.trump, board.deal.joined_by is not None) for raw in board.deal.scores])

    def test_clicked_card_flies_from_hand_to_trick(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.PLAY_SECONDS = 0.15
        self.root.update()
        board.trump_button.invoke()
        while not board.waiting_for_human():
            board.step()
        # The human is fourth in the opening trick: arrival must complete it.
        self.assertEqual(len(board.deal.trick), 3)
        x1, y1, x2, y2, card = board.hits[-1]
        click = SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2)
        others = {
            player: board.canvas.coords(
                board.canvas.find_withtag(f"table-card-{player}")[0]
            )
            for player, _ in board.deal.trick
        }
        board.toggle_run()
        board.click_card(click)
        self.assertNotIn(card, board.deal.hands[0])
        self.assertEqual(board.deal.trick[-1], (0, card))
        self.assertEqual(board.canvas.coords(
            board.canvas.find_withtag("table-card-0")[0]
        )[:2], [x1, y1])
        self.assertFalse(board.hits)
        self.assertIsNone(board.pending)
        scores = list(board.deal.scores)
        board.click_card(click)
        board.step()
        board.next_deal()
        self.assertEqual(len(board.deal.trick), 4)
        self.assertEqual(board.deal.scores, scores)

        self.root.after(45, self.root.quit)
        self.root.mainloop()
        self.assertIsNotNone(board.animation_progress)
        board.render()
        sx = board.canvas.winfo_width() / 880
        sy = board.canvas.winfo_height() / 730
        tx, ty = board.TRICK_POSITIONS[0]
        x, y = board.canvas.coords(
            board.canvas.find_withtag("table-card-0")[0]
        )[:2]
        self.assertGreater(x, min(x1, tx * sx))
        self.assertLess(x, max(x1, tx * sx))
        self.assertGreater(y, ty * sy)
        self.assertLess(y, y1)
        for player, coords in others.items():
            self.assertEqual(board.canvas.coords(
                board.canvas.find_withtag(f"table-card-{player}")[0]
            ), coords)

        board.toggle_run()  # Pausing leaves the arriving card on the table.
        self.wait_for_collection(board)
        self.assertIsNone(board.playing_card)
        self.assertIsNone(board.pending)
        self.assertEqual(board.canvas.coords(
            board.canvas.find_withtag("table-card-0")[0]
        )[:2], [tx * sx, ty * sy])
        self.assertEqual(board.deal.scores, scores)
        board.CAPTURE_SECONDS = 0.01
        self.step_and_wait(board)
        self.assertEqual(board.deal.trick, [])

    def test_cards_move_toward_each_winner_before_clearing(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.12
        self.root.update()
        board.deal.choose_trump("Hearts")
        for winner in range(4):
            with self.subTest(winner=winner):
                board.deal.trick = [
                    (player, Card(
                        "Hearts" if player == winner else "Clubs", "10"
                    ))
                    for player in range(4)
                ]
                board.render()
                before = [
                    board.canvas.coords(
                        board.canvas.find_withtag(f"table-card-{player}")[0]
                    )[:2]
                    for player in range(4)
                ]
                trick_number = board.deal.trick_number
                board.step()
                board.step()  # Cannot advance twice while cards are moving.
                self.assertEqual(len(board.deal.trick), 4)
                self.assertEqual(str(board.step_button["state"]), "disabled")
                self.root.after(40, self.root.quit)
                self.root.mainloop()
                self.assertIsNotNone(board.animation_progress)
                # A redraw (including resizing) must preserve the motion.
                board.render()
                sx = board.canvas.winfo_width() / 880
                sy = board.canvas.winfo_height() / 730
                tx, ty = board.CAPTURE_POSITIONS[winner]
                for player in range(4):
                    items = board.canvas.find_withtag(f"table-card-{player}")
                    self.assertEqual(len(items), 3)  # Face and both labels.
                    x, y = board.canvas.coords(items[0])[:2]
                    target = ((tx + player * 5) * sx, (ty + player * 3) * sy)
                    old_distance = sum((a - b) ** 2 for a, b in zip(before[player], target))
                    new_distance = (x - target[0]) ** 2 + (y - target[1]) ** 2
                    self.assertLess(new_distance, old_distance)
                self.wait_for_collection(board)
                self.assertEqual(board.deal.trick, [])
                self.assertEqual(board.deal.leader, winner)
                self.assertEqual(board.deal.trick_number, trick_number + 1)
                self.assertFalse(board.canvas.find_withtag("table-card"))

    def test_partner_trump_requires_higher_trump_instead_of_high_value_discard(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.PLAY_SECONDS = 0.01
        self.root.update()
        board.deal.choose_trump("Hearts")
        board.deal.leader = 1
        board.deal.trick = [
            (1, Card("Clubs", "7")), (2, Card("Hearts", "King")),
            (3, Card("Clubs", "8")),
        ]
        discard = Card("Diamonds", "10")
        board.deal.hands[0] = [
            Card("Hearts", "8"), Card("Hearts", "Ace"), discard,
        ]
        board.render()
        self.assertEqual(
            [hit[-1] for hit in board.hits], [board.deal.hands[0][1]]
        )
        x1, y1, x2, y2, _ = board.hits[-1]
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.wait_for_collection(board)
        self.assertEqual(board.deal.trick[-1], (0, Card("Hearts", "Ace")))
        self.assertEqual(board.deal.scores, [7, 0])
        self.assertIn(discard, board.deal.hands[0])
        self.assertIn(
            "Must play a winning trump.",
            board.log.get("1.0", "end"),
        )

    def test_running_total_and_101_match_end_for_both_teams(self):
        for team in range(2):
            for previous, rank, earned in ((99, "Jack", 1), (100, "Jack", 1), (100, "Ace", 4)):
                with self.subTest(team=team, previous=previous, rank=rank):
                    board = self.create_board(self.root, human=False, seed=42)
                    self.root.update()
                    board.total[team] = previous
                    board.total[1 - team] = 30
                    board.deal.scores[team] = 30
                    board.deal.choose_trump("Hearts")
                    board.deal.leader = 0
                    trump_player = 2 if team == 0 else 1
                    board.deal.trick = [
                        (player, Card(
                            "Hearts" if player == trump_player else "Clubs",
                            rank if player == trump_player else str(7 + player),
                        ))
                        for player in range(3)
                    ]
                    last_card = Card("Clubs", "9")
                    board.deal.hands[3] = [last_card]
                    board.render()
                    self.assertEqual(board.running_totals()[team], previous)
                    board.toggle_run()
                    board.play_card(last_card, "Finish test trick.")
                    expected = previous + earned
                    self.assertEqual(board.running_totals()[team], expected)
                    self.assertIn(f"Team {team + 1}: {expected}", board.match_score.get())
                    if expected < 101:
                        self.assertIsNone(board.match_winner)
                        self.assertTrue(board.running)
                        board.stop()
                        continue
                    self.assertEqual(board.match_winner, team)
                    self.assertFalse(board.running)
                    self.assertIsNone(board.pending)
                    self.wait_for_collection(board)
                    self.assertTrue(board.trick_collected)
                    self.assertFalse(board.canvas.find_withtag("table-card"))
                    self.assertIn(f"Team {team + 1} wins", board.status.get())
                    for button in (board.step_button, board.run_button, board.next_button):
                        self.assertEqual(str(button["state"]), "disabled")
                    final_deal = board.deal
                    board.step()
                    board.next_deal()
                    board.start_next_deal()
                    board.toggle_run()
                    board.play_card(last_card, "Must not score again.")
                    self.assertIs(board.deal, final_deal)
                    self.assertEqual(board.running_totals()[team], expected)
                    self.assertIsNone(board.pending)

    def test_running_totals_ignore_30_or_less_and_keep_previous_deals(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.total = [12, 7]
        for raw, expected in (
            ([29, 20], [12, 7]), ([30, 30], [12, 7]),
            ([40, 20], [22, 7]), ([20, 40], [12, 17]),
            ([60, 0], [42, 7]),
        ):
            with self.subTest(raw=raw):
                board.deal.scores = raw
                board.render()
                self.assertEqual(board.running_totals(), expected)
                for team, points in enumerate(expected, start=1):
                    self.assertIn(f"Team {team}: {points}", board.match_score.get())
        # Completed deal totals have already been credited: never add twice.
        board.deal.scores = [40, 20]
        board.deal.finished = True
        board.total = [22, 7]
        self.assertEqual(board.running_totals(), [22, 7])
        board.start_next_deal()
        self.assertEqual(board.running_totals(), [22, 7])

    def test_complete_match_preserves_running_scores_between_deals(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.01
        self.root.update()
        actions = 0
        while board.match_winner is None:
            self.assertLess(actions, 2000, "Match failed to end")
            before = board.running_totals()
            if not board.shuffling and board.deal.finished:
                board.next_deal()
                self.wait_for_collection(board)
                self.assertEqual(board.running_totals(), before)
            else:
                self.step_and_wait(board)
            after = board.running_totals()
            self.assertTrue(all(a >= b for a, b in zip(after, before)))
            actions += 1
        self.assertGreater(board.deal_number, 1)
        self.assertGreaterEqual(board.running_totals()[board.match_winner], 101)
        self.assertEqual(len(board.deal.trick), 4)

    def test_autoplay_pause_and_close_during_collection(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.CAPTURE_SECONDS = 0.03
        self.root.update()
        while len(board.deal.trick) != 4:
            board.step()
        board.toggle_run()
        board.step()
        self.assertIsNone(board.pending)
        board.toggle_run()  # Pause finishes collection without playing onward.
        self.wait_for_collection(board)
        self.assertEqual(board.deal.trick, [])
        self.assertIsNone(board.pending)
        self.assertFalse(board.running)

        while len(board.deal.trick) != 4:
            board.step()
        board.toggle_run()
        board.step()
        self.wait_for_collection(board)
        self.assertIsNotNone(board.pending)
        board.stop()

        import tkinter as tk
        window = tk.Toplevel(self.root)
        closing = self.create_board(window, human=False, seed=42)
        while len(closing.deal.trick) != 4:
            closing.step()
        closing.step()
        self.assertIsNotNone(closing.animation_pending)
        closing.close()
        self.assertIsNone(closing.animation_pending)
        self.root.update()

    def test_last_deal_trick_collects_without_step_or_next_deal(self):
        board = self.create_board(self.root, human=False, seed=42, deal_limit=1)
        board.CAPTURE_SECONDS = 0.01
        self.root.update()
        for _ in range(50):
            if board.deal.trick_number == 8 and len(board.deal.trick) == 3:
                break
            self.step_and_wait(board)
        self.assertEqual(board.deal.trick_number, 8)
        self.assertEqual(len(board.deal.trick), 3)
        board.CAPTURE_SECONDS = 0.15
        board.step()  # The fourth card starts collection automatically.
        self.assertTrue(board.deal.finished)
        self.assertIsNotNone(board.animation_progress)
        self.assertEqual(len(board.canvas.find_withtag("table-card")), 12)
        winner = winning_play(board.deal.trick, board.deal.trump)[0]
        sx = board.canvas.winfo_width() / 880
        sy = board.canvas.winfo_height() / 730
        before = [
            board.canvas.coords(board.canvas.find_withtag(f"table-card-{p}")[0])[:2]
            for p, _ in board.deal.trick
        ]
        board.step()
        board.next_deal()
        self.root.after(45, self.root.quit)
        self.root.mainloop()
        self.assertIsNotNone(board.animation_progress)
        tx, ty = board.CAPTURE_POSITIONS[winner]
        for index, (player, _) in enumerate(board.deal.trick):
            x, y = board.canvas.coords(
                board.canvas.find_withtag(f"table-card-{player}")[0]
            )[:2]
            target = ((tx + index * 5) * sx, (ty + index * 3) * sy)
            old_distance = sum((a - b) ** 2 for a, b in zip(before[index], target))
            self.assertLess((x - target[0]) ** 2 + (y - target[1]) ** 2, old_distance)
        self.wait_for_collection(board)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))
        self.assertEqual(sum(board.deal.scores), 60)
        self.assertEqual(board.total, [max(raw - 30, 0) for raw in board.deal.scores])
        self.assertEqual(board.deal_number, 1)
        self.assertEqual(str(board.next_button["state"]), "disabled")

    def test_human_match_winning_card_arrives_before_final_collection(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.PLAY_SECONDS = 0.03
        board.CAPTURE_SECONDS = 0.15
        self.root.update()
        board.total = [100, 30]
        board.deal.scores[0] = 30
        board.deal.choose_trump("Hearts")
        board.deal.leader = 1
        board.deal.trick = [
            (1, Card("Clubs", "7")), (2, Card("Hearts", "King")),
            (3, Card("Clubs", "8")),
        ]
        discard = Card("Diamonds", "10")
        board.deal.hands[0] = [discard, Card("Spades", "Ace")]
        board.render()
        x1, y1, x2, y2, _ = board.hits[0]
        board.toggle_run()
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.assertEqual(board.match_winner, 0)
        self.assertIsNotNone(board.playing_card)
        self.assertFalse(board.trick_collected)
        self.root.after(65, self.root.quit)
        self.root.mainloop()
        self.assertIsNone(board.playing_card)
        self.assertIsNotNone(board.animation_progress)
        self.assertIn("Collecting trick", board.status.get())
        board.next_deal()
        self.wait_for_collection(board)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))
        self.assertEqual(board.running_totals(), [108, 30])
        self.assertIn("Team 1 wins", board.status.get())
        self.assertFalse(board.running)
        self.assertIsNone(board.pending)
        self.assertEqual(board.deal_number, 1)

    def test_computer_prioritizes_five_point_lead_and_logs_strategy(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.deal.choose_trump("Hearts")
        board.deal.hands[1] = [Card("Clubs", "7"), Card("Hearts", "Ace"),
                               Card("Diamonds", "10")]
        board.step()
        self.assertEqual(board.deal.trick, [(1, Card("Diamonds", "10"))])
        self.assertIn("Play a legal 5-point 10 first", board.log.get("1.0", "end"))
        self.assertNotIn("Lead a low-value card", board.log.get("1.0", "end"))

    def test_null_computer_leads_highest_value_and_logs_strategy(self):
        board = self.create_board(self.root, human=False, seed=42)
        board.deal.choose_trump(NULL_TRUMP)
        board.deal.hands[1] = [Card("Clubs", "7"), Card("Hearts", "Ace"),
                               Card("Diamonds", "10")]
        board.step()
        self.assertEqual(board.deal.trick, [(1, Card("Diamonds", "10"))])
        self.assertIn("Null: play the highest-value legal card, prioritizing 5-point 10s.",
                      board.log.get("1.0", "end"))
        self.assertNotIn("Lead a low-value card", board.log.get("1.0", "end"))

    def test_opponent_winning_computer_plays_cheaply_and_logs_actual_strategy(self):
        for lead, hand, expected, message in (
            (Card("Clubs", "10"),
             [Card("Spades", "10"), Card("Diamonds", "7")],
             Card("Diamonds", "7"), "Cannot win: discard the lowest-value legal card."),
            (Card("Clubs", "Jack"),
             [Card("Clubs", "10"), Card("Clubs", "Queen")],
             Card("Clubs", "Queen"), "Take the trick with the lowest-value winning legal card."),
            (Card("Clubs", "Ace"),
             [Card("Clubs", "10"), Card("Spades", "7")],
             Card("Clubs", "10"), "Take the trick with the lowest-value winning legal card."),
        ):
            with self.subTest(lead=lead, hand=hand):
                board = self.create_board(self.root, human=False, seed=42)
                board.deal.choose_trump("Hearts")
                board.deal.leader = 0
                board.deal.trick = [(0, lead)]
                board.deal.hands[1] = list(hand)
                board.step()
                self.assertEqual(board.deal.trick[-1], (1, expected))
                history = board.log.get("1.0", "end")
                self.assertIn(message, history)
                self.assertNotIn("Play a legal 5-point 10 first", history)

    def test_human_can_select_null_and_complete_animated_deal(self):
        board = self.create_board(self.root, human=True, seed=42, deal_limit=1)
        board.PLAY_SECONDS = board.CAPTURE_SECONDS = 0.01
        self.root.update()
        self.assertIn(NULL_TRUMP, board.trump_box["values"])
        board.trump_var.set(NULL_TRUMP)
        board.trump_button.invoke()
        self.assertEqual(board.deal.trump, NULL_TRUMP)
        self.assertIn("Null doubles", board.summary.get())
        for _ in range(50):
            if board.deal.finished:
                break
            if board.waiting_for_human():
                x1, y1, x2, y2, _ = board.hits[0]
                board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
                self.wait_for_collection(board)
            else:
                self.step_and_wait(board)
        self.assertTrue(board.deal.finished)
        self.assertEqual(sum(board.deal.scores), 60)
        self.assertEqual(board.total, [2 * max(raw - 30, 0) for raw in board.deal.scores])
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.canvas.find_withtag("table-card"))
        self.assertEqual(str(board.next_button["state"]), "disabled")

    def test_null_double_points_end_match_and_collect_winning_trick(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.PLAY_SECONDS = board.CAPTURE_SECONDS = 0.01
        self.root.update()
        board.trump_var.set(NULL_TRUMP)
        board.trump_button.invoke()
        board.total = [95, 10]
        board.deal.scores = [30, 0]
        board.deal.leader = 1
        board.deal.trick = [
            (1, Card("Diamonds", "7")), (2, Card("Diamonds", "Jack")),
            (3, Card("Spades", "10")),
        ]
        board.deal.hands[0] = [Card("Hearts", "Ace"), Card("Clubs", "7")]
        board.render()
        self.assertEqual(board.running_totals(), [95, 10])
        self.assertEqual(len(board.hits), 2)
        x1, y1, x2, y2, _ = board.hits[0]
        board.toggle_run()
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.wait_for_collection(board)
        self.assertEqual(board.deal.scores, [40, 0])
        self.assertEqual(board.running_totals(), [115, 10])
        self.assertEqual(board.match_winner, 0)
        self.assertTrue(board.trick_collected)
        self.assertFalse(board.running)
        self.assertIsNone(board.pending)
        self.assertIn("Null: cannot follow suit; any card is legal.", board.log.get("1.0", "end"))

    def test_lower_trumps_are_gold_only_when_forced_even_with_winning_partner(self):
        import tkinter as tk
        for partner_winning in (False, True):
            for forced in (False, True):
                with self.subTest(partner=partner_winning, forced=forced):
                    window = tk.Toplevel(self.root)
                    try:
                        board = self.create_board(window, human=True, seed=42)
                        board.PLAY_SECONDS = 0.01
                        self.root.update()
                        board.deal.choose_trump("Hearts")
                        board.deal.leader = 1
                        board.deal.trick = [
                            (1, Card("Clubs", "7")),
                            (2, Card("Hearts", "King") if partner_winning else Card("Clubs", "8")),
                            (3, Card("Clubs", "8") if partner_winning else Card("Hearts", "King")),
                        ]
                        lower = Card("Hearts", "Queen")
                        discard = Card("Diamonds", "10")
                        board.deal.hands[0] = [lower, Card("Hearts", "8"), discard]
                        if not forced:
                            board.deal.hands[0].append(Card("Hearts", "Ace"))
                        board.render()
                        expected = board.deal.hands[0][:2] if forced else [Card("Hearts", "Ace")]
                        self.assertEqual([hit[-1] for hit in board.hits], expected)
                        sx = board.canvas.winfo_width() / 880
                        sy = board.canvas.winfo_height() / 730
                        x, y = (104 + 38) * sx, (617 + 47) * sy
                        face = next(
                            item for item in board.canvas.find_overlapping(x, y, x, y)
                            if board.canvas.type(item) == "rectangle"
                        )
                        self.assertEqual(
                            board.canvas.itemcget(face, "outline"),
                            "#ffc857" if forced else "#9bac9f",
                        )
                        board.click_card(SimpleNamespace(x=x, y=y))
                        if forced:
                            self.assertIsNotNone(board.animation_progress)
                            self.wait_for_collection(board)
                            self.assertNotIn(lower, board.deal.hands[0])
                            self.assertEqual(board.deal.trick[-1], (0, lower))
                        else:
                            self.assertIsNone(board.animation_progress)
                            self.assertEqual(len(board.deal.trick), 3)
                            self.assertIn(lower, board.deal.hands[0])
                    finally:
                        window.destroy()

    def test_winning_partner_still_requires_following_suit(self):
        import tkinter as tk
        for trump, partner_card, selection in (
            ("Hearts", Card("Hearts", "King"), 1),
            ("Hearts", Card("Clubs", "Queen"), 1),
            (NULL_TRUMP, Card("Clubs", "Queen"), 1),
        ):
            with self.subTest(trump=trump, partner=partner_card):
                window = tk.Toplevel(self.root)
                board = self.create_board(window, human=True, seed=42)
                board.PLAY_SECONDS = 0.01
                self.root.update()
                board.deal.choose_trump(trump)
                board.deal.leader = 1
                board.deal.trick = [
                    (1, Card("Clubs", "7")), (2, partner_card),
                    (3, Card("Clubs", "8")),
                ]
                hand = [Card("Clubs", "Ace"), Card("Hearts", "7"),
                        Card("Hearts", "Ace"), Card("Diamonds", "10"),
                        Card("Clubs", "7")]
                board.deal.hands[0] = list(hand)
                board.render()
                expected = [hand[0], hand[4]]
                self.assertEqual([hit[-1] for hit in board.hits], expected)
                sx = board.canvas.winfo_width() / 880
                sy = board.canvas.winfo_height() / 730
                for index, held in enumerate(hand):
                    x1, y1 = (104 + index * 84) * sx, 617 * sy
                    x2, y2 = x1 + 76 * sx, y1 + 94 * sy
                    x, y = (x1 + x2) / 2, (y1 + y2) / 2
                    face = next(item for item in board.canvas.find_overlapping(x, y, x, y)
                                if board.canvas.type(item) == "rectangle")
                    self.assertEqual(board.canvas.itemcget(face, "outline"),
                                     "#ffc857" if held in expected else "#9bac9f")
                # Off-suit cards remain blocked even with a winning partner.
                board.click_card(SimpleNamespace(x=(104 + 1 * 84 + 38) * sx,
                                                     y=(617 + 47) * sy))
                self.assertEqual(len(board.deal.trick), 3)
                self.assertEqual(board.deal.hands[0], hand)
                self.assertIsNone(board.animation_progress)
                x1, y1, x2, y2, card = board.hits[selection]
                board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
                self.wait_for_collection(board)
                self.assertEqual(board.deal.trick[-1], (0, card))
                self.assertNotIn(card, board.deal.hands[0])
                message = "Must follow Clubs. Partner is winning: a higher card is optional."
                self.assertIn(message, board.log.get("1.0", "end"))
                window.destroy()

    def test_only_led_suit_is_gold_and_clickable_when_human_can_follow(self):
        board = self.create_board(self.root, human=True, seed=42)
        board.PLAY_SECONDS = board.CAPTURE_SECONDS = 0.01
        self.root.update()
        board.trump_var.set("Hearts")
        board.trump_button.invoke()
        board.deal.leader = 1
        board.deal.trick = [
            (1, Card("Clubs", "7")), (2, Card("Hearts", "8")),
            (3, Card("Hearts", "King")),
        ]
        follow = Card("Clubs", "Ace")
        overtrump = Card("Hearts", "10")
        board.deal.hands[0] = [
            follow, overtrump, Card("Hearts", "9"), Card("Spades", "10"),
        ]
        board.render()
        self.assertEqual([hit[-1] for hit in board.hits], [follow])
        # Clicking the higher trump in hand must do nothing.
        sx = board.canvas.winfo_width() / 880
        sy = board.canvas.winfo_height() / 730
        for index, card in enumerate(board.deal.hands[0]):
            x = (104 + index * 84 + 38) * sx
            y = (617 + 47) * sy
            faces = [
                item for item in board.canvas.find_overlapping(x, y, x, y)
                if board.canvas.type(item) == "rectangle"
            ]
            self.assertEqual(len(faces), 1)
            self.assertEqual(
                board.canvas.itemcget(faces[0], "outline"),
                "#ffc857" if card.suit == "Clubs" else "#9bac9f",
            )
        board.click_card(SimpleNamespace(x=(188 + 38) * sx, y=(617 + 47) * sy))
        self.assertIsNone(board.animation_progress)
        self.assertEqual(len(board.deal.trick), 3)
        self.assertIn(overtrump, board.deal.hands[0])
        x1, y1, x2, y2, _ = board.hits[0]
        board.click_card(SimpleNamespace(x=(x1 + x2) / 2, y=(y1 + y2) / 2))
        self.assertIsNotNone(board.animation_progress)
        self.wait_for_collection(board)
        self.assertEqual(winning_play(board.deal.trick, "Hearts")[0], 3)
        self.assertNotIn(follow, board.deal.hands[0])
        self.assertIn(overtrump, board.deal.hands[0])
        self.assertEqual(board.deal.scores, [0, 7])
        self.assertIn("Must follow Clubs with a higher card.", board.log.get("1.0", "end"))
        self.step_and_wait(board)
        self.assertEqual(board.deal.leader, 3)
        self.assertFalse(board.canvas.find_withtag("table-card"))


if __name__ == "__main__":
    unittest.main()
