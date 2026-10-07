// Real backend: Firebase Realtime Database. Each screen gets its own named
// app so the Main Display, Admin Panel and team logins can sit in the same
// browser without logging each other out.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  push,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export { ref, onValue, get, set, update, remove, push, runTransaction, serverTimestamp };

export function connect(appName) {
  const app = initializeApp(firebaseConfig, appName);
  const auth = getAuth(app);
  const db = getDatabase(app);

  // Server clock: every screen counts down against the same time.
  let offset = 0;
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    offset = snap.val() || 0;
  });
  const now = () => Date.now() + offset;

  return {
    isDemo: false,
    app,
    auth,
    db,
    now,
    onAuth: (cb) => onAuthStateChanged(auth, cb),
    signInHost: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signInAnon: () => signInAnonymously(auth),
    signOut: () => signOut(auth),
  };
}
