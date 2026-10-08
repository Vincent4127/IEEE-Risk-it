# Risk It

A live quiz game for the IEEE UOB Student Branch. It's plain HTML, CSS and
JavaScript, with Firebase Realtime Database keeping every screen in sync.
The look (colours, Karla and Roboto fonts, buttons, cards and leaderboard)
follows the IEEE UOB website.

| Page | Who uses it |
| --- | --- |
| `display.html` | **Main Display** on the projector device. It also runs the game, so keep it open the whole time. |
| `team.html` | **Team Screen** on each team's device. |
| `admin.html` | **Admin Panel** for the game master: start, pause, skip, fix scores, codes, questions. |
| `index.html` | A start page that links to the three above. |

## Files

```
css/theme.css          colours, fonts and spacing from the IEEE UOB site
css/components.css     buttons, cards, badges, forms, leaderboard, podium
css/screens.css        layouts for the display, team and admin pages
js/config.js           ALL game rules: teams, points, timers, wheel, All In, ties
js/firebase-config.js  your Firebase keys (step 3)
js/game.js             turn order, scoring, question drawing
js/engine.js           runs the game automatically (on the Main Display)
js/display.js, team.js, admin.js   one script per page
js/views.js, ui.js, wheel.js       shared pieces
questions/questions.json  300 sample test questions from Open Trivia DB (replace with the real ones)
database.rules.json    database security rules (step 5)
```

## Try it now (demo mode, no setup)

While `js/firebase-config.js` still has the `PASTE_HERE` placeholders, the
game runs in **demo mode**: everything lives in your browser and syncs
between its tabs. Nothing is shared with other computers.

1. In this folder run `python serve.py`, then open
   <http://localhost:8000/admin.html> and sign in (any password works).
2. Click **Quick setup** to load `questions/questions.json` and make codes.
3. Click **Open Main Display** and sign in there too.
4. Click **Bots: off** to turn the bots on. They play for every team that
   hasn't joined.
5. To play a team yourself, click **Open a team screen** and type that team's
   code from the Access codes table. Use `team.html?slot=2` and so on for
   more teams.
6. Back in the Admin Panel, click **Start game**.

To start over, click **Reset game**. Once you paste real Firebase keys, demo
mode turns off on its own.

## One-time setup (about 5 minutes)

1. Go to <https://console.firebase.google.com>, click **Add project**, name it
   (for example `risk-it`). You can turn Google Analytics off.
2. **Build → Realtime Database → Create database.** Pick a location close to
   you (for example `europe-west1`) and choose **Start in locked mode**.
3. **Project settings (gear icon) → Your apps → Web (`</>`)**. Register the app
   (no hosting needed yet), then copy the values from `firebaseConfig` into
   `js/firebase-config.js`. Make sure `databaseURL` is filled in.
4. **Build → Authentication → Get started → Sign-in method.** Enable
   **Anonymous** and **Email/Password**. Then open **Users → Add user**:
   - Email: `host@riskit.game` (it doesn't need to be a real inbox)
   - Password: choose one. This is the game master's password.

   To use a different email, change `HOST_EMAIL` in `js/config.js` **and**
   every `host@riskit.game` in `database.rules.json`.
5. **Realtime Database → Rules.** Replace everything with the contents of
   `database.rules.json` and click **Publish**.

## Running it on your computer

The pages use JavaScript modules, so they must be opened through a small
local web server (double-clicking the HTML files won't work). In this folder:

```
python serve.py
```

Then open <http://localhost:8000>. `serve.py` turns the browser's caching off,
so every refresh shows your latest changes.

**Testing all the teams in one browser:** open `team.html?slot=1`,
`team.html?slot=2`, … `team.html?slot=10` in separate tabs. Each slot keeps
its own login.

## Before the event

1. Open **Admin Panel** and sign in.
2. **Question bank:** click **Upload file…** and pick your questions file (or
   **Load questions/questions.json** on this computer). The table shows how many questions
   are left in each pool. Orange numbers mean a pool could run short for the
   number of teams that have joined.
3. **Access codes:** click **Generate codes**, then **Print cards**. Hand one
   card to each team.
4. Open **Main Display** on the projector device and sign in. Click
   **Full screen** and **Tap for sound** in its header. Keep this page open:
   it runs the game.
5. Teams scan the QR code on the Main Display (or open `team.html`) and type
   their code once. The device then stays locked to that team, even after a
   refresh. The Main Display lobby shows who has joined.
6. In the Admin Panel, click **Start game**. Only the teams that have joined
   by then take turns; a team that joins later can watch. Everything after
   that is automatic.

If a team needs to switch devices, click **Release** next to their name in
the Admin Panel. Their code then works on a new device.

## During the game

The scoring follows *Risk It - Scoring & Risk Wheel Weights*:

| Round | Choice | Right | Wrong or no answer |
| --- | --- | --- | --- |
| 1 | none | +1 | 0 |
| 2 and 3 | 🛡️ Safe | +1 | 0 |
| 2 and 3 | 🔥 Risk it: spin the wheel first | see below | see below |
| 4 | 🛡️ Normal | +1 | 0 |
| 4 | 💰 All In (same question) | +4 | −4 |

| Wheel | Chance | Right | Wrong or no answer |
| --- | --- | --- | --- |
| 🎲 Double or Nothing | 30% | +2 | −1 |
| 🏴‍☠️ Steal 2 | 25% | +2, target −2 | target +1 |
| ⚡ Double | 20% | +2 | 0 |
| 🧪 Mystery Drink | 20% | +2 | 0 |
| 🍀 Lucky Point | 5% | +2 at once, no question | |

- **Steal 2:** the team picks any other playing team on its device before
  the question. The target can go to zero or below.
- **Mystery Drink:** a dialog opens on the **Admin Panel**. Hand over the
  drink, then click **Drink done: show the question**. The quick question
  (from the `drink` pool) has 10 seconds. Keep the Admin Panel open during
  the game for this.
- **A tie for first after Round 4:** sudden death between the tied teams
  only. One question each per cycle, +1 tie-break point if right; after
  each cycle only the teams with the most tie-break points stay in, until one
  is left. No wheel and no All In.

The points, chances and timers are all in `js/config.js`.

**Sounds** are in `assets/sounds`: the drum roll, Double or Nothing (dice),
Mystery Drink (potion), Lucky Point and the All In cash register. To change
one, replace the file with another of the same name. Steal 2, Double and the
Risk it suspense are made in the browser. When the wheel lands, its result
shows in the middle of every screen for `DURATIONS.result` seconds (5)
before the next step.

## Putting it online (optional)

Firebase Hosting is free, and it's set up so the `questions/` folder is
**not** uploaded (that file has the answers):

```
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project
firebase deploy
```

You get a link like `https://risk-it.web.app`. Online, upload the questions
with **Upload file…** in the Admin Panel.

**Before every deploy, run `python tools/stamp.py`.** It gives every file a
new version number, so browsers that already opened the game fetch the update
as one set instead of mixing old and new files (which stops a page working).
If a page ever does load badly, it shows a banner with a Reload button.

Avoid GitHub Pages unless you remove `questions/questions.json` first, because
GitHub Pages would publish the answers.

## The question file

The questions come from *Risk_It_10_Teams_Question_Bank_CORRECTED.pdf*
(287 questions). They live in `questions/questions.json` **on the game
master's computer only**: the file has the answers and this repository is
public, so `.gitignore` keeps it out of git and Firebase Hosting skips the
folder. Load it in the Admin Panel with **Load questions/questions.json**
(locally) or **Upload file…** (online, or from any other computer).

```json
{
  "questions": [
    { "id": "R2-C1-T01-S", "round": 2, "pool": "safe", "category": "Business", "seconds": 20,
      "text": "Which company is famous for the slogan Just Do It?",
      "choices": ["Adidas", "Nike", "Puma", "Reebok"], "answer": "B" },
    { "id": "DRINK-01", "pool": "drink", "seconds": 10,
      "text": "What is 15 percent of 200?", "answerText": "30" }
  ]
}
```

| `pool` | Used for |
| --- | --- |
| `normal` | Rounds 1 and 4 (Normal and All In share it) |
| `safe` | Rounds 2 and 3, 🛡️ Safe |
| `risk` | Rounds 2 and 3, 🔥 Risk it (Double or Nothing, Steal 2, Double) |
| `drink` | 🧪 Mystery Drink: no choices, answered out loud, `answerText` instead of `answer` |
| `tiebreak` | ⚔️ Sudden death |

- `round` (1 to 4) for `normal`, `safe` and `risk`; none for `drink` and `tiebreak`.
- `seconds`: the question's own timer.
- `answer`: a letter (`"A"` to `"D"`) or a number (0 to 3).
- `image` (optional): a picture shown with the question, for example
  `"assets/questions/R2-C4-T08-S.webp"`. Pictures are in `assets/questions`.

Each turn draws a random unused question from its pool and never repeats
one. When the drink questions run out, the wheel stops landing on Mystery
Drink. A drink question shows an **Answered** button on the team's device;
the Admin Panel then asks the game master **Correct** or **Wrong**.

## Changing the rules

Everything is in `js/config.js`: team names, points per round, timers per
difficulty, how long the reveal and wheel screens stay up, wheel segments and
their chances, All In points and the tie-break. Save the file and refresh
the open pages.

## Security

- Team codes are only in the database, never in the code. A team can look up
  a code only if it already knows it.
- A team device can only press Ready, choose, or submit on its own turn.
- Answers live in a part of the database only the game master's login can
  read. Team devices receive the correct answer only after the reveal.
