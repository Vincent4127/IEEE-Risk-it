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

// Teams with a device signed in, ranked by points. `roster` is the
// { teamId: true } list the Main Display and Admin Panel keep up to date.
export function standings(live, roster) {
  return ranking(live).filter((t) => roster?.[t.id]);
}

// A medal: two ribbon straps in IEEE blues over a metal disc with the place
// on it. Gold, silver and bronze for places 1 to 3.
const METALS = {
  gold: ["#fff0a8", "#f4c63a", "#c9930f", "#7a5606"],
  silver: ["#ffffff", "#d9dee4", "#a9b3be", "#47505a"],
  bronze: ["#ffd9b8", "#e39a5f", "#b06a33", "#6b3a12"],
};
export function medalSVG(place) {
  const kind = ["gold", "silver", "bronze"][place - 1];
  if (!kind) return "";
  const [hi, mid, lo, ink] = METALS[kind];
  const g = `medal-${kind}`;
  return `<svg class="medal" viewBox="0 0 40 50" role="img" aria-label="${["Gold", "Silver", "Bronze"][place - 1]} medal, place ${place}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/>
    </linearGradient></defs>
    <path d="M6 0h10l8 20h-10z" fill="#0f2547"/>
    <path d="M34 0h-10l-8 20h10z" fill="#016eb6"/>
    <path d="M24 0h10l-5 12z" fill="#4fa6e6" opacity=".55"/>
    <circle cx="20" cy="33" r="15" fill="url(#${g})" stroke="${lo}" stroke-width="1.5"/>
    <circle cx="20" cy="33" r="11" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="1.2"/>
    <text x="20" y="38.5" text-anchor="middle" font-family="Karla, sans-serif" font-size="15" font-weight="700" fill="${ink}">${place}</text>
  </svg>`;
}

// Live leaderboard of the teams that have joined. It follows the points:
// when places change, rows glide to their new spot, and a score change
// flashes +/-.
export function createLeaderboard(listEl, { compact = false, me = null } = {}) {
  let prev = null;
  return function render(live, roster) {
    const rows = standings(live, roster);
    if (compact) listEl.classList.add("lb--compact");
    if (!rows.length) {
      listEl.innerHTML = `<li class="lb__empty">No teams have joined yet</li>`;
      prev = {};
      return;
    }
    const scored = rows.some((t) => t.score !== 0);
    const before = new Map([...listEl.querySelectorAll("[data-team]")].map((el) => [el.dataset.team, el.getBoundingClientRect().top]));
    listEl.innerHTML = rows.map((t, i) => {
      const delta = prev && prev[t.id] !== undefined ? t.score - prev[t.id] : 0;
      const medal = scored && i < 3 ? ["gold", "silver", "bronze"][i] : "";
      const cls = [
        "lb__row",
        medal ? `lb__row--${medal}` : "",
        live?.activeTeam === t.id ? "lb__row--active" : "",
        me === t.id ? "lb__row--me" : "",
      ].join(" ");
      return `
        <li class="${cls}" data-team="${t.id}">
          <span class="lb__rank">${medal ? medalSVG(i + 1) : `<span class="lb__place">${i + 1}</span>`}</span>
          <span class="lb__name">${esc(t.name)}${me === t.id ? `<span class="lb__you">You</span>` : ""}${delta ? `<span class="lb__delta lb__delta--${delta > 0 ? "up" : "down"}">${fmtPoints(delta)}</span>` : ""}</span>
          <span class="lb__score">${t.score}</span>
        </li>`;
    }).join("");
    // Glide: start each row where it was, then let it move to its new place.
    if (before.size && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      listEl.querySelectorAll("[data-team]").forEach((el) => {
        const was = before.get(el.dataset.team);
        if (was === undefined) return;
        const dy = was - el.getBoundingClientRect().top;
        if (!dy) return;
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = "";
          el.style.transform = "";
        }));
      });
    }
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
