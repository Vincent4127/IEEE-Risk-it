// ============================================================================
//  RISK IT: GAME CONFIG
//  Every rule of the game lives in this one file. Change a value, save,
//  refresh the screens.
// ============================================================================

export const GAME_TITLE = "Risk It";

// The game master's login for the Main Display and Admin Panel.
// Create this user in Firebase (Authentication → Users → Add user).
// It must match the email in database.rules.json.
export const HOST_EMAIL = "host@riskit.game";

// The teams. Each id (t1, t2 …) stays fixed; change only the names.
export const TEAMS = [
  { id: "t1", name: "Packet Sniffers" },
  { id: "t2", name: "FTZ" },
  { id: "t3", name: "Goodfellas" },
  { id: "t4", name: "فادي العفوي" },
  { id: "t5", name: "Tirashrash" },
  { id: "t6", name: "لاعبين اللعبة" },
  { id: "t7", name: "Riemann Team" },
  { id: "t8", name: "AADL" },
  { id: "t9", name: "maressa" },
  { id: "t10", name: "on god" },
];

// Questions each team answers per round. With 10 teams that is up to 40
// turns per round (only the teams that join take turns).
export const QUESTIONS_PER_TEAM = 4;

// Rounds, from "Risk It - Scoring & Risk Wheel Weights" (the PDF).
//   base     points for a correct answer
//   wrong    points for a wrong answer; running out of time counts as wrong
//   choices  what the team picks before the question ([] = no choice)
export const ROUNDS = [
  { number: 1, difficulty: "easy",   base: 1, wrong: 0, choices: [] },
  { number: 2, difficulty: "medium", base: 1, wrong: 0, choices: ["safe", "risk"] },
  { number: 3, difficulty: "hard",   base: 1, wrong: 0, choices: ["safe", "risk"] },
  { number: 4, difficulty: "expert", base: 1, wrong: 0, choices: ["normal", "allin"] },
];

// Seconds on the clock when a question has no "seconds" of its own (every
// question in the question file does): by difficulty, then the Mystery Drink
// quick question and the sudden-death tie-break.
export const TIMERS = {
  easy: 20,
  medium: 25,
  hard: 30,
  expert: 40,
  drink: 10,
  tiebreak: 25,
};

// How long (seconds) the automatic screens stay up.
export const DURATIONS = {
  roundIntro: 6, // "Round 2" title card before the first turn of a round
  spin: 6,       // wheel spin on the Main Display
  result: 5,     // the wheel's result, big on every screen, before the question
  reveal: 7,     // answer reveal before the next team's turn
};

// Extra time (ms) allowed for an answer to reach the database after the
// timer hits zero, so a click at 0.1 s left still counts.
export const ANSWER_GRACE_MS = 1500;

// ----------------------------------------------------------------------------
//  THE RISK WHEEL (Rounds 2 and 3)
//  Each segment:
//    id, label, emoji  shown on the wheel and the screens
//    weight            chance in % (they don't need to add up to 100)
//    color, ink        slice colour, by how risky it is (green safe, red
//                      risky), and the text colour that reads on it
//    kind              "question"  a normal question with these points
//                      "steal"     pick a target team first, then a question
//                      "drink"     the mystery drink, then a quick question
//                                  from the "drink" pool (10 s)
//                      "lucky"     points straight away, no question
//    correct, wrong    points for the active team
//    targetCorrect, targetWrong  points for the robbed team (Steal 2)
// ----------------------------------------------------------------------------
export const WHEEL = [
  { id: "doubleornothing", label: "Double or Nothing", emoji: "🎲", weight: 30, color: "#dc2626", ink: "#ffffff",
    kind: "question", correct: 2, wrong: -1 },
  { id: "double", label: "Double", emoji: "⚡", weight: 20, color: "#84cc16", ink: "#1a2e05",
    kind: "question", correct: 2, wrong: 0 },
  { id: "steal", label: "Steal 2", emoji: "🏴‍☠️", weight: 25, color: "#f97316", ink: "#431407",
    kind: "steal", correct: 2, wrong: 0, targetCorrect: -2, targetWrong: 1 },
  { id: "drink", label: "Mystery Drink", emoji: "🧪", weight: 20, color: "#facc15", ink: "#422006",
    kind: "drink", correct: 2, wrong: 0 },
  { id: "lucky", label: "Lucky Point", emoji: "🍀", weight: 5, color: "#15803d", ink: "#ffffff",
    kind: "lucky", correct: 1 },
];

// Round 4: All In uses the same question as Normal.
export const ALL_IN = { label: "All In", correct: 4, wrong: -4 };

// The cards a team picks from, with their emoji.
export const MODE_LABELS = {
  question: "Question",
  safe: "Safe",
  risk: "Risk it",
  normal: "Normal",
  allin: "All In",
};
export const MODE_EMOJI = { safe: "🛡️", risk: "🔥", normal: "🛡️", allin: "💰" };
export const MODE_HINTS = {
  safe: "Normal question, nothing to lose",
  risk: "Spin the wheel before the question",
  normal: "Same question, nothing to lose",
  allin: "Same question, all or nothing",
};

// Order within a shared place on the leaderboard (a tie for first is played
// off in sudden death instead). Return a negative number if team a should be
// listed above team b. Default: more correct answers first, then team number.
export function tieBreak(a, b) {
  return (b.correct || 0) - (a.correct || 0) || a.index - b.index;
}
