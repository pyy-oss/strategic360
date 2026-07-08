// Config ESLint minimale — CI « durcissement » (2026-07). But UNIQUE : attraper `no-undef`
// (variable référencée mais non déclarée) que `node --check` ne détecte pas — la classe de bug
// qui a cassé le Copilote en prod (clientProfile non défini dans assembleCopiloteContext). On ne
// fait PAS de linting de style ici, seulement la sûreté d'exécution. Auto-suffisante (globals Node
// déclarés en dur → pas de dépendance @eslint/js ni globals).

const NODE_GLOBALS = {
  require: "readonly", module: "writable", exports: "writable", process: "readonly",
  console: "readonly", Buffer: "readonly", __dirname: "readonly", __filename: "readonly",
  global: "readonly", globalThis: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  setImmediate: "readonly", clearImmediate: "readonly", queueMicrotask: "readonly",
  URL: "readonly", URLSearchParams: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
  AbortController: "readonly", AbortSignal: "readonly",
  fetch: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly",
  FormData: "readonly", Blob: "readonly", structuredClone: "readonly", performance: "readonly",
  crypto: "readonly", atob: "readonly", btoa: "readonly",
};

export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  {
    // Code applicatif (CommonJS).
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs", globals: NODE_GLOBALS },
    rules: { "no-undef": "error" },
  },
  {
    // Tests (ESM : import depuis vitest).
    files: ["test/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: NODE_GLOBALS },
    rules: { "no-undef": "error" },
  },
];
