"""Manille with a visual inspection board and an optional console mode.

Run in PyCharm or with: python manille.py
Watch a computer game: python manille.py --auto --seed 42
Console mode: python manille.py --console --auto --deals 3 --seed 42
On the board, click the deck to shuffle once; choose Deal cards when ready.
Uses only Python's standard library (Python 3.10 or newer).
Deal points are raw captured card points; only the excess above 30 counts
toward match totals, doubled for Null (no trump) or joined trump.
An opponent may join suit trump before play begins. The board ends at 101.
"""

from __future__ import annotations

import argparse
import math
import random
import time
from dataclasses import dataclass


SUITS = ("Clubs", "Diamonds", "Hearts", "Spades")
NULL_TRUMP = "Null"
TRUMP_CHOICES = SUITS + (NULL_TRUMP,)
RANKS = ("7", "8", "9", "Jack", "Queen", "King", "Ace", "10")
POINTS = {
    "7": 0, "8": 0, "9": 0, "Jack": 1, "Queen": 2,
    "King": 3, "Ace": 4, "10": 5,
}
PLAYER_NAMES = (
    "You", "Computer 1", "Computer 2 (your teammate)", "Computer 3"
)


@dataclass(frozen=True)
class Card:
    suit: str
    rank: str

    @property
    def strength(self) -> int:
        return RANKS.index(self.rank)

    @property
    def points(self) -> int:
        return POINTS[self.rank]

    def __str__(self) -> str:
        return f"{self.rank} of {self.suit} ({self.points} points)"


Trick = list[tuple[int, Card]]


@dataclass(frozen=True)
class TrickRecord:
    plays: tuple[tuple[int, Card], ...]
    trump: str
    deal_number: int
    trick_number: int


def make_deck() -> list[Card]:
    return [Card(suit, rank) for suit in SUITS for rank in RANKS]


def hindu_shuffle(deck: list[Card], rng: random.Random) -> None:
    """Pull top packets into a receiving hand, then drop the remainder on top.

    Card 0 is the top of the deck. Each packet retains its internal order;
    successive packets land on top of the cards already received.
    """
    if len(deck) < 2:
        return
    remainder = min(rng.randint(3, 6), len(deck) - 1)
    received: list[Card] = []
    cursor = 0
    while len(deck) - cursor > remainder:
        size = rng.randint(1, min(5, len(deck) - cursor - remainder))
        received = deck[cursor:cursor + size] + received
        cursor += size
    deck[:] = deck[cursor:] + received


def deal_hands(deck: list[Card], dealer: int) -> list[list[Card]]:
    """Deal consecutive 3-2-3 packets clockwise, starting left of dealer."""
    if len(deck) != 32 or set(deck) != set(make_deck()):
        raise ValueError("A deal requires all 32 unique Manille cards.")
    hands: list[list[Card]] = [[], [], [], []]
    cursor = 0
    for packet_size in (3, 2, 3):
        for offset in range(1, 5):
            player = (dealer + offset) % 4
            hands[player].extend(deck[cursor:cursor + packet_size])
            cursor += packet_size
    return hands


def team_of(player: int) -> int:
    """Players 0/2 are Team 1; players 1/3 are Team 2."""
    return player % 2


def zero_point_players(hands: list[list[Card]]) -> tuple[int, ...]:
    """Inspect initial hands; do not apply this check as cards are played."""
    return tuple(player for player, hand in enumerate(hands)
                 if sum(card.points for card in hand) == 0)


def match_points(deal_points: int, trump: str | None = None, joined: bool = False) -> int:
    """Count the excess above 30, doubled for Null or joined trump."""
    multiplier = 2 if trump == NULL_TRUMP or joined else 1
    return max(deal_points - 30, 0) * multiplier


def winning_play(trick: Trick, trump: str) -> tuple[int, Card]:
    if not trick:
        raise ValueError("An empty trick has no winner.")
    led_suit = trick[0][1].suit
    return max(trick, key=lambda play: (
        2 if play[1].suit == trump else 1 if play[1].suit == led_suit else 0,
        play[1].strength,
    ))


def partner_is_winning(player: int, trick: Trick, trump: str) -> bool:
    if not trick:
        return False
    winner, _ = winning_play(trick, trump)
    return winner == (player + 2) % 4


def legal_cards(hand: list[Card], trick: Trick, trump: str) -> list[Card]:
    """Follow suit; beat its highest card if possible when an opponent wins.

    If a non-trump lead has been trumped, any card of the led suit is legal.

    When void, play trump if available, unless your partner is winning.
    Overtrump when possible; otherwise any held trump is a forced choice.
    A lower trump is allowed only when no other legal choice remains,
    including when following trump suit.
    """
    if not trick:
        return list(hand)
    # Turns proceed clockwise, so the next player follows the last play.
    player = (trick[-1][0] + 1) % 4
    following = [card for card in hand if card.suit == trick[0][1].suit]
    trumps_played = [card for _, card in trick if card.suit == trump]
    best_trump = max((card.strength for card in trumps_played), default=-1)
    winning_trumps = [
        card for card in hand
        if card.suit == trump and card.strength > best_trump
    ]
    if following:
        best_following = max(card.strength for _, card in trick
                             if card.suit == trick[0][1].suit)
        higher = [card for card in following if card.strength > best_following]
        choices = (
            following if partner_is_winning(player, trick, trump)
            or (trumps_played and trick[0][1].suit != trump)
            else higher or following
        )
    else:
        trumps = [card for card in hand if card.suit == trump]
        choices = (
            list(hand) if partner_is_winning(player, trick, trump)
            else winning_trumps or trumps or list(hand)
        )
    if trumps_played:
        without_lower_trumps = [
            card for card in choices
            if card.suit != trump or card.strength > best_trump
        ]
        return without_lower_trumps or choices
    return choices


def choose_computer_card(
    player: int, hand: list[Card], trick: Trick, trump: str,
    trump_chooser: int | None = None,
) -> Card:
    """A simple team-aware heuristic, without seeing other players' hands.

    Prioritize legal 5-point cards on leads or with a winning partner.
    Against a winning opponent, win cheaply or discard the cheapest legal card.
    In Null, always play the highest-value legal card, then highest rank.
    The trump chooser prefers legal trump cards, applying the value strategy
    within that suit. This recommendation never changes card legality.
    Feed points to a winning partner when legal. A later opponent may still
    win, so this is a basic strategy rather than an optimal playing engine.
    """
    choices = legal_cards(hand, trick, trump)
    if trump == NULL_TRUMP:
        return max(choices, key=lambda card: (card.points, card.strength))
    if player == trump_chooser:
        legal_trumps = [card for card in choices if card.suit == trump]
        choices = legal_trumps or choices
    cheap = lambda card: (card.points, card.suit == trump, card.strength)
    partner_winning = partner_is_winning(player, trick, trump)
    fives = [card for card in choices if card.points == 5]
    if fives and (not trick or partner_winning):
        return min(fives, key=lambda card: card.suit == trump)
    if not trick:
        return min(choices, key=cheap)
    current_winner, _ = winning_play(trick, trump)
    if team_of(current_winner) == team_of(player):
        return max(choices, key=lambda card: (
            card.points, card.suit != trump, card.strength
        ))
    winners = [
        card for card in choices
        if winning_play(trick + [(player, card)], trump)[0] == player
    ]
    if winners:
        return min(winners, key=cheap)
    return min(choices, key=cheap)


def choose_computer_trump(hand: list[Card]) -> str:
    # A conservative no-trump choice with high cards spread across suits.
    high_cards = [card for card in hand if card.rank in ("Ace", "10")]
    if (
        len(high_cards) >= 4
        and len({card.suit for card in high_cards}) >= 3
        and sum(card.points for card in hand) >= 24
    ):
        return NULL_TRUMP
    return max(SUITS, key=lambda suit: (
        sum(card.points for card in hand if card.suit == suit),
        sum(card.suit == suit for card in hand),
        sum(card.strength for card in hand if card.suit == suit),
    ))


def choose_computer_join(hand: list[Card], trump: str) -> bool:
    """Join only with a long, strong trump holding in the computer's own hand."""
    trumps = [card for card in hand if card.suit == trump]
    return (
        trump in SUITS and len(trumps) >= 5
        and sum(card.points for card in trumps) >= 10
        and any(card.rank == "10" for card in trumps)
    )


def read_choice(prompt: str, count: int) -> int:
    while True:
        try:
            choice = int(input(prompt))
            if 1 <= choice <= count:
                return choice - 1
        except ValueError:
            pass
        print(f"Enter a number from 1 to {count}.")


def show_hand(hand: list[Card]) -> None:
    print("\nYour hand:")
    for index, card in enumerate(hand, start=1):
        print(f"  {index:2}. {card}")


def choose_human_card(hand: list[Card], trick: Trick, trump: str) -> Card:
    show_hand(hand)
    choices = legal_cards(hand, trick, trump)
    print("Legal card numbers:", ", ".join(
        str(index + 1) for index, card in enumerate(hand) if card in choices
    ))
    while True:
        card = hand[read_choice("Play card number: ", len(hand))]
        if card in choices:
            return card
        print("That card is not legal. Choose one of the listed legal cards.")


class ManilleGame:
    def __init__(self, human: bool = True, seed: int | None = None) -> None:
        self.human = human
        self.random = random.Random(seed)
        self.dealer = 0
        self.scores = [0, 0]
        self.joined_by: int | None = None
        self.deals_played = 0
        self.deck = make_deck()
        self.game_deck: list[Card] = []
        self.names = (
            PLAYER_NAMES if human
            else tuple(f"Computer {i}" for i in range(4))
        )

    def play_deal(self, verbose: bool = True) -> list[int]:
        deck = list(self.deck)
        while True:
            self.random.shuffle(deck)
            hands = deal_hands(deck, self.dealer)
            empty_points = zero_point_players(hands)
            if not empty_points:
                break
            message = (
                f"Zero-point hand: {', '.join(self.names[p] for p in empty_points)}. "
                "Redeal with the same dealer; scores are unchanged."
            )
            if self.human or verbose:
                print(message)
            if self.human:
                input("Press Enter to reshuffle and deal again: ")
        self.game_deck = []
        for hand in hands:
            hand.sort(key=lambda card: (
                SUITS.index(card.suit), -card.strength
            ))

        if verbose:
            print(
                f"\nDeal {self.deals_played + 1}. "
                f"Dealer: {self.names[self.dealer]}"
            )
        if self.human and self.dealer == 0:
            show_hand(hands[0])
            for index, suit in enumerate(TRUMP_CHOICES, start=1):
                print(f"  {index}. {suit}")
            print("Null: no trump; points above 30 count double.")
            trump = TRUMP_CHOICES[read_choice("Choose trump: ", len(TRUMP_CHOICES))]
        else:
            trump = choose_computer_trump(hands[self.dealer])
        if verbose:
            print(f"Trump: {trump}" + (
                " (no trump; double match points)" if trump == NULL_TRUMP else ""
            ))

        self.joined_by = None
        if trump in SUITS:
            opponents = [p for p in range(4) if team_of(p) != team_of(self.dealer)]
            if self.human and 0 in opponents:
                show_hand(hands[0])
                if read_choice("Join trump? 1 = join (double points), 2 = pass: ", 2) == 0:
                    self.joined_by = 0
            if self.joined_by is None:
                for player in opponents:
                    if not (self.human and player == 0) and choose_computer_join(hands[player], trump):
                        self.joined_by = player
                        break
        if verbose and self.joined_by is not None:
            print(f"{self.names[self.joined_by]} joins {trump}: double match points.")

        leader = (self.dealer + 1) % 4
        captured: list[list[Card]] = [[], []]
        for trick_number in range(1, 9):
            trick: Trick = []
            if verbose:
                print(
                    f"\nTrick {trick_number}. Leader: {self.names[leader]}"
                )
            for offset in range(4):
                player = (leader + offset) % 4
                hand = hands[player]
                if self.human and player == 0:
                    if verbose and player == self.dealer and any(
                        card.suit == trump for card in legal_cards(hand, trick, trump)
                    ):
                        print("As trump chooser, playing trump is recommended when legal.")
                    card = choose_human_card(hand, trick, trump)
                else:
                    card = choose_computer_card(player, hand, trick, trump, self.dealer)
                if card not in legal_cards(hand, trick, trump):
                    raise RuntimeError("A player selected an illegal card.")
                hand.remove(card)
                trick.append((player, card))
                if verbose:
                    print(f"  {self.names[player]} plays {card}")
            leader, _ = winning_play(trick, trump)
            captured[team_of(leader)].extend(card for _, card in trick)
            self.game_deck.extend(card for _, card in trick)
            if verbose:
                print(
                    f"{self.names[leader]} wins "
                    f"{sum(card.points for _, card in trick)} points."
                )

        deal_scores = [
            sum(card.points for card in cards) for cards in captured
        ]
        if (
            sum(deal_scores) != 60
            or sum(map(len, captured)) != 32
            or any(hands)
            or len(self.game_deck) != 32 or len(set(self.game_deck)) != 32
        ):
            raise RuntimeError("Deal did not preserve all cards and points.")
        self.scores = [
            total + match_points(earned, trump, self.joined_by is not None)
            for total, earned in zip(self.scores, deal_scores)
        ]
        self.deals_played += 1
        self.deck = list(self.game_deck)
        self.dealer = (self.dealer + 1) % 4
        if verbose:
            print(
                f"\nDeal points: Team 1 = {deal_scores[0]}, "
                f"Team 2 = {deal_scores[1]}"
            )
            print(
                f"Total points: Team 1 = {self.scores[0]}, "
                f"Team 2 = {self.scores[1]}"
            )
        return deal_scores


class BoardDeal:
    """One observable deal; advance one card or one trick at a time."""

    def __init__(
        self, dealer: int, rng: random.Random, deck: list[Card] | None = None
    ) -> None:
        self.dealer = dealer
        if deck is None:
            deck = make_deck()
            rng.shuffle(deck)
        else:
            deck = list(deck)
        self.hands = deal_hands(deck, dealer)
        for hand in self.hands:
            hand.sort(key=lambda card: (
                SUITS.index(card.suit), -card.strength
            ))
        self.trump: str | None = None
        self.zero_point_players = zero_point_players(self.hands)
        self.joined_by: int | None = None
        self.leader = (dealer + 1) % 4
        self.trick: Trick = []
        self.captured: list[list[Card]] = [[], []]
        # Completed tricks in chronological order, cards in play order.
        self.game_deck: list[Card] = []
        self.scores = [0, 0]
        self.trick_number = 1
        self.finished = False

    @property
    def current_player(self) -> int:
        return (self.leader + len(self.trick)) % 4

    def choose_trump(self, suit: str) -> None:
        if self.zero_point_players or self.trump is not None or suit not in TRUMP_CHOICES:
            raise ValueError("Choose a valid trump once per deal.")
        self.trump = suit

    def join_trump(self, player: int) -> None:
        if (
            player not in range(4)
            or self.zero_point_players
            or self.trump not in SUITS
            or team_of(player) == team_of(self.dealer)
            or self.joined_by is not None
            or self.trick or self.trick_number != 1 or self.finished
        ):
            raise ValueError("Only an opponent can join suit trump once, before play begins.")
        self.joined_by = player

    def play(self, card: Card) -> None:
        if self.zero_point_players or self.trump is None or self.finished or len(self.trick) == 4:
            raise ValueError("The deal is not waiting for a card.")
        player = self.current_player
        if card not in legal_cards(self.hands[player], self.trick, self.trump):
            raise ValueError("Illegal card.")
        self.hands[player].remove(card)
        self.trick.append((player, card))
        if len(self.trick) == 4:
            winner, _ = winning_play(self.trick, self.trump)
            team = team_of(winner)
            self.captured[team].extend(card for _, card in self.trick)
            self.game_deck.extend(card for _, card in self.trick)
            self.scores[team] += sum(card.points for _, card in self.trick)
            self.finished = not any(self.hands)
            if self.finished and (
                sum(self.scores) != 60
                or sum(map(len, self.captured)) != 32
                or len(self.game_deck) != 32 or len(set(self.game_deck)) != 32
            ):
                raise RuntimeError(
                    "Deal did not preserve all cards and points."
                )

    def next_trick(self) -> None:
        if self.finished or len(self.trick) != 4 or self.trump is None:
            raise ValueError("There is no next trick ready.")
        self.leader = winning_play(self.trick, self.trump)[0]
        self.trick = []
        self.trick_number += 1


class ManilleBoard:
    """Tkinter board. All hands are exposed for learning and debugging."""

    SYMBOLS = {
        "Clubs": "♣", "Diamonds": "♦", "Hearts": "♥", "Spades": "♠"
    }
    SHORT = {"Jack": "J", "Queen": "Q", "King": "K", "Ace": "A"}
    TRICK_POSITIONS = {
        0: (402, 449), 1: (275, 324),
        2: (402, 227), 3: (528, 324),
    }
    CAPTURE_POSITIONS = {
        0: (402, 570), 1: (60, 324),
        2: (402, 110), 3: (744, 324),
    }
    CAPTURE_SECONDS = 0.5
    PLAY_SECONDS = 0.35
    MATCH_TARGET = 101

    def __init__(
        self, root, human: bool = True, seed: int | None = None,
        deal_limit: int | None = None
    ) -> None:
        import tkinter as tk
        from tkinter import ttk
        from tkinter.scrolledtext import ScrolledText

        self.root = root
        self.human = human
        self.rng = random.Random(seed)
        self.deal_limit = deal_limit
        self.names = ("Stefaan", "Gerard", "Isabel", "Gino")
        self.names_window = None
        self.total = [0, 0]
        self.match_winner: int | None = None
        self.deal_number = 1
        self.deal: BoardDeal | None = None
        self.shuffle_dealer = 0
        self.join_pending = False
        self.redeal_pending = False
        self.shuffling = False
        self.shuffle_deck: list[Card] = []
        self.shuffle_count = 0
        self.shuffle_box = (245, 150, 635, 420)
        self.running = False
        self.pending = None
        self.animation_pending = None
        self.animation_progress: float | None = None
        self.playing_card: tuple[Card, float, float] | None = None
        self.trick_collected = False
        self.last_hand: TrickRecord | None = None
        self.showing_last_hand = False
        self.hits: list[tuple[float, float, float, float, Card]] = []

        root.title("Manille — visible hands / learning board")
        root.geometry("1250x850")
        root.minsize(1100, 780)
        root.protocol("WM_DELETE_WINDOW", self.close)

        self.canvas = tk.Canvas(
            root, background="#145442", highlightthickness=0
        )
        self.canvas.pack(side="left", fill="both", expand=True)
        panel = ttk.Frame(root, padding=12, width=310)
        panel.pack(side="right", fill="y")
        panel.pack_propagate(False)

        ttk.Label(
            panel, text="MANILLE", font=("Segoe UI", 21, "bold")
        ).pack(anchor="w")
        self.names_button = ttk.Button(
            panel, text="Player names...", command=self.edit_player_names
        )
        self.names_button.pack(fill="x", pady=4)
        ttk.Label(
            panel,
            text=(
                "All hands visible for inspection.\n"
                "Computers still use only their own hand."
            ),
            wraplength=285,
        ).pack(anchor="w", pady=(0, 12))

        self.match_score = tk.StringVar()
        ttk.Label(
            panel, textvariable=self.match_score, wraplength=285,
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=8)

        self.summary = tk.StringVar()
        ttk.Label(
            panel, textvariable=self.summary, wraplength=285
        ).pack(anchor="w", pady=8)

        self.status = tk.StringVar()
        ttk.Label(
            panel, textvariable=self.status, wraplength=285,
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w", pady=8)

        self.info_button = ttk.Button(
            panel, text="Info: zero-point hand — restart deal", command=self.restart_deal
        )

        self.trump_var = tk.StringVar(value=SUITS[0])
        self.trump_box = ttk.Combobox(
            panel, textvariable=self.trump_var,
            values=TRUMP_CHOICES, state="readonly",
        )
        self.trump_box.pack(fill="x")
        ttk.Label(
            panel, text="Null: no trump; points above 30 count double.",
            wraplength=285,
        ).pack(anchor="w", pady=4)
        self.trump_button = ttk.Button(
            panel, text="Choose trump", command=self.set_human_trump
        )
        self.trump_button.pack(fill="x", pady=4)

        self.deal_button = ttk.Button(
            panel, text="Deal cards", command=self.stop_shuffle
        )
        self.deal_button.pack(fill="x", pady=4)

        self.join_var = tk.BooleanVar(value=False)
        self.join_frame = ttk.Frame(panel)
        self.join_checkbox = ttk.Checkbutton(
            self.join_frame, text="Join trump (double points)", variable=self.join_var
        )
        self.join_checkbox.pack(anchor="w")
        self.join_button = ttk.Button(
            self.join_frame, text="Confirm choice / pass", command=self.confirm_join
        )
        self.join_button.pack(fill="x", pady=4)

        self.step_button = ttk.Button(
            panel, text="Step: one action", command=self.step
        )
        self.step_button.pack(fill="x", pady=4)

        self.run_button = ttk.Button(
            panel, text="Auto-play", command=self.toggle_run
        )
        self.run_button.pack(fill="x", pady=4)

        ttk.Label(
            panel, text="Seconds between actions"
        ).pack(anchor="w", pady=(8, 0))
        self.delay = tk.DoubleVar(value=1.2)
        ttk.Scale(
            panel, from_=0.3, to=3.0, variable=self.delay
        ).pack(fill="x")

        self.next_button = ttk.Button(
            panel, text="Next deal", command=self.next_deal
        )
        self.next_button.pack(fill="x", pady=8)

        self.last_hand_button = ttk.Button(
            panel, text="Show Last Hand", command=self.show_last_hand
        )
        self.last_hand_button.pack(fill="x", pady=4)
        self.back_button = ttk.Button(
            panel, text="Back to Game", command=self.hide_last_hand
        )

        ttk.Label(
            panel,
            text=(
                "Gold borders: legal cards for this turn.\n"
                "Click a gold card on your turn."
            ),
            wraplength=285,
        ).pack(anchor="w", pady=8)
        ttk.Label(
            panel, text="Decision history",
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w")

        self.log = ScrolledText(
            panel, height=15, wrap="word",
            font=("Segoe UI", 10), state="disabled",
        )
        self.log.pack(fill="both", expand=True, pady=6)

        self.canvas.bind("<Configure>", lambda event: self.render())
        self.canvas.bind("<Button-1>", self.click_card)
        self.begin_shuffle()

    def begin_shuffle(self, deck: list[Card] | None = None) -> None:
        if self.shuffling:
            return
        self.stop()
        self.showing_last_hand = False
        self.last_hand = None
        self.shuffling = True
        self.redeal_pending = False
        self.info_button.pack_forget()
        self.join_pending = False
        self.join_var.set(False)
        self.shuffle_deck = make_deck() if deck is None else list(deck)
        # Preserve the incoming order: only a deck click performs a shuffle.
        self.shuffle_count = 0
        self.write(
            f"Deal {self.deal_number}: {self.names[self.shuffle_dealer]} deals. "
            "Click the deck for one Hindu shuffle. Inspect the 32 cards below, then deal."
        )
        self.render()

    def shuffle_once(self) -> None:
        if not self.shuffling:
            return
        hindu_shuffle(self.shuffle_deck, self.rng)
        self.shuffle_count += 1
        self.write(f"Hindu shuffle {self.shuffle_count} complete. Click again or deal the cards.")
        self.render()

    def stop_shuffle(self) -> None:
        if self.showing_last_hand or not self.shuffling:
            return
        # Deal this exact order. BoardDeal must not shuffle it again.
        self.deal = BoardDeal(self.shuffle_dealer, self.rng, deck=self.shuffle_deck)
        self.shuffling = False
        self.redeal_pending = bool(self.deal.zero_point_players)
        if self.redeal_pending:
            self.stop()
            self.write(
                "Zero-point hand: "
                + ", ".join(self.names[p] for p in self.deal.zero_point_players)
                + ". Click the info button to restart this deal. No points are counted."
            )
        self.write(
            f"{self.names[self.deal.dealer]}: deck ready; "
            "32 cards dealt in 3-2-3 packets, starting left of the dealer. "
            + ("A zero-point hand requires a redeal." if self.redeal_pending else "Choose trump to begin.")
        )
        self.render()

    def restart_deal(self) -> None:
        if self.showing_last_hand or not self.redeal_pending or self.shuffling or self.match_winner is not None:
            return
        self.stop()
        deck = list(self.shuffle_deck)
        self.shuffle_dealer = self.deal.dealer
        self.deal = None
        self.trick_collected = False
        self.begin_shuffle(deck)

    def render_shuffle(self, sx: float, sy: float) -> None:
        c = self.canvas
        def label(x, y, value, size=16):
            c.create_text(
                x * sx, y * sy, text=value, fill="#f4f5ef",
                font=("Segoe UI", size, "bold"),
            )
        label(440, 65, "HINDU SHUFFLE", 28)
        label(440, 105, f"Dealer: {self.names[self.shuffle_dealer]}", 14)
        c.create_line(340 * sx, 135 * sy, 540 * sx, 135 * sy,
                      fill="#c8a765", width=2)
        c.create_oval(200 * sx, 150 * sy, 680 * sx, 420 * sy,
                      fill="#1b6350", outline="#438773", width=2)
        c.create_oval(325 * sx, 345 * sy, 565 * sx, 395 * sy,
                      fill="#104536", outline="")
        for index in range(32):
            x = 372 + index * .8
            y = 190 + index * 1.3
            c.create_rectangle(
                x * sx, y * sy, (x + 116) * sx, (y + 162) * sy,
                fill="#fffdf5", outline="#c7c7b8", width=1,
                tags=("shuffle-card",),
            )
            c.create_rectangle(
                (x + 5) * sx, (y + 5) * sy, (x + 111) * sx, (y + 157) * sy,
                fill="#203c75", outline="#c8a765", width=2,
            )
            c.create_polygon(
                (x + 58) * sx, (y + 28) * sy,
                (x + 93) * sx, (y + 81) * sy,
                (x + 58) * sx, (y + 134) * sy,
                (x + 23) * sx, (y + 81) * sy,
                fill="#294c86", outline="#c8a765", width=2,
            )
            c.create_text((x + 58) * sx, (y + 81) * sy, text="M",
                          fill="#f1d797", font=("Georgia", 27, "bold"))
            for corner_x, corner_y, symbol in ((17, 19, "♠"), (99, 143, "♠")):
                c.create_text((x + corner_x) * sx, (y + corner_y) * sy,
                              text=symbol, fill="#f1d797", font=("Segoe UI", 13))
        label(440, 442, "Click the deck for one Hindu shuffle", 17)
        shuffles = "shuffle" if self.shuffle_count == 1 else "shuffles"
        label(440, 473, f"32 cards  •  {self.shuffle_count} {shuffles}", 13)
        label(440, 505, "Deck order: left to right, top row first (1 is dealt first)", 12)
        for index, card in enumerate(self.shuffle_deck):
            x, y = 41 + (index % 16) * 50, 526 + (index // 16) * 92
            tag = f"deck-preview-{index}"
            color = "#b72c3a" if card.suit in ("Hearts", "Diamonds") else "#20332d"
            c.create_rectangle(x * sx, y * sy, (x + 46) * sx, (y + 74) * sy,
                               fill="#fffdf5", outline="#c8a765",
                               tags=("deck-preview-card", tag))
            c.create_text((x + 23) * sx, (y + 19) * sy,
                          text=self.SHORT.get(card.rank, card.rank), fill=color,
                          font=("Segoe UI", 13, "bold"), tags=("deck-preview-rank", tag))
            c.create_text((x + 23) * sx, (y + 40) * sy,
                          text=self.SYMBOLS[card.suit], fill=color,
                          font=("Segoe UI", 17), tags=("deck-preview-suit", tag))
            c.create_text((x + 23) * sx, (y + 62) * sy, text=str(index + 1),
                          fill="#68766e", font=("Segoe UI", 9), tags=("deck-preview-position", tag))
        label(440, 714, "Ready? Choose Deal cards to use this exact order.", 12)
        c.configure(cursor="hand2")
        self.match_score.set(
            f"First to {self.MATCH_TARGET} points\n"
            f"Team 1: {self.total[0]}\nTeam 2: {self.total[1]}"
        )
        self.summary.set(f"Deal {self.deal_number} - Dealer: {self.names[self.shuffle_dealer]}")
        self.status.set("Click the deck for one Hindu shuffle, or choose Deal cards.")
        self.deal_button.configure(state="normal")
        self.trump_box.configure(state="disabled")
        for button in (self.trump_button, self.step_button, self.run_button, self.next_button):
            button.configure(state="disabled")
        self.run_button.configure(text="Auto-play")
        self.join_frame.pack_forget()
        self.join_checkbox.configure(state="disabled")
        self.join_button.configure(state="disabled")

    def edit_player_names(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        if self.names_window is not None and self.names_window.winfo_exists():
            self.names_window.lift()
            return
        self.stop()
        self.render()
        window = tk.Toplevel(self.root)
        self.names_window = window
        window.title("Player names")
        window.transient(self.root)
        window.resizable(False, False)
        form = ttk.Frame(window, padding=16)
        form.pack(fill="both", expand=True)
        ttk.Label(
            form, text="Choose fictional names for this game."
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 12))
        seats = (
            "Bottom - Team 1" + (" (you)" if self.human else ""),
            "Left - Team 2",
            "Top - Team 1" + (" (your teammate)" if self.human else ""),
            "Right - Team 2",
        )
        self.name_vars = [tk.StringVar(value=name) for name in self.names]
        entries = []
        for player, seat in enumerate(seats):
            ttk.Label(form, text=seat).grid(
                row=player + 1, column=0, sticky="w", padx=(0, 12), pady=4
            )
            entry = ttk.Entry(form, textvariable=self.name_vars[player], width=24)
            entry.grid(row=player + 1, column=1, pady=4)
            entries.append(entry)
        self.save_names_button = ttk.Button(
            form, text="Apply names", command=self.apply_player_names
        )
        self.save_names_button.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        window.bind("<Return>", lambda event: self.apply_player_names())
        window.bind("<Escape>", lambda event: window.destroy())
        window.grab_set()
        entries[0].focus_set()
        entries[0].selection_range(0, "end")

    def apply_player_names(self) -> None:
        # A blank field keeps its previous name; names persist between deals.
        self.names = tuple(
            " ".join(variable.get().split()) or previous
            for variable, previous in zip(self.name_vars, self.names)
        )
        self.names_window.destroy()
        self.names_window = None
        self.write(
            f"Player names: Team 1 = {self.names[0]} and {self.names[2]}; "
            f"Team 2 = {self.names[1]} and {self.names[3]}."
        )
        self.render()

    def write(self, message: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", message + "\n\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def stop(self) -> None:
        self.running = False
        if self.pending is not None:
            self.root.after_cancel(self.pending)
            self.pending = None

    def close(self) -> None:
        self.stop()
        if self.animation_pending is not None:
            self.root.after_cancel(self.animation_pending)
            self.animation_pending = None
        self.root.destroy()

    def running_totals(self) -> list[int]:
        """Count each deal's excess above 30 once, including the live deal."""
        if self.shuffling or self.deal.finished:
            return list(self.total)
        return [
            a + match_points(b, self.deal.trump, self.deal.joined_by is not None)
            for a, b in zip(self.total, self.deal.scores)
        ]

    def collect_trick(self, on_complete) -> None:
        """Move all four cards to the winner before advancing the board."""
        if (
            self.shuffling
            or self.animation_progress is not None
            or self.trick_collected
            or len(self.deal.trick) != 4
        ):
            return
        self.start_animation(self.CAPTURE_SECONDS, on_complete)

    def start_animation(self, duration: float, on_complete) -> None:
        """Keep game actions suspended until a card movement finishes."""
        if self.pending is not None:
            self.root.after_cancel(self.pending)
            self.pending = None
        started = time.monotonic()
        self.animation_progress = 0.0

        def frame() -> None:
            self.animation_pending = None
            progress = min(
                (time.monotonic() - started) / duration, 1.0
            )
            # Smooth acceleration and deceleration at both ends of the move.
            self.animation_progress = progress * progress * (3 - 2 * progress)
            self.render()
            if progress < 1.0:
                self.animation_pending = self.root.after(16, frame)
            else:
                self.animation_progress = None
                on_complete()
                self.render()
                self.schedule()

        self.render()
        self.animation_pending = self.root.after(16, frame)

    def finish_card_play(self) -> None:
        self.playing_card = None
        self.collect_final_trick()

    def collect_final_trick(self) -> None:
        if self.deal.finished or self.match_winner is not None:
            self.collect_trick(self.finish_final_trick)

    def finish_final_trick(self) -> None:
        # The cards are already scored and captured. Keep that evidence in
        # the deal model, but remove their faces from the finished board.
        self.trick_collected = True

    def advance_trick(self) -> None:
        if self.shuffling or self.match_winner is not None:
            return
        self.deal.next_trick()
        self.write(
            f"Trick {self.deal.trick_number}: "
            f"{self.names[self.deal.leader]} leads."
        )

    def offer_join(self) -> None:
        if self.redeal_pending or self.deal.trump not in SUITS:
            return
        if self.human and team_of(0) != team_of(self.deal.dealer):
            self.join_pending = True
            self.join_var.set(False)
        else:
            self.consider_computer_joins()

    def consider_computer_joins(self) -> None:
        d = self.deal
        if d.trump not in SUITS or d.joined_by is not None:
            return
        for player in range(4):
            if (
                team_of(player) != team_of(d.dealer)
                and not (self.human and player == 0)
                and choose_computer_join(d.hands[player], d.trump)
            ):
                d.join_trump(player)
                self.write(f"{self.names[player]} joins {d.trump}: double match points.")
                break

    def confirm_join(self) -> None:
        if self.showing_last_hand or not self.join_pending or self.shuffling or self.match_winner is not None:
            return
        if self.join_var.get():
            self.deal.join_trump(0)
            self.write(f"{self.names[0]} joins {self.deal.trump}: double match points.")
        else:
            self.write(f"{self.names[0]} passes on joining {self.deal.trump}.")
            self.consider_computer_joins()
        self.join_pending = False
        self.render()
        self.schedule()

    def set_human_trump(self) -> None:
        if (
            not self.shuffling
            and not self.showing_last_hand
            and not self.redeal_pending
            and self.deal.trump is None
            and self.match_winner is None
            and self.human
            and self.deal.dealer == 0
        ):
            self.deal.choose_trump(self.trump_var.get())
            self.write(f"{self.names[0]} chooses {self.deal.trump} as trump." + (
                " No trump suit; double match points."
                if self.deal.trump == NULL_TRUMP else ""
            ))
            self.offer_join()
            self.render()
            self.schedule()

    def waiting_for_human(self) -> bool:
        d = self.deal
        return not self.shuffling and self.match_winner is None and self.human and (
            self.join_pending
            or (d.trump is None and d.dealer == 0)
            or (
                d.trump is not None
                and len(d.trick) < 4
                and not d.finished
                and d.current_player == 0
            )
        )

    def step(self) -> None:
        d = self.deal
        if (
            self.shuffling
            or self.showing_last_hand
            or self.redeal_pending
            or self.animation_progress is not None
            or self.match_winner is not None
            or d.finished or self.waiting_for_human()
        ):
            return
        if d.trump is None:
            d.choose_trump(choose_computer_trump(d.hands[d.dealer]))
            self.write(
                f"{self.names[d.dealer]} chooses {d.trump}: "
                + (
                    "high-value cards across several suits; "
                    "no trump and double match points."
                    if d.trump == NULL_TRUMP else
                    "most card points, then card count, "
                    "then rank strength in its own hand."
                )
            )
            self.offer_join()
        elif len(d.trick) == 4:
            self.collect_trick(self.advance_trick)
            return
        else:
            player = d.current_player
            hand = d.hands[player]
            card = choose_computer_card(player, hand, d.trick, d.trump, d.dealer)
            if d.trump == NULL_TRUMP:
                reason = "Null: play the highest-value legal card, prioritizing 5-point 10s."
            elif card.points == 5 and (
                not d.trick or partner_is_winning(player, d.trick, d.trump)
            ):
                reason = "Play a legal 5-point 10 first, conserving trump on equal points."
            elif not d.trick:
                reason = (
                    "Lead a low-value card, "
                    "conserving trump on equal points."
                )
            elif (
                team_of(winning_play(d.trick, d.trump)[0])
                == team_of(player)
            ):
                reason = (
                    "Partner is winning: contribute "
                    "the highest-value legal card."
                )
            elif (
                winning_play(d.trick + [(player, card)], d.trump)[0]
                == player
            ):
                reason = (
                    "Take the trick with the "
                    "lowest-value winning legal card."
                )
            else:
                reason = (
                    "Cannot win: discard the lowest-value legal card."
                )
            if player == d.dealer and card.suit == d.trump:
                reason = "Trump chooser: prioritize legal trump cards. " + reason
            self.play_card(card, reason)
            return
        self.render()

    def play_card(self, card: Card, reason: str) -> None:
        if self.showing_last_hand or self.shuffling or self.redeal_pending or self.join_pending or self.animation_progress is not None or self.match_winner is not None:
            return
        d = self.deal
        player = d.current_player
        choices = legal_cards(d.hands[player], d.trick, d.trump)
        if not d.trick:
            obligation = "Any lead is legal."
        elif any(
            c.suit == d.trick[0][1].suit for c in d.hands[player]
        ):
            obligation = f"Must follow {d.trick[0][1].suit}."
            best_following = max(c.strength for _, c in d.trick
                                 if c.suit == d.trick[0][1].suit)
            if partner_is_winning(player, d.trick, d.trump) and d.trick[0][1].suit != d.trump:
                obligation += " Partner is winning: a higher card is optional."
            elif (
                d.trick[0][1].suit != d.trump
                and winning_play(d.trick, d.trump)[1].suit == d.trump
            ):
                obligation += f" Trick has been trumped: any {d.trick[0][1].suit} card is legal."
            elif any(
                c.strength > best_following
                for c in choices
            ):
                obligation = f"Must follow {d.trick[0][1].suit} with a higher card."
        elif d.trump == NULL_TRUMP:
            obligation = "Null: cannot follow suit; any card is legal."
        elif (
            partner_is_winning(player, d.trick, d.trump)
            and any(c.suit != d.trump for c in choices)
        ):
            obligation = (
                "Partner is winning with trump: trumping is optional."
                if winning_play(d.trick, d.trump)[1].suit == d.trump
                else "Partner is winning: trumping is optional."
            ) + " Lower trumps are allowed only when forced."
        elif any(c.suit == d.trump for c in choices):
            best = max(
                (
                    c.strength for _, c in d.trick
                    if c.suit == d.trump
                ),
                default=-1,
            )
            obligation = (
                "Must play a winning trump."
                if any(
                    c.suit == d.trump and c.strength > best
                    for c in d.hands[player]
                )
                else "Must play trump: no higher trump is available."
            )
        else:
            obligation = "Cannot follow suit and no trump available: any card is legal."
        d.play(card)
        self.write(
            f"{self.names[player]}: {card}\n{obligation} {reason}"
        )
        if len(d.trick) == 4:
            self.last_hand = TrickRecord(tuple(d.trick), d.trump, self.deal_number, d.trick_number)
            winner, _ = winning_play(d.trick, d.trump)
            points = sum(c.points for _, c in d.trick)
            self.write(
                f"{self.names[winner]} wins trick {d.trick_number}: "
                f"{points} points for Team {team_of(winner) + 1}."
            )
        if d.finished:
            earned = [match_points(points, d.trump, d.joined_by is not None) for points in d.scores]
            self.total = [
                a + b for a, b in zip(self.total, earned)
            ]
            self.stop()
            self.write(
                f"Deal complete: Team 1 {d.scores[0]}, "
                f"Team 2 {d.scores[1]}. "
                f"Added to totals: Team 1 {earned[0]}, Team 2 {earned[1]}. "
                "All 32 cards and 60 points accounted for."
            )
        totals = self.running_totals()
        for team, points in enumerate(totals):
            if points >= self.MATCH_TARGET:
                self.match_winner = team
                self.stop()
                self.write(
                    f"Game over: Team {team + 1} wins! "
                    f"Final totals: Team 1 {totals[0]}, Team 2 {totals[1]}."
                )
                break
        self.render()
        if self.playing_card is None:
            self.collect_final_trick()

    def click_card(self, event) -> None:
        if self.showing_last_hand:
            return
        if self.shuffling:
            sx = max(self.canvas.winfo_width(), 1) / 880
            sy = max(self.canvas.winfo_height(), 1) / 730
            x1, y1, x2, y2 = self.shuffle_box
            if x1 * sx <= event.x <= x2 * sx and y1 * sy <= event.y <= y2 * sy:
                self.shuffle_once()
            return
        d = self.deal
        if (
            self.animation_progress is not None
            or self.redeal_pending
            or self.join_pending
            or self.match_winner is not None
            or not self.human
            or not d.trump
            or d.finished
            or len(d.trick) == 4
            or d.current_player != 0
        ):
            return
        for x1, y1, x2, y2, card in self.hits:
            if x1 <= event.x <= x2 and y1 <= event.y <= y2:
                # Store board coordinates so resizing preserves the flight.
                sx = max(self.canvas.winfo_width(), 1) / 880
                sy = max(self.canvas.winfo_height(), 1) / 730
                self.playing_card = (card, x1 / sx, y1 / sy)
                self.play_card(card, "Human selection.")
                self.start_animation(self.PLAY_SECONDS, self.finish_card_play)
                break

    def toggle_run(self) -> None:
        if self.showing_last_hand or self.shuffling or self.redeal_pending or self.match_winner is not None:
            return
        if self.running:
            self.stop()
        else:
            self.running = True
            self.schedule()
        self.render()

    def schedule(self) -> None:
        if (
            self.running
            and not self.shuffling
            and not self.showing_last_hand
            and not self.redeal_pending
            and self.match_winner is None
            and self.pending is None
            and self.animation_progress is None
            and not self.waiting_for_human()
            and not self.deal.finished
        ):
            self.pending = self.root.after(
                int(self.delay.get() * 1000), self.tick
            )

    def tick(self) -> None:
        self.pending = None
        if self.running:
            self.step()
            self.schedule()

    def next_deal(self) -> None:
        if (
            self.showing_last_hand
            or self.shuffling
            or self.animation_progress is not None
            or self.match_winner is not None
            or not self.deal.finished
            or (
                self.deal_limit is not None
                and self.deal_number >= self.deal_limit
            )
        ):
            return
        self.stop()
        if self.trick_collected:
            self.start_next_deal()
        else:
            self.collect_trick(self.start_next_deal)

    def start_next_deal(self) -> None:
        if self.showing_last_hand or self.shuffling or self.redeal_pending or self.match_winner is not None:
            return
        self.shuffle_dealer = (self.deal.dealer + 1) % 4
        deck = list(self.deal.game_deck)
        self.deal = None
        self.trick_collected = False
        self.deal_number += 1
        self.begin_shuffle(deck)

    def show_last_hand(self) -> None:
        if self.shuffling or self.last_hand is None or self.animation_progress is not None:
            return
        self.stop()
        self.showing_last_hand = True
        self.render()

    def hide_last_hand(self) -> None:
        self.showing_last_hand = False
        self.render()

    def render_last_hand(self, sx: float, sy: float) -> None:
        record = self.last_hand
        c = self.canvas
        winner, _ = winning_play(list(record.plays), record.trump)
        points = sum(card.points for _, card in record.plays)

        def label(x, y, value, size=16, width=0):
            c.create_text(x * sx, y * sy, text=value, fill="#f4f5ef",
                          font=("Segoe UI", size), width=width * sx,
                          justify="center", tags=("last-hand-label",))

        label(440, 150, "LAST HAND", 26)
        label(440, 195, f"Deal {record.deal_number} · Trick {record.trick_number} · Trump: {record.trump}")
        for index, (player, card) in enumerate(record.plays):
            x, y = 230 + index * 110, 300
            tag = f"last-hand-card-{player}"
            c.create_rectangle(x * sx, y * sy, (x + 90) * sx, (y + 130) * sy,
                               fill="#fffdf5", outline="#ffc857" if player == winner else "#9bac9f",
                               width=4 if player == winner else 1, tags=("last-hand-card", tag))
            color = "#b72c3a" if card.suit in ("Hearts", "Diamonds") else "#20332d"
            c.create_text((x + 45) * sx, (y + 45) * sy,
                          text=f"{self.SHORT.get(card.rank, card.rank)} {self.SYMBOLS[card.suit]}",
                          fill=color, font=("Segoe UI", 21), tags=("last-hand-card", tag))
            c.create_text((x + 45) * sx, (y + 100) * sy, text=f"{card.points} pts",
                          fill=color, font=("Segoe UI", 12), tags=("last-hand-card", tag))
            label(x + 45, 267, f"#{index + 1}\n{self.names[player]}", 11, 105)
        label(440, 490, f"Winner: {self.names[winner]} · Team {team_of(winner) + 1}", 18, 650)
        label(440, 535, f"{points} raw points", 15)
        label(440, 605, "Choose Back to Game to return. Auto-play is paused.", 13)
        self.status.set("Viewing the last completed trick. Choose Back to Game to continue.")
        self.back_button.pack(fill="x", pady=4, after=self.last_hand_button)
        self.run_button.configure(text="Auto-play")
        self.trump_box.configure(state="disabled")
        for button in (self.step_button, self.run_button, self.next_button, self.trump_button,
                       self.deal_button, self.join_button, self.join_checkbox, self.info_button):
            button.configure(state="disabled")
        c.configure(cursor="")

    def render(self) -> None:
        d = self.deal
        c = self.canvas
        c.delete("all")
        self.hits = []
        sx = max(c.winfo_width(), 1) / 880
        sy = max(c.winfo_height(), 1) / 730
        self.last_hand_button.configure(
            state="normal" if self.last_hand is not None
            and not self.shuffling
            and self.animation_progress is None else "disabled"
        )
        self.info_button.configure(state="normal")
        self.back_button.pack_forget()
        if self.showing_last_hand:
            self.render_last_hand(sx, sy)
            return
        if self.shuffling:
            self.render_shuffle(sx, sy)
            return
        self.deal_button.configure(state="disabled")
        c.configure(cursor="")

        def text(x, y, value, size=12, color="#f4f5ef", tags=(), width=0):
            c.create_text(
                x * sx, y * sy, text=value, fill=color,
                font=("Segoe UI", size), justify="center",
                tags=tags,
                width=width * sx,
            )

        def draw_card(
            x, y, width, height, card,
            legal=False, clickable=False, tags=()
        ):
            box = (
                x * sx, y * sy,
                (x + width) * sx, (y + height) * sy,
            )
            c.create_rectangle(
                *box, fill="#fffdf5",
                outline="#ffc857" if legal else "#9bac9f",
                width=4 if legal else 1,
                tags=tags,
            )
            color = (
                "#b72c3a"
                if card.suit in ("Hearts", "Diamonds")
                else "#20332d"
            )
            rank = self.SHORT.get(card.rank, card.rank)
            text(
                x + width / 2, y + height * .32,
                f"{rank} {self.SYMBOLS[card.suit]}",
                17, color, tags,
            )
            text(
                x + width / 2, y + height * .75,
                f"{card.points} pts", 10, color, tags,
            )
            if clickable:
                self.hits.append((*box, card))

        active = (
            d.trump is not None
            and not self.redeal_pending
            and len(d.trick) < 4
            and not d.finished
            and self.match_winner is None
            and not self.join_pending
            and self.animation_progress is None
        )
        current = d.current_player if active else None
        choices = (
            legal_cards(d.hands[current], d.trick, d.trump)
            if active else []
        )
        labels = {
            0: (440, 590), 1: (98, 187),
            2: (440, 34), 3: (782, 187),
        }
        for player, hand in enumerate(d.hands):
            x, y = labels[player]
            tags = f" • Team {team_of(player) + 1}"
            if self.human and player == 0:
                tags += " (you)"
            elif self.human and player == 2:
                tags += " (your teammate)"
            if player == d.dealer:
                tags += " • Dealer"
            if player == current:
                tags += " • TURN"
            label = (
                self.names[player]
                + ("\n" if player in (1, 3) else "")
                + tags
            )
            text(
                x, y, label, 11,
                "#ffc857" if player == current else "#f4f5ef",
                width=170 if player in (1, 3) else 690,
            )
            for index, card in enumerate(hand):
                if player in (0, 2):
                    px, py, w, h = (
                        104 + index * 84,
                        617 if player == 0 else 62,
                        76, 94,
                    )
                else:
                    px, py, w, h = (
                        (18 if player == 1 else 706)
                        + (index % 2) * 80,
                        213 + (index // 2) * 83,
                        72, 75,
                    )
                legal = player == current and card in choices
                draw_card(
                    px, py, w, h, card, legal,
                    legal and player == 0 and self.human,
                )
            if not hand:
                text(x, y + 55, "No cards remaining", 11)

        c.create_oval(
            203 * sx, 181 * sy, 677 * sx, 565 * sy,
            fill="#1b6350", outline="#438773", width=2,
        )
        text(440, 193, f"Trick {d.trick_number} of 8", 14)
        visible_trick = [] if self.trick_collected else d.trick
        winner = (
            winning_play(visible_trick, d.trump)[0]
            if visible_trick else None
        )
        for order, (player, card) in enumerate(visible_trick, start=1):
            x, y = self.TRICK_POSITIONS[player]
            moving = self.playing_card is not None and card == self.playing_card[0]
            if moving:
                _, start_x, start_y = self.playing_card
                progress = self.animation_progress or 0.0
                x = start_x + (x - start_x) * progress
                y = start_y + (y - start_y) * progress
            elif (
                self.animation_progress is not None
                and self.playing_card is None
            ):
                target_x, target_y = self.CAPTURE_POSITIONS[winner]
                target_x += (order - 1) * 5
                target_y += (order - 1) * 3
                x += (target_x - x) * self.animation_progress
                y += (target_y - y) * self.animation_progress
            draw_card(
                x, y, 76, 94, card, player == winner,
                tags=("table-card", f"table-card-{player}"),
            )
            if self.animation_progress is None and not moving:
                text(
                    x + 38, y - 13,
                    f"#{order} · {self.names[player]}", 10, width=140,
                )
        text(
            440, 357,
            (
                f"TRUMP: {d.trump} [{self.names[d.dealer]}]"
                if d.trump is not None else "TRUMP: choose suit"
            ),
            13,
        )
        text(
            440, 385,
            f"On table: {sum(card.points for _, card in visible_trick)} points",
            11,
        )
        if winner is not None:
            text(
                440, 413,
                f"{'Winner' if len(d.trick) == 4 else 'Winning'}: "
                f"{self.names[winner]}",
                11,
            )
        if self.animation_progress is not None:
            c.tag_raise("table-card")
        totals = self.running_totals()
        self.match_score.set(
            f"First to {self.MATCH_TARGET} points\n"
            f"Team 1: {totals[0]}\nTeam 2: {totals[1]}"
        )
        self.summary.set(
            f"Deal {self.deal_number} • Trump: {d.trump or 'pending'}\n"
            f"Deal points: Team 1 {d.scores[0]} / Team 2 {d.scores[1]}\n"
            f"Total points: Team 1 {totals[0]} / Team 2 {totals[1]}"
            "\nOnly deal points above 30 count toward totals."
            + (" Null doubles those points." if d.trump == NULL_TRUMP else "")
            + (
                f"\nJoined by {self.names[d.joined_by]}: double points."
                if d.joined_by is not None else ""
            )
        )
        if self.match_winner is not None and self.animation_progress is None:
            status = f"Game over! Team {self.match_winner + 1} wins."
        elif self.animation_progress is not None:
            status = (
                f"Playing {self.names[0]}'s card."
                if self.playing_card is not None
                else f"Collecting trick for {self.names[winner]}."
            )
        elif self.redeal_pending:
            names = ", ".join(self.names[p] for p in d.zero_point_players)
            status = f"Zero-point hand: {names}. Click the info button to restart dealing."
        elif self.join_pending:
            status = f"{self.names[0]}: join {d.trump} for double points, or pass."
        elif d.finished:
            status = "Deal complete. Choose Next deal."
        elif d.trump is None:
            status = f"{self.names[d.dealer]} chooses trump."
        elif len(d.trick) == 4:
            status = (
                "Trick complete. Step to collect the cards "
                "and start the next trick."
            )
        else:
            status = (
                f"{self.names[d.current_player]}'s turn."
                + (
                    " Click a gold card."
                    if self.waiting_for_human()
                    else " Step to inspect the next play."
                )
            )
        if (active and self.human and current == 0 and d.dealer == 0
                and any(card.suit == d.trump for card in choices)):
            status += " Trump chooser: playing trump is recommended."
        self.status.set(status)
        if self.redeal_pending:
            self.info_button.pack(fill="x", pady=4, before=self.trump_box)
        else:
            self.info_button.pack_forget()
        if self.join_pending:
            self.join_frame.pack(fill="x", pady=4, before=self.step_button)
        else:
            self.join_frame.pack_forget()
        self.join_checkbox.configure(state="normal" if self.join_pending else "disabled")
        self.join_button.configure(state="normal" if self.join_pending else "disabled")
        human_trump = (
            self.match_winner is None
            and not self.redeal_pending
            and d.trump is None and self.human and d.dealer == 0
        )
        self.trump_button.configure(
            state="normal" if human_trump else "disabled"
        )
        self.trump_box.configure(
            state="readonly" if human_trump else "disabled"
        )
        self.step_button.configure(
            state=(
                "disabled"
                if self.animation_progress is not None
                or self.redeal_pending
                or self.match_winner is not None
                or d.finished or self.waiting_for_human()
                else "normal"
            )
        )
        self.run_button.configure(
            text="Pause" if self.running else "Auto-play",
            state=(
                "disabled" if self.redeal_pending or d.finished or self.match_winner is not None
                else "normal"
            ),
        )
        can_continue = (
            d.finished
            and self.match_winner is None
            and self.animation_progress is None
            and (
                self.deal_limit is None
                or self.deal_number < self.deal_limit
            )
        )
        self.next_button.configure(
            state="normal" if can_continue else "disabled"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Play the agreed Manille rules."
    )
    parser.add_argument(
        "--auto", action="store_true",
        help="Use four computer players.",
    )
    parser.add_argument(
        "--deals", type=int, default=None,
        help="Play this many deals.",
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="Random seed; board deals also depend on the number of deck shuffles.",
    )
    parser.add_argument(
        "--console", action="store_true",
        help="Use the original text interface.",
    )
    args = parser.parse_args()
    if args.deals is not None and args.deals < 1:
        parser.error("--deals must be at least 1")
    if not args.console:
        import tkinter as tk

        root = tk.Tk()
        ManilleBoard(
            root, human=not args.auto,
            seed=args.seed, deal_limit=args.deals,
        )
        root.mainloop()
        return

    game = ManilleGame(human=not args.auto, seed=args.seed)
    print("Manille: 32 cards, 8 tricks, 60 points per deal.")
    print("Team 1: positions 0 and 2. Team 2: positions 1 and 3.")
    limit = (
        args.deals if args.deals is not None
        else (1 if args.auto else None)
    )
    try:
        while limit is None or game.deals_played < limit:
            game.play_deal()
            if (
                limit is None
                and input("\nPlay another deal? [y/N]: ").strip().lower()
                not in ("y", "yes")
            ):
                break
    except (KeyboardInterrupt, EOFError):
        print(
            "\nGame stopped. Only completed deals count toward the total."
        )
    print(
        f"\nFinal totals: Team 1 = {game.scores[0]}, "
        f"Team 2 = {game.scores[1]}"
    )


if __name__ == "__main__":
    main()
