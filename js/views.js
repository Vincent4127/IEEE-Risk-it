// Pieces of markup shared by the Main Display and the team screens.

import { WHEEL, MODE_HINTS, MODE_LABELS, MODE_EMOJI, ALL_IN, STEAL, SNIPER, ROUNDS, QUESTIONS_PER_TEAM } from "./config.js";
import { roundCfg, teamName, teamNumber, letter, modeLabel, questionNumber, ranking, initials, turnsPerRound } from "./game.js";
import { esc, fmtPoints, standings, medalSVG } from "./ui.js";

export const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

export function timerHTML(size = "") {
  return `<div class="timer ${size}" data-timer><span class="timer__num" data-secs></span></div>`;
}

// "Volt's turn", but "Circuit Breakers' turn".
export const possessive = (name) => `${name}${/s$/i.test(name) ? "'" : "'s"}`;

// Answer choices. `result` turns on the reveal colours; `selected` marks the
// team's pick before submitting; `interactive` renders buttons. `picked` is
// the tag on the chosen answer ("Their answer" on the projector).
export function choicesHTML(question, { result = null, selected = null, interactive = false, picked = "Their answer" } = {}) {
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
    const mark = result && i === result.choice ? `<span class="choice__tag">${esc(picked)}${result.choice === result.correctIndex ? " ✓" : ""}</span>` : "";
    return `<${tag} class="${cls.join(" ")}" ${attrs}>
        <span class="choice__letter">${letter(i)}</span>
        <span class="choice__text">${esc(c)}</span>${mark}
      </${tag}>`;
  }).join("")}</div>`;
}

// Correct / Wrong / Time's up / Lucky Point, with the points. On Steal 2 a
// second line says what happened to the robbed team.
export function verdictHTML(result) {
  if (!result) return "";
  const map = {
    correct: ["success", "Correct", "✅"],
    wrong: ["danger", "Wrong", "❌"],
    timeout: ["warning", "Time's up", "⏱"],
    lucky: ["success", "Lucky Point", "🍀"],
    noquestion: ["neutral", "Turn skipped", "⏭"],
  };
  const [kind, label, icon] = map[result.outcome] || map.noquestion;
  const unit = result.tiebreak ? "tie-break point" : "point";
  const p = result.points ?? 0;
  const steal = result.target && result.targetPoints
    ? `<span class="verdict__steal">🏴‍☠️ ${esc(teamName(result.target))} ${fmtPoints(result.targetPoints)}</span>`
    : "";
  return `
    <div class="verdict-wrap">
      <div class="verdict verdict--${kind}">
        <span class="verdict__icon" aria-hidden="true">${icon}</span>
        <span class="verdict__label">${label}</span>
        <span class="verdict__points">${fmtPoints(p)} ${unit}${Math.abs(p) === 1 ? "" : "s"}</span>
      </div>${steal}
    </div>`;
}

// The question, with its picture when it has one.
export function questionCardHTML(q) {
  if (!q) return "";
  return `
    <div class="card card--elevated qa__question ${q.image ? "qa__question--img" : ""}">
      <p class="qa__text">${esc(q.text)}</p>
      ${q.image ? `<img class="qa__img" src="${esc(q.image)}" alt="">` : ""}
    </div>`;
}

// In place of the choices, for a question answered out loud (Mystery Drink):
// what to do now, or the right answer once it's judged.
export function openNoteHTML(live) {
  if (live.phase === "question") return `<p class="open-note">🗣️ Answer out loud!</p>`;
  if (live.phase === "judge") return `<p class="open-note open-note--wait">The game master is checking the answer<span class="dots"></span></p>`;
  const a = live.result?.answerText;
  return a ? `<p class="open-note open-note--answer"><span>Answer</span><strong>${esc(a)}</strong></p>` : "";
}

export function questionTags(live) {
  const q = live.question;
  const tags = [`<span class="badge badge--on-dark">${esc(modeLabel(live) || "Question")}</span>`];
  if (live.target) tags.push(`<span class="badge badge--on-dark">🏴‍☠️ Robbing ${esc(teamName(live.target))}</span>`);
  if (q?.category) tags.push(`<span class="badge badge--on-dark">${esc(q.category)}</span>`);
  else if (q?.difficulty && !live.tiebreak) tags.push(`<span class="badge badge--on-dark">${DIFFICULTY_LABEL[q.difficulty] ?? esc(q.difficulty)}</span>`);
  return tags.join("");
}

export function teamChip(id, extra = "") {
  return `<span class="team-chip ${extra}"><span class="team-chip__num">${teamNumber(id)}</span><span class="team-chip__name">${esc(teamName(id))}</span></span>`;
}

// What each card is worth, shown with `stakes`. Risk it shows nothing more:
// the wheel decides.
function stakeText(round, m) {
  const base = roundCfg(round).base;
  if (m === "safe" || m === "normal") return `+${base} if right`;
  if (m === "allin") return `+${ALL_IN.correct} if right · ${ALL_IN.wrong} if wrong`;
  if (m === "steal") return `You +${STEAL.correct}, them ${STEAL.targetCorrect} · wrong: them +${STEAL.targetWrong}`;
  if (m === "sniper") return `+${SNIPER.correct} if right · ${SNIPER.wrong} if wrong`;
  return "";
}

// "Safe or Risk it?" / "Normal or All In?"
export const choiceQuestion = (round) => {
  const names = roundCfg(round).choices.map((m) => MODE_LABELS[m]);
  return `${names.length > 2 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names.join(" or ")}?`;
};

// What's at stake on a steal (Steal 2 on the wheel, or Steal 4 in Round 4).
export function stealTerms(live) {
  const t = live.mode === "steal" ? STEAL : WHEEL.find((w) => w.kind === "steal");
  return { label: live.mode === "steal" ? STEAL.label : t.label, win: t.correct, take: -t.targetCorrect, give: t.targetWrong };
}

// The choice cards: Safe 🛡️ / Risk it 🔥 (red) in Rounds 2 and 3, Normal 🛡️ /
// All In 💰 (green) in Round 4.
export function modeCardsHTML(round, { interactive = false, stakes = false } = {}) {
  return `<div class="modes">${roundCfg(round).choices.map((m) => {
    const tag = interactive ? "button" : "div";
    const attrs = interactive ? `type="button" data-mode="${m}"` : "";
    const stake = stakes ? stakeText(round, m) : "";
    return `<${tag} class="mode mode--${m}" ${attrs}>
        <span class="mode__icon" aria-hidden="true">${MODE_EMOJI[m] ?? ""}</span>
        <span class="mode__label">${esc(MODE_LABELS[m])}</span>
        <span class="mode__hint">${esc(MODE_HINTS[m] || "")}</span>${stake ? `<span class="mode__stake">${esc(stake)}</span>` : ""}
      </${tag}>`;
  }).join("")}</div>`;
}

export function roundSummary(round) {
  const r = roundCfg(round);
  const choice = r.choices.length
    ? r.choices.map((m) => `${MODE_EMOJI[m] ?? ""} ${MODE_LABELS[m]}`.trim()).join(" or ")
    : "Answer the question";
  return [
    `${DIFFICULTY_LABEL[r.difficulty]} questions`,
    `${r.base} ${r.base === 1 ? "point" : "points"} per correct answer`,
    choice,
  ];
}

// The title card before sudden death, and before each extra cycle of it.
export function tieIntro(live) {
  const tb = live.tiebreak;
  const names = tb.alive.map(teamName);
  return {
    over: tb.cycle > 1 ? `Still tied after cycle ${tb.cycle - 1}` : `Tied on ${live.scores?.[tb.alive[0]] ?? 0} points`,
    title: "⚔️ Sudden death",
    facts: [`${names.slice(0, -1).join(", ")} vs ${names[names.length - 1]}`, "One question each", "+1 tie-break point if right", "No wheel, no All In"],
  };
}

export function progressText(live) {
  if (live.tiebreak) {
    const tb = live.tiebreak;
    return `Sudden death · Cycle ${tb.cycle} · Team ${Math.min((tb.index ?? 0) + 1, tb.alive.length)} of ${tb.alive.length}`;
  }
  return `Round ${live.round} of ${ROUNDS.length} · Question ${questionNumber(live.turnIndex, live)} of ${QUESTIONS_PER_TEAM} · Turn ${(live.turnIndex ?? 0) + 1}/${turnsPerRound(live)}`;
}

// The top three on a podium: silver, gold, bronze from left to right.
export function podiumHTML(live, roster) {
  const rows = standings(live, roster);
  return `<ol class="podium">${[0, 1, 2].map((i) => {
    const t = rows[i];
    if (!t) return "";
    const metal = ["gold", "silver", "bronze"][Math.min(t.place, 3) - 1];
    return `
      <li class="podium__step podium__step--${metal} podium__pos--${i}">
        <div class="podium__person">
          <span class="podium__medal">${t.place <= 3 ? medalSVG(t.place) : ""}</span>
          <span class="podium__name">${esc(t.name)}</span>
          <span class="podium__pts">${t.score} pts${live.tiebreak?.tied?.includes(t.id) ? ` · ⚔️ ${t.tb}` : ""}</span>
        </div>
        <div class="podium__block">${t.place}</div>
      </li>`;
  }).join("")}</ol>`;
}

// "🏆 Volt wins!", or the shared winners when sudden death couldn't settle it.
export function winnerText(live, roster) {
  const top = standings(live, roster).filter((t) => t.place === 1).map((t) => t.name);
  if (!top.length) return "Game over";
  if (top.length === 1) return `🏆 ${top[0]} wins!`;
  return `It's a tie! ${top.slice(0, -1).join(", ")} and ${top[top.length - 1]} share first place`;
}

// What the wheel's result means, in a line.
function resultLine(seg) {
  switch (seg.kind) {
    case "steal": return `Pick a team to rob: right answer, you +${seg.correct} and them ${seg.targetCorrect}`;
    case "drink": return `Drink first, then a quick question: +${seg.correct} if right`;
    case "lucky": return `+${seg.correct} ${seg.correct === 1 ? "point" : "points"}, no question!`;
    default: return seg.wrong ? `+${seg.correct} if right · ${seg.wrong} if wrong` : `+${seg.correct} if right · nothing to lose`;
  }
}

// The wheel's result, big in the middle of the screen over a blurred, dark
// background. It's in the page from the start of the spin, hidden, and
// showResultPop() brings it up the moment the wheel lands; it goes when the
// screen moves on to the next step.
export function resultPopHTML(live) {
  const seg = live.wheel ? WHEEL[live.wheel.segment] : null;
  if (!seg) return "";
  return `
    <div class="result-pop" data-result-pop role="status" aria-live="assertive" style="--seg:${seg.color}">
      <div class="result-pop__card">
        <span class="result-pop__emoji" aria-hidden="true">${seg.emoji}</span>
        <span class="result-pop__label">${esc(seg.label)}</span>
        <span class="result-pop__line">${esc(resultLine(seg))}</span>
      </div>
    </div>`;
}
// `leaveIn`: ms until it should be gone; it shrinks and fades out over the
// last 0.6 s of that.
export function showResultPop(root, leaveIn) {
  const el = root.querySelector("[data-result-pop]");
  if (!el) return;
  el.classList.add("is-shown");
  setTimeout(() => el.classList.add("is-leaving"), Math.max(0, leaveIn - 600));
}

export function wheelResultLabel(live) {
  const seg = live.wheel ? WHEEL[live.wheel.segment] : null;
  return seg ? `${seg.emoji} ${seg.label}!` : "";
}
