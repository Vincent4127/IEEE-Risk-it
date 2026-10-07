// Small UI helpers shared by the screens.

import { GAME_TITLE, HOST_EMAIL } from "./config.js";
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

// Login card for the game master (Main Display and Admin Panel). The email
// is fixed, so only the password is asked for; the email still sits in the
// form, out of sight, so password managers can pair the two.
const EYE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/></svg>`;

export function hostLogin(root, fb, title) {
  root.innerHTML = `
    <form class="login-card" novalidate>
      <img class="login-card__logo" src="assets/ieee-uob-logo.png" alt="IEEE UOB Student Branch" width="480" height="157">
      <div class="login-card__head">
        <h1 class="login-card__title">${esc(GAME_TITLE)}</h1>
        <p class="login-card__sub">Game master · ${esc(title)}</p>
      </div>
      <input class="login-card__user" name="email" type="email" autocomplete="username" value="${esc(HOST_EMAIL)}" tabindex="-1" aria-hidden="true" readonly>
      <label class="field">
        <span class="field__label">Password</span>
        <span class="login-card__pw">
          <input class="control control--lg" name="password" type="password" autocomplete="current-password" required autofocus ${fb.isDemo ? 'value="demo"' : ""}>
          <button class="login-card__eye" type="button" aria-label="Show password" aria-pressed="false">${EYE}</button>
        </span>
      </label>
      ${fb.isDemo ? `<p class="field__helper">Demo mode: any password works.</p>` : ""}
      <p class="field__error hidden" data-error role="alert"></p>
      <button class="btn btn--primary btn--lg btn--block login-card__submit" type="submit">
        <span class="login-card__spinner" aria-hidden="true"></span>
        <span data-label>Sign in</span>
      </button>
    </form>`;
  const form = root.querySelector("form");
  const pw = form.password;
  const err = form.querySelector("[data-error]");
  const btn = form.querySelector(".login-card__submit");
  const label = btn.querySelector("[data-label]");
  const showError = (msg) => {
    err.textContent = msg;
    err.classList.remove("hidden");
    pw.setAttribute("aria-invalid", "true");
  };

  const eye = form.querySelector(".login-card__eye");
  eye.addEventListener("click", () => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    eye.innerHTML = show ? EYE_OFF : EYE;
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    eye.setAttribute("aria-pressed", String(show));
    pw.focus();
  });
  pw.addEventListener("input", () => {
    pw.removeAttribute("aria-invalid");
    err.classList.add("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pw.value) {
      showError("Enter the game master password.");
      pw.focus();
      return;
    }
    btn.disabled = true;
    btn.classList.add("is-loading");
    label.textContent = "Signing in…";
    err.classList.add("hidden");
    try {
      await fb.signInHost(form.email.value.trim(), pw.value);
    } catch (ex) {
      showError("Wrong password. Try again.");
      pw.select();
      btn.disabled = false;
      btn.classList.remove("is-loading");
      label.textContent = "Sign in";
    }
  });
}
