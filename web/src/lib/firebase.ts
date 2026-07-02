import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

/**
 * Firebase client SDK bootstrap. Reads config from `import.meta.env.VITE_FIREBASE_*`
 * (see web/.env.example). No real Firebase project is provisioned in this sandbox, so
 * missing/blank env vars must NOT crash the app at import time — we log a warning and
 * export a `configured: false` flag instead. Callers (e.g. AuthProvider) should check
 * `isFirebaseConfigured` before relying on `auth`/`db`/`functions` actually reaching a backend.
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  functions = getFunctions(app);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[firebase] VITE_FIREBASE_* env vars are missing/incomplete — Firebase is not initialized. " +
      "Copy web/.env.example to web/.env.local and fill in your project config. " +
      "Auth/Firestore/Functions calls will fail until then."
  );
  // Initialize with a placeholder config so importers can still construct SDK handles without
  // throwing; every real network call will fail loudly instead of the module failing to load.
  app = initializeApp({ apiKey: "not-configured", projectId: "not-configured", appId: "not-configured" });
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  functions = getFunctions(app);
}

export { app, auth, db, functions };
