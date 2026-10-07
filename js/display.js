// Main Display (projector). Shows the game and runs the engine.

import { connect, ref, onValue } from "./firebase.js";
import { HOST_EMAIL, TEAMS, ROUNDS } from "./config.js";
import { Engine } from "./engine.js";
import { teamName, roundCfg, ranking, initials, questionNumber, TURNS_PER_ROUND } from "./game.js";
import { $, esc, toast, createLeaderboard, startCountdown, hostLogin } from "./ui.js";
import {
  choicesHTML, verdictHTML, questionTags, teamChip, modeCardsHTML,
  roundSummary, timerHTML, wheelResultLabel, podiumHTML, possessive,
} from "./views.js";
import { wheelSVG, spin } from "./wheel.js";

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

  const renderBoard = createLeaderboard($("#leaderboard"));
  let live = null;
  let claims = {};
  let viewKey = "";
  let stopTimer = () => {};

  onValue(ref(fb.db, "claims"), (s) => {
    claims = s.val() || {};
    if (live?.status === "lobby") draw(true);
  });
  onValue(ref(fb.db, "live"), (s) => {
    live = s.val() || { status: "lobby", phase: "lobby", round: 1, turnIndex: 0 };
    draw();
  });

  function draw(force = false) {
    renderBoard(live);
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
  }

  function renderMeta() {
    if (live.status === "lobby" || live.status === "finished") {
      meta.innerHTML = `<span class="badge badge--on-dark">${live.status === "lobby" ? "Starting soon" : "Final results"}</span>`;
      return;
    }
    meta.innerHTML = `
      <span class="badge badge--on-dark">Round ${live.round} / ${ROUNDS.length}</span>
      <span class="badge badge--on-dark">Question ${questionNumber(live.turnIndex ?? 0)} / ${TURNS_PER_ROUND / TEAMS.length}</span>
      <span class="badge badge--on-dark">Turn ${(live.turnIndex ?? 0) + 1} / ${TURNS_PER_ROUND}</span>`;
  }

  function view() {
    const name = live.activeTeam ? esc(teamName(live.activeTeam)) : "";
    switch (live.phase) {
      case "lobby":
        return `
          <div class="stage__center">
            <p class="overline stage__over">IEEE UOB Student Branch presents</p>
            <h1 class="title-xl">Risk It</h1>
            <p class="lede">${ROUNDS.length} rounds · ${TEAMS.length} teams · every answer counts</p>
            <ul class="joined">${TEAMS.map((t) => `
              <li class="joined__team ${claims[t.id] ? "joined__team--in" : ""}">
                <span class="joined__dot"></span>${esc(t.name)}
              </li>`).join("")}</ul>
            <p class="muted">Teams: enter your code on your laptop to join.</p>
          </div>`;

      case "roundIntro":
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
            <h1 class="title-lg">${roundCfg(live.round).choices.includes("allin") ? "Safe, Risk or All In?" : "Safe or Risk?"}</h1>
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
          </div>`;

      case "question":
      case "reveal":
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
              ${live.phase === "question" ? timerHTML() : verdictHTML(live.result)}
            </div>
            <div class="card card--elevated qa__question">
              <p class="qa__text">${esc(live.question?.text)}</p>
            </div>
            ${choicesHTML(live.question, { result: live.phase === "reveal" ? live.result : null })}
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
        <h1 class="title-lg">${esc(ranking(live)[0]?.name ?? "")} wins!</h1>
        ${podiumHTML(live)}
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
      );
    }
    const wheel = stage.querySelector(".wheel");
    if (wheel && live.wheel) {
      spin(wheel, live.wheel.segment, live.wheel.spinId, live.phaseEndsAt ?? 0, fb.now());
    }
  }
}
