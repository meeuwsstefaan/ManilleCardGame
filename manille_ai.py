"""Computer strategies and public-play observations for Manille.

Observation sets belong to each game; this module keeps no global game state.
All decisions use only the supplied hand and public information.
"""

from __future__ import annotations

from manille_core import (
    Card, Trick, NULL_TRUMP, SUITS, legal_cards, partner_is_winning,
    team_of, winning_play,
)


def record_trumped_suit(trick: Trick, trump: str, trumped_suits: list[set[str]]) -> None:
    """Remember a publicly observed trump for the trumping player's opponents."""
    if len(trick) < 2 or trump not in SUITS:
        return
    led_suit = trick[0][1].suit
    player, card = trick[-1]
    if led_suit != trump and card.suit == trump:
        trumped_suits[1 - team_of(player)].add(led_suit)


def choose_computer_card(
    player: int, hand: list[Card], trick: Trick, trump: str,
    trump_chooser: int | None = None,
    opponent_trumped_suits: set[str] | None = None,
) -> Card:
    """A simple team-aware heuristic, without seeing other players' hands.

    With a winning partner, play the highest-value legal card before applying
    suit preferences; break value ties by rank, then conserve trump.
    Prioritize legal 5-point cards on leads.
    Against a winning opponent, win cheaply or discard the cheapest legal card.
    In Null, play the highest-value legal card, then highest rank, except
    against an opponent's opening 10: play the cheapest legal card instead.
    The trump chooser prefers legal trump cards, applying the value strategy
    within that suit. This recommendation never changes card legality.
    When the opposing team chose trump, prefer legal non-trump cards.
    Avoid suits previously trumped by opponents when a legal alternative
    exists. Mandatory following and trumping still take precedence.
    Feed points to a winning partner when legal. A later opponent may still
    win, so this is a basic strategy rather than an optimal playing engine.
    """
    choices = legal_cards(hand, trick, trump)
    if partner_is_winning(player, trick, trump):
        return max(choices, key=lambda card: (
            card.points, card.strength, card.suit != trump
        ))
    if trump == NULL_TRUMP:
        if trick and trick[0][1].rank == "10" and team_of(trick[0][0]) != team_of(player):
            return min(choices, key=lambda card: (card.points, card.strength))
        return max(choices, key=lambda card: (card.points, card.strength))
    if player == trump_chooser:
        legal_trumps = [card for card in choices if card.suit == trump]
        choices = legal_trumps or choices
    elif trump_chooser is not None and team_of(player) != team_of(trump_chooser):
        non_trumps = [card for card in choices if card.suit != trump]
        choices = non_trumps or choices
    if opponent_trumped_suits:
        alternatives = [card for card in choices if card.suit not in opponent_trumped_suits]
        choices = alternatives or choices
    cheap = lambda card: (card.points, card.suit == trump, card.strength)
    fives = [card for card in choices if card.points == 5]
    if fives and not trick:
        return min(fives, key=lambda card: card.suit == trump)
    if not trick:
        return min(choices, key=cheap)
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


def explain_computer_card(
    player: int, hand: list[Card], trick: Trick, trump: str, card: Card,
    trump_chooser: int | None = None,
    opponent_trumped_suits: set[str] | None = None,
) -> str:
    """Explain a card selected by choose_computer_card before it is played."""
    avoided = opponent_trumped_suits or set()
    partner_winning = partner_is_winning(player, trick, trump)
    if partner_winning:
        reason = "Partner is winning: contribute the highest-value legal card."
    elif trump == NULL_TRUMP:
        if (trick and trick[0][1].rank == "10"
                and team_of(trick[0][0]) != team_of(player)):
            reason = "Null: opponent led an unbeatable 10; play the lowest-value legal card."
        else:
            reason = "Null: play the highest-value legal card, prioritizing 5-point 10s."
    elif card.points == 5 and (
        not trick or partner_is_winning(player, trick, trump)
    ):
        reason = "Play a legal 5-point 10 first, conserving trump on equal points."
    elif not trick:
        reason = (
            "Lead a low-value card, "
            "conserving trump on equal points."
        )
    elif (
        team_of(winning_play(trick, trump)[0])
        == team_of(player)
    ):
        reason = (
            "Partner is winning: contribute "
            "the highest-value legal card."
        )
    elif (
        winning_play(trick + [(player, card)], trump)[0]
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
    if not partner_winning and player == trump_chooser and card.suit == trump:
        reason = "Trump chooser: prioritize legal trump cards. " + reason
    if not partner_winning and trump in SUITS and trump_chooser is not None and team_of(player) != team_of(trump_chooser) and card.suit != trump and any(
        choice.suit == trump for choice in legal_cards(hand, trick, trump)
    ):
        reason = "Opponents chose trump: prefer a legal non-trump card. " + reason
    if not partner_winning and trump != NULL_TRUMP and card.suit not in avoided and any(
        choice.suit in avoided for choice in legal_cards(hand, trick, trump)
    ):
        reason = "Avoid suits previously trumped by opponents. " + reason
    return reason


def explain_computer_trump(trump: str) -> str:
    """Explain the current fixed trump-selection heuristic."""
    if trump == NULL_TRUMP:
        return "high-value cards across several suits; no trump and double match points."
    return "most card points, then card count, then rank strength in its own hand."
