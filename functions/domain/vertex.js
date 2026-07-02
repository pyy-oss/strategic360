"use strict";

/**
 * Thin wrapper around `@google/genai` (the unified Google Gen AI SDK — BUILD_KIT.md §10:
 * "classifyAI/generateBriefing — Vertex AI/Gemini"). This module is the ONLY place in the
 * codebase that constructs a Gen AI client / calls `generateContent` — everything else (prompt
 * construction, response parsing, Firestore writes) lives in pure, unit-testable functions in
 * `domain/classify.js` and `domain/briefing.js` that never import this file's network path
 * directly at test time (they receive an already-built JSON response as input).
 *
 * MIGRATION HISTORY (2026-07-02, from real production runs against propulse-business-87f7a):
 * 1. Started on `@google-cloud/vertexai` (old SDK) in Vertex AI mode — 404'd on every model name
 *    tried (3 names, 2 regions). That SDK's own deprecation notice ("removed June 24, 2026", a
 *    date already past) suggested a dead API path, so migrated to `@google/genai`.
 * 2. Still in Vertex AI mode (`{vertexai:true, project, location}`) — STILL 404'd on 4 model names
 *    across 2 regions, despite Vertex AI Studio in the Console successfully chatting with Gemini
 *    on this same project (ruling out billing/ToS/org-policy as the cause).
 * 3. Root cause: the code snippet Vertex AI Studio itself generates ("Code" tab) does NOT use
 *    Vertex AI mode at all — it authenticates with `{ apiKey: ... }`, i.e. the **Gemini Developer
 *    API** (Google AI Studio's backend), a DIFFERENT product from enterprise Vertex AI with its
 *    own model rollout schedule. `gemini-3.5-flash` is available there but wasn't resolving via
 *    the Vertex AI publisher-model path for this project. Switched this module to Developer-API
 *    mode (`apiKey`) accordingly — requires a `GEMINI_API_KEY` secret (Secret Manager via
 *    `firebase-functions/params#defineSecret`, wired in functions/index.js), NOT the service
 *    account JSON used everywhere else in this codebase.
 *
 * NOT unit-tested end-to-end here: there is no real GCP project/credentials in this sandbox (no
 * network egress to Gemini endpoints). This file is verified with `node --check` only (structural
 * correctness against the documented SDK surface) until re-verified against the real project.
 */

const { GoogleGenAI } = require("@google/genai");

/**
 * `gemini-3.5-flash` — confirmed available via the Gemini Developer API (Vertex AI Studio's own
 * generated code sample) for propulse-business-87f7a as of 2026-07-02. If this 404s again in the
 * future (model lineup drift), check Vertex AI Studio's "Code" export tab for the CURRENT working
 * snippet rather than guessing model names/auth modes blindly — see MIGRATION HISTORY above.
 */
const DEFAULT_MODEL = "gemini-3.5-flash";

let cachedClient = null;
let cachedApiKey = null;

/**
 * Lazily constructs (and memoizes) the Gen AI client in Gemini Developer API mode (API-key auth,
 * NOT the service-account/project/location Vertex AI mode used to fail — see MIGRATION HISTORY).
 * Lazy so that importing this module (e.g. transitively via functions/index.js) never throws in
 * environments without `GEMINI_API_KEY` set (local `node --check`, unit tests of
 * domain/classify.js and domain/briefing.js that never call `generateJson`).
 */
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "vertex.js: GEMINI_API_KEY is not set — Gen AI client cannot be initialized. " +
        "This is expected in local/test environments; only fails when generateJson() is actually invoked. " +
        "In production this must be wired as a Secret Manager secret (see functions/index.js)."
    );
  }

  if (cachedClient && cachedApiKey === apiKey) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({ apiKey });
  cachedApiKey = apiKey;
  return cachedClient;
}

/**
 * Calls Gemini with `prompt`, asking for a JSON response (`config.responseMimeType:
 * "application/json"`), and returns the parsed JSON object.
 *
 * @param {string} prompt Full prompt text (already includes any schema description — Gemini's
 *   JSON mode constrains the *format* of the output, not a rigid schema by itself unless a
 *   `responseSchema` is also supplied; callers here describe the desired shape in the prompt).
 * @param {object} [schema] Optional JSON Schema-ish object passed through as
 *   `config.responseSchema` for stricter structured output.
 * @returns {Promise<any>} Parsed JSON response body.
 */
async function generateJson(prompt, schema) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("generateJson: prompt (non-empty string) is required.");
  }

  const ai = getClient();
  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const config = { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 2048 };
  if (schema) config.responseSchema = schema;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config,
  });

  // `@google/genai` exposes a `.text` convenience getter that concatenates all text parts of the
  // first candidate; fall back to manual extraction if it's ever absent (defensive — SDK surface).
  const text =
    typeof response.text === "string"
      ? response.text
      : (response.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "");

  if (!text.trim()) {
    throw new Error("generateJson: empty response text from Gemini.");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`generateJson: response is not valid JSON — ${err.message}. Raw text: ${text.slice(0, 500)}`);
  }
}

module.exports = { generateJson, getClient, DEFAULT_MODEL };
