// Game rules: turn order, phases, scoring and question drawing.
// Every function here is pure: it takes the current game state and returns
// the next one (or undefined when the move doesn't apply). The engine and the
// Admin Panel run them inside database transactions.

import {
  TEAMS, ROUNDS, QUESTIONS_PER_TEAM, TIMERS, DURATIONS,
  WHEEL, ALL_IN, MODE_LABELS, tieBreak,
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

export function initials(name) {
  const m = String(name).match(/\d+$/);
  if (m) return m[0];
  return String(name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

export function modeLabel(live) {
  if (!live?.mode) return "";
  if (live.mode === "risk" && live.wheel) return `Risk · ${WHEEL[live.wheel.segment]?.label ?? ""}`;
  if (live.mode === "allin") return ALL_IN.label;
  return MODE_LABELS[live.mode] ?? live.mode;
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
  s.question = null;
  s.result = null;
  s.phaseEndsAt = null;
};

// `players`: ids of the teams that take turns (the joined ones).
export function startGame(s, now, players) {
  if (s.status !== "lobby" || !players?.length) return;
  Object.assign(s, initialLive());
  s.players = TEAMS.map((t) => t.id).filter((id) => players.includes(id));
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
  s.activeTeam = teamForTurn(s);
  s.turnId = newId();
  return s;
}

// Team pressed Ready. In rounds with no choice the question comes straight away.
export function pressReady(s, now, turnId, question) {
  if (s.status !== "running" || s.phase !== "ready" || s.turnId !== turnId) return;
  if (roundCfg(s.round).choices.length === 0) {
    s.mode = "normal";
    return showQuestion(s, now, question);
  }
  s.phase = "choose";
  return s;
}

// Team picked Safe / Risk / All In.
// For Risk, `pick` is { segment, spinId }; otherwise it's the drawn question.
export function chooseMode(s, now, turnId, mode, pick) {
  if (s.status !== "running" || s.phase !== "choose" || s.turnId !== turnId) return;
  if (!roundCfg(s.round).choices.includes(mode)) return;
  s.mode = mode;
  if (mode === "risk") {
    s.wheel = { segment: pick.segment, spinId: pick.spinId };
    s.phase = "spinning";
    s.phaseEndsAt = now + DURATIONS.spin * 1000;
    return s;
  }
  return showQuestion(s, now, pick);
}

export function finishSpin(s, now, turnId, question) {
  if (s.status !== "running" || s.phase !== "spinning" || s.turnId !== turnId) return;
  return showQuestion(s, now, question);
}

function showQuestion(s, now, q) {
  if (!q) {
    // Bank ran dry: skip the turn with no points rather than freezing the game.
    s.phase = "reveal";
    s.result = { outcome: "noquestion", points: 0 };
    s.phaseEndsAt = now + DURATIONS.reveal * 1000;
    return s;
  }
  const difficulty = q.difficulty || roundCfg(s.round).difficulty;
  const seconds = TIMERS[difficulty] ?? 30;
  s.question = {
    id: q.id,
    text: q.text,
    choices: q.choices,
    difficulty,
    seconds,
    pool: q.pool,
  };
  s.phase = "question";
  s.phaseEndsAt = now + seconds * 1000;
  return s;
}

// outcome: "correct" | "wrong" | "timeout"
export function pointsFor(s, outcome) {
  const r = roundCfg(s.round);
  const score = s.scores?.[s.activeTeam] ?? 0;
  if (s.mode === "risk" && s.wheel) return WHEEL[s.wheel.segment][outcome](r.base, score);
  if (s.mode === "allin") return ALL_IN[outcome](r.base, score);
  if (outcome === "correct") return r.base;
  return outcome === "wrong" ? r.wrong : r.timeout;
}

export function answer(s, now, turnId, choice, correctIndex) {
  if (s.status !== "running" || s.phase !== "question" || s.turnId !== turnId) return;
  return reveal(s, now, choice === correctIndex ? "correct" : "wrong", choice, correctIndex);
}

export function timeUp(s, now, turnId, correctIndex) {
  if (s.status !== "running" || s.phase !== "question" || s.turnId !== turnId) return;
  return reveal(s, now, "timeout", null, correctIndex);
}

function reveal(s, now, outcome, choice, correctIndex) {
  const points = pointsFor(s, outcome);
  const t = s.activeTeam;
  s.scores = s.scores || {};
  s.scores[t] = (s.scores[t] ?? 0) + points;
  s.stats = s.stats || {};
  const st = s.stats[t] || { correct: 0, wrong: 0, timeout: 0 };
  st[outcome] = (st[outcome] ?? 0) + 1;
  s.stats[t] = st;
  s.result = { outcome, choice, correctIndex, points };
  s.phase = "reveal";
  s.phaseEndsAt = now + DURATIONS.reveal * 1000;
  return s;
}

export function nextTurn(s, now) {
  if (s.status === "finished" || s.status === "lobby") return;
  if (s.phase === "roundIntro") return beginTurn(s);
  s.turnIndex = (s.turnIndex ?? 0) + 1;
  if (s.turnIndex >= turnsPerRound(s)) {
    if (s.round >= ROUNDS.length) {
      clear(s);
      s.status = "finished";
      s.phase = "finished";
      s.activeTeam = null;
      s.turnId = null;
      return s;
    }
    return toRoundIntro(s, now, s.round + 1);
  }
  return beginTurn(s);
}

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

export function spinWheel() {
  const total = WHEEL.reduce((a, w) => a + w.weight, 0);
  let r = Math.random() * total;
  let segment = WHEEL.length - 1;
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i].weight;
    if (r < 0) { segment = i; break; }
  }
  return { segment, spinId: Math.floor(Math.random() * 1e9) };
}

// ---------- Questions ----------

export function poolFor(mode, wheel) {
  if (mode === "risk" && wheel) return WHEEL[wheel.segment].id;
  if (mode === "allin") return "allin";
  return "normal";
}

// Turns the raw question file into a clean list. Accepts answers as an
// index (0–3) or a letter ("A"–"D").
export function normaliseBank(raw) {
  const list = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(list)) throw new Error('Expected { "questions": [ … ] }');
  const seen = new Set();
  return list.map((q, i) => {
    const where = `Question ${i + 1}`;
    if (!q.text) throw new Error(`${where} has no "text"`);
    if (!Array.isArray(q.choices) || q.choices.length < 2) throw new Error(`${where} needs at least 2 "choices"`);
    const round = Number(q.round);
    if (!ROUNDS[round - 1]) throw new Error(`${where} has an invalid "round"`);
    let ans = q.answer;
    if (typeof ans === "string" && /^[A-Ha-h]$/.test(ans)) ans = ans.toUpperCase().charCodeAt(0) - 65;
    ans = Number(ans);
    if (!Number.isInteger(ans) || ans < 0 || ans >= q.choices.length) throw new Error(`${where} has an invalid "answer"`);
    const pool = q.pool || "normal";
    let id = String(q.id || `r${round}-${pool}-${i + 1}`).replace(/[.#$\[\]/]/g, "-");
    if (seen.has(id)) throw new Error(`Two questions share the id "${id}"`);
    seen.add(id);
    return {
      id, round, pool,
      difficulty: q.difficulty || roundCfg(round).difficulty,
      text: String(q.text),
      choices: q.choices.map(String),
      answer: ans,
    };
  });
}

// Picks an unused question: the exact pool first, then this round's normal
// pool, then anything left in this round.
export function drawQuestion(bank, used, round, pool) {
  const free = (q) => !used[q.id];
  const tiers = [
    (q) => q.round === round && q.pool === pool,
    (q) => q.round === round && q.pool === "normal",
    (q) => q.round === round,
  ];
  for (const match of tiers) {
    const options = bank.filter((q) => match(q) && free(q));
    if (options.length) return options[Math.floor(Math.random() * options.length)];
  }
  return null;
}

// ---------- Leaderboard ----------

export function ranking(live) {
  return TEAMS.map((t, index) => ({
    id: t.id,
    name: t.name,
    index,
    score: live?.scores?.[t.id] ?? 0,
    correct: live?.stats?.[t.id]?.correct ?? 0,
  })).sort((a, b) => b.score - a.score || tieBreak(a, b));
}
