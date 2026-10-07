// ============================================================================
//  RISK IT: GAME CONFIG
//  Every rule of the game lives in this one file. Change a value, save,
//  refresh the screens. Items marked "TBD" are placeholders until you decide.
// ============================================================================

export const GAME_TITLE = "Risk It";

// The game master's login for the Main Display and Admin Panel.
// Create this user in Firebase (Authentication → Users → Add user).
// It must match the email in database.rules.json.
export const HOST_EMAIL = "host@riskit.game";

// TBD: real team names. Keep the ids (t1 … t9) as they are.
export const TEAMS = [
  { id: "t1", name: "Team 1" },
  { id: "t2", name: "Team 2" },
  { id: "t3", name: "Team 3" },
  { id: "t4", name: "Team 4" },
  { id: "t5", name: "Team 5" },
  { id: "t6", name: "Team 6" },
  { id: "t7", name: "Team 7" },
  { id: "t8", name: "Team 8" },
  { id: "t9", name: "Team 9" },
];

// Questions each team answers per round. 9 teams × 4 = 36 turns per round.
export const QUESTIONS_PER_TEAM = 4;

// Rounds. `base` = points for a correct answer, `wrong` = points for a wrong
// answer, `timeout` = points when the timer runs out.
// `choices` = what the team picks before the question ([] = no choice).
export const ROUNDS = [
  { number: 1, difficulty: "easy",   base: 1, wrong: 0, timeout: -1, choices: [] },
  { number: 2, difficulty: "medium", base: 2, wrong: 0, timeout: -1, choices: ["safe", "risk"] },
  { number: 3, difficulty: "hard",   base: 3, wrong: 0, timeout: -1, choices: ["safe", "risk"] },
  { number: 4, difficulty: "expert", base: 4, wrong: 0, timeout: -1, choices: ["safe", "risk", "allin"] },
];

// TBD: seconds on the clock for each difficulty.
export const TIMERS = {
  easy: 20,
  medium: 25,
  hard: 30,
  expert: 40,
};

// How long (seconds) the automatic screens stay up.
export const DURATIONS = {
  roundIntro: 6, // "Round 2" title card before the first turn of a round
  spin: 6,       // wheel spin on the Main Display
  reveal: 7,     // answer reveal before the next team's turn
};

// Extra time (ms) allowed for an answer to reach the database after the
// timer hits zero, so a click at 0.1 s left still counts.
export const ANSWER_GRACE_MS = 1500;

// ----------------------------------------------------------------------------
//  TBD: THE WHEEL (Risk mode)
//  Each segment:
//    id      also the question pool it draws from (questions with this "pool")
//    label   shown on the wheel
//    weight  relative chance (they don't need to add up to 100)
//    correct / wrong / timeout: points, given the round's base points
//    and the team's current score.
// ----------------------------------------------------------------------------
export const WHEEL = [
  {
    id: "double",
    label: "Double Points",
    weight: 35,
    color: "#016eb6",
    correct: (base) => base * 2,
    wrong: (base) => -base,
    timeout: (base) => -base,
  },
  {
    id: "triple",
    label: "Triple Points",
    weight: 20,
    color: "#3a5396",
    correct: (base) => base * 3,
    wrong: (base) => -base * 2,
    timeout: (base) => -base * 2,
  },
  {
    id: "shield",
    label: "Shield",
    weight: 30,
    color: "#1085e4",
    correct: (base) => base,
    wrong: () => 0,
    timeout: () => 0,
  },
  {
    id: "jackpot",
    label: "Jackpot ×5",
    weight: 15,
    color: "#0f2547",
    correct: (base) => base * 5,
    wrong: (base) => -base * 3,
    timeout: (base) => -base * 3,
  },
];

// TBD: All In rules (Round 4). Draws from the "allin" pool.
export const ALL_IN = {
  label: "All In",
  correct: (base, score) => Math.max(score, base), // doubles your score
  wrong: (base, score) => -Math.max(score, 0),     // lose everything
  timeout: (base, score) => -Math.max(score, 0),
};

// Labels for the Safe / Risk / All In buttons.
export const MODE_LABELS = {
  normal: "Question",
  safe: "Safe",
  risk: "Risk",
  allin: "All In",
};

export const MODE_HINTS = {
  safe: "Normal question, normal points",
  risk: "Spin the wheel, play for more",
  allin: "Bet your whole score",
};

// TBD: tie-break. Teams with equal scores are ordered by this function
// (return a negative number if team a should rank above team b).
// Default: more correct answers first, then team number.
export function tieBreak(a, b) {
  return (b.correct || 0) - (a.correct || 0) || a.index - b.index;
}
