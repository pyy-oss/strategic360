"use strict";

/**
 * Thin wrapper around `@google/genai` (the unified Google Gen AI SDK — BUILD_KIT.md §10:
 * "classifyAI/generateBriefing — Vertex AI/Gemini") in VERTEX AI mode (service-account auth via
 * ADC, consistent with the rest of this codebase — no API key to manage/rotate). This module is
 * the ONLY place in the codebase that constructs a Gen AI client / calls `generateContent` —
 * everything else (prompt construction, response parsing, Firestore writes) lives in pure,
 * unit-testable functions in `domain/classify.js` and `domain/briefing.js` that never import this
 * file's network path directly at test time (they receive an already-built JSON response as input).
 *
 * DIAGNOSIS HISTORY (2026-07-02, real production runs against propulse-business-87f7a) — read
 * this before touching model/location again:
 * 1. `@google-cloud/vertexai` (old SDK, its own notice says removed June 24 2026 — already past):
 *    404 on every model tried. Migrated to `@google/genai`.
 * 2. `@google/genai` in Vertex mode, REGIONAL endpoints (`us-central1`, `europe-west1`): still
 *    404 on `gemini-2.0-flash`, `gemini-2.0-flash-001`, `gemini-1.5-flash-002`,
 *    `gemini-3.5-flash` — "Publisher model ... was not found", with IAM (`aiplatform.user`) and
 *    the Vertex AI API confirmed enabled (Studio chats fine on this same project).
 * 3. Current hypothesis being tested: recent Gemini generations on Vertex AI are served via the
 *    GLOBAL endpoint (`location: "global"`), not the classic regional endpoints — which would
 *    explain every regional 404 above while Studio (which uses its own routing) worked.
 *    `DEFAULT_LOCATION` is therefore `"global"`; override via `VERTEX_LOCATION` if needed.
 * If `global` ALSO 404s: the fallback (already validated as the auth mode Studio's own code
 * export uses for this project) is the Gemini Developer API with an API key — see git history
 * (commit "Switch Vertex AI calls to Gemini Developer API") for the ready-made implementation.
 *
 * NOT unit-tested end-to-end here: there is no real GCP project/credentials in this sandbox (no
 * network egress to Vertex AI endpoints). This file is verified with `node --check` only
 * (structural correctness against the documented SDK surface).
 */

const { GoogleGenAI } = require("@google/genai");

/**
 * `gemini-3.5-flash` — the model Vertex AI Studio's own picker defaults to for this project as of
 * 2026-07-02 (older generations tried before it are retired — see DIAGNOSIS HISTORY).
 */
const DEFAULT_LOCATION = "global";
const DEFAULT_MODEL = "gemini-3.5-flash";

let cachedClient = null;
let cachedClientKey = null;

/**
 * Lazily constructs (and memoizes) the Gen AI client in Vertex AI mode. Lazy so that importing
 * this module (e.g. transitively via functions/index.js) never throws in environments without
 * `GCLOUD_PROJECT` set (local `node --check`, unit tests of domain/classify.js and
 * domain/briefing.js that never call `generateJson`).
 */
function getClient() {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!project) {
    throw new Error(
      "vertex.js: GCLOUD_PROJECT is not set — Gen AI client cannot be initialized. " +
        "This is expected in local/test environments; only fails when generateJson() is actually invoked."
    );
  }
  const location = process.env.VERTEX_LOCATION || DEFAULT_LOCATION;
  const key = `${project}:${location}`;

  if (cachedClient && cachedClientKey === key) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({ vertexai: true, project, location });
  cachedClientKey = key;
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

module.exports = { generateJson, getClient, DEFAULT_LOCATION, DEFAULT_MODEL };
