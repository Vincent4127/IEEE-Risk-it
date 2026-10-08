// Main Display (projector). Shows the game and runs the engine.

import { connect, ref, onValue, set } from "./firebase.js";
import { HOST_EMAIL, TEAMS, ROUNDS, QUESTIONS_PER_TEAM } from "./config.js";
import { Engine } from "./engine.js";
import { teamName, initials, questionNumber, turnsPerRound, playersOf } from "./game.js";
import { $, esc, toast, createLeaderboard, startCountdown, hostLogin } from "./ui.js";
import {
  choicesHTML, verdictHTML, questionTags, teamChip, modeCardsHTML,
  roundSummary, timerHTML, wheelResultLabel, podiumHTML, possessive, winnerText,
  choiceQuestion, tieIntro, resultPopHTML, showResultPop, questionCardHTML, openNoteHTML, stealTerms,
} from "./views.js";
import { wheelSVG, spin } from "./wheel.js";
import { sfx, soundButton, soundPrompt, createMomentSounds } from "./sound.js";

const QR_LIB = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm";
// The address teams open: the team page next to this one.
const TEAM_URL = new URL("team.html", location.href).href;

// Full screen on and off from the header (instead of F11).
const FULL_ON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const FULL_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;
function fullscreenButton(btn) {
  if (!document.fullscreenEnabled) { btn.hidden = true; return; }
  const paint = () => {
    const on = !!document.fullscreenElement;
    btn.innerHTML = `${on ? FULL_OFF : FULL_ON}<span class="tool-btn__label">${on ? "Exit full screen" : "Full screen"}</span>`;
  };
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", paint);
  paint();
}

const stage = $("#stage");
const meta = $("#meta");

{
  const fb = connect("host");
  let started = false;

  fb.onAuth((user) => {
    const ok = user && user.email === HOST_EMAIL;
    $("#login").classList.toggle("hidden", ok);
    if (!ok) {
      if (user) fb.signOut();
      hostLogin($("#login"), fb, "Main Display");
      return;
    }
    if (!started) {
      started = true;
      run(fb);
    }
  });
}

function run(fb) {
  const engine = new Engine(fb, {
    onOwnerChange: (owner) => $("#ownerBanner").classList.toggle("hidden", owner),
    onWarning: (msg) => toast(msg, "error"),
  });
  engine.start();
  $("#takeOver").addEventListener("click", () => engine.takeOver());

  soundButton($("#soundBtn"));
  soundPrompt();
  const playMoment = createMomentSounds(fb.now);
  fullscreenButton($("#fullBtn"));

  const renderBoard = createLeaderboard($("#leaderboard"));
  let live = null;
  let claims = {};
  let viewKey = "";
  let stopTimer = () => {};

  let roster = null;
  let rosterBlocked = false;
  let rosterWarned = false;
  onValue(ref(fb.db, "claims"), (s) => {
    claims = s.val() || {};
    // Publish who has joined (team ids only, never the codes) for the
    // team screens' leaderboards.
    set(ref(fb.db, "roster"), Object.fromEntries(Object.keys(claims).map((id) => [id, true]))).catch(() => {
      if (rosterWarned) return;
      rosterWarned = true;
      toast("Couldn't share who has joined: the database rules need updating (README, step 5).", "error");
    });
    if (live?.status === "lobby") draw(true);
  });
  onValue(ref(fb.db, "roster"), (s) => {
    roster = s.val() || {};
    rosterBlocked = false;
    if (live) draw(true);
  }, () => {
    rosterBlocked = true;
    if (live) draw(true);
  });
  onValue(ref(fb.db, "live"), (s) => {
    live = s.val() || { status: "lobby", phase: "lobby", round: 1, turnIndex: 0 };
    draw();
  });

  function draw(force = false) {
    renderBoard(live, roster, { blocked: rosterBlocked });
    renderMeta();
    $("#paused").classList.toggle("hidden", live.status !== "paused");
    document.body.dataset.phase = live.phase;

    const key = [live.status === "paused" ? "running" : live.status, live.phase, live.round,
      live.turnId, live.wheel?.spinId, live.question?.id, live.result?.outcome].join("|");
    if (key === viewKey && !force) return;
    viewKey = key;
    stopTimer();
    stopTimer = () => {};
    stage.innerHTML = view();
    after();
    playMoment(live);
  }



  function renderMeta() {
    if (live.status === "lobby" || live.status === "finished") {
      meta.innerHTML = `<span class="badge badge--on-dark">${live.status === "lobby" ? "Starting soon" : "Final results"}</span>`;
      return;
    }
    if (live.tiebreak) {
      const tb = live.tiebreak;
      meta.innerHTML = `
        <span class="badge badge--on-dark">⚔️ Sudden death</span>
        <span class="badge badge--on-dark">Cycle ${tb.cycle}</span>
        <span class="badge badge--on-dark">Team ${Math.min((tb.index ?? 0) + 1, tb.alive.length)} / ${tb.alive.length}</span>`;
      return;
    }
    meta.innerHTML = `
      <span class="badge badge--on-dark">Round ${live.round} / ${ROUNDS.length}</span>
      <span class="badge badge--on-dark">Question ${questionNumber(live.turnIndex, live)} / ${QUESTIONS_PER_TEAM}</span>
      <span class="badge badge--on-dark">Turn ${(live.turnIndex ?? 0) + 1} / ${turnsPerRound(live)}</span>`;
  }

  function view() {
    const name = live.activeTeam ? esc(teamName(live.activeTeam)) : "";
    switch (live.phase) {
      case "lobby":
        return `
          <div class="stage__center">
            <p class="overline stage__over">IEEE UOB Student Branch presents</p>
            <h1 class="title-xl">Risk It</h1>
            <p class="lede">${ROUNDS.length} rounds · ${Object.keys(claims).length} of ${TEAMS.length} teams joined · every answer counts</p>
            <ul class="joined">${TEAMS.map((t) => `
              <li class="joined__team ${claims[t.id] ? "joined__team--in" : ""}">
                <span class="joined__dot"></span>${esc(t.name)}
              </li>`).join("")}</ul>
            <div class="join-card">
              <div class="join-card__qr" data-qr aria-hidden="true"></div>
              <div class="join-card__text">
                <p class="join-card__title">Join on your phone or laptop</p>
                <p class="join-card__steps">Scan the code or open the link, then type the code on your team's card.</p>
                <p class="join-card__url">${esc(TEAM_URL.replace(/^https?:\/\//, ""))}</p>
              </div>
            </div>
          </div>`;

      case "roundIntro":
        if (live.tiebreak) {
          const t = tieIntro(live);
          return `
            <div class="stage__center">
              <p class="overline stage__over">${esc(t.over)}</p>
              <h1 class="title-xl">${t.title}</h1>
              <ul class="facts">${t.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
              ${timerHTML()}
            </div>`;
        }
        return `
          <div class="stage__center">
            <p class="overline stage__over">Round ${live.round} of ${ROUNDS.length}</p>
            <h1 class="title-xl">Round ${live.round}</h1>
            <ul class="facts">${roundSummary(live.round).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
            ${timerHTML()}
          </div>`;

      case "ready":
        return `
          <div class="stage__center">
            <div class="turn-avatar">${esc(initials(teamName(live.activeTeam)))}</div>
            <h1 class="title-lg">${possessive(name)} turn</h1>
            <p class="lede">Waiting for ${name} to press <strong>Ready</strong><span class="dots"></span></p>
          </div>`;

      case "choose":
        return `
          <div class="stage__center">
            ${teamChip(live.activeTeam)}
            <h1 class="title-lg">${esc(choiceQuestion(live.round))}</h1>
            <p class="lede">${name} is deciding<span class="dots"></span></p>
            ${modeCardsHTML(live.round)}
          </div>`;

      case "spinning":
        return `
          <div class="stage__center">
            ${teamChip(live.activeTeam)}
            <h1 class="title-md">${name} took the risk</h1>
            <div class="wheel-wrap">${wheelSVG()}</div>
            <p class="wheel-result" data-wheel-result>${esc(wheelResultLabel(live))}</p>
            ${resultPopHTML(live)}
          </div>`;

      // Steal 2 (wheel) or Steal 4 (Round 4): the team is picking who to rob.
      case "target": {
        const st = stealTerms(live);
        return `
          <div class="stage__center">
            ${teamChip(live.activeTeam)}
            <p class="big-emoji" aria-hidden="true">🏴‍☠️</p>
            <h1 class="title-lg">${esc(st.label)}!</h1>
            <p class="lede">${name} is choosing who to rob<span class="dots"></span></p>
            <ul class="targets">${playersOf(live).filter((id) => id !== live.activeTeam).map((id) => `
              <li class="target"><span class="target__name">${esc(teamName(id))}</span><span class="target__pts">${live.scores?.[id] ?? 0} pts</span></li>`).join("")}</ul>
            <p class="muted">Right answer: ${name} +${st.win}, the robbed team −${st.take}. Wrong: the robbed team +${st.give}.</p>
          </div>`;
      }

      // Mystery Drink: waiting for the game master to confirm the drink.
      case "drink":
        return `
          <div class="stage__center">
            ${teamChip(live.activeTeam)}
            <p class="big-emoji" aria-hidden="true">🧪</p>
            <h1 class="title-lg">Mystery Drink!</h1>
            <p class="lede">${name}, take the drink. Your quick question starts when the game master confirms<span class="dots"></span></p>
          </div>`;

      case "question":
      case "judge":
      case "reveal":
        if (live.result?.outcome === "lucky") {
          return `
            <div class="stage__center">
              ${teamChip(live.activeTeam)}
              <p class="big-emoji" aria-hidden="true">🍀</p>
              <h1 class="title-lg">Lucky Point!</h1>
              ${verdictHTML(live.result)}
              <p class="lede">No question this time. On to the next team<span class="dots"></span></p>
            </div>`;
        }
        if (live.result?.outcome === "noquestion") {
          return `
            <div class="stage__center">
              ${teamChip(live.activeTeam)}
              <h1 class="title-md">No question left in this pool</h1>
              <p class="lede">This turn is skipped. Moving on<span class="dots"></span></p>
            </div>`;
        }
        return `
          <div class="qa">
            <div class="qa__top">
              ${teamChip(live.activeTeam)}
              <div class="qa__tags">${questionTags(live)}</div>
              ${live.phase === "question" ? timerHTML() : live.phase === "reveal" ? verdictHTML(live.result) : ""}
            </div>
            ${questionCardHTML(live.question)}
            ${live.question?.open ? openNoteHTML(live) : choicesHTML(live.question, { result: live.phase === "reveal" ? live.result : null })}
          </div>`;

      case "finished":
        return finishedView();

      default:
        return "";
    }
  }

  function finishedView() {
    return `
      <div class="stage__center">
        <p class="overline stage__over">Final results</p>
        <h1 class="title-lg">${esc(winnerText(live, roster))}</h1>
        ${podiumHTML(live, roster)}
      </div>`;
  }

  function after() {
    const timer = stage.querySelector("[data-timer]");
    if (timer) {
      const total = live.phase === "question"
        ? (live.question?.seconds ?? 30) * 1000
        : (live.phaseEndsAt ?? 0) - fb.now();
      stopTimer = startCountdown(
        timer,
        () => live.phaseEndsAt ?? 0,
        total,
        fb.now,
        () => (live.status === "paused" ? live.pausedRemaining ?? 0 : null),
        (secs) => { if (live.phase === "question" && secs > 0 && secs <= 5) sfx.tick(secs); },
      );
    }
    const qr = stage.querySelector("[data-qr]");
    if (qr) drawQR(qr);
    const wheel = stage.querySelector(".wheel");
    if (wheel && live.wheel) {
      spin(wheel, live.wheel.segment, live.wheel.spinId, live.wheel.landsAt ?? (live.phaseEndsAt ?? 0) - 400, fb.now(), () => showResultPop(stage, (live.phaseEndsAt ?? 0) - fb.now()));
    }
  }

  let qrSvg = null;
  async function drawQR(el) {
    if (!qrSvg) {
      try {
        const { default: qrcode } = await import(QR_LIB);
        const q = qrcode(0, "M");
        q.addData(TEAM_URL);
        q.make();
        qrSvg = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      } catch {
        el.closest(".join-card")?.classList.add("join-card--no-qr");
        return;
      }
    }
    el.innerHTML = qrSvg;
  }
}
