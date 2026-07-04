import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";

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

/**
 * App Check (V8 Durcissement, BUILD_KIT.md §13/§3 "Firebase Hosting ... App Check"). Site key for
 * the reCAPTCHA v3 provider — Firebase Console > App Check > register a reCAPTCHA v3 site key for
 * this web app, then set VITE_FIREBASE_APPCHECK_SITE_KEY (see web/.env.example). Deliberately
 * OPTIONAL/best-effort: App Check is enabled client-side only when the key is present, so local
 * dev / this sandbox (no real key) keeps working without it. `functions/index.js` documents the
 * matching server-side `enforceAppCheck` rollout sequencing — DO NOT flip enforcement on in
 * Functions before this client-side piece is actually configured against a real site key, or
 * every callable will start rejecting requests.
 */
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;

/**
 * Named Firestore database (shared-project isolation). When this Firebase project hosts other
 * apps, set VITE_FIREBASE_FIRESTORE_DATABASE_ID to a dedicated database (e.g. "strategic360") so
 * this app never reads/writes the project's "(default)" database, which other apps may already
 * be using. Defaults to "(default)" — the standard single-database behavior — when unset.
 * Mirrors functions/index.js's FIRESTORE_DATABASE_ID (must match for client/server reads to agree).
 */
const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "(default)";

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let functions: Functions;
let appCheck: AppCheck | undefined;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(
    app,
    { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
    firestoreDatabaseId
  );
  // Région EXPLICITE : toutes les Cloud Functions sont déployées en europe-west1. Sans ce
  // paramètre, getFunctions() vise us-central1 par défaut → tous les callables échouent
  // silencieusement (endpoint inexistant), d'où un portefeuille Copilote vide et des « internal ».
  functions = getFunctions(app, "europe-west1");

  if (appCheckSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[firebase] VITE_FIREBASE_APPCHECK_SITE_KEY is not set — App Check is NOT enabled client-side. " +
        "Requests will still work as long as Functions haven't turned on enforceAppCheck yet " +
        "(see functions/index.js). Set the site key before enabling server-side enforcement."
    );
  }
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
  // Région EXPLICITE : toutes les Cloud Functions sont déployées en europe-west1. Sans ce
  // paramètre, getFunctions() vise us-central1 par défaut → tous les callables échouent
  // silencieusement (endpoint inexistant), d'où un portefeuille Copilote vide et des « internal ».
  functions = getFunctions(app, "europe-west1");
}

export { app, auth, db, functions, appCheck };
