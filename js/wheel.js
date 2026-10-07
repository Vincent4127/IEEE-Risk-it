// The Risk wheel. Slice sizes follow the segment weights in config.js.
// The landing angle comes from the spin id, so every screen stops on the
// exact same spot.

import { WHEEL } from "./config.js";

const TURNS = 6;
const total = WHEEL.reduce((a, w) => a + w.weight, 0);
const slices = (() => {
  let start = 0;
  return WHEEL.map((w) => {
    const sweep = (w.weight / total) * 360;
    const s = { ...w, start, end: start + sweep };
    start += sweep;
    return s;
  });
})();

function point(angle, r) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

const EMOJI_FONT = `"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;

// Each slice: its colour (green safe → red risky), a big emoji near the rim
// and the name nearer the middle. Lucky Point's slice is too thin for words,
// so it shows the emoji alone.
export function wheelSVG() {
  const paths = slices.map((s) => {
    const [x1, y1] = point(s.start, 96);
    const [x2, y2] = point(s.end, 96);
    const large = s.end - s.start > 180 ? 1 : 0;
    const mid = (s.start + s.end) / 2;
    const sweep = s.end - s.start;
    const turn = mid > 180 ? mid + 90 : mid - 90; // keep labels upright
    const [ex, ey] = point(mid, sweep < 30 ? 70 : 78);
    const [tx, ty] = point(mid, 44);
    // Names of more than one word over ten letters go on two lines.
    const words = s.label.split(" ");
    const lines = s.label.length > 10 && words.length > 1
      ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
      : [s.label];
    const label = sweep < 30 ? "" : `
      <text x="${tx}" y="${ty}" transform="rotate(${turn} ${tx} ${ty})"
        text-anchor="middle" dominant-baseline="middle" fill="${s.ink ?? "#fff"}"
        font-family="Karla, sans-serif" font-weight="700" font-size="${lines.length > 1 ? 9.5 : 10.5}">${lines.map((l, i) =>
          `<tspan x="${tx}" dy="${i === 0 ? (lines.length - 1) * -0.55 : 1.1}em">${l}</tspan>`).join("")}</text>`;
    return `
      <path d="M100 100 L${x1} ${y1} A96 96 0 ${large} 1 ${x2} ${y2} Z" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>
      <text x="${ex}" y="${ey}" transform="rotate(${mid} ${ex} ${ey})" text-anchor="middle" dominant-baseline="central"
        font-family='${EMOJI_FONT}' font-size="${sweep < 30 ? 13 : 17}">${s.emoji ?? ""}</text>${label}`;
  }).join("");
  return `
    <div class="wheel">
      <div class="wheel__pointer" aria-hidden="true"></div>
      <svg class="wheel__disc" viewBox="0 0 200 200" role="img" aria-label="Risk wheel">
        <circle cx="100" cy="100" r="99" fill="#fff"/>
        ${paths}
        <circle cx="100" cy="100" r="14" fill="#fff" stroke="#016eb6" stroke-width="3"/>
      </svg>
    </div>`;
}

// Final rotation (degrees) that puts the chosen slice under the top pointer.
export function landingAngle(segment, spinId) {
  const s = slices[segment];
  const frac = ((spinId % 1000) / 1000) * 0.7 + 0.15; // stay away from the edges
  const at = s.start + (s.end - s.start) * frac;
  return TURNS * 360 + (360 - at);
}

// Spins `el` (the element from wheelSVG) so it lands at `endsAt` (server ms).
export function spin(el, segment, spinId, endsAt, now) {
  const disc = el.querySelector(".wheel__disc");
  const final = landingAngle(segment, spinId);
  const remaining = endsAt - now - 400; // land a moment before the phase ends
  if (remaining < 600) {
    disc.style.transition = "none";
    disc.style.transform = `rotate(${final}deg)`;
    el.classList.add("wheel--landed");
    return;
  }
  disc.style.transition = "none";
  disc.style.transform = "rotate(0deg)";
  disc.getBoundingClientRect(); // restart from zero
  disc.style.transition = `transform ${remaining}ms cubic-bezier(.12,.75,.15,1)`;
  disc.style.transform = `rotate(${final}deg)`;
  setTimeout(() => el.classList.add("wheel--landed"), remaining);
}
