"use strict";

/**
 * Thin wrapper around `@google/genai` (the unified Google Gen AI SDK — BUILD_KIT.md §10:
 * "classifyAI/generateBriefing — Vertex AI/Gemini"). This module is the ONLY place in the
 * codebase that constructs a Gen AI client / calls `generateContent` — everything else (prompt
 * construction, response parsing, Firestore writes) lives in pure, unit-testable functions in
 * `domain/classify.js` and `domain/briefing.js` that never import this file's network path
 * directly at test time (they receive an already-built JSON response as input).
 *
 * MIGRATION NOTE (2026-07-02, from a real production run against propulse-business-87f7a): this
 * file originally used `@google-cloud/vertexai` (the older `VertexAI` class). THREE different
 * model names (`gemini-2.0-flash`, `gemini-2.0-flash-001`, `gemini-1.5-flash-002`) all 404'd —
 * "Publisher model ... was not found" — with IAM/API access confirmed correct each time. The
 * actual cause: that SDK's own deprecation notice states it "will be removed on June 24, 2026" —
 * a date already in the past relative to this run — so its underlying API path had stopped
 * resolving publisher models entirely, independent of which model name was requested. Migrated to
 * `@google/genai` (Google's current unified Gen AI SDK, supporting both the Gemini Developer API
 * and Vertex AI) to fix this at the root rather than continuing to guess model names.
 *
 * NOT unit-tested end-to-end here: there is no real GCP project/credentials in this sandbox (no
 * network egress to Vertex AI endpoints). This file is verified with `node --check` only
 * (structural correctness against the documented SDK surface) until re-verified against the real
 * project in a follow-up syncSources run.
 */

const { GoogleGenAI } = require("@google/genai");

/**
 * Vertex AI model availability varies by region — Gemini models are broadly available in
 * `us-central1`; `europe-west1` (used elsewhere in this codebase for Cloud Functions, e.g.
 * `region: "europe-west1"` in index.js) does NOT currently serve all Gemini models. The Vertex AI
 * *client* location is therefore deliberately independent of the Cloud Functions *execution*
 * region and is configurable via `VERTEX_LOCATION` (defaults to `us-central1`) — pick whichever
 * region actually serves the chosen model for your GCP project at deploy time.
 */
const DEFAULT_LOCATION = "us-central1";
const DEFAULT_MODEL = "gemini-2.0-flash-001";

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
