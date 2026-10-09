"""Shared Manille cards, rules and scoring; no UI or strategy imports."""

from __future__ import annotations

import random
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


def hindu_shuffle(deck: list[Card], rng: random.Random) -> list[int]:
    """Pull top packets into a receiving hand, then drop the remainder on top.

    Card 0 is the top of the deck. Each packet retains its internal order;
    successive packets land on top of the cards already received.
    Return packet sizes in pickup order, including the final remainder,
    so the board can animate this exact shuffle without drawing again.
    """
    if len(deck) < 2:
        return [len(deck)] if deck else []
    remainder = min(rng.randint(3, 6), len(deck) - 1)
    received: list[Card] = []
    packets: list[int] = []
    cursor = 0
    while len(deck) - cursor > remainder:
        size = rng.randint(1, min(5, len(deck) - cursor - remainder))
        received = deck[cursor:cursor + size] + received
        packets.append(size)
        cursor += size
    deck[:] = deck[cursor:] + received
    return packets + [remainder]


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
    Overtrump when possible; otherwise discard a non-trump if available.
    A lower trump is allowed only when no other legal choice remains,
    except when following suit with a winning partner: any follower is legal,
    including a lower trump when trump was led.
    """
    if not trick:
        return list(hand)
    # Turns proceed clockwise, so the next player follows the last play.
    player = (trick[-1][0] + 1) % 4
    following = [card for card in hand if card.suit == trick[0][1].suit]
    if following and partner_is_winning(player, trick, trump):
        return following
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
        choices = (
            list(hand) if partner_is_winning(player, trick, trump)
            else winning_trumps or list(hand)
        )
    if trumps_played:
        without_lower_trumps = [
            card for card in choices
            if card.suit != trump or card.strength > best_trump
        ]
        return without_lower_trumps or choices
    return choices
