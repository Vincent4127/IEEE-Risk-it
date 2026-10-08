// The engine runs the game automatically. It lives on the Main Display: it
// holds the answers, watches the clock, reads what teams press, and moves the
// game forward. Only one Main Display runs it at a time; any other copy is
// view-only until someone presses "Take over".

import { ref, onValue, set, push, runTransaction, serverTimestamp } from "./firebase.js";
import { ANSWER_GRACE_MS, WHEEL } from "./config.js";
import * as G from "./game.js";

const HEARTBEAT_MS = 2000;
const STALE_MS = 7000;

// A timer that keeps its pace when the Main Display's tab is in the
// background. Browsers slow a hidden tab's own timers (down to once a minute
// after a few minutes), which froze the game on whatever screen it was on;
// timers inside a worker aren't slowed. Falls back to a normal timer.
function steadyInterval(fn, ms) {
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = () => fn();
    return;
  } catch { /* no workers: use a normal timer */ }
  setInterval(fn, ms);
}

// Applies a game-rule function to /live inside a transaction.
// Resolves to the new state if it was applied, or null if it didn't apply.
export async function transactLive(db, fn) {
  let applied = null;
  const res = await runTransaction(ref(db, "live"), (cur) => {
    if (!cur) return; // not loaded yet, Firebase retries with the real value
    const next = fn(structuredClone(cur));
    applied = next ?? null;
    return next === undefined ? undefined : next;
  });
  return res.committed ? applied : null;
}

export function logEvent(db, text) {
  return push(ref(db, "history"), { text, at: serverTimestamp() });
}

export class Engine {
  constructor(fb, { onOwnerChange, onWarning } = {}) {
    this.fb = fb;
    this.db = fb.db;
    this.id = Math.random().toString(36).slice(2, 10);
    this.live = null;
    this.actions = {};
    this.bank = [];
    this.used = {};
    this.owner = false;
    this.busy = false;
    this.handled = new Set();
    this.onOwnerChange = onOwnerChange || (() => {});
    this.onWarning = onWarning || (() => {});
  }

  start() {
    const { db } = this;
    onValue(ref(db, "live"), (s) => { this.live = s.val(); this.processActions(); });
    onValue(ref(db, "actions"), (s) => { this.actions = s.val() || {}; this.processActions(); });
    onValue(ref(db, "secret/used"), (s) => { this.used = s.val() || {}; });
    onValue(ref(db, "secret/questions"), (s) => {
      const v = s.val();
      this.bank = v ? Object.values(v) : [];
    });
    onValue(ref(db, "engine"), (s) => this.checkOwner(s.val()));
    steadyInterval(() => this.beat(), HEARTBEAT_MS);
    steadyInterval(() => this.tick(), 250);
  }

  checkOwner(e) {
    const now = this.fb.now();
    const other = e && e.owner !== this.id && now - (e.beat || 0) < STALE_MS;
    const owner = !other;
    if (owner && (!e || e.owner !== this.id)) this.claim();
    if (owner !== this.owner) {
      this.owner = owner;
      this.onOwnerChange(owner);
    }
  }

  claim() {
    return set(ref(this.db, "engine"), { owner: this.id, beat: this.fb.now() });
  }

  takeOver() {
    this.owner = true;
    this.onOwnerChange(true);
    return this.claim();
  }

  beat() {
    if (this.owner) set(ref(this.db, "engine/beat"), this.fb.now());
  }

  async run(fn, after) {
    if (this.busy) return;
    this.busy = true;
    try {
      const next = await transactLive(this.db, fn);
      if (next && after) after(next);
    } catch (err) {
      console.error(err);
      this.onWarning(err.message);
    } finally {
      this.busy = false;
      this.processActions();
    }
  }

  answerFor(id) {
    return this.bank.find((q) => q.id === id)?.answer;
  }
  answerTextFor(id) {
    return this.bank.find((q) => q.id === id)?.answerText ?? null;
  }

  draw(round, pool) {
    const q = G.drawQuestion(this.bank, this.used, round, pool);
    if (!q) this.onWarning(pool === "tiebreak"
      ? "No questions left for sudden death. The tied teams share first place."
      : `No questions left for round ${round}. The turn was skipped.`);
    return q;
  }

  // Mystery Drink can only come up while drink questions are left.
  spin() {
    const drinksLeft = !!G.drawQuestion(this.bank, this.used, null, "drink");
    return G.spinWheel(drinksLeft ? [] : ["drink"]);
  }

  markUsed(next) {
    const id = next?.question?.id;
    if (id && !this.used[id]) {
      this.used[id] = true;
      set(ref(this.db, `secret/used/${id}`), true);
    }
  }

  logReveal(s) {
    const r = s.result;
    if (!r) return;
    const name = G.teamName(s.activeTeam);
    const pts = r.points > 0 ? `+${r.points}` : `${r.points}`;
    const what = { correct: "correct", wrong: "wrong", timeout: "ran out of time", noquestion: "skipped (no question left)", lucky: "got a Lucky Point" }[r.outcome];
    const robbed = r.target && r.targetPoints ? `, ${G.teamName(r.target)} ${r.targetPoints > 0 ? `+${r.targetPoints}` : r.targetPoints}` : "";
    const where = s.tiebreak ? `Sudden death ${s.tiebreak.cycle}` : `R${s.round}`;
    logEvent(this.db, `${where} · ${name} ${what} (${G.modeLabel(s) || "Question"}) ${pts}${robbed}`);
  }

  // Timed transitions.
  tick() {
    const s = this.live;
    if (!this.owner || !s || s.status !== "running" || !s.phaseEndsAt) return;
    const now = this.fb.now();
    if (now < s.phaseEndsAt) return;

    switch (s.phase) {
      case "roundIntro":
        return this.run((x) => (x.phase === "roundIntro" && x.status === "running" ? G.beginTurn(x) : undefined));
      case "spinning": {
        // Only Double or Nothing and Double need their question now: Steal 2
        // waits for the target, Mystery Drink for the game master, and Lucky
        // Point has none.
        const q = G.segmentOf(s)?.kind === "question" ? this.draw(s.round, "risk") : null;
        return this.run((x) => G.finishSpin(x, now, s.turnId, q), (n) => this.afterQuestion(n));
      }
      case "question": {
        const correct = this.answerFor(s.question?.id);
        const text = this.answerTextFor(s.question?.id);
        return this.run((x) => G.timeUp(x, now, s.turnId, correct, text), (n) => this.logReveal(n));
      }
      case "reveal":
        return this.run((x) => (x.phase === "reveal" && x.turnId === s.turnId ? G.nextTurn(x, now) : undefined));
    }
  }

  afterQuestion(next) {
    this.markUsed(next);
    if (next.phase === "reveal") this.logReveal(next);
    if (next.phase === "reveal" && next.result?.outcome === "noquestion" && next.tiebreak) {
      // After this run has finished (run() ignores calls while busy).
      setTimeout(() => this.run((x) => G.endTieUnsettled(x)), 0);
    }
  }

  // Button presses from the active team.
  processActions() {
    const s = this.live;
    if (this.busy || !this.owner || !s || s.status !== "running" || !s.activeTeam) return;
    const a = this.actions[s.activeTeam];
    if (!a || a.turnId !== s.turnId) return;
    const key = `${a.turnId}:${a.type}:${a.at}`;
    if (this.handled.has(key)) return;

    const now = this.fb.now();
    if (a.type === "ready" && s.phase === "ready") {
      this.handled.add(key);
      const q = G.asksStraightAway(s) ? (s.tiebreak ? this.draw(null, "tiebreak") : this.draw(s.round, "normal")) : null;
      this.run((x) => G.pressReady(x, now, a.turnId, q), (n) => this.afterQuestion(n));
    } else if (a.type === "mode" && s.phase === "choose") {
      this.handled.add(key);
      const pick = a.value === "risk" ? this.spin() : this.draw(s.round, G.poolFor(s.round, a.value));
      this.run((x) => G.chooseMode(x, now, a.turnId, a.value, pick), (n) => {
        this.afterQuestion(n);
        if (n.wheel) logEvent(this.db, `R${n.round} · ${G.teamName(n.activeTeam)} spun ${WHEEL[n.wheel.segment].label}`);
      });
    } else if (a.type === "target" && s.phase === "target") {
      this.handled.add(key);
      const q = this.draw(s.round, "risk");
      this.run((x) => G.chooseTarget(x, now, a.turnId, String(a.value), q), (n) => {
        this.afterQuestion(n);
        logEvent(this.db, `R${n.round} · ${G.teamName(n.activeTeam)} is robbing ${G.teamName(n.target)}`);
      });
    } else if (a.type === "answer" && s.phase === "question") {
      this.handled.add(key);
      if (a.at > s.phaseEndsAt + ANSWER_GRACE_MS) return; // too late, the timer handles it
      const correct = this.answerFor(s.question?.id);
      this.run((x) => G.answer(x, now, a.turnId, Number(a.value), correct), (n) => {
        if (n.phase === "reveal") this.logReveal(n);
      });
    }
  }
}
