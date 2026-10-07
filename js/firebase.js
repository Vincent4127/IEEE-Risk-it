// Picks the backend for every screen.
// - firebase-config.js filled in → real Firebase (works across laptops).
// - still the placeholder → demo mode: the game lives in this browser and
//   syncs between its tabs, so you can try everything on one computer.

import { firebaseConfig } from "./firebase-config.js";

export const isDemo = String(firebaseConfig.apiKey).includes("PASTE_HERE");

const backend = isDemo ? await import("./backend-demo.js") : await import("./backend-firebase.js");

export const {
  connect, ref, onValue, get, set, update, remove, push, runTransaction, serverTimestamp,
} = backend;
