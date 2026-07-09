module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs", "vite.config.ts"],
  parser: "@typescript-eslint/parser",
  // react-hooks (audit intégral 2026-07, m9) : le plugin est désormais ENREGISTRÉ — sans lui, les
  // `// eslint-disable react-hooks/exhaustive-deps` du code faisaient échouer `npm run lint` avec
  // « rule not found », ce qui empêchait d'ajouter le lint web à la CI.
  plugins: ["react-refresh", "react-hooks"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    // rules-of-hooks = erreur (vrai bug) ; exhaustive-deps = avertissement (non bloquant en CI).
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
  },
};
