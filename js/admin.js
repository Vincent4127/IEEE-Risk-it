// Admin Panel: the game master's backup controls. The game runs on its own
// from the Main Display; this page is for starting, pausing, skipping,
// fixing scores, team codes and the question bank.

import {
  connect, ref, onValue, set, update, remove, runTransaction, serverTimestamp,
} from "./firebase.js";
import { HOST_EMAIL, TEAMS, ROUNDS, WHEEL } from "./config.js";
import { transactLive, logEvent } from "./engine.js";
import * as G from "./game.js";
import { $, esc, toast, hostLogin, fmtPoints } from "./ui.js";
import { DIFFICULTY_LABEL, progressText } from "./views.js";

{
  const fb = connect("host");
  let started = false;
  fb.onAuth((user) => {
    const ok = user && user.email === HOST_EMAIL;
    $("#panel").classList.toggle("hidden", !ok);
    $("#login").classList.toggle("hidden", ok);
    $("#signOut").classList.toggle("hidden", !ok);
    if (!ok) {
      if (user) fb.signOut();
      hostLogin($("#login"), fb, "Admin Panel");
      return;
    }
    if (!started) {
      started = true;
      run(fb);
    }
  });
  $("#signOut").addEventListener("click", () => fb.signOut().then(() => location.reload()));
}

function run(fb) {
  const { db } = fb;
  let live = null;
  let bank = [];
  let used = {};
  let codes = {};
  let claims = {};

  const tx = async (fn, done) => {
    try {
      const next = await transactLive(db, fn);
      if (!next) toast("That can't be done right now.", "error");
      else if (done) logEvent(db, done);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  // ---------- Listeners ----------

  onValue(ref(db, "live"), (s) => {
    live = s.val();
    if (!live) {
      set(ref(db, "live"), G.initialLive());
      return;
    }
    renderGame();
    renderScores();
  });
  onValue(ref(db, "secret/questions"), (s) => { bank = Object.values(s.val() || {}); renderBank(); renderGame(); });
  onValue(ref(db, "secret/used"), (s) => { used = s.val() || {}; renderBank(); });
  onValue(ref(db, "secret/codes"), (s) => { codes = s.val() || {}; renderCodes(); });
  onValue(ref(db, "claims"), (s) => {
    claims = s.val() || {};
    renderCodes();
    // Who has joined, for the leaderboards (team ids only, never the codes).
    set(ref(db, "roster"), Object.fromEntries(Object.keys(claims).map((id) => [id, true]))).catch(() => {});
  });
  onValue(ref(db, "history"), (s) => {
    const items = Object.values(s.val() || {}).sort((a, b) => b.at - a.at).slice(0, 40);
    $("#history").innerHTML = items.length
      ? items.map((h) => `<li><time>${new Date(h.at).toLocaleTimeString()}</time> ${esc(h.text)}</li>`).join("")
      : `<li class="muted">Nothing yet.</li>`;
  });
  onValue(ref(db, "engine"), (s) => {
    const e = s.val();
    const el = $("#engineState");
    const fresh = () => e && fb.now() - (e.beat || 0) < 7000;
    const paint = () => {
      el.textContent = fresh() ? "Main Display: running ●" : "Main Display: not open";
      el.dataset.ok = fresh() ? "true" : "false";
    };
    paint();
    clearInterval(el._t);
    el._t = setInterval(paint, 2000);
  });

  // ---------- Game controls ----------

  // Only teams with a device signed in take turns. In demo mode with bots
  // on, the bots play the rest, so every team takes part.
  $("#btnStart").addEventListener("click", () => {
    if (!bank.length) return toast("Upload the questions first.", "error");
    const bots = fb.isDemo && localStorage.getItem("riskit.demo.bots") === "on";
    const players = TEAMS.map((t) => t.id).filter((id) => bots || claims[id]);
    if (!players.length) return toast("No team has joined yet. Teams join with their code first.", "error");
    if (players.length < TEAMS.length && !confirm(
      `Start with ${players.length} of ${TEAMS.length} teams? Only these take turns:\n\n${players.map(G.teamName).join(", ")}\n\nTeams that join later can watch but won't get turns.`)) return;
    tx((s) => G.startGame(s, fb.now(), players), `Game started with ${players.length} ${players.length === 1 ? "team" : "teams"}`);
  });
  $("#btnPause").addEventListener("click", () => {
    if (live?.status === "paused") tx((s) => G.resume(s, fb.now()), "Game resumed");
    else tx((s) => G.pause(s, fb.now()), "Game paused");
  });
  $("#btnSkip").addEventListener("click", () => {
    if (!confirm(`Skip ${live?.activeTeam ? G.teamName(live.activeTeam) + "'s" : "this"} turn? No points are given.`)) return;
    tx((s) => (s.status === "running" || s.status === "paused" ? G.nextTurn(s, fb.now()) : undefined),
      `Turn skipped${live?.activeTeam ? ` (${G.teamName(live.activeTeam)})` : ""}`);
  });
  $("#btnReset").addEventListener("click", async () => {
    if (!confirm("Reset the whole game? Scores go to 0, every question becomes unused again, and the game goes back to the lobby. Team codes stay.")) return;
    await update(ref(db), {
      live: G.initialLive(),
      actions: null,
      history: null,
      "secret/used": null,
    });
    logEvent(db, "Game reset");
    toast("Game reset.");
  });

  function renderGame() {
    if (!live) return;
    const statusText = {
      lobby: "In the lobby, not started",
      running: "Running",
      paused: "Paused",
      finished: "Finished",
    }[live.status] ?? live.status;
    $("#statusLine").textContent = statusText;
    $("#progressLine").textContent = live.status === "running" || live.status === "paused" ? progressText(live) : "";
    $("#btnStart").disabled = live.status !== "lobby";
    $("#btnPause").disabled = !["running", "paused"].includes(live.status);
    $("#btnPause").textContent = live.status === "paused" ? "Resume" : "Pause";
    $("#btnSkip").disabled = !["running", "paused"].includes(live.status);

    const q = live.question;
    const full = q && bank.find((b) => b.id === q.id);
    const phase = {
      lobby: "Waiting to start", roundIntro: `Round ${live.round} title card`, ready: "Waiting for Ready",
      choose: "Choosing Safe / Risk", spinning: "Wheel spinning", question: "Answering", reveal: "Showing the answer",
      finished: "Game over",
    }[live.phase] ?? live.phase;
    $("#nowPlaying").innerHTML = `
      <dl class="kv">
        <div><dt>Team</dt><dd>${live.activeTeam ? esc(G.teamName(live.activeTeam)) : "—"}</dd></div>
        <div><dt>Step</dt><dd>${esc(phase)}</dd></div>
        <div><dt>Mode</dt><dd>${esc(G.modeLabel(live) || "—")}</dd></div>
        <div><dt>Result</dt><dd>${live.result ? `${esc(live.result.outcome)} (${fmtPoints(live.result.points)})` : "—"}</dd></div>
      </dl>
      ${q ? `
        <div class="admin-q">
          <p class="overline muted">Current question · ${esc(DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty)} · ${q.seconds}s · pool "${esc(q.pool)}"</p>
          <p class="admin-q__text">${esc(q.text)}</p>
          <ol class="admin-q__choices">${q.choices.map((c, i) =>
            `<li class="${full && full.answer === i ? "is-answer" : ""}">${G.letter(i)}. ${esc(c)}${full && full.answer === i ? " ✓" : ""}</li>`).join("")}</ol>
        </div>` : ""}`;
  }

  // ---------- Scores ----------

  // Always in team order (Team 1, 2, 3 …), so a row never moves while the
  // game master is fixing it; the leaderboards show the ranking.
  function renderScores() {
    const byId = Object.fromEntries(G.ranking(live).map((t) => [t.id, t]));
    const rows = TEAMS.map((t) => byId[t.id] ?? { id: t.id, name: t.name, score: 0 });
    const tbl = $("#scores");
    if (tbl.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    tbl.innerHTML = `
      <thead><tr><th>#</th><th>Team</th><th class="num">Score</th><th>Adjust</th></tr></thead>
      <tbody>${rows.map((t, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc(t.name)}</td>
          <td class="num"><strong>${t.score}</strong></td>
          <td class="adjust">
            <button class="btn btn--sm btn--secondary" data-adj="${t.id}" data-d="-1" type="button" aria-label="Minus one">−1</button>
            <button class="btn btn--sm btn--secondary" data-adj="${t.id}" data-d="1" type="button" aria-label="Plus one">+1</button>
            <input class="control control--sm" data-set="${t.id}" type="number" step="1" placeholder="Set" aria-label="Set score for ${esc(t.name)}">
          </td>
        </tr>`).join("")}</tbody>`;
  }

  $("#scores").addEventListener("click", (e) => {
    const b = e.target.closest("[data-adj]");
    if (!b) return;
    const id = b.dataset.adj;
    const d = Number(b.dataset.d);
    runTransaction(ref(db, `live/scores/${id}`), (v) => (v || 0) + d)
      .then(() => logEvent(db, `Score fixed: ${G.teamName(id)} ${fmtPoints(d)}`));
  });
  $("#scores").addEventListener("change", (e) => {
    const inp = e.target.closest("[data-set]");
    if (!inp || inp.value === "") return;
    const id = inp.dataset.set;
    const v = Math.round(Number(inp.value));
    if (!Number.isFinite(v)) return;
    set(ref(db, `live/scores/${id}`), v).then(() => {
      logEvent(db, `Score set: ${G.teamName(id)} = ${v}`);
      inp.value = "";
      inp.blur();
      renderScores();
    });
  });

  // ---------- Codes ----------

  function makeCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const pick = () => abc[crypto.getRandomValues(new Uint32Array(1))[0] % abc.length];
    return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}`;
  }

  $("#btnCodes").addEventListener("click", () => {
    if (Object.keys(codes).length && !confirm("Make new codes? The old codes stop working. Devices already signed in stay signed in.")) return;
    generateCodes();
  });

  async function generateCodes() {
    const fresh = {};
    const lookup = {};
    for (const t of TEAMS) {
      let c;
      do { c = makeCode(); } while (lookup[c]);
      fresh[t.id] = c;
      lookup[c] = t.id;
    }
    await update(ref(db), { codes: lookup, "secret/codes": fresh });
    logEvent(db, "New team codes generated");
    toast("New codes ready.");
  }

  function renderCodes() {
    $("#codes").innerHTML = `
      <thead><tr><th>Team</th><th>Code</th><th>Device</th><th></th></tr></thead>
      <tbody>${TEAMS.map((t) => `
        <tr>
          <td>${esc(t.name)}</td>
          <td><code class="code">${esc(codes[t.id] ?? "—")}</code></td>
          <td>${claims[t.id] ? `<span class="badge badge--success">Joined</span>` : `<span class="badge badge--neutral">Not yet</span>`}</td>
          <td>${claims[t.id] ? `<button class="btn btn--sm btn--ghost" data-release="${t.id}" type="button">Release</button>` : ""}</td>
        </tr>`).join("")}</tbody>`;
  }

  $("#codes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-release]");
    if (!b) return;
    const id = b.dataset.release;
    if (!confirm(`Release ${G.teamName(id)}'s device? It goes back to the code screen and the code can be used on another device.`)) return;
    remove(ref(db, `claims/${id}`)).then(() => logEvent(db, `${G.teamName(id)} device released`));
  });

  $("#btnPrint").addEventListener("click", () => {
    if (!Object.keys(codes).length) return toast("Generate the codes first.", "error");
    $("#printSheet").innerHTML = TEAMS.map((t) => `
      <div class="print-card">
        <img src="assets/ieee-uob-logo.png" alt="">
        <p class="print-card__game">Risk It</p>
        <p class="print-card__team">${esc(t.name)}</p>
        <p class="print-card__code">${esc(codes[t.id])}</p>
        <p class="print-card__hint">Open the team page and type this code.</p>
      </div>`).join("");
    window.print();
  });

  // ---------- Question bank ----------

  async function uploadBank(raw, label) {
    let list;
    try {
      list = G.normaliseBank(raw);
    } catch (e) {
      return toast(`Question file problem: ${e.message}`, "error");
    }
    if (live && live.status !== "lobby" && !confirm("A game is in progress. Replace the questions anyway?")) return;
    const byId = Object.fromEntries(list.map((q) => [q.id, q]));
    await set(ref(db, "secret/questions"), byId);
    logEvent(db, `Question bank loaded: ${list.length} questions (${label})`);
    toast(`${list.length} questions uploaded.`);
  }

  $("#bankFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      await uploadBank(JSON.parse(await file.text()), file.name);
    } catch {
      toast("That file isn't valid JSON.", "error");
    }
  });

  async function loadSample() {
    try {
      const res = await fetch("questions/questions.json", { cache: "no-store" });
      if (!res.ok) throw new Error();
      await uploadBank(await res.json(), "placeholder file");
    } catch {
      toast("Couldn't load questions/questions.json. Use Upload file instead.", "error");
    }
  }
  $("#btnSample").addEventListener("click", loadSample);

  $("#btnClearUsed").addEventListener("click", () => {
    if (!confirm("Mark every question as unused? Questions already asked could come up again.")) return;
    remove(ref(db, "secret/used")).then(() => logEvent(db, "All questions marked unused"));
  });

  function renderBank() {
    if (!bank.length) {
      $("#bank").innerHTML = `<p class="empty">No questions uploaded yet.</p>`;
      return;
    }
    const pools = ["normal", ...WHEEL.map((w) => w.id), "allin"];
    const label = (p) => (p === "normal" ? "Normal (Safe)" : p === "allin" ? "All In" : WHEEL.find((w) => w.id === p)?.label ?? p);
    const count = (r, p) => {
      const all = bank.filter((q) => q.round === r && q.pool === p);
      const left = all.filter((q) => !used[q.id]).length;
      return { all: all.length, left };
    };
    const need = G.TURNS_PER_ROUND;
    $("#bank").innerHTML = `
      <p class="muted">${bank.length} questions · ${Object.keys(used).length} used. Each cell shows <strong>unused / total</strong>. A pool needs up to ${need} per round to be safe.</p>
      <div class="table-scroll"><table class="table table--bank">
        <thead><tr><th>Pool</th>${ROUNDS.map((r) => `<th class="num">Round ${r.number}</th>`).join("")}</tr></thead>
        <tbody>${pools.map((p) => `
          <tr><td>${esc(label(p))}</td>${ROUNDS.map((r) => {
            const c = count(r.number, p);
            const relevant = p === "normal" || (p === "allin" ? r.choices.includes("allin") : r.choices.includes("risk"));
            if (!relevant && !c.all) return `<td class="num muted">·</td>`;
            const warn = relevant && c.left < need;
            return `<td class="num ${warn ? "warn" : ""}">${c.left} / ${c.all}</td>`;
          }).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
  }

  // ---------- Demo helpers ----------

  if (fb.isDemo) {
    $("#demoCard").classList.remove("hidden");
    $("#btnQuick").addEventListener("click", async () => {
      await loadSample();
      if (!Object.keys(codes).length) await generateCodes();
    });

    const BOTS_KEY = "riskit.demo.bots";
    let botsOn = localStorage.getItem(BOTS_KEY) === "on";
    const planned = new Set();
    const paintBots = () => {
      $("#btnBots").textContent = botsOn ? "Bots: on" : "Bots: off";
      $("#btnBots").setAttribute("aria-pressed", String(botsOn));
      $("#btnBots").className = `btn ${botsOn ? "btn--primary" : "btn--secondary"}`;
    };
    paintBots();
    $("#btnBots").addEventListener("click", () => {
      botsOn = !botsOn;
      localStorage.setItem(BOTS_KEY, botsOn ? "on" : "off");
      paintBots();
      bot();
    });

    // Presses the buttons for the active team when no device has joined it.
    const bot = () => {
      const s = live;
      if (!botsOn || !s || s.status !== "running" || !s.activeTeam || claims[s.activeTeam]) return;
      if (!["ready", "choose", "question"].includes(s.phase)) return;
      const key = `${s.turnId}:${s.phase}`;
      if (planned.has(key)) return;
      planned.add(key);
      const delay = { ready: 1200, choose: 1500, question: 2500 + Math.random() * 3000 }[s.phase];
      setTimeout(() => {
        const n = live;
        if (!n || n.turnId !== s.turnId || n.phase !== s.phase || n.status !== "running") {
          planned.delete(key);
          return bot();
        }
        let type = "ready";
        let value = null;
        if (s.phase === "choose") {
          const options = G.roundCfg(s.round).choices;
          type = "mode";
          value = options[Math.floor(Math.random() * options.length)];
        } else if (s.phase === "question") {
          const right = bank.find((q) => q.id === s.question.id)?.answer ?? 0;
          const count = s.question.choices.length;
          type = "answer";
          value = Math.random() < 0.65 ? right : (right + 1 + Math.floor(Math.random() * (count - 1))) % count;
        }
        set(ref(db, `actions/${s.activeTeam}`), { type, value, turnId: s.turnId, at: serverTimestamp() });
      }, delay);
    };
    onValue(ref(db, "live"), bot);
    onValue(ref(db, "claims"), bot);
  }
}
