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

const notes = (list, step, opts, at = 0) => list.forEach((f, i) => tone(f, at + i * step, opts.length ?? 0.3, opts));

// Filtered white noise, for drums, cymbals, dice and the sword.
let noiseBuf = null;
function noise(start, length, { gain = 0.2, filter = "bandpass", freq = 2000, q = 0.8 } = {}) {
  const a = audio();
  if (!a || muted || a.state !== "running") return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + start;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const amp = a.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(f).connect(amp).connect(a.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.05);
}

// Recorded clips in assets/sounds. They're decoded once, as soon as the page
// loads, so they're ready by the first spin.
// Steal 2 keeps its made pirate fanfare and sword (see RESULT below).
const CLIPS = {
  drumroll: "drumroll.mp3",
  doubleornothing: "doubleornothing.mp3",
  drink: "drink.wav",
  lucky: "lucky.wav",
  cash: "cash.mp3",
};
const clips = {};
function loadClips() {
  const a = audio();
  if (!a) return;
  for (const [name, file] of Object.entries(CLIPS)) {
    clips[name] ??= fetch(new URL(`../assets/sounds/${file}`, import.meta.url))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => a.decodeAudioData(b))
      .catch(() => null);
  }
}
loadClips();

// Plays clip `name` from `start` seconds after now for at most `length`
// seconds (looping if it's shorter), fading out at the end. Resolves false
// when there's no such clip, so the caller can fall back to a made sound.
async function clip(name, start, length, { gain = 0.9, loop = false } = {}) {
  const a = audio();
  if (!a || muted || !clips[name]) return false;
  const t0 = a.currentTime + start;
  const buf = await clips[name];
  if (!buf || muted || a.state !== "running") return !!buf;
  const at = Math.max(a.currentTime, t0);
  const late = at - t0; // seconds lost while the clip was still loading
  const play = length - late;
  if (play <= 0.05) return true;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = loop && buf.duration < length;
  const amp = a.createGain();
  const fade = Math.min(0.3, play / 3);
  amp.gain.setValueAtTime(gain, at);
  amp.gain.setValueAtTime(gain, at + play - fade);
  amp.gain.linearRampToValueAtTime(0.0001, at + play);
  src.connect(amp).connect(a.destination);
  src.start(at, src.loop ? 0 : Math.min(late, buf.duration));
  src.stop(at + play + 0.05);
  return true;
}

// Made-in-the-browser sounds for results with no recorded clip (and as a
// fallback if a clip fails to load), starting `at` seconds from now.
const RESULT = {
  // Two shakes of the dice, then a tense rising tone.
  doubleornothing: (at) => {
    for (const shake of [0, 0.32]) {
      for (let i = 0; i < 6; i++) noise(at + shake + i * 0.03 + Math.random() * 0.012, 0.025, { gain: 0.22, filter: "highpass", freq: 2800 });
    }
    tone(220, at + 0.7, 0.9, { type: "sawtooth", gain: 0.06, slide: 440 });
  },
  // A pirate "yo-ho" in a minor key, then a sword being drawn.
  steal: (at) => {
    notes([220, 262, 330], 0.14, { type: "sawtooth", gain: 0.09, length: 0.2 }, at);
    tone(311, at + 0.42, 0.45, { type: "sawtooth", gain: 0.09 });
    noise(at + 0.95, 0.45, { gain: 0.14, filter: "highpass", freq: 6000 });
    tone(2400, at + 0.95, 0.4, { type: "sine", gain: 0.07, slide: 4200 });
  },
  // An electric zap, then a bright power-up.
  double: (at) => {
    tone(1800, at, 0.25, { type: "sawtooth", gain: 0.1, slide: 120 });
    noise(at, 0.2, { gain: 0.1, filter: "highpass", freq: 4000 });
    notes([659, 988], 0.12, { type: "triangle", gain: 0.17, length: 0.32 }, at + 0.3);
  },
  // Bubbling potion and a spooky wobble.
  drink: (at) => {
    for (let i = 0; i < 11; i++) {
      const f = 280 + Math.random() * 420;
      tone(f, at + i * 0.08 + Math.random() * 0.04, 0.07, { type: "sine", gain: 0.12, slide: f * 2.2 });
    }
    tone(330, at + 0.25, 1.1, { type: "sine", gain: 0.07 });
    tone(337, at + 0.25, 1.1, { type: "sine", gain: 0.07 });
  },
  // A sparkly rising chime and a coin.
  lucky: (at) => {
    notes([1568, 2093, 2637, 3136], 0.06, { type: "sine", gain: 0.1, length: 0.35 }, at);
    tone(1976, at + 0.3, 0.09, { type: "square", gain: 0.05 });
    tone(2637, at + 0.38, 0.45, { type: "square", gain: 0.05 });
  },
};

// Suspense when a team picks Risk it: a dark, swelling chord that rises,
// with a tremolo on top, about 1.4 seconds.
function suspense(at) {
  for (const [f, to] of [[98, 131], [104, 139], [147, 196]]) tone(f, at, 1.4, { type: "sawtooth", gain: 0.06, slide: to });
  for (let i = 0; i < 12; i++) tone(587, at + 0.2 + i * 0.09, 0.08, { type: "triangle", gain: 0.012 + i * 0.004 });
}

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
  // The whole Risk it spin: a suspense swell, the drum roll until the wheel
  // lands `land` seconds from now, then the clip for the result it landed on
  // (`id` from WHEEL) while the result shows, `show` seconds.
  wheel: (land, id, show = 3) => {
    land = Math.max(0.6, land);
    suspense(0);
    const rollFrom = Math.min(0.9, land / 2);
    clip("drumroll", rollFrom, land - rollFrom, { gain: 0.8, loop: true }).then((ok) => {
      if (!ok) for (let t = rollFrom; t < land - 0.03; t += 0.045) noise(t, 0.05, { gain: 0.04 + 0.2 * ((t - rollFrom) / (land - rollFrom)), freq: 1800, q: 0.7 });
    });
    clip(id, land, show).then((ok) => { if (!ok) RESULT[id]?.(land); });
  },
  // A cash register for All In: the recorded "ka-ching", or a made one if
  // the clip can't play.
  cash: () => clip("cash", 0, 2.5).then((ok) => {
    if (ok) return;
    tone(1568, 0, 0.09, { type: "square", gain: 0.06 });
    tone(2637, 0.08, 0.7, { type: "triangle", gain: 0.2 });
    tone(3951, 0.08, 0.5, { type: "sine", gain: 0.08 });
    tone(2093, 0.1, 0.6, { type: "triangle", gain: 0.1 });
    for (let i = 0; i < 7; i++) tone(3200 + Math.random() * 1600, 0.32 + i * 0.055, 0.07, { type: "sine", gain: 0.06 });
  }),
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
