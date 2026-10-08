// Team Screen. Asks for the team code once, then follows the game and
// unlocks only on this team's turn.
//
// Testing several teams in one browser: open team.html?slot=2, ?slot=3 …
// Each slot keeps its own login.

import { connect, ref, onValue, get, set, serverTimestamp } from "./firebase.js";
import { ROUNDS, TEAMS } from "./config.js";
import { teamName, ranking, roundCfg, questionNumber, initials, playersOf, turnsPerRound } from "./game.js";
import { $, esc, toast, createLeaderboard, startCountdown, standings } from "./ui.js";
import {
  choicesHTML, verdictHTML, questionTags, teamChip, modeCardsHTML,
  roundSummary, timerHTML, wheelResultLabel, podiumHTML, possessive, winnerText,
  tieIntro, resultPopHTML, showResultPop,
} from "./views.js";
import { wheelSVG, spin } from "./wheel.js";
import { sfx, soundButton, createMomentSounds } from "./sound.js";

const slot = new URLSearchParams(location.search).get("slot") || "1";
const STORE = `riskit.team.${slot}`;
const stage = $("#stage");

{
  const fb = connect(`team-${slot}`);
  let entered = false;
  fb.onAuth(async (user) => {
    if (!user) {
      fb.signInAnon().catch(() => showError("Couldn't connect. Check the internet connection and refresh."));
      return;
    }
    if (entered) return;
    const saved = readStore();
    if (saved) {
      try {
        const claim = (await get(ref(fb.db, `claims/${saved}`))).val();
        if (claim?.uid === user.uid) {
          entered = true;
          return play(fb, saved);
        }
      } catch { /* not ours any more */ }
      writeStore(null);
    }
    codeForm(fb, user, (team) => {
      entered = true;
      play(fb, team);
    });
  });
}

function readStore() {
  try { return localStorage.getItem(STORE); } catch { return null; }
}
function writeStore(v) {
  try { v ? localStorage.setItem(STORE, v) : localStorage.removeItem(STORE); } catch { /* private mode */ }
}

function showError(msg) {
  stage.innerHTML = `<div class="card card--elevated card--pad-lg notice"><h1 class="h3">${esc(msg)}</h1></div>`;
}

// ---------- Code entry ----------

function codeForm(fb, user, onJoined) {
  stage.innerHTML = `
    <form class="card card--elevated card--pad-lg code-card" novalidate>
      <div>
        <p class="overline" style="color:var(--color-brand)">Welcome to Risk It</p>
        <h1 class="h1">Enter your team code</h1>
        <p class="muted">It's on the card you got at the entrance. You only need to enter it once.</p>
      </div>
      <label class="field">
        <span class="field__label">Team code</span>
        <input class="control control--lg code-input" name="code" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="K7Q2-MX" maxlength="9" required autofocus>
      </label>
      <p class="field__error hidden" data-error></p>
      <button class="btn btn--gradient btn--xl btn--block" type="submit">Join the game</button>
    </form>`;
  const form = stage.querySelector("form");
  const input = form.code;
  const err = form.querySelector("[data-error]");
  input.addEventListener("input", () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    input.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    input.removeAttribute("aria-invalid");
    err.classList.add("hidden");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove("hidden");
      input.setAttribute("aria-invalid", "true");
      btn.disabled = false;
    };
    const btn = form.querySelector("button");
    if (!code) return fail("Type your team code.");
    btn.disabled = true;
    let team;
    try {
      team = (await get(ref(fb.db, `codes/${code}`))).val();
    } catch {
      return fail("Couldn't check the code. Check the internet connection.");
    }
    if (!team) return fail("That code isn't right. Check your card and try again.");
    try {
      await set(ref(fb.db, `claims/${team}`), { uid: user.uid, code, at: serverTimestamp() });
    } catch {
      return fail("This code is already in use on another device. Ask the game master to release it.");
    }
    writeStore(team);
    onJoined(team);
  });
}

// ---------- Game ----------

function play(fb, team) {
  soundButton($("#soundBtn"));
  const playMoment = createMomentSounds(fb.now);
  const renderBoard = createLeaderboard($("#leaderboard"), { me: team });
  $("#side").classList.remove("hidden");
  let live = null;
  let action = null;
  let selected = null;
  let sending = false;
  let viewKey = "";
  let lastTurn = null;
  let stopTimer = () => {};

  onValue(ref(fb.db, "live"), (s) => {
    live = s.val() || { status: "lobby", phase: "lobby", round: 1, turnIndex: 0 };
    draw();
  });
  let roster = null;
  let rosterBlocked = false;
  onValue(ref(fb.db, "roster"), (s) => {
    roster = s.val() || {};
    rosterBlocked = false;
    draw(true);
  }, () => {
    // The published database rules are older than this version of the game.
    rosterBlocked = true;
    draw(true);
  });
  onValue(ref(fb.db, `actions/${team}`), (s) => {
    action = s.val();
    draw();
  });
  // If the game master releases this device, go back to the code screen.
  onValue(ref(fb.db, `claims/${team}`), (s) => {
    if (!s.exists() || s.val().uid !== fb.auth.currentUser?.uid) {
      writeStore(null);
      location.reload();
    }
  }, () => {
    writeStore(null);
    location.reload();
  });

  const sent = (type) => action && live && action.turnId === live.turnId && action.type === type;

  async function send(type, value = null) {
    if (sending) return;
    sending = true;
    draw(true);
    try {
      await set(ref(fb.db, `actions/${team}`), { type, value, turnId: live.turnId, at: serverTimestamp() });
    } catch {
      // Still this team's turn, so the database refused the action itself:
      // its published rules are older than this version of the game.
      const stillMine = live.status === "running" && live.activeTeam === team;
      toast(stillMine
        ? "The database refused this. Its rules need updating: ask the game master to publish database.rules.json (README, step 5)."
        : "That didn't go through. It may no longer be your turn.", "error");
    } finally {
      sending = false;
      draw(true);
    }
  }

  function draw(force = false) {
    if (!live) return;
    renderBoard(live, roster, { blocked: rosterBlocked });
    $("#paused").classList.toggle("hidden", live.status !== "paused");
    const score = live.scores?.[team] ?? 0;
    const me = myPlace();
    $("#meta").innerHTML = `
      ${teamChip(team, "team-chip--on-dark")}
      <span class="my-score" aria-label="${score} points, ${me ? `place ${me.place} of ${me.of}` : "watching this game"}">
        <span class="my-score__pts"><b>${score}</b> pts</span>
        ${me
          ? `<span class="my-score__rank ${me.medal ? `my-score__rank--${me.medal}` : ""}">#${me.place}<small> of ${me.of}</small></span>`
          : `<span class="my-score__rank">Watching</span>`}
      </span>`;

    const mine = live.activeTeam === team;
    if (live.turnId !== lastTurn) {
      lastTurn = live.turnId;
      selected = null;
    }
    const key = [live.status === "paused" ? "running" : live.status, live.phase, mine, live.turnId,
      live.wheel?.spinId, live.question?.id, live.result?.outcome, action?.type, action?.turnId, selected, sending].join("|");
    if (key === viewKey && !force) return;
    viewKey = key;
    stopTimer();
    stopTimer = () => {};
    stage.innerHTML = mine ? myTurn() : waiting();
    wire();
    playMoment(live);
  }

  // This team's place among the teams on the board, or null when it isn't
  // playing (it joined after the start).
  function myPlace() {
    const board = standings(live, { ...roster, [team]: true });
    const row = board.find((t) => t.id === team);
    return row ? { place: row.place, of: board.length, medal: row.medal } : null;
  }



  function waiting() {
    const rank = myPlace()?.place ?? 0;
    switch (live.phase) {
      case "lobby":
        return panel(`
          <span class="me-avatar" aria-hidden="true">${esc(initials(teamName(team)))}</span>
          <div>
            <p class="overline">You're in</p>
            <h1 class="title-md">${esc(teamName(team))}</h1>
          </div>
          <p class="lede">Waiting for the game master to start<span class="dots"></span></p>
          <ol class="round-list" aria-label="The rounds">
            ${ROUNDS.map((rd) => `
              <li><span class="round-list__num">${rd.number}</span>
                <span class="round-list__text">${roundSummary(rd.number).map(esc).join(" · ")}</span></li>`).join("")}
          </ol>`);
      case "roundIntro":
        if (live.tiebreak) {
          const t = tieIntro(live);
          const inIt = live.tiebreak.alive.includes(team);
          return panel(`
            <p class="overline">${esc(t.over)}</p>
            <h1 class="title-lg">${t.title}</h1>
            <p class="lede">${inIt ? "You're in it: one question each, highest tie-break score wins." : "The tied teams play it off for first place."}</p>
            <ul class="facts">${t.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
        }
        return panel(`
          <p class="overline">Round ${live.round} of ${ROUNDS.length}</p>
          <h1 class="title-lg">Round ${live.round}</h1>
          <ul class="facts">${roundSummary(live.round).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
      case "finished":
        return `
          <div class="finish">
            <p class="overline finish__over">Game over</p>
            <h1 class="title-lg">${rank ? `You finished #${rank}` : esc(winnerText(live, roster))}</h1>
            <p class="lede">${live.scores?.[team] ?? 0} points. Thanks for playing!</p>
            ${podiumHTML(live, roster)}
          </div>`;
      default:
        return watch();
    }
  }

  // Another team's turn: who is playing, what they're doing, and the same
  // wheel, question and answer the main screen shows.
  function watch() {
    const n = teamName(live.activeTeam);
    const nextUp = teamOrderIn(live, team);
    const head = `
      <div class="watch__head">
        <span class="watch__avatar" aria-hidden="true">${esc(initials(n))}</span>
        <div class="watch__who">
          <p class="watch__name">${esc(possessive(n))} turn</p>
          <p class="watch__status"><span class="live-dot" aria-hidden="true"></span>${esc(otherStatus())}</p>
        </div>
        ${nextUp ? `<span class="next-up ${nextUp.startsWith("You're up next") ? "next-up--now" : ""}">${esc(nextUp)}</span>` : ""}
      </div>`;
    const upNext = nextUp.startsWith("You're up next");
    const robbed = live.target === team && (live.phase === "question" || live.phase === "reveal");
    const banner = robbed
      ? `<div class="get-ready get-ready--robbed" role="status"><span class="get-ready__title">🏴‍☠️ ${esc(n)} is robbing you!</span><span class="get-ready__sub">Right answer: you lose 2. Wrong: you get +1.</span></div>`
      : upNext
        ? `<div class="get-ready" role="status"><span class="get-ready__title">You're next. Get ready!</span><span class="get-ready__sub">Your turn starts as soon as ${esc(n)} finishes.</span></div>`
        : "";
    let body = "";
    if (live.phase === "ready") {
      const me = myPlace();
      const st = live.stats?.[team] ?? {};
      body = `
        <dl class="me-strip">
          <div><dt>Your score</dt><dd>${live.scores?.[team] ?? 0}</dd></div>
          <div><dt>Your place</dt><dd>${me ? `#${me.place}<small> of ${me.of}</small>` : "Watching"}</dd></div>
          <div><dt>Correct</dt><dd>${st.correct ?? 0}</dd></div>
        </dl>`;
    } else if (live.phase === "choose") {
      body = modeCardsHTML(live.round);
    } else if (live.phase === "spinning") {
      body = `
        <div class="wheel-wrap wheel-wrap--sm">${wheelSVG()}</div>
        <p class="wheel-result">${esc(wheelResultLabel(live))}</p>
        ${resultPopHTML(live)}`;
    } else if (live.phase === "target") {
      body = `<div class="moment"><span class="big-emoji" aria-hidden="true">🏴‍☠️</span><p class="moment__title">Steal 2!</p><p class="moment__sub">${esc(n)} is choosing who to rob. It could be you.</p></div>`;
    } else if (live.phase === "drink") {
      body = `<div class="moment"><span class="big-emoji" aria-hidden="true">🧪</span><p class="moment__title">Mystery Drink!</p><p class="moment__sub">${esc(n)} is taking the drink.</p></div>`;
    } else if (live.phase === "reveal" && live.result?.outcome === "lucky") {
      body = `<div class="moment"><span class="big-emoji" aria-hidden="true">🍀</span><p class="moment__title">Lucky Point!</p><p class="moment__sub">${esc(n)} gets +1 with no question.</p></div>`;
    } else if ((live.phase === "question" || live.phase === "reveal") && live.question) {
      body = `
        <div class="qa qa--team qa--watch">
          <div class="qa__top">
            <div class="qa__tags">${questionTags(live)}</div>
            ${live.phase === "question" ? timerHTML("timer--sm") : verdictHTML(live.result)}
          </div>
          <div class="card card--elevated qa__question"><p class="qa__text">${esc(live.question.text)}</p></div>
          ${choicesHTML(live.question, { result: live.phase === "reveal" ? live.result : null })}
        </div>`;
    }
    return `<div class="watch">${banner}${head}${body}</div>`;
  }

  function otherStatus() {
    const n = teamName(live.activeTeam);
    return {
      ready: `Waiting for ${n} to get ready`,
      choose: `${n} is choosing`,
      spinning: `${n} is spinning the wheel`,
      target: `${n} is choosing who to rob`,
      drink: `${n} is taking the mystery drink`,
      question: `${n} is answering`,
      reveal: "Here's the answer",
    }[live.phase] || "Watch the main screen";
  }

  function myTurn() {
    switch (live.phase) {
      case "ready":
        return panel(`
          <p class="overline">${live.tiebreak ? `⚔️ Sudden death · Cycle ${live.tiebreak.cycle}` : `Round ${live.round} · Question ${questionNumber(live.turnIndex, live)}`}</p>
          <h1 class="title-xl your-turn">Your turn!</h1>
          <p class="lede">Press Ready when your team is set.</p>
          <button class="btn btn--gradient btn--xl big-btn" data-ready type="button" ${sending || sent("ready") ? "disabled" : ""}>
            ${sent("ready") ? "Getting your question…" : "Ready"}
          </button>`, "panel--active panel--turn");
      case "choose":
        return `
          <div class="decide">
            <p class="overline decide__over">Round ${live.round} · Your turn</p>
            <h1 class="title-lg">How do you want to play?</h1>
            ${modeCardsHTML(live.round, { interactive: !(sending || sent("mode")), stakes: true })}
          </div>`;
      case "spinning":
        return `
          <div class="decide">
            <p class="overline decide__over">You took the risk</p>
            <h1 class="title-md">Spinning the wheel…</h1>
            <div class="wheel-wrap">${wheelSVG()}</div>
            <p class="wheel-result">${esc(wheelResultLabel(live))}</p>
            ${resultPopHTML(live)}
          </div>`;
      // Steal 2: pick any other playing team; they can go below zero.
      case "target": {
        const chosen = sent("target");
        return `
          <div class="decide">
            <p class="big-emoji" aria-hidden="true">🏴‍☠️</p>
            <h1 class="title-lg">Steal 2! Choose who to rob</h1>
            <p class="lede decide__lede">Right answer: you +2, them −2. Wrong: they get +1.</p>
            <div class="target-pick">${playersOf(live).filter((id) => id !== team).map((id) => `
              <button class="target-btn ${chosen && action.value === id ? "is-chosen" : ""}" type="button" data-target="${id}" ${chosen || sending ? "disabled" : ""}>
                <span class="target-btn__name">${esc(teamName(id))}</span>
                <span class="target-btn__pts">${live.scores?.[id] ?? 0} pts</span>
              </button>`).join("")}</div>
            ${chosen ? `<p class="locked-in">Target locked: ${esc(teamName(action.value))}. Your question is coming!</p>` : ""}
          </div>`;
      }
      case "drink":
        return panel(`
          <p class="big-emoji" aria-hidden="true">🧪</p>
          <h1 class="title-lg">Mystery Drink!</h1>
          <p class="lede">Take the drink. Your quick question (10 seconds) starts as soon as the game master confirms.</p>
          <p class="drink-note">Right answer: +2 · Wrong: 0</p>`, "panel--active");
      case "question": {
        const done = sent("answer");
        const chosen = done ? Number(action.value) : selected;
        return `
          <div class="qa qa--team">
            <div class="qa__top">
              <div class="qa__tags">${questionTags(live)}</div>
              ${timerHTML()}
            </div>
            <div class="card card--elevated qa__question"><p class="qa__text">${esc(live.question?.text)}</p></div>
            ${choicesHTML(live.question, { selected: chosen, interactive: !done })}
            ${done
              ? `<p class="locked-in">Answer locked in. Look at the main screen!</p>`
              : `<button class="btn btn--gradient btn--xl btn--block" data-submit type="button" ${selected == null || sending ? "disabled" : ""}>Submit answer</button>`}
          </div>`;
      }
      case "reveal":
        if (live.result?.outcome === "lucky") {
          return panel(`
            <p class="big-emoji" aria-hidden="true">🍀</p>
            <h1 class="title-lg">Lucky Point!</h1>
            ${verdictHTML(live.result)}
            <p class="lede">No question this time. The next team is up in a moment.</p>`, "panel--active");
        }
        if (!live.question) {
          return panel(`
            ${verdictHTML(live.result)}
            <p class="lede">The next team is up in a moment.</p>`, "panel--active");
        }
        return `
          <div class="qa qa--team">
            <div class="qa__top qa__top--center">${verdictHTML(live.result)}</div>
            <div class="card card--elevated qa__question"><p class="qa__text">${esc(live.question.text)}</p></div>
            ${choicesHTML(live.question, { result: live.result, picked: "Your answer" })}
            <p class="after-note">The next team is up in a moment.</p>
          </div>`;
      default:
        return waiting();
    }
  }

  function panel(inner, cls = "") {
    return `<div class="card card--elevated card--pad-lg panel ${cls}">${inner}</div>`;
  }

  function wire() {
    stage.querySelector("[data-ready]")?.addEventListener("click", () => send("ready"));
    stage.querySelectorAll("[data-target]").forEach((b) =>
      b.addEventListener("click", () => send("target", b.dataset.target)));
    stage.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => send("mode", b.dataset.mode)));
    stage.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => {
        selected = Number(b.dataset.choice);
        draw();
      }));
    stage.querySelector("[data-submit]")?.addEventListener("click", () => {
      if (selected != null) send("answer", selected);
    });

    const timer = stage.querySelector("[data-timer]");
    if (timer) {
      stopTimer = startCountdown(
        timer,
        () => live.phaseEndsAt ?? 0,
        (live.question?.seconds ?? 30) * 1000,
        fb.now,
        () => (live.status === "paused" ? live.pausedRemaining ?? 0 : null),
        (secs) => { if (live.phase === "question" && secs > 0 && secs <= 5) sfx.tick(secs); },
      );
    }
    const wheel = stage.querySelector(".wheel");
    if (wheel && live.wheel) spin(wheel, live.wheel.segment, live.wheel.spinId, live.wheel.landsAt ?? (live.phaseEndsAt ?? 0) - 400, fb.now(), () => showResultPop(stage, (live.phaseEndsAt ?? 0) - fb.now()));
  }
}

// "You're up in 3 turns" helper for teams that are waiting. A team that
// joined after the start has no turns and only watches.
function teamOrderIn(live, team) {
  if (live.status !== "running" && live.status !== "paused") return "";
  if (live.tiebreak) {
    const alive = live.tiebreak.alive;
    const n = alive.indexOf(team);
    if (n < 0) return "";
    const away = n - (live.tiebreak.index ?? 0);
    return away === 1 ? "You're up next!" : away > 1 ? `You're up in ${away} turns.` : "";
  }
  const players = playersOf(live);
  const n = players.indexOf(team);
  if (n < 0) return "You joined after the start, so you're watching this game.";
  const cur = live.turnIndex ?? 0;
  const teams = players.length;
  let next = cur - (cur % teams) + n;
  if (next <= cur) next += teams;
  if (next >= turnsPerRound(live)) return "";
  const away = next - cur;
  return away === 1 ? "You're up next!" : `You're up in ${away} turns.`;
}
