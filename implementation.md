# Understanding the ManilleCardGame implementation

This guide explains the source code in this checkout as inspected on 10 October 2026. It is written for someone learning Python. It describes how the current implementation works; it does not attempt to reconstruct the exact historical order in which it was written. Where a design benefit is discussed, that is an explanation of the structure visible in the code.

The project is a four-player Manille learning game. One person can play with three computer players, or watch computer play. Players opposite each other are partners. There are 32 cards, eight tricks in a complete deal, and 60 card points available per deal. A **trick** is one round in which each player puts down one card. A **deal** starts with eight cards per player. A **match** accumulates counted points across deals.

The project offers three interfaces: a Python desktop window, a Python terminal game, and a browser game written in JavaScript. The browser game has optional server-based analytics, but its card decisions and gameplay run in the browser.

## Contents

1. [Technologies and architecture](#1-technologies-and-architecture)
2. [Project file map](#2-project-file-map)
3. [Cards and basic Python concepts](#3-cards-and-basic-python-concepts)
4. [Rules, trick winners, and scoring](#4-rules-trick-winners-and-scoring)
5. [Shuffling, dealing, and collecting cards](#5-shuffling-dealing-and-collecting-cards)
6. [Computer strategy](#6-computer-strategy)
7. [Python game models and console mode](#7-python-game-models-and-console-mode)
8. [The Tkinter desktop interface](#8-the-tkinter-desktop-interface)
9. [How play_web.py works](#9-how-play_webpy-works)
10. [The browser implementation](#10-the-browser-implementation)
11. [Translations, accessibility, and history](#11-translations-accessibility-and-history)
12. [Saving data and optional analytics](#12-saving-data-and-optional-analytics)
13. [Tests and validation](#13-tests-and-validation)
14. [Running and packaging the project](#14-running-and-packaging-the-project)
15. [A practical reading and modification guide](#15-a-practical-reading-and-modification-guide)

## 1. Technologies and architecture

The Python application uses the standard library: the modules supplied with Python. Its documented minimum is Python 3.10. There is no Python web framework, database package, or machine-learning dependency needed for ordinary play.

| Technology | Purpose in this project |
| --- | --- |
| Python | Desktop and console gameplay, rules, computer choices, local browser launcher, and Python tests. |
| `dataclasses` | Defines simple objects representing cards and saved tricks. |
| `random` | Shuffling and reproducible test/game sequences. |
| Tkinter, `ttk`, and `Canvas` | Desktop widgets and the drawn card table. Tkinter needs an available graphical desktop. |
| `argparse` | Reads command-line options such as `--console`, `--seed`, and `--port`. |
| `http.server`, `pathlib`, `webbrowser` | Serves the browser files locally and opens their address. |
| HTML and CSS | Browser page structure, appearance, layout, and animations. |
| JavaScript ES modules (`.mjs`) | Browser rules, strategy, game state, controls, translations, and analytics client. |
| Node.js | Runs JavaScript tests and the dedicated local analytics preview. It is not required for ordinary browser play through `play_web.py`. |
| Netlify Functions and `@netlify/blobs` | Optional hosted analytics endpoint, storage, and scheduled cleanup. |
| Docker | Configuration for running the console game in a container; see the packaging caveat below. |

The main organizing idea is **separation of responsibilities**. Rules answer “Which cards are legal?” Strategy answers “Which legal card should the computer choose?” The interface answers “What should the player see, and what should happen after a click?”

```text
Python desktop / console
    manille.py                 interface, flow, and deal objects
       |-- manille_ai.py       computer choices and explanations
       |      `-- manille_core.py
       `-- manille_core.py     cards, legal moves, scoring, dealing

Browser
    play_web.py                delivers files over local HTTP
       `-- web/index.html
              `-- web/app.mjs          interface and action scheduling
                     |-- engine.mjs   Deal and Match objects
                     |      |-- core.mjs
                     |      `-- ai.mjs --> core.mjs
                     |-- i18n.mjs --> locales/*.mjs
                     |-- history-panel.mjs
                     `-- analytics.mjs --> optional Netlify endpoint
```

An arrow here means “uses” or “loads”; Python does not execute the browser's JavaScript. Python and JavaScript contain separate implementations of the game rules. Cross-language tests help keep them consistent.

Keeping the rule module independent of the interface makes it possible to test a tricky card situation without opening a window. Keeping AI separate allows a strategy improvement without redefining legal play. This is a useful pattern for many applications, not just games.

## 2. Project file map

The following are the main source files and their responsibilities. Links are relative to this document, so they work when browsing the repository.

| File or directory | What it serves |
| --- | --- |
| [manille_core.py](manille_core.py) | Card definitions, constants, deck creation, Hindu shuffle, packet dealing, teams, legal-card rules, winners, zero-point detection, and score conversion. |
| [manille_ai.py](manille_ai.py) | Computer card/trump/join decisions, observations of publicly played trumps, and English strategy explanations. |
| [manille.py](manille.py) | Python entry point, console interaction, `ManilleGame`, `BoardDeal`, and `ManilleBoard`. Also re-exports imported rule/AI names for compatibility. |
| [play_web.py](play_web.py) | Small local HTTP launcher for the contents of `web/`. |
| [web/index.html](web/index.html) | Browser table, controls, score areas, history, rules, and analytics panel. |
| [web/style.css](web/style.css) | Card styling, table layout, responsive layouts, floating history, and motion effects. |
| [web/core.mjs](web/core.mjs) | JavaScript equivalents of core rules and helpers, including translatable rule hints. |
| [web/ai.mjs](web/ai.mjs) | JavaScript computer strategies and public-play observations. |
| [web/engine.mjs](web/engine.mjs) | Browser `Deal` and `Match` classes; re-exports core and AI functions. |
| [web/app.mjs](web/app.mjs) | Connects buttons, cards, timers, game objects, rendering, and analytics hooks. |
| [web/i18n.mjs](web/i18n.mjs) | Language selection, translated labels, message formatting, and language persistence. |
| [web/locales/](web/locales/) | English, Dutch, French, and Simplified Chinese dictionaries. |
| [web/history-panel.mjs](web/history-panel.mjs) | Dragging and docking the “At the Table” history panel. |
| [web/analytics.mjs](web/analytics.mjs) | Optional visitor/event tracking and the public analytics panel. |
| [netlify/analytics-service.mjs](netlify/analytics-service.mjs) | Event validation, deduplication keys, aggregate reporting, and expiration. |
| [netlify/functions/manille-analytics.mjs](netlify/functions/manille-analytics.mjs) | Hosted HTTP function connecting the service to Netlify Blobs. |
| [netlify/functions/manille-analytics-cleanup.mjs](netlify/functions/manille-analytics-cleanup.mjs) | Scheduled deletion of old production analytics records. |
| [scripts/preview-analytics.mjs](scripts/preview-analytics.mjs) | Local game plus an in-memory analytics endpoint on port 8767. |
| [test_manille.py](test_manille.py) | Python rule, strategy, dealing, model, and console regression tests. |
| [test_board_ui.py](test_board_ui.py) | Tests the actual Tkinter board and its interactions. |
| [test_web_parity.py](test_web_parity.py) | Compares Python and JavaScript results using Node.js. |
| `web/*.test.mjs` | Browser engine, app, translation, and analytics tests. |
| [netlify/analytics-service.test.mjs](netlify/analytics-service.test.mjs) | Tests analytics service behavior with controlled storage/time. |
| [package.json](package.json), [package-lock.json](package-lock.json) | Node commands/dependency declaration and the resolved dependency versions. |
| [netlify.toml](netlify.toml) | Standalone publish directory and function bundling configuration. |
| [Dockerfile](Dockerfile), [.dockerignore](.dockerignore) | Container instructions and selection of files sent to a Docker build. |
| [README.md](README.md) | User-facing installation, playing, testing, and deployment instructions. |
| `images/` | Documentation images, including the README screenshot. Cards are drawn by the interfaces rather than loaded from that screenshot. |
| [.gitignore](.gitignore) | Excludes local environments, caches, deployment working data, and other generated files from Git. |

Folders such as `.venv/`, `node_modules/`, `__pycache__/`, `.idea/`, `.netlify/`, and `.analytics-preview/` are local environment, cache, editor, or tooling material. They are not the core game design. `.git/` stores version-control history.

## 3. Cards and basic Python concepts

Start with `manille_core.py`: it is small enough to read before the interface.

### Constants and lookups

`SUITS` lists the four suit names. `RANKS` lists ranks from weakest to strongest:

```python
RANKS = ("7", "8", "9", "Jack", "Queen", "King", "Ace", "10")
```

The 10 is the strongest card within its suit. Its position in this tuple is deliberate. A **tuple** is an ordered collection that cannot be changed in place. Uppercase names conventionally identify constants, although Python does not enforce that convention.

`POINTS` is a **dictionary**, mapping each rank to a value. The 7, 8, and 9 score zero; Jack scores 1; Queen 2; King 3; Ace 4; and 10 scores 5. Each suit therefore contains 15 points, and four suits contain 60.

Strength and points are different ideas. Strength decides which card beats another. Points decide how much a captured card contributes. For example, 9 is stronger than 8, but both are worth zero points.

### The Card dataclass

The source defines:

```python
@dataclass(frozen=True)
class Card:
    suit: str
    rank: str
```

A **class** defines a kind of object. `Card("Hearts", "10")` creates one instance with two attributes. `@dataclass` supplies routine methods such as initialization and comparison, so the programmer does not have to write them manually. `frozen=True` prevents ordinary reassignment of its attributes. A card can move between hands and tricks without changing its identity.

The `strength` and `points` methods have `@property`. This lets you write `card.points` rather than `card.points()`: the value is calculated when read. `__str__` defines the readable description used when printing a card.

```python
from manille_core import Card

card = Card("Hearts", "10")
print(card.points)    # 5
print(card.strength)  # 7: its zero-based position in RANKS
```

Python starts indexing at zero. The first rank is at position 0; the eighth is at position 7.

### Lists, tuples, sets, and type hints

The game uses different collections for different jobs:

| Structure | Example | Reason |
| --- | --- | --- |
| List | A player's hand | Cards are removed as they are played. |
| List of lists | Four hands, or two captured-card piles | Groups information by player or team. |
| Tuple | `(player, card)` | Keeps the player number and played card together. |
| Set | Suits an opponent has trumped | Membership matters; duplicates do not. |
| Dictionary | Rank-to-point lookup | Retrieves a value by name. |

`Trick = list[tuple[int, Card]]` gives a readable name to the type of a trick. For example, `[(0, Card("Clubs", "Ace"))]` means player 0 has played the Ace of Clubs.

Annotations such as `hand: list[Card]`, `-> int`, and `str | None` are **type hints**. They explain the expected values to readers and tools. They do not automatically validate every value at runtime. The code explicitly checks important conditions, such as a supplied deck containing all 32 unique cards.

`None` represents an absent value. Before trump selection, `trump` is `None`. After choosing no trump, it is the string `"Null"`. Those are different states: “not chosen yet” versus “chosen to play without a trump suit.”

### Creating a deck

`make_deck()` uses a list comprehension:

```python
return [Card(suit, rank) for suit in SUITS for rank in RANKS]
```

Read this as “for each suit, make a card for each rank.” It is a compact version of two nested `for` loops that append cards to a list. It creates a new ordered deck; shuffling is a separate operation.

## 4. Rules, trick winners, and scoring

### Player numbers and teams

Players are numbered 0, 1, 2, and 3. Partners are 0/2 and 1/3. `team_of(player)` returns `player % 2`; `%` calculates the remainder after division. Even seats belong to team 0 and odd seats to team 1. Displayed team labels generally add one for human-readable numbering.

`(player + 2) % 4` finds a partner. `(dealer + 1) % 4` finds the first leader. Modulo 4 wraps seat 3 back around to seat 0.

### Finding a winner

`winning_play(trick, trump)` uses `max(..., key=...)`. The key gives each play a pair of comparison values:

1. Suit priority: trump receives 2, the led suit receives 1, and other suits receive 0.
2. Rank strength within that priority.

Python compares tuples from left to right. Suit priority is checked first, then rank strength. Consequently a low trump beats a high card of another suit. In Null, no actual card has suit `"Null"`, so the led suit determines the winner.

`partner_is_winning()` checks whether the current winning player is the next player's partner. It is used by both rules and strategy.

### Selecting legal cards

`legal_cards(hand, trick, trump)` returns a list of permitted cards without removing anything from the hand. These are this project's implemented rules; local Manille variants may differ.

The main priorities are:

1. If no card has been led, any card in the hand is legal.
2. If you can follow the led suit, you must do so.
3. While following, if your partner is winning, any follower is allowed, including a lower trump when trump was led.
4. If an opponent is winning, play a higher card of the led suit when possible. However, if a non-trump lead has already been trumped, any card of the led suit is allowed: it cannot beat that trump anyway.
5. If you cannot follow and an opponent is winning, you must play a winning trump when available.
6. If you cannot follow and your partner is winning, trumping is optional.
7. When trump has already been played, avoid a lower trump if a legal alternative exists. When unable to overtrump, discard a non-trump if possible; a lower trump is allowed only when forced. The following-suit exception with a winning partner is handled earlier.

The ordering of these checks matters. “My partner is winning” never lets you ignore following suit. Similarly, a computer preference to conserve trump cannot override a compulsory trump.

Example: Clubs is led, Hearts is trump, and an opponent has trumped. If your hand still contains Clubs, you must play Clubs, but you can choose a low Club. You are not forced to spend a higher Club on a trick already beaten by trump.

### Raw points versus match points

The rule function is:

```python
def match_points(deal_points, trump=None, joined=False):
    multiplier = 2 if trump == NULL_TRUMP or joined else 1
    return max(deal_points - 30, 0) * multiplier
```

Only points above 30 count toward the match. `max(..., 0)` prevents a negative result. Null or joined trump doubles the excess once.

| Raw deal points | Ordinary counted points | Null or joined counted points |
| --- | --- | --- |
| 25 | 0 | 0 |
| 30 | 0 | 0 |
| 42 | 12 | 24 |
| 60 | 30 | 60 |

The expression uses `or`, so even if both flags were supplied directly to the helper, the multiplier would be 2, not 4. Normal game flow allows joining only a suit trump.

There is a current interface difference worth understanding: the desktop board's `running_totals()` includes the live deal's excess and can end a match when that running total reaches 101. The browser `Match.scoreDeal()` adds points and checks 101 only after a completed deal. The console accumulates completed-deal totals but uses its deal limit or user prompt to stop; it has no equivalent automatic 101-point stopping loop. Shared scoring rules do not mean identical stopping behavior in every interface.

## 5. Shuffling, dealing, and collecting cards

### Explicit shuffling on the boards

The desktop and browser boards have a preparation stage. The first deck is ordered; subsequent decks use collected cards. Clicking the deck performs one Hindu shuffle. Dealing uses exactly the deck shown in the preview.

`hindu_shuffle(deck, rng)` treats index 0 as the top. It pulls packets of 1–5 cards and places each new packet above the previously received cards. The final 3–6 cards are placed on top. The cards within each packet retain their order.

It returns packet sizes so the interface can animate the shuffle that actually occurred. Generating a second random sequence for the animation could show a different shuffle from the one used to deal.

`deck[:] = ...` replaces the contents of the existing list. This is different from rebinding `deck = ...`, which would only make the local variable refer to another list.

### Dealing 3–2–3

`deal_hands()` validates the deck and distributes packets of 3, then 2, then 3 cards around the four players, beginning to the dealer's left. Each player ends with eight cards.

Hands are then sorted for display by suit and descending strength. Sorting a hand changes how it is presented; it does not change which player received its cards.

`BoardDeal` and browser `Deal` also support construction without a supplied deck, in which case they shuffle one themselves. Normal board preparation supplies an explicit deck, avoiding an extra hidden shuffle. Console mode instead calls its random generator's ordinary `shuffle()` automatically for each deal.

### Zero-point hands

`zero_point_players()` checks the initial hands. A player with eight zero-point cards requires a redeal. Trump selection and play are blocked until this is resolved. The dealer, deal number, and match totals are retained. The condition is not reapplied to a partially played hand.

### Collection order and invariants

Each completed trick contributes its cards to two different collections:

- `captured[team]` records which team won the cards.
- `game_deck` records cards in chronological trick order and, within a trick, play order.

The second collection becomes the next deck. Keeping it separate from the team piles preserves the actual collection sequence.

At completion, the models verify that all 32 cards and 60 points are accounted for, including uniqueness of the collected deck. Such a condition is an **invariant**: something that should always be true if the program is working correctly. An exception exposes a broken invariant instead of silently continuing with a damaged game.

## 6. Computer strategy

`manille_ai.py` implements a fixed **heuristic**: a sequence of practical decision rules. It is not a trained model, does not call an external AI service, and does not search all future combinations of plays.

The card chooser receives its own hand, the public trick, trump, the trump chooser, and observed vulnerable suits. Although the learning interface can display all hands, the chooser is not passed the other players' hands.

### Card choice, in priority order

`choose_computer_card()` first calls `legal_cards()`. Every subsequent preference operates on that legal set.

1. **Partner winning:** choose the highest-value legal card. Break ties by rank strength, then prefer non-trump. This happens before the other suit preferences.
2. **Null:** normally choose the highest-value legal card. Against an opponent's opening 10, choose the cheapest legal card instead because that led 10 cannot be beaten in Null. Following suit still applies.
3. **Trump chooser:** prefer legal cards of the chosen trump suit if any exist.
4. **Opponents chose trump:** prefer legal non-trumps if available.
5. **Observed vulnerable suits:** within the remaining candidates, avoid suits previously trumped by opponents when an alternative exists.
6. **Leading:** prefer an available 5-point 10; otherwise lead cheaply.
7. **Responding:** take the trick with the cheapest winning candidate, if one exists; otherwise discard the cheapest candidate.

“Cheapest” is encoded with a tuple key: points first, whether the card is trump next, then strength. `min()` or `max()` with a short `lambda` function expresses these comparisons compactly. A **lambda** is simply a small unnamed function.

These choices are understandable teaching heuristics. Feeding a currently winning partner does not guarantee the team will ultimately win: a later opponent can still beat the trick.

### Trump and joining choices

`choose_computer_trump()` chooses Null only with at least four Aces/10s spread across at least three suits and a hand worth at least 24 points. Otherwise it compares suits by their total card points, then number of cards, then combined strength.

`choose_computer_join()` joins a suit trump only with at least five trumps, at least ten points in those trumps, and the trump 10. A human opponent can make their own join/pass choice before play. Joining doubles counted points; it does not change teams or create another trump suit.

### Memory of public plays

`record_trumped_suit()` notices when a player trumps a non-trump lead. It records the led suit for the opposing team. Both partners on that team can then avoid leading that vulnerable suit.

The observation sets belong to each deal/game object and reset for a new deal. They are not shared module-global memory. This prevents one independent game from contaminating another.

`explain_computer_card()` and `explain_computer_trump()` provide English explanations for the desktop presentation. The browser additionally uses `ruleHint()` message descriptors to explain legal obligations in the selected language. A rule explanation and a strategic preference answer different questions.

## 7. Python game models and console mode

### ManilleGame: a complete deal in a loop

`ManilleGame` in `manille.py` runs the terminal version. Its attributes hold the random generator, dealer, totals, deck, names, and observations. `self` means “this particular object.” For example, `self.dealer` is the dealer stored on that game instance.

`play_deal()` shuffles, deals, checks zero-point hands, chooses trump, offers joining, plays eight tricks, verifies card/point conservation, adds counted points, and rotates the dealer.

Nested loops fit terminal interaction: one loop visits the eight tricks and an inner loop visits four players. `read_choice()` keeps asking until the input is a valid numbered option. `choose_human_card()` adds a legality check before accepting the chosen card.

### BoardDeal: one action at a time

`BoardDeal` stores one deal without drawing anything. Its main fields include:

| Attribute | Meaning |
| --- | --- |
| `hands` | Four lists of remaining cards. |
| `dealer`, `leader` | Who chose trump and who leads the current trick. |
| `trump`, `joined_by` | Selected contract and optional joining opponent. |
| `trick` | Cards currently on the table, paired with their players. |
| `captured`, `game_deck` | Team winnings and chronological collection order. |
| `scores` | Raw points for the two teams in this deal. |
| `trumped_suits` | Public observations for the two teams. |
| `trick_number`, `finished` | Progress through the deal. |

`current_player` calculates `(leader + len(trick)) % 4`. It derives the answer from existing state instead of keeping another counter that could become inconsistent.

`choose_trump()`, `join_trump()`, `play()`, and `next_trick()` validate actions before changing state. A second trump selection or an illegal card raises an exception. This protects the model even if the interface accidentally calls it incorrectly.

After the fourth card, `play()` records the winner's points and collected cards, but leaves the trick visible. `next_trick()` separately installs the winner as leader and clears the trick. That separation gives the interface time to display and animate the completed trick.

### Re-exports

`manille.py` imports core and AI names at module level. Existing code can therefore continue to use `from manille import Card`, although `Card` is defined in `manille_core.py`. The browser engine similarly re-exports helpers. This preserves existing import paths while allowing implementation files to be separated.

## 8. The Tkinter desktop interface

`ManilleBoard` creates the window controls, card table, log, and supporting dialogs. Tkinter is imported inside the graphical path so console use does not require initializing a GUI.

The desktop uses a `Canvas` to draw the table and cards. Card suit symbols, abbreviated ranks, positions, colors, and outlines are produced by code. The rendering code scales drawing coordinates for the available area. Card hit areas connect mouse positions to card choices.

This interface is **event driven**. After creating the window, `root.mainloop()` listens for clicks, window changes, and timers. A button callback performs a small action and returns control to Tkinter. A long blocking loop inside a callback would prevent the interface from responding.

The major methods work together as follows:

- `begin_shuffle()`, `shuffle_once()`, and `stop_shuffle()` manage preparation and dealing.
- `set_human_trump()` and `confirm_join()` accept human choices.
- `step()` performs one computer/game action.
- `play_card()` applies a card through the model, writes explanations, updates totals, and checks the match target.
- `render()` redraws the visible state.
- `schedule()` and `tick()` arrange autoplay using `root.after()`.
- `stop()` and `close()` cancel pending callbacks; closing also cancels animation/shuffle timers.

### Animation and control guards

`start_animation()` uses elapsed time from `time.monotonic()` and schedules frames approximately every 16 milliseconds. The expression `p * p * (3 - 2 * p)` smooths the beginning and end of movement. Card play and trick collection have separate animation durations.

Flags such as `shuffling`, `join_pending`, `redeal_pending`, and `animation_progress` prevent actions at the wrong time. These flags collectively describe the application's **state**. For example, an autoplay callback must wait while a human join decision is pending.

The logical capture/scoring happens in the model. The animation shows that result; it must not score the same trick a second time.

### Learning features

All desktop hands are exposed. Legal cards have a gold border, and the log explains obligations and computer choices. Names can be edited and retained between deals in the current board session. Step mode lets the learner inspect each action; autoplay waits for human decisions.

`TrickRecord`, an immutable dataclass, stores the last completed trick with its trump and deal/trick numbers. “Show Last Hand” displays this record inside the existing board. Here “hand” means the previous four-card trick. Reviewing it stops desktop autoplay; returning to the live view does not itself restart autoplay. The record is cleared for a new deal.

## 9. How play_web.py works

This file is the browser launcher, not the browser game engine. It does not import `manille_core` or process card choices.

### Imports

| Import | Job |
| --- | --- |
| `partial` | Pre-fills an argument for the request handler. |
| `SimpleHTTPRequestHandler` | Reads files and sends them as HTTP responses. |
| `ThreadingHTTPServer` | Accepts HTTP requests, using threads to handle requests. |
| `Path` | Builds the web-directory path reliably. |
| `argparse` | Reads launcher options. |
| `webbrowser` | Opens the address in the user's default browser. |

### The custom handler

```python
class WebHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'text/javascript',
    }
```

This is **inheritance**: `WebHandler` takes the standard handler's behavior and changes one detail. `**` copies existing dictionary entries into a new dictionary. The added entry ensures `.mjs` files are served with a JavaScript content type, which browsers need for module loading.

### Startup, line by line in concept

1. `ArgumentParser` uses the module's opening docstring as help text.
2. `--port` accepts an integer and defaults to 8765.
3. `--no-browser` uses `action='store_true'`, so it becomes `True` when the flag is supplied.
4. `Path(__file__).resolve().parent / 'web'` finds `web/` beside the script. It does not assume the terminal is currently in the project directory.
5. The server binds to `127.0.0.1`, the loopback address for this computer.
6. `partial(WebHandler, directory=str(directory))` tells each handler to serve that web directory. `str()` converts the path object to a string.
7. If binding fails, an `OSError` is caught and a helpful error suggests another port.
8. The actual server port is used to build the printed URL.
9. Unless disabled, `webbrowser.open(url)` opens the page.
10. `serve_forever()` keeps accepting requests until interrupted.
11. Ctrl+C raises `KeyboardInterrupt`; the launcher handles it and `finally` closes the server.

`finally` is useful for cleanup because it executes when leaving the `try` block even after an interruption.

The file ends with:

```python
if __name__ == '__main__':
    main()
```

When Python runs the file directly, its special name is `__main__`, so the launcher starts. Importing the file as a module defines its functions and class without automatically starting a server.

The configured document root is `web/`, rather than the whole repository. It is a local development server, with no analytics function or multiplayer service. The browser requests HTML, CSS, and JavaScript; after loading, JavaScript manages the game.

## 10. The browser implementation

### HTML, CSS, and modules

`index.html` defines named elements such as `our-score`, `trick`, and `deal-cards`. `app.mjs` finds them with `document.getElementById()`. The **DOM** is the browser's object representation of the HTML page; changing these objects changes the visible page.

`style.css` controls the appearance using grid/flex layouts and media queries for smaller screens. Cards are HTML elements with classes such as `legal`, `winner`, or `back`. CSS assigns the appearance for each class. There is no frontend framework or mandatory browser build step.

`<script type="module">` enables imports between `.mjs` files. These imports organize JavaScript much like Python imports organize `.py` files. Asset URLs are relative, allowing the game assets to live below a path such as `/manille/`. The analytics endpoint separately uses an absolute path on the same host.

### Deal and Match

The JavaScript `Deal` class mirrors the incremental Python `BoardDeal`: it validates a deck, stores hands/trick/scores, accepts trump/join choices, enforces legal play, and records completed tricks.

Cards are plain objects such as `{suit: 'Hearts', rank: '10'}`. Unlike Python dataclass equality, JavaScript object equality normally compares object identity. The engine uses `cardId()` to identify a requested card in the actual hand, then checks legality using that actual object.

`Match` keeps totals separately from a single deal. `scoreDeal()` rejects unfinished deals and uses a `WeakSet` of already-scored deal objects to prevent duplicate scoring. A WeakSet tracks object membership without keeping otherwise-unused objects alive indefinitely.

### app.mjs: coordinating a changing screen

Module-level variables hold the current deal, match, timers, shuffle preparation, animation flags, and last-trick snapshot. This module coordinates a single browser table; the reusable engine classes are separate from that page state.

`render()` rebuilds the visible hands/trick and updates scores, messages, and enabled controls from current state. `cardView()` creates a card element, labels it, and attaches a click callback where appropriate. Rebuilding a small table of 32 cards is straightforward, though larger applications might update only the parts that changed.

`schedule()` uses `setTimeout()` to arrange the next computer action. `clearTimer()` removes an earlier timeout before scheduling another. `waitingForHuman()` also checks preparation, collection, review, zero-point hands, and human choices. This prevents overlapping turns.

The practical stages are:

```text
prepare deck -> optional shuffle -> deal
    -> zero-point redeal, if required
    -> choose trump -> join/pass, when applicable
    -> play four cards -> collect trick -> next trick
    -> completed deal -> count match points
    -> next deal, or match finished
```

### Trace one human card click

1. `cardView()` attaches a callback to the human card button.
2. `playHuman(card)` checks that the page is accepting a human move.
3. `play(card)` obtains a rule hint and calls `deal.play(card)`.
4. `Deal.play()` validates the card, removes it from the hand, and adds it to the trick.
5. On the fourth card, the model captures cards and adds raw points.
6. The app logs the play and any trick result. On the final card of a deal, it calls `match.scoreDeal()`.
7. `afterAction()` redraws, starts trick collection when needed, and schedules further play.

The button's disabled state helps the user, but the engine still validates the move. This is a useful general design: interface checks improve usability; model checks protect correctness.

### Collection, review, and autoplay

The collection animation measures the table and winning seat positions. It gathers four cards into a stack and moves them toward the winner. Controls wait until collection finishes. After the final trick's collection, the app saves the collected deck.

“Show Last Hand” switches the displayed trick to a copied snapshot. In the browser, the `running` flag is retained while review blocks scheduling. Returning can therefore resume computers if they were running before review. This differs from the desktop's explicit stop behavior.

“Autoplay my hand” lets the same computer strategy handle player 0's trump, join/pass, and cards. It defaults to off. It respects the existing pause state and does not skip deck preparation or a required zero-point redeal. Human-card analytics hooks exclude cards played by this automatic mode.

## 11. Translations, accessibility, and history

`i18n` is a common abbreviation for internationalization. `web/i18n.mjs` supports Dutch, English, French, Simplified Chinese, and a Dutch-plus-English mode, which is the default.

Locale files map stable keys to strings or formatting functions. A message can be represented as `{key, params}` rather than immediately fixed as an English sentence. For example, parameters can carry a player number, suit, or point count. Nested message descriptors allow a translated rule to appear inside another translated message.

The translation helpers store message keys and parameters on DOM elements using `data-i18n-*` attributes. A language change re-translates existing elements, including history entries, without recreating the deal or resetting timers. Internal suit and rank identifiers remain English, so changing language does not change card identity or saved data.

French displays V/D/R/A for face-card abbreviations; the other supported modes use J/Q/K/A. Full names are available in tooltips and accessible labels. Bilingual labels can display Dutch and English on separate lines.

Accessibility support includes real buttons, disabled illegal choices, `aria-label` descriptions, live status areas, and translated tooltips. CSS responds to reduced-motion preferences. Small-screen media queries rearrange the board and reduce the deck preview to four columns at widths up to 480 pixels.

`history-panel.mjs` moves the existing history panel between floating and docked layouts. Pointer events track dragging; positions are constrained to the viewport. Docking changes layout without creating a second history list. `app.mjs` puts new entries first and limits the list to 100 entries.

These features illustrate why presentation belongs outside game rules: dragging a panel or translating “Hearts” should never alter whose turn it is.

## 12. Saving data and optional analytics

### Local browser storage

The game uses `localStorage`, a browser-provided key/value store. Values survive page reloads when storage is available. Structured values are converted to JSON text with `JSON.stringify()` and read back using `JSON.parse()`.

| Key | Stored information |
| --- | --- |
| `manille.lastCollectedDeck.v1` | The last complete collected deck. |
| `manille.language` | Selected language mode. |
| `manille.analytics.visitor.v1` | Random analytics identity and expiry. |
| `manille.analytics.exclude.v1` | Whether future analytics events are excluded. |

The restored deck is checked for exactly 32 valid, unique cards. Invalid data is discarded. Access is wrapped in error handling because storage can be blocked or unavailable.

Reloading does not restore the current match, hand, or totals. It restores the collected deck and language preference where available. “New game” creates a new match while retaining the available collected deck. Storage belongs to an origin: changing host, protocol, or port can give the game a different storage area.

### Analytics client and events

`createTracker()` sends small events using `fetch()`, the browser HTTP API. The event types are `visit`, `start`, `complete`, and `replay`. A random browser ID expires after 30 days. The tracker records a completion only if the deal included a manually played human card. Replay means a human card in a later deal after a participating completion within that page visit.

The report shows estimated unique visitors, visitors who started playing, completed deals with human participation, replaying visitors, and referral domains. It covers today plus the previous 13 UTC dates. UTC is used consistently for date boundaries.

The ordinary localhost game is excluded. The dedicated port-8767 preview enables local test events and keeps them in memory. The exclusion checkbox affects future events; it does not erase already recorded totals.

Network work is asynchronous: gameplay does not wait for an analytics response. Requests have timeouts, limited retries, and error handling. The panel fetches on opening or Refresh, with no continuous polling. Failure produces an unavailable message rather than an invented table of zeros.

### Server functions and storage design

The HTTP function calls `createHandler()` from `analytics-service.mjs`. GET returns aggregate totals. POST validates event type, identifiers, fields, payload size, JSON content type, and same-origin information before storing an event.

Events use deterministic keys containing the date, type, visitor, and relevant deal/source data. `onlyIfNew: true` avoids writing the same key twice. This replaces a fragile “read a counter, add one, write it back” approach in which simultaneous visitors could overwrite each other's increments.

The reporting service reads a bounded window and uses sets to count unique identities and deals. It refuses a window above 50,000 event keys instead of silently reporting partial totals. The endpoint also configures a hosting rate limit.

Stored event keys do not include player names, hands, full referral URLs, or IP addresses. The hosting provider still handles HTTP traffic, and these client-reported measurements remain approximate. Browser storage clearing, multiple devices, and automated requests affect accuracy.

Draft hostnames containing `--` use a separate preview store. Production uses `manille-analytics-v1`. The cleanup function is scheduled for 03:17 UTC daily and removes production records with dates older than the 30-day cutoff. These hosted analytics records are separate from local saved deck data.

## 13. Tests and validation

A **regression test** records an expected behavior so a later edit does not accidentally undo it. This project has several test layers because correct card rules alone do not guarantee correct interface timing.

| Test file | Main responsibility |
| --- | --- |
| `test_manille.py` | Legal moves, strategy priority, Null, joining, shuffles, packet dealing, scoring, conservation, and invalid actions. |
| `test_board_ui.py` | Real Tkinter buttons, clicks, timers, animations, review, redealing, names, and match endings. It skips when Tk/display support is unavailable. |
| `test_web_parity.py` | Python-to-JavaScript comparisons for decisions, scoring, and shuffling. Skips when Node.js is unavailable. |
| `web/engine.test.mjs` | JavaScript rules, strategies, deal and match behavior. |
| `web/app.test.mjs` | Real app handlers using a small simulated DOM and controlled timers. |
| `web/i18n.test.mjs` | Dictionaries, translated messages, and language-switching behavior. |
| `web/analytics.test.mjs` | Tracking, persistence/expiry, opt-out, failures, and analytics presentation. |
| `netlify/analytics-service.test.mjs` | Server validation, deduplication, concurrent events, date windows, expiration, and failures. |

The parity suite creates 100 full deals and compares 3,200 card decisions. It also compares 610 score combinations and 100 shuffles using controlled random draws. Python sends JSON to a Node subprocess, then checks whether the JavaScript results match.

Passing parity demonstrates agreement for those tested cases, not mathematical proof that every possible position is correct. Simulated DOM tests also cannot fully verify actual screen layout. The Tkinter UI tests exercise a real GUI, while browser visual changes still benefit from manual inspection on relevant screen sizes.

Random seeds make failures easier to repeat. Passing a random generator into a function also makes it possible to substitute controlled draws in a test. The analytics code similarly accepts storage, time, and network helpers so tests can avoid production services. This technique is called **dependency injection**: supplying a dependency instead of hiding it inside a function.

Useful commands from the project root, using the Python interpreter configured for the project:

```powershell
python -m unittest test_manille test_web_parity
python -m unittest test_board_ui
npm test
```

Here `python` means that configured interpreter; in PyCharm it may be `.venv\Scripts\python.exe`. `npm test` runs the five JavaScript test files listed in `package.json`. These commands document how to run the checks; this documentation-only change does not claim a new test-suite result.

## 14. Running and packaging the project

From the project root on Windows:

```powershell
py -3 manille.py
py -3 manille.py --console --auto --deals 3 --seed 42
py -3 play_web.py
py -3 play_web.py --no-browser --port 8766
```

In PyCharm, use the project's configured interpreter. `--auto` makes all four Python players computers; on the desktop you still use the preparation and autoplay buttons. `--seed` makes randomness repeatable when the same sequence of operations is performed.

The ordinary Python game has no third-party package requirement. For Node dependency installation and the analytics integration preview:

```powershell
npm ci
npm run preview:analytics
```

`npm ci` installs the locked dependency tree. The preview serves the game and in-memory analytics at `http://127.0.0.1:8767`; stopping it discards its analytics data.

### Static hosting versus hosted analytics

The browser game can be served as static files without Python. The optional shared analytics require the functions and storage connection as well. A static-only server cannot implement the endpoint simply by copying `web/`.

`netlify.toml` describes publishing `web/` as a standalone site. When integrating beneath a larger site, the full parent site must be preserved and the game assets placed under the intended subdirectory. A standalone publish directory is not a complete copy of that larger site. Actual current deployment state is outside the scope of this source-code guide.

The HTML requests no search indexing. That is a search-engine instruction, not authentication or access control.

### Docker configuration caveat in this checkout

The Dockerfile uses `python:3.13-slim`, copies the three Python game modules, and starts console mode. Its default arguments request three computer-only deals.

However, the current `.dockerignore` excludes everything except `manille.py`, `Dockerfile`, and `.dockerignore`. It does not allow `manille_core.py` or `manille_ai.py`, even though the Dockerfile copies them. Those two modules need to be included in the build context before this configuration can build successfully. This guide records the mismatch; it does not change packaging files.

## 15. A practical reading and modification guide

For a first pass through the code, use this order:

1. Read `Card`, `POINTS`, `make_deck()`, and `team_of()` in `manille_core.py`.
2. Work through `winning_play()` using a two-card example.
3. Read `legal_cards()` alongside the follow-suit and partner-winning tests.
4. Read `choose_computer_card()` and observe how strategy starts from legal cards.
5. Read `BoardDeal.play()` to see a move change state.
6. Read `ManilleGame.play_deal()` for an entire game loop without rendering details.
7. Read `ManilleBoard.step()`, `play_card()`, and `schedule()` before studying the larger `render()` method.
8. Read `play_web.py` to understand local serving, then `web/engine.mjs` and the `playHuman()` -> `play()` -> `afterAction()` flow in `web/app.mjs`.
9. Explore translations and analytics after the game itself is clear.

When deciding where an edit belongs:

| Desired change | Starting point |
| --- | --- |
| Change which cards are legal | `manille_core.py` and `web/core.mjs`, plus rule/parity tests. |
| Improve computer strategy | `manille_ai.py` and `web/ai.mjs`, plus strategy/parity tests. |
| Change desktop layout or controls | `ManilleBoard` in `manille.py`. |
| Change browser appearance | `web/style.css`, and HTML/app rendering where structure changes. |
| Change browser control flow | `web/app.mjs`; engine methods if game-state rules change. |
| Add or revise translated text | All relevant `web/locales/*.mjs` dictionaries and translation tests. |
| Change local browser address/launch options | `play_web.py`. |
| Change reporting definitions | Analytics client hooks, shared server service, and their tests. |

For a small beginner experiment, create a few `Card` objects and call `winning_play()` without launching the GUI. Then compare `legal_cards()` for the same hand when a partner versus an opponent is winning. These short examples make the rule priorities visible before animation and event handling add complexity.

The structure has tradeoffs. Separate Python and JavaScript engines make both versions independently runnable, but rule changes need coordinated edits and parity checks. The Python UI remains a large class, while browser page state is held in module-level variables; these are areas to navigate carefully when adding features. The deterministic AI is easy to explain but is not an optimal competitive engine. Persistence intentionally saves selected browser preferences and the deck rather than a complete resumable match.

Keep the central distinction in mind as you read: a card object represents data, a rule function decides what is permitted, a strategy chooses among permitted actions, a deal object applies the action, and an interface displays the resulting state.
