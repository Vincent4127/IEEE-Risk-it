// Team Screen. Asks for the team code once, then follows the game and
// unlocks only on this team's turn.
//
// Testing several teams in one browser: open team.html?slot=2, ?slot=3 …
// Each slot keeps its own login.

import { connect, ref, onValue, get, set, serverTimestamp } from "./firebase.js";
import { ROUNDS, TEAMS } from "./config.js";
import { teamName, teamNumber, ranking, roundCfg, questionNumber, TURNS_PER_ROUND } from "./game.js";
import { $, esc, toast, createLeaderboard, startCountdown } from "./ui.js";
import {
  choicesHTML, verdictHTML, questionTags, teamChip, modeCardsHTML,
  roundSummary, timerHTML, wheelResultLabel,
} from "./views.js";
import { wheelSVG, spin } from "./wheel.js";

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
      return fail("This code is already in use on another laptop. Ask the game master to release it.");
    }
    writeStore(team);
    onJoined(team);
  });
}

// ---------- Game ----------

function play(fb, team) {
  const renderBoard = createLeaderboard($("#leaderboard"));
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
  onValue(ref(fb.db, `actions/${team}`), (s) => {
    action = s.val();
    draw();
  });
  // If the game master releases this laptop, go back to the code screen.
  onValue(ref(fb.db, `claims/${team}`), (s) => {
    if (s.exists() && s.val().uid !== fb.auth.currentUser?.uid) {
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
      toast("That didn't go through. It may no longer be your turn.", "error");
    } finally {
      sending = false;
      draw(true);
    }
  }

  function draw(force = false) {
    if (!live) return;
    renderBoard(live);
    $("#paused").classList.toggle("hidden", live.status !== "paused");
    const score = live.scores?.[team] ?? 0;
    const rank = ranking(live).findIndex((t) => t.id === team) + 1;
    $("#meta").innerHTML = `
      ${teamChip(team, "team-chip--on-dark")}
      <span class="badge badge--on-dark">${score} pts · #${rank}</span>`;

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
  }

  function waiting() {
    const r = ranking(live);
    const rank = r.findIndex((t) => t.id === team) + 1;
    switch (live.phase) {
      case "lobby":
        return panel(`
          <p class="overline">You're in</p>
          <h1 class="title-md">${esc(teamName(team))}</h1>
          <p class="lede">Waiting for the game master to start<span class="dots"></span></p>`);
      case "roundIntro":
        return panel(`
          <p class="overline">Round ${live.round} of ${ROUNDS.length}</p>
          <h1 class="title-md">Round ${live.round}</h1>
          <ul class="facts">${roundSummary(live.round).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
      case "finished":
        return panel(`
          <p class="overline">Game over</p>
          <h1 class="title-md">You finished #${rank}</h1>
          <p class="lede">${live.scores?.[team] ?? 0} points. Thanks for playing!</p>`);
      default: {
        const nextUp = teamOrderIn(live, team);
        return panel(`
          <div class="lock" aria-hidden="true">🔒</div>
          <h1 class="title-md">${esc(teamName(live.activeTeam))}'s turn</h1>
          <p class="lede">${esc(otherStatus())}</p>
          ${nextUp ? `<p class="muted">${esc(nextUp)}</p>` : ""}`, "panel--locked");
      }
    }
  }

  function otherStatus() {
    const n = teamName(live.activeTeam);
    return {
      ready: `Waiting for ${n} to get ready`,
      choose: `${n} is choosing`,
      spinning: `${n} is spinning the wheel`,
      question: `${n} is answering`,
      reveal: "Look at the main screen for the answer",
    }[live.phase] || "Watch the main screen";
  }

  function myTurn() {
    switch (live.phase) {
      case "ready":
        return panel(`
          <p class="overline">Round ${live.round} · Question ${questionNumber(live.turnIndex)}</p>
          <h1 class="title-lg">Your turn!</h1>
          <p class="lede">Press Ready when your team is set.</p>
          <button class="btn btn--gradient btn--xl big-btn" data-ready type="button" ${sending || sent("ready") ? "disabled" : ""}>
            ${sent("ready") ? "Getting your question…" : "Ready"}
          </button>`, "panel--active");
      case "choose":
        return panel(`
          <p class="overline">Round ${live.round} · ${roundCfg(live.round).base} points base</p>
          <h1 class="title-md">How do you want to play?</h1>
          ${modeCardsHTML(live.round, { interactive: !(sending || sent("mode")) })}`, "panel--active");
      case "spinning":
        return panel(`
          <h1 class="title-md">Spinning the wheel…</h1>
          <div class="wheel-wrap wheel-wrap--sm">${wheelSVG()}</div>
          <p class="wheel-result">${esc(wheelResultLabel(live))}</p>`, "panel--active");
      case "question": {
        const done = sent("answer");
        const chosen = done ? Number(action.value) : selected;
        return `
          <div class="qa qa--team">
            <div class="qa__top">
              <div class="qa__tags">${questionTags(live)}</div>
              ${timerHTML("timer--sm")}
            </div>
            <div class="card card--elevated qa__question"><p class="qa__text">${esc(live.question?.text)}</p></div>
            ${choicesHTML(live.question, { selected: chosen, interactive: !done })}
            ${done
              ? `<p class="locked-in">Answer locked in. Look at the main screen!</p>`
              : `<button class="btn btn--gradient btn--xl btn--block" data-submit type="button" ${selected == null || sending ? "disabled" : ""}>Submit answer</button>`}
          </div>`;
      }
      case "reveal":
        return panel(`
          ${verdictHTML(live.result)}
          <p class="lede">The next team is up in a moment.</p>`, "panel--active");
      default:
        return waiting();
    }
  }

  function panel(inner, cls = "") {
    return `<div class="card card--elevated card--pad-lg panel ${cls}">${inner}</div>`;
  }

  function wire() {
    stage.querySelector("[data-ready]")?.addEventListener("click", () => send("ready"));
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
      );
    }
    const wheel = stage.querySelector(".wheel");
    if (wheel && live.wheel) spin(wheel, live.wheel.segment, live.wheel.spinId, live.phaseEndsAt ?? 0, fb.now());
  }
}

// "You're up in 3 turns" helper for teams that are waiting.
function teamOrderIn(live, team) {
  if (live.status !== "running" && live.status !== "paused") return "";
  const n = teamNumber(team) - 1;
  const cur = live.turnIndex ?? 0;
  const teams = TEAMS.length;
  let next = cur - (cur % teams) + n;
  if (next <= cur) next += teams;
  if (next >= TURNS_PER_ROUND) return "";
  const away = next - cur;
  return away === 1 ? "You're up next!" : `You're up in ${away} turns.`;
}
