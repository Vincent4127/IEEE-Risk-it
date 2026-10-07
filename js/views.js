// Pieces of markup shared by the Main Display and the team screens.

import { WHEEL, MODE_HINTS, MODE_LABELS, ALL_IN, ROUNDS, QUESTIONS_PER_TEAM } from "./config.js";
import { roundCfg, teamName, teamNumber, letter, modeLabel, questionNumber, TURNS_PER_ROUND } from "./game.js";
import { esc, fmtPoints } from "./ui.js";

export const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

export function timerHTML(size = "") {
  return `<div class="timer ${size}" data-timer><span class="timer__num" data-secs></span></div>`;
}

// Answer choices. `result` turns on the reveal colours; `selected` marks the
// team's pick before submitting; `interactive` renders buttons.
export function choicesHTML(question, { result = null, selected = null, interactive = false } = {}) {
  return `<div class="choices">${question.choices.map((c, i) => {
    const cls = ["choice"];
    if (result) {
      if (i === result.correctIndex) cls.push("choice--correct");
      if (i === result.choice && result.choice !== result.correctIndex) cls.push("choice--wrong");
      if (i === result.choice) cls.push("choice--picked");
      if (i !== result.correctIndex && i !== result.choice) cls.push("choice--dim");
    } else if (i === selected) {
      cls.push("choice--selected");
    }
    const tag = interactive ? "button" : "div";
    const attrs = interactive ? `type="button" data-choice="${i}" aria-pressed="${i === selected}"` : "";
    const mark = result && i === result.choice ? `<span class="choice__tag">${result.choice === result.correctIndex ? "Their answer ✓" : "Their answer"}</span>` : "";
    return `<${tag} class="${cls.join(" ")}" ${attrs}>
        <span class="choice__letter">${letter(i)}</span>
        <span class="choice__text">${esc(c)}</span>${mark}
      </${tag}>`;
  }).join("")}</div>`;
}

export function verdictHTML(result) {
  if (!result) return "";
  const map = {
    correct: ["success", "Correct", "✅"],
    wrong: ["danger", "Wrong", "❌"],
    timeout: ["warning", "Time's up", "⏱"],
    noquestion: ["neutral", "Turn skipped", "⏭"],
  };
  const [kind, label, icon] = map[result.outcome] || map.noquestion;
  return `
    <div class="verdict verdict--${kind}">
      <span class="verdict__icon" aria-hidden="true">${icon}</span>
      <span class="verdict__label">${label}</span>
      <span class="verdict__points">${fmtPoints(result.points ?? 0)} ${Math.abs(result.points) === 1 ? "point" : "points"}</span>
    </div>`;
}

export function questionTags(live) {
  const q = live.question;
  const tags = [`<span class="badge badge--on-dark">${esc(modeLabel(live) || "Question")}</span>`];
  if (q?.difficulty) tags.push(`<span class="badge badge--on-dark">${DIFFICULTY_LABEL[q.difficulty] ?? esc(q.difficulty)}</span>`);
  return tags.join("");
}

export function teamChip(id, extra = "") {
  return `<span class="team-chip ${extra}"><span class="team-chip__num">${teamNumber(id)}</span>${esc(teamName(id))}</span>`;
}

export function modeCardsHTML(round, { interactive = false } = {}) {
  return `<div class="modes">${roundCfg(round).choices.map((m) => {
    const tag = interactive ? "button" : "div";
    const attrs = interactive ? `type="button" data-mode="${m}"` : "";
    const label = m === "allin" ? ALL_IN.label : MODE_LABELS[m];
    return `<${tag} class="mode mode--${m}" ${attrs}>
        <span class="mode__label">${esc(label)}</span>
        <span class="mode__hint">${esc(MODE_HINTS[m] || "")}</span>
      </${tag}>`;
  }).join("")}</div>`;
}

export function roundSummary(round) {
  const r = roundCfg(round);
  const choice = r.choices.length
    ? r.choices.map((m) => (m === "allin" ? ALL_IN.label : MODE_LABELS[m])).join(" / ")
    : "Answer the question";
  return [
    `${DIFFICULTY_LABEL[r.difficulty]} questions`,
    `${r.base} ${r.base === 1 ? "point" : "points"} per correct answer`,
    choice,
  ];
}

export function progressText(live) {
  return `Round ${live.round} of ${ROUNDS.length} · Question ${questionNumber(live.turnIndex ?? 0)} of ${QUESTIONS_PER_TEAM} · Turn ${(live.turnIndex ?? 0) + 1}/${TURNS_PER_ROUND}`;
}

export function wheelResultLabel(live) {
  return live.wheel ? WHEEL[live.wheel.segment]?.label : "";
}
