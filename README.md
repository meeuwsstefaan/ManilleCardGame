## Screenshot

![Manille game board](ManilleCardGame.png)

The most popular card game in Flanders, Belgium, is now available — with source code — for the world, for the first time! (06-Oct-2026)

With this app, learning Manille becomes easy.

The game is played with four players, and you are one of them. The game uses a 32-card deck.

## Requirements

Choose a local Python installation for the graphical board, or [Docker for console mode](#run-with-docker-no-local-python-required).

- Python **3.10 or newer**. The app has been tested with Python 3.13.2.
- Tkinter for the graphical board. It is normally included with Python installers from [python.org](https://www.python.org/downloads/) on Windows and macOS. Some Linux distributions require a separate Tkinter package.
- A desktop session to display the board. Console mode works without Tkinter.

The app uses only Python's standard library. No `pip install` command or virtual environment is required. GitHub hosts the source code; download it and run it on your computer.

## Download the app

Choose either method:

### Download ZIP (no Git required)

1. Open [the GitHub repository](https://github.com/meeuwsstefaan/ManilleCardGame).
2. Click **Code → Download ZIP**.
3. Extract the ZIP file. Do not run the app from inside the ZIP.
4. Open a terminal in the extracted folder containing `manille.py`, usually named `ManilleCardGame-main`.

### Clone with Git

If Git is installed, run:

```sh
git clone https://github.com/meeuwsstefaan/ManilleCardGame.git
cd ManilleCardGame
```

## Start the graphical board

Run the command for your operating system from the folder containing `manille.py`.

**Windows — PowerShell or Command Prompt:**

```powershell
py -3 manille.py
```

If the `py` launcher is unavailable, use `python manille.py` instead. Check `python --version` to confirm it is Python 3.10 or newer.

**macOS or Linux — Terminal:**

```sh
python3 manille.py
```

### Play a game

1. Click the deck to animate one shuffle. Click again for another shuffle if desired.
2. Click **Deal cards**. The current deck is dealt in 3–2–3 packets, starting left of the dealer.
3. If you are the dealer, select a suit or **Null**, then click **Choose trump**. Otherwise, use **Step: one action** or **Auto-play** to let the computer choose.
4. If offered a chance to join trump, select the checkbox to join or leave it unchecked to pass, then click **Confirm choice / pass**.
5. Use **Step: one action** to advance the computers one action at a time, or **Auto-play** to let them continue automatically. Auto-play waits for your choices.
6. On your turn, click a card with a **gold border**. These are the legal cards. All hands are visible for learning.
7. After a deal, click **Next deal**, shuffle the deck, and click **Deal cards** again. The board match ends when a team reaches 101 counted points.

Use **Player names...** to change names; they remain in place between deals.

## Other run modes

These examples use the Windows Python launcher. On macOS or Linux, replace `py -3` with `python3`.

**Watch four computer players on the board:**

```powershell
py -3 manille.py --auto --seed 42
```

Click the deck if you want to shuffle, click **Deal cards**, then click **Auto-play**. The `--auto` option selects four computer players; you still control the board buttons. The seed makes the deck sequence repeatable when you use the same number of shuffles.

**Play one deal in the terminal:**

```powershell
py -3 manille.py --console --deals 1
```

Enter the numbered choices shown in the terminal.

**Run three computer-only deals in the terminal:**

```powershell
py -3 manille.py --console --auto --deals 3 --seed 42
```

**Show all command-line options:**

```powershell
py -3 manille.py --help
```

## Run from PyCharm

1. Open the extracted or cloned project folder in PyCharm.
2. Configure a Python 3.10 or newer interpreter with Tkinter available. PyCharm may create a virtual environment; no extra Python packages are needed.
3. Open `manille.py`, right-click in the editor, and select **Run 'manille'**.

## Run with Docker (no local Python required)

Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows/macOS, or Docker Engine on Linux. On Windows, use Linux containers. Python runs inside the container; you do not need to install Python on your computer.

Download or clone the repository as described above, then open a terminal in the folder containing `Dockerfile` and `manille.py`.

**Build the image:**

```sh
docker build -t manille-card-game .
```

The first build downloads the Python base image and requires internet access. Rebuild after changing `manille.py` to include the changes in the image.

**Play one deal yourself:**

```sh
docker run --rm -it manille-card-game --deals 1
```

Enter the numbered choices shown in your terminal. The `-it` options enable interactive input. To play multiple deals with a prompt between them, use a seed without a deal limit:

```sh
docker run --rm -it manille-card-game --seed 42
```

**Watch three computer-only deals (the default):**

```sh
docker run --rm manille-card-game
```

**Choose the number of computer-only deals and a seed:**

```sh
docker run --rm manille-card-game --auto --deals 5 --seed 42
```

**Show the available options:**

```sh
docker run --rm manille-card-game --help
```

The image always starts in console mode. It does not display the Tkinter board or its animations. Running a Tkinter window from a container requires additional display-server setup; use the local Python instructions above for the graphical board. These Docker commands do not require port mappings or shared folders. Each container is removed on exit by `--rm`; match totals last only for that run.

## Troubleshooting

- **Python command not found:** install Python from [python.org](https://www.python.org/downloads/), then reopen your terminal. On Windows, enable the installer options for the Python launcher and adding Python to PATH when offered.
- **Cannot find `manille.py`:** change to the extracted or cloned project folder before running the command.
- **Tkinter missing:** test it with `py -3 -m tkinter` on Windows or `python3 -m tkinter` on macOS/Linux. A small test window should open. On Ubuntu/Debian using the distribution's Python, install it with `sudo apt install python3-tk`. Other Linux distributions or custom Python installations need the Tkinter package matching their interpreter.
- **No graphical display available:** use `--console`, or run the board in a desktop session.

## Run the tests (optional)

From the project folder:

```powershell
py -3 -m unittest test_manille test_board_ui
```

On macOS/Linux, replace `py -3` with `python3`. Board tests open temporary windows and are skipped if Tkinter or a graphical display is unavailable.
