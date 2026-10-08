// Game rules: turn order, phases, scoring and question drawing.
// Every function here is pure: it takes the current game state and returns
// the next one (or undefined when the move doesn't apply). The engine and the
// Admin Panel run them inside database transactions.
//
// A turn goes: ready → (choose) → (spinning → target | drink) → question →
// (judge) → reveal. Mystery Drink questions are answered out loud, so after
// the team presses Answered the game master judges them (the judge step). Lucky Point skips straight from the spin to the reveal. After
// Round 4, a tie for first place is played off in sudden death.

import {
  TEAMS, ROUNDS, QUESTIONS_PER_TEAM, TIMERS, DURATIONS,
  WHEEL, ALL_IN, STEAL, SNIPER, MODE_LABELS, MODE_EMOJI, tieBreak,
} from "./config.js";

// The most turns a round can have (every configured team playing).
export const TURNS_PER_ROUND = TEAMS.length * QUESTIONS_PER_TEAM;

// The teams taking turns in this game: the ones that had joined when the
// game started, in team order. `players` is fixed at Start; a game saved
// before it existed falls back to every team.
export const playersOf = (s) => (s?.players?.length ? s.players : TEAMS.map((t) => t.id));
export const turnsPerRound = (s) => playersOf(s).length * QUESTIONS_PER_TEAM;

// ---------- Lookups ----------

export const roundCfg = (n) => ROUNDS[(n || 1) - 1];
export const teamById = (id) => TEAMS.find((t) => t.id === id);
export const teamName = (id) => teamById(id)?.name ?? id;
export const teamNumber = (id) => TEAMS.findIndex((t) => t.id === id) + 1;
export const teamForTurn = (s) => playersOf(s)[(s.turnIndex ?? 0) % playersOf(s).length];
export const questionNumber = (turnIndex, s) => Math.floor((turnIndex ?? 0) / playersOf(s).length) + 1;
export const letter = (i) => "ABCDEFGH"[i];
export const segmentOf = (s) => (s?.wheel ? WHEEL[s.wheel.segment] : null);

export function initials(name) {
  const m = String(name).match(/\d+$/);
  if (m) return m[0];
  return String(name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// "Risk it · 🏴‍☠️ Steal 2", "💰 All In", "Safe" …
export function modeLabel(live) {
  if (live?.tiebreak && live.phase !== "roundIntro") return "⚔️ Sudden death";
  if (!live?.mode) return "";
  const seg = segmentOf(live);
  if (live.mode === "risk" && seg) return `${MODE_LABELS.risk} · ${seg.emoji} ${seg.label}`;
  const emoji = MODE_EMOJI[live.mode];
  return `${emoji ? `${emoji} ` : ""}${MODE_LABELS[live.mode] ?? live.mode}`;
}

// ---------- State ----------

export function initialLive() {
  const scores = {};
  const stats = {};
  for (const t of TEAMS) {
    scores[t.id] = 0;
    stats[t.id] = { correct: 0, wrong: 0, timeout: 0 };
  }
  return { status: "lobby", phase: "lobby", round: 1, turnIndex: 0, scores, stats };
}

const newId = () => Math.random().toString(36).slice(2, 10);
const clear = (s) => {
  s.mode = null;
  s.wheel = null;
  s.target = null;
  s.question = null;
  s.result = null;
  s.phaseEndsAt = null;
};

// `players`: ids of the teams that take turns (the joined ones).
export function startGame(s, now, players) {
  if (s.status !== "lobby" || !players?.length) return;
  Object.assign(s, initialLive());
  s.players = TEAMS.map((t) => t.id).filter((id) => players.includes(id));
  s.tiebreak = null;
  s.winner = null;
  s.status = "running";
  return toRoundIntro(s, now, 1);
}

function toRoundIntro(s, now, round) {
  clear(s);
  s.round = round;
  s.turnIndex = 0;
  s.activeTeam = null;
  s.turnId = null;
  s.phase = "roundIntro";
  s.phaseEndsAt = now + DURATIONS.roundIntro * 1000;
  return s;
}

export function beginTurn(s) {
  clear(s);
  s.phase = "ready";
  s.activeTeam = s.tiebreak ? s.tiebreak.alive[s.tiebreak.index] : teamForTurn(s);
  s.turnId = newId();
  return s;
}

// Rounds with no choice (Round 1, sudden death) go straight to the question.
export const asksStraightAway = (s) => !!s.tiebreak || roundCfg(s.round).choices.length === 0;

// Team pressed Ready.
export function pressReady(s, now, turnId, question) {
  if (s.status !== "running" || s.phase !== "ready" || s.turnId !== turnId) return;
  if (asksStraightAway(s)) {
    s.mode = "question";
    return showQuestion(s, now, question, s.tiebreak ? TIMERS.tiebreak : null);
  }
  s.phase = "choose";
  return s;
}

// Team picked Safe / Risk it / Normal / All In.
// For Risk, `pick` is { segment, spinId }; otherwise it's the drawn question.
export function chooseMode(s, now, turnId, mode, pick) {
  if (s.status !== "running" || s.phase !== "choose" || s.turnId !== turnId) return;
  if (!roundCfg(s.round).choices.includes(mode)) return;
  s.mode = mode;
  if (mode === "steal") {
    // Steal 4: pick the target first; the question comes after.
    s.phase = "target";
    s.phaseEndsAt = null;
    return s;
  }
  if (mode === "risk") {
    // The wheel turns for `spin` seconds; its result then shows on every
    // screen for `result` seconds before the next step.
    s.wheel = { segment: pick.segment, spinId: pick.spinId, landsAt: now + DURATIONS.spin * 1000 };
    s.phase = "spinning";
    s.phaseEndsAt = now + (DURATIONS.spin + DURATIONS.result) * 1000;
    return s;
  }
  return showQuestion(s, now, pick);
}

// The wheel has landed. A plain question for Double or Nothing and Double;
// Steal 2 waits for the target, Mystery Drink for the game master, and
// Lucky Point scores straight away.
export function finishSpin(s, now, turnId, question) {
  if (s.status !== "running" || s.phase !== "spinning" || s.turnId !== turnId) return;
  const seg = segmentOf(s);
  if (seg.kind === "steal") {
    s.phase = "target";
    s.phaseEndsAt = null;
    return s;
  }
  if (seg.kind === "drink") {
    s.phase = "drink";
    s.phaseEndsAt = null;
    return s;
  }
  if (seg.kind === "lucky") return reveal(s, now, "lucky", null, null);
  return showQuestion(s, now, question);
}

// Steal 2: the active team picked who to rob. Any other playing team can be
// robbed, even into negative points.
export function chooseTarget(s, now, turnId, target, question) {
  if (s.status !== "running" || s.phase !== "target" || s.turnId !== turnId) return;
  if (target === s.activeTeam || !playersOf(s).includes(target)) return;
  s.target = target;
  return showQuestion(s, now, question);
}

// Mystery Drink: the game master confirmed the drink is done.
export function confirmDrink(s, now, turnId, question) {
  if (s.status !== "running" || s.phase !== "drink" || s.turnId !== turnId) return;
  return showQuestion(s, now, question);
}

// The clock: the question's own seconds (from the question file), else the
// default for its pool or difficulty in config.js.
const secondsFor = (q, fallback) => Number(q.seconds) || fallback || TIMERS[q.pool] || TIMERS[q.difficulty] || 30;

function showQuestion(s, now, q, seconds = null) {
  if (!q) {
    // Bank ran dry: skip the turn with no points rather than freezing the game.
    s.phase = "reveal";
    s.result = { outcome: "noquestion", points: 0 };
    s.phaseEndsAt = now + DURATIONS.reveal * 1000;
    return s;
  }
  // Drink and tie-break questions belong to no round, so no difficulty tag.
  const difficulty = q.difficulty || (q.round ? roundCfg(q.round).difficulty : null);
  // A round's own clock (config.js) wins over the question's.
  // Sniper has its own short clock; otherwise the round's clock (config.js)
  // wins over the question's. Leftover questions use the round being played.
  const modeSecs = s.mode === "sniper" ? SNIPER.seconds : null;
  const roundSecs = q.pool !== "drink" && q.pool !== "tiebreak" ? roundCfg(s.round)?.seconds : null;
  const secs = modeSecs || roundSecs || secondsFor(q, seconds);
  // Never the answer: that stays with the game master. `open` questions have
  // no choices and are answered out loud.
  s.question = {
    id: q.id,
    text: q.text,
    choices: q.choices?.length ? q.choices : [],
    open: !q.choices?.length,
    difficulty,
    category: q.category ?? null,
    image: q.image ?? null,
    seconds: secs,
    pool: q.pool,
  };
  s.phase = "question";
  s.phaseEndsAt = now + secs * 1000;
  return s;
}

// Points for the active team and, on Steal 2, for the robbed team.
// outcome: "correct" | "wrong" | "timeout" (counts as wrong) | "lucky"
export function pointsFor(s, outcome) {
  const right = outcome === "correct" || outcome === "lucky";
  if (s.tiebreak) return { points: right ? 1 : 0, targetPoints: 0 };
  const seg = segmentOf(s);
  if (s.mode === "risk" && seg) {
    return {
      points: right ? seg.correct : seg.wrong ?? 0,
      targetPoints: seg.kind === "steal" ? (right ? seg.targetCorrect : seg.targetWrong) : 0,
    };
  }
  if (s.mode === "allin") return { points: right ? ALL_IN.correct : ALL_IN.wrong, targetPoints: 0 };
  if (s.mode === "steal") return { points: right ? STEAL.correct : STEAL.wrong, targetPoints: right ? STEAL.targetCorrect : STEAL.targetWrong };
  if (s.mode === "sniper") return { points: right ? SNIPER.correct : SNIPER.wrong, targetPoints: 0 };
  const r = roundCfg(s.round);
  return { points: right ? r.base : r.wrong, targetPoints: 0 };
}

export function answer(s, now, turnId, choice, correctIndex) {
  if (s.status !== "running" || s.phase !== "question" || s.turnId !== turnId) return;
  if (s.question?.open) {
    // Answered out loud: the clock stops and the game master judges it.
    s.phase = "judge";
    s.phaseEndsAt = null;
    return s;
  }
  return reveal(s, now, choice === correctIndex ? "correct" : "wrong", choice, correctIndex);
}

// The game master's verdict on an answer given out loud. `answerText` is the
// right answer, shown on every screen with the result.
export function judge(s, now, turnId, correct, answerText) {
  if (s.status !== "running" || s.phase !== "judge" || s.turnId !== turnId) return;
  const next = reveal(s, now, correct ? "correct" : "wrong", null, null);
  next.result.answerText = answerText ?? null;
  return next;
}

export function timeUp(s, now, turnId, correctIndex, answerText = null) {
  if (s.status !== "running" || s.phase !== "question" || s.turnId !== turnId) return;
  const next = reveal(s, now, "timeout", null, correctIndex);
  if (s.question?.open) next.result.answerText = answerText;
  return next;
}

function reveal(s, now, outcome, choice, correctIndex) {
  const { points, targetPoints } = pointsFor(s, outcome);
  const t = s.activeTeam;
  if (s.tiebreak) {
    // Sudden death keeps its own points; the game scores stay as they were.
    s.tiebreak.points = s.tiebreak.points || {};
    s.tiebreak.points[t] = (s.tiebreak.points[t] ?? 0) + points;
  } else {
    s.scores = s.scores || {};
    s.scores[t] = (s.scores[t] ?? 0) + points;
    if (s.target && targetPoints) s.scores[s.target] = (s.scores[s.target] ?? 0) + targetPoints;
    s.stats = s.stats || {};
    const st = s.stats[t] || { correct: 0, wrong: 0, timeout: 0 };
    if (outcome !== "lucky") st[outcome] = (st[outcome] ?? 0) + 1;
    s.stats[t] = st;
  }
  s.result = {
    outcome, choice, correctIndex, points,
    target: s.target ?? null,
    targetPoints: s.target ? targetPoints : 0,
    tiebreak: !!s.tiebreak,
  };
  s.phase = "reveal";
  s.phaseEndsAt = now + DURATIONS.reveal * 1000;
  return s;
}

export function nextTurn(s, now) {
  if (s.status === "finished" || s.status === "lobby") return;
  if (s.phase === "roundIntro") return beginTurn(s);
  if (s.tiebreak) return nextTieTurn(s, now);
  s.turnIndex = (s.turnIndex ?? 0) + 1;
  if (s.turnIndex >= turnsPerRound(s)) {
    if (s.round >= ROUNDS.length) return endOfGame(s, now);
    return toRoundIntro(s, now, s.round + 1);
  }
  return beginTurn(s);
}

// ---------- Sudden death ----------

// After Round 4: one winner ends the game; a tie for first starts sudden
// death between the tied teams only.
function endOfGame(s, now) {
  const players = playersOf(s);
  const top = Math.max(...players.map((id) => s.scores?.[id] ?? 0));
  const tied = players.filter((id) => (s.scores?.[id] ?? 0) === top);
  if (tied.length > 1) {
    s.tiebreak = { alive: tied, tied, points: {}, cycle: 1, index: 0 };
    return toTieIntro(s, now);
  }
  return finish(s, tied[0]);
}

function toTieIntro(s, now) {
  clear(s);
  s.activeTeam = null;
  s.turnId = null;
  s.phase = "roundIntro";
  s.phaseEndsAt = now + DURATIONS.roundIntro * 1000;
  return s;
}

// Each tied team answers once per cycle. After a cycle, only the teams with
// the most tie-break points stay in, until one is left.
function nextTieTurn(s, now) {
  const tb = s.tiebreak;
  tb.index = (tb.index ?? 0) + 1;
  if (tb.index < tb.alive.length) return beginTurn(s);
  const pts = (id) => tb.points?.[id] ?? 0;
  const best = Math.max(...tb.alive.map(pts));
  const left = tb.alive.filter((id) => pts(id) === best);
  if (left.length === 1) return finish(s, left[0]);
  tb.alive = left;
  tb.cycle = (tb.cycle ?? 1) + 1;
  tb.index = 0;
  return toTieIntro(s, now);
}

// `winner`: the team that won, or null when there are no questions left to
// settle a tie (the teams then share first place).
function finish(s, winner) {
  clear(s);
  s.status = "finished";
  s.phase = "finished";
  s.activeTeam = null;
  s.turnId = null;
  s.winner = winner ?? null;
  return s;
}

// Sudden death ran out of questions: end with the tied teams sharing first.
export function endTieUnsettled(s) {
  if (!s.tiebreak) return;
  return finish(s, null);
}

// ---------- Pause ----------

export function pause(s, now) {
  if (s.status !== "running") return;
  s.status = "paused";
  s.pausedRemaining = s.phaseEndsAt ? Math.max(0, s.phaseEndsAt - now) : null;
  return s;
}

export function resume(s, now) {
  if (s.status !== "paused") return;
  s.status = "running";
  if (s.pausedRemaining != null) s.phaseEndsAt = now + s.pausedRemaining;
  s.pausedRemaining = null;
  return s;
}

// ---------- Wheel ----------

// `skip`: wheel ids that can't come up (Mystery Drink once its questions run
// out); the spin is shared among the others by their weights.
export function spinWheel(skip = []) {
  const live = WHEEL.map((w, i) => ({ w, i })).filter(({ w }) => !skip.includes(w.id) && w.weight > 0);
  const total = live.reduce((a, { w }) => a + w.weight, 0);
  let r = Math.random() * total;
  let segment = live[live.length - 1].i;
  for (const { w, i } of live) {
    r -= w.weight;
    if (r < 0) { segment = i; break; }
  }
  return { segment, spinId: Math.floor(Math.random() * 1e9) };
}

// ---------- Questions ----------

// Pools in the question file:
//   normal    Rounds 1 and 4 (Normal and All In share it)
//   safe      Rounds 2 and 3, Safe
//   risk      Rounds 2 and 3, Risk it (every wheel result with a question
//             except the Mystery Drink)
//   drink     Mystery Drink, answered out loud (any round)
//   tiebreak  sudden death
export const POOLS = ["normal", "safe", "risk", "drink", "tiebreak"];
export function poolFor(round, mode, wheel) {
  // Steal 4 and Sniper share the questions Rounds 2 and 3 left unused.
  if (mode === "steal" || mode === "sniper") return "leftover";
  if (mode === "risk" && wheel && WHEEL[wheel.segment]?.kind === "drink") return "drink";
  if (mode === "risk") return "risk";
  if (mode === "safe") return "safe";
  return "normal";
}

// Turns the raw question file into a clean list. Accepts answers as an
// index (0–3) or a letter ("A"–"D"). Drink questions have no choices: they
// carry `answerText` for the game master instead.
export function normaliseBank(raw) {
  const list = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(list)) throw new Error('Expected { "questions": [ … ] }');
  const seen = new Set();
  return list.map((q, i) => {
    const where = `Question ${i + 1}${q?.id ? ` (${q.id})` : ""}`;
    if (!q.text) throw new Error(`${where} has no "text"`);
    const pool = q.pool || "normal";
    if (!POOLS.includes(pool)) throw new Error(`${where} has an unknown "pool" "${pool}"`);
    const special = pool === "drink" || pool === "tiebreak";
    const round = special ? null : Number(q.round);
    if (!special && !ROUNDS[round - 1]) throw new Error(`${where} has an invalid "round"`);
    const open = pool === "drink";
    let ans = null;
    if (open) {
      if (!q.answerText) throw new Error(`${where} needs an "answerText"`);
    } else {
      if (!Array.isArray(q.choices) || q.choices.length < 2) throw new Error(`${where} needs at least 2 "choices"`);
      ans = q.answer;
      if (typeof ans === "string" && /^[A-Ha-h]$/.test(ans)) ans = ans.toUpperCase().charCodeAt(0) - 65;
      ans = Number(ans);
      if (!Number.isInteger(ans) || ans < 0 || ans >= q.choices.length) throw new Error(`${where} has an invalid "answer"`);
    }
    if (q.image != null && !/^[\w./-]+\.(png|jpe?g|webp|gif|svg)$/i.test(String(q.image))) throw new Error(`${where} has an invalid "image" path`);
    const id = String(q.id || `${pool}-${round ?? "x"}-${i + 1}`).replace(/[.#$\[\]/]/g, "-");
    if (seen.has(id)) throw new Error(`Two questions share the id "${id}"`);
    seen.add(id);
    return {
      id, round, pool,
      difficulty: q.difficulty || (round ? roundCfg(round).difficulty : null),
      category: q.category ? String(q.category) : null,
      seconds: Number(q.seconds) || null,
      image: q.image ? String(q.image) : null,
      text: String(q.text),
      choices: open ? [] : q.choices.map(String),
      answer: open ? null : ans,
      answerText: q.answerText ? String(q.answerText) : null,
    };
  });
}

// A random unused question from the pool. Drink and tie-break questions
// belong to no round. If a round's pool runs dry the other pools of that
// round fill in; sudden death falls back to unused Round 4 questions.
// Drink questions are never replaced by another kind (the wheel re-spins).
export function drawQuestion(bank, used, round, pool) {
  const free = (q) => !used[q.id];
  const tiers = pool === "drink"
    ? [(q) => q.pool === "drink"]
    : pool === "leftover"
      // Steal 4 and Sniper: what Rounds 2 and 3 left unused, then Round 4.
      ? [(q) => (q.round === 2 || q.round === 3) && (q.pool === "safe" || q.pool === "risk"), (q) => q.round === 4 && q.pool === "normal"]
    : pool === "tiebreak"
      ? [(q) => q.pool === "tiebreak", (q) => q.round === 4 && q.pool === "normal", (q) => !!q.choices?.length]
      : [(q) => q.round === round && q.pool === pool, (q) => q.round === round && q.pool !== "drink"];
  for (const match of tiers) {
    const options = bank.filter((q) => match(q) && free(q));
    if (options.length) return options[Math.floor(Math.random() * options.length)];
  }
  return null;
}

// ---------- Leaderboard ----------

// Teams by points. Ties stay together, except that the sudden-death winner
// goes first and more tie-break points rank higher; then the order from
// config.js.
export function ranking(live) {
  return TEAMS.map((t, index) => ({
    id: t.id,
    name: t.name,
    index,
    score: live?.scores?.[t.id] ?? 0,
    correct: live?.stats?.[t.id]?.correct ?? 0,
    tb: live?.tiebreak?.points?.[t.id] ?? 0,
    won: live?.winner === t.id,
  })).sort((a, b) => b.score - a.score || Number(b.won) - Number(a.won) || b.tb - a.tb || tieBreak(a, b));
}

// Two teams share a place when nothing separates them: same points, and
// sudden death didn't split them.
export const samePlace = (a, b) => a.score === b.score && a.tb === b.tb && !a.won && !b.won;
