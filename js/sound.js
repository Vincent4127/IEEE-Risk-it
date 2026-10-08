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

// One sound per wheel result, starting `at` seconds from now.
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
  // The whole Risk it spin, `seconds` long: a low "dun-dun", a snare roll
  // that builds under clicks slowing down with the wheel, a cymbal crash as
  // it lands, then the sound of the result it landed on (`id` from WHEEL).
  wheel: (seconds, id) => {
    const land = Math.max(0.6, seconds - 0.4); // the wheel stops 0.4 s early
    for (const at of [0, 0.3]) {
      tone(110, at, 0.28, { type: "sawtooth", gain: 0.14, slide: 70 });
      noise(at, 0.12, { gain: 0.16, filter: "lowpass", freq: 300 });
    }
    for (let t = 0.6; t < land - 0.03; t += 0.045) {
      const build = 0.04 + 0.2 * ((t - 0.6) / Math.max(0.1, land - 0.6));
      noise(t, 0.05, { gain: build, freq: 1800, q: 0.7 });
    }
    let t = 0.6;
    let gap = 0.05;
    while (t < land - 0.1) {
      tone(1700, t, 0.025, { type: "square", gain: 0.03 });
      t += gap;
      gap *= 1.07;
    }
    noise(land, 1.6, { gain: 0.28, filter: "highpass", freq: 5000, q: 0.5 });
    tone(82, land, 0.5, { type: "sine", gain: 0.25, slide: 50 });
    RESULT[id]?.(land + 0.15);
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
