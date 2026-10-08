// Game-show sounds, made in the browser with Web Audio (no sound files to
// download). Browsers only allow sound after someone clicks or taps the
// page, so the first click anywhere switches sound on. The mute choice is
// remembered on this device.

const KEY = "riskit.sound";
let ctx = null;
let muted = (() => {
  try { return localStorage.getItem(KEY) === "off"; } catch { return false; }
})();
const listeners = new Set();

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
for (const type of ["pointerdown", "keydown"]) {
  addEventListener(type, () => { audio(); listeners.forEach((f) => f()); }, { passive: true });
}

export const isMuted = () => muted;
// True once the browser lets this page play sound.
export const isReady = () => !!ctx && ctx.state === "running";
export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(KEY, value ? "off" : "on"); } catch { /* private mode */ }
  listeners.forEach((f) => f());
}
export const onSoundChange = (f) => listeners.add(f);

function tone(freq, start, length, { type = "sine", gain = 0.18, slide = null } = {}) {
  const a = audio();
  if (!a || muted || a.state !== "running") return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

const notes = (list, step, opts) => list.forEach((f, i) => tone(f, i * step, opts.length ?? 0.3, opts));

export const sfx = {
  // The last five seconds of a question; the final second is higher.
  tick: (secs) => tone(secs <= 1 ? 1320 : 990, 0, 0.09, { type: "square", gain: 0.07 }),
  correct: () => notes([523, 659, 784, 1047], 0.09, { type: "triangle", gain: 0.17, length: 0.28 }),
  wrong: () => {
    tone(233, 0, 0.32, { type: "sawtooth", gain: 0.11, slide: 150 });
    tone(175, 0.2, 0.45, { type: "sawtooth", gain: 0.11, slide: 110 });
  },
  timeout: () => tone(392, 0, 0.7, { type: "square", gain: 0.07, slide: 98 }),
  turn: () => {
    tone(880, 0, 0.16, { type: "triangle", gain: 0.15 });
    tone(1319, 0.13, 0.28, { type: "triangle", gain: 0.15 });
  },
  round: () => notes([392, 523, 659, 784], 0.13, { type: "triangle", gain: 0.15, length: 0.4 }),
  // Clicks that slow down like the wheel, for `seconds`.
  spin: (seconds) => {
    let t = 0;
    let gap = 0.045;
    while (t < seconds - 0.25) {
      tone(1700, t, 0.03, { type: "square", gain: 0.045 });
      t += gap;
      gap *= 1.075;
    }
    tone(1047, Math.max(0, seconds - 0.1), 0.35, { type: "triangle", gain: 0.16 });
  },
  // A cash register for All In: the drawer bell "ka-ching", then coins.
  cash: () => {
    tone(1568, 0, 0.09, { type: "square", gain: 0.06 });
    tone(2637, 0.08, 0.7, { type: "triangle", gain: 0.2 });
    tone(3951, 0.08, 0.5, { type: "sine", gain: 0.08 });
    tone(2093, 0.1, 0.6, { type: "triangle", gain: 0.1 });
    for (let i = 0; i < 7; i++) {
      tone(3200 + Math.random() * 1600, 0.32 + i * 0.055 + Math.random() * 0.02, 0.07, { type: "sine", gain: 0.06 });
    }
  },
  win: () => {
    notes([523, 659, 784], 0.14, { type: "triangle", gain: 0.16, length: 0.3 });
    notes([1047, 1047, 1319, 1568], 0.12, { type: "triangle", gain: 0.17, length: 0.5 });
  },
};

// A mute button: shows "Sound on", "Muted", or "Tap for sound" while the
// browser is still blocking audio.
const ICON_ON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`;
export function soundButton(btn) {
  const paint = () => {
    const off = muted;
    btn.innerHTML = `${off ? ICON_OFF : ICON_ON}<span class="tool-btn__label">${off ? "Muted" : isReady() ? "Sound on" : "Tap for sound"}</span>`;
    btn.setAttribute("aria-pressed", String(off));
    btn.setAttribute("aria-label", off ? "Sound is off. Turn sound on" : "Sound is on. Mute");
  };
  // The page-wide "first tap turns sound on" runs before this click, so
  // remember whether sound was already on when the tap began: the first tap
  // only switches sound on, later taps mute and unmute.
  let readyAtTap = false;
  btn.addEventListener("pointerdown", () => { readyAtTap = isReady(); });
  btn.addEventListener("click", () => {
    if (readyAtTap || muted) setMuted(!muted);
    else { audio(); paint(); }
    readyAtTap = isReady();
  });
  onSoundChange(paint);
  paint();
  setTimeout(paint, 300);
}
