// Demo backend: a stand-in for Firebase that keeps the database in this
// browser's localStorage and syncs every open tab. Same functions as the
// Firebase SDK, so the game code doesn't know the difference.
// Only for trying the game on one computer: nothing leaves this browser and
// the security rules are not applied.

import { HOST_EMAIL } from "./config.js";

const DB_KEY = "riskit.demo.db";
const AUTH_KEY = "riskit.demo.auth.";
const TS = { ".sv": "timestamp" };

// ---------- Tree helpers ----------

const split = (path) => String(path || "").split("/").filter(Boolean);

function load() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch { return {}; }
}

function getAt(tree, path) {
  let cur = tree;
  for (const k of split(path)) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
}

// Mirrors Firebase: nulls and empty objects disappear, timestamps resolve.
function clean(v) {
  if (v === undefined || v === null) return null;
  if (v && v[".sv"] === "timestamp") return Date.now();
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c !== null) out[k] = c;
    }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

function setAt(tree, path, value) {
  const keys = split(path);
  if (!keys.length) return clean(value) || {};
  const chain = [tree];
  let cur = tree;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
    chain.push(cur);
  }
  const last = keys[keys.length - 1];
  const v = clean(value);
  if (v === null) delete cur[last];
  else cur[last] = v;
  // drop parents left empty
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length === 0) delete chain[i - 1][keys[i - 1]];
    else break;
  }
  return tree;
}

// ---------- Shared state ----------

let tree = load();
const listeners = new Set();

function notify() {
  for (const l of listeners) {
    const json = JSON.stringify(getAt(tree, l.path));
    if (json !== l.last) {
      l.last = json;
      l.cb(snapshot(l.path, json));
    }
  }
}

function write(mutate) {
  tree = load(); // start from the newest copy, other tabs may have written
  tree = mutate(tree) || tree;
  localStorage.setItem(DB_KEY, JSON.stringify(tree));
  setTimeout(notify, 0);
}

window.addEventListener("storage", (e) => {
  if (e.key === DB_KEY) {
    tree = load();
    notify();
  }
});

function snapshot(path, json) {
  const v = json === undefined ? getAt(tree, path) : JSON.parse(json);
  return { key: split(path).pop() ?? null, val: () => structuredClone(v), exists: () => v !== null };
}

// ---------- Firebase-style API ----------

export const ref = (db, path = "") => ({ path: split(path).join("/") });
export const serverTimestamp = () => TS;

export function onValue(r, cb) {
  if (r.path === ".info/serverTimeOffset") {
    setTimeout(() => cb({ val: () => 0, exists: () => true }), 0);
    return () => {};
  }
  const l = { path: r.path, cb, last: undefined };
  listeners.add(l);
  setTimeout(() => {
    if (!listeners.has(l)) return;
    l.last = JSON.stringify(getAt(tree, l.path));
    cb(snapshot(l.path, l.last));
  }, 0);
  return () => listeners.delete(l);
}

export async function get(r) {
  tree = load();
  return snapshot(r.path);
}

export async function set(r, value) {
  write((t) => setAt(t, r.path, value));
}

export async function update(r, values) {
  write((t) => {
    for (const [k, v] of Object.entries(values)) t = setAt(t, `${r.path}/${k}`, v);
    return t;
  });
}

export async function remove(r) {
  return set(r, null);
}

let pushCount = 0;
export async function push(r, value) {
  const key = `${Date.now().toString(36)}${(pushCount++).toString(36).padStart(4, "0")}`;
  await set({ path: `${r.path}/${key}` }, value);
  return { key };
}

export async function runTransaction(r, fn) {
  let committed = false;
  write((t) => {
    const next = fn(structuredClone(getAt(t, r.path)));
    if (next === undefined) return t;
    committed = true;
    return setAt(t, r.path, next);
  });
  return { committed, snapshot: snapshot(r.path) };
}

// ---------- Auth stand-in ----------

export function connect(appName) {
  const key = AUTH_KEY + appName;
  const auth = {
    get currentUser() {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
  };
  const subs = new Set();
  const setUser = (u) => {
    u ? localStorage.setItem(key, JSON.stringify(u)) : localStorage.removeItem(key);
    subs.forEach((cb) => setTimeout(() => cb(u), 0));
  };
  showBadge();

  return {
    isDemo: true,
    auth,
    db: {},
    now: () => Date.now(),
    onAuth(cb) {
      subs.add(cb);
      setTimeout(() => cb(auth.currentUser), 0);
      return () => subs.delete(cb);
    },
    async signInHost(email) {
      if (email !== HOST_EMAIL) throw new Error("wrong email");
      setUser({ uid: "host", email });
    },
    async signInAnon() {
      setUser({ uid: `anon-${Math.random().toString(36).slice(2, 10)}`, email: null });
    },
    async signOut() {
      setUser(null);
    },
  };
}

function showBadge() {
  if (document.getElementById("demoBadge")) return;
  const el = document.createElement("div");
  el.id = "demoBadge";
  el.className = "demo-badge";
  el.textContent = "Demo mode · this browser only";
  el.title = "Firebase isn't connected yet, so the game runs inside this browser. Open the screens as tabs to test.";
  document.body.appendChild(el);
}
