// Small UI helpers shared by the screens.

import { HOST_EMAIL } from "./config.js";
import { ranking, initials } from "./game.js";

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind ? `toast--${kind}` : ""}`;
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

export const fmtPoints = (p) => (p > 0 ? `+${p}` : `${p}`);

// Live leaderboard. Keeps the previous scores so it can flash +/- changes.
export function createLeaderboard(listEl, { compact = false } = {}) {
  let prev = null;
  return function render(live) {
    const rows = ranking(live);
    const medals = ["gold", "silver", "bronze"];
    listEl.innerHTML = rows.map((t, i) => {
      const delta = prev && prev[t.id] !== undefined ? t.score - prev[t.id] : 0;
      const cls = [
        "lb__row",
        i < 3 && t.score > 0 ? `lb__row--${medals[i]}` : "",
        live?.activeTeam === t.id ? "lb__row--active" : "",
      ].join(" ");
      return `
        <li class="${cls}">
          <span class="lb__rank">${i + 1}</span>
          <span class="lb__avatar">${esc(initials(t.name))}</span>
          <span class="lb__name">${esc(t.name)}${delta ? `<span class="lb__delta lb__delta--${delta > 0 ? "up" : "down"}">${fmtPoints(delta)}</span>` : ""}</span>
          <span class="lb__score">${t.score}</span>
        </li>`;
    }).join("");
    if (compact) listEl.classList.add("lb--compact");
    prev = Object.fromEntries(rows.map((t) => [t.id, t.score]));
  };
}

// Countdown: fills `el` with seconds left and sets --progress (1 → 0).
export function startCountdown(el, getEnd, total, now, pausedRemaining) {
  let raf;
  const draw = () => {
    const end = getEnd();
    const left = pausedRemaining() ?? Math.max(0, end - now());
    const secs = Math.ceil(left / 1000);
    el.style.setProperty("--progress", total ? Math.min(1, left / total) : 0);
    el.dataset.urgent = secs <= 5 ? "true" : "false";
    const num = el.querySelector("[data-secs]");
    if (num && num.textContent !== String(secs)) num.textContent = secs;
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}

// Login card for the game master (Main Display and Admin Panel).
export function hostLogin(root, fb, title) {
  root.innerHTML = `
    <form class="card card--elevated card--pad-lg login-card" novalidate>
      <img class="login-card__logo" src="assets/ieee-uob-logo.png" alt="IEEE UOB Student Branch">
      <div>
        <p class="overline" style="color:var(--color-brand)">Game master</p>
        <h1 class="h2">${esc(title)}</h1>
      </div>
      <label class="field">
        <span class="field__label">Email</span>
        <input class="control" name="email" type="email" autocomplete="username" value="${esc(HOST_EMAIL)}" required>
      </label>
      <label class="field">
        <span class="field__label">Password</span>
        <input class="control" name="password" type="password" autocomplete="current-password" required autofocus ${fb.isDemo ? 'value="demo"' : ""}>
      </label>
      ${fb.isDemo ? `<p class="field__helper">Demo mode: any password works.</p>` : ""}
      <p class="field__error hidden" data-error></p>
      <button class="btn btn--primary btn--lg btn--block" type="submit">Sign in</button>
    </form>`;
  const form = root.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = form.querySelector("[data-error]");
    const btn = form.querySelector("button");
    btn.disabled = true;
    err.classList.add("hidden");
    try {
      await fb.signInHost(form.email.value.trim(), form.password.value);
    } catch (ex) {
      err.textContent = "Wrong email or password.";
      err.classList.remove("hidden");
      btn.disabled = false;
    }
  });
}
