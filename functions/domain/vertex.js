"use strict";

/**
 * Thin wrapper around `@google-cloud/vertexai` (BUILD_KIT.md §10: "classifyAI/generateBriefing —
 * Vertex AI/Gemini"). This module is the ONLY place in the codebase that constructs a
 * `VertexAI` client / calls `generateContent` — everything else (prompt construction, response
 * parsing, Firestore writes) lives in pure, unit-testable functions in `domain/classify.js` and
 * `domain/briefing.js` that never import this file's network path directly at test time (they
 * receive an already-built JSON response as input).
 *
 * NOT unit-tested end-to-end here: there is no real GCP project/credentials in this sandbox (no
 * network egress to Vertex AI endpoints). This file is verified with `node --check` only
 * (structural correctness against the documented SDK surface), never invoked in tests.
 *
 * Model: `gemini-1.5-flash-002` — an older, very broadly available GA model, appropriate for
 * summarization/classification/JSON-extraction workloads (BUILD_KIT.md doesn't pin an exact
 * model name, only "Vertex AI (Gemini)"). Swap via `GEMINI_MODEL` env var if needed without a
 * code change.
 *
 * NOTE (found via two real production runs against propulse-business-87f7a, 2026-07-02): BOTH
 * `gemini-2.0-flash` (unversioned alias) and `gemini-2.0-flash-001` (versioned GA id) 404'd —
 * "Publisher model ... was not found or your project does not have access to it" — even though
 * Vertex AI + the aiplatform.user role were correctly enabled/granted (the error is a genuine
 * model/region availability gap for this project, not a permission problem — auth succeeded both
 * times). Fell back to `gemini-1.5-flash-002`, which has been GA and broadly available across
 * regions for far longer. If this ALSO 404s, the likely next step is enabling/accepting the
 * relevant model in Vertex AI Model Garden for this project (Console > Vertex AI > Model Garden >
 * search the model > Enable), not another model-name guess.
 */

const { VertexAI } = require("@google-cloud/vertexai");

/**
 * Vertex AI model availability varies by region — Gemini models are broadly available in
 * `us-central1`; `europe-west1` (used elsewhere in this codebase for Cloud Functions, e.g.
 * `region: "europe-west1"` in index.js) does NOT currently serve all Gemini models. The Vertex AI
 * *client* location is therefore deliberately independent of the Cloud Functions *execution*
 * region and is configurable via `VERTEX_LOCATION` (defaults to `us-central1`) — pick whichever
 * region actually serves the chosen model for your GCP project at deploy time.
 */
const DEFAULT_LOCATION = "us-central1";
const DEFAULT_MODEL = "gemini-1.5-flash-002";

let cachedClient = null;
let cachedModelName = null;

/**
 * Lazily constructs (and memoizes) the Vertex AI generative model client. Lazy so that importing
 * this module (e.g. transitively via functions/index.js) never throws in environments without
 * `GCLOUD_PROJECT` set (local `node --check`, unit tests of domain/classify.js and
 * domain/briefing.js that never call `generateJson`).
 */
function getModel() {
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!project) {
    throw new Error(
      "vertex.js: GCLOUD_PROJECT is not set — Vertex AI client cannot be initialized. " +
        "This is expected in local/test environments; only fails when generateJson() is actually invoked."
    );
  }
  const location = process.env.VERTEX_LOCATION || DEFAULT_LOCATION;
  const modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  if (cachedClient && cachedModelName === `${project}:${location}:${modelName}`) {
    return cachedClient;
  }

  const vertexAi = new VertexAI({ project, location });
  cachedClient = vertexAi.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  });
  cachedModelName = `${project}:${location}:${modelName}`;
  return cachedClient;
}

/**
 * Calls Gemini with `prompt`, asking for a JSON response (`response_mime_type:
 * "application/json"` per the Vertex AI SDK's documented `generationConfig.responseMimeType`),
 * and returns the parsed JSON object.
 *
 * @param {string} prompt Full prompt text (already includes any schema description — Vertex AI's
 *   JSON mode constrains the *format* of the output, not a rigid schema by itself unless a
 *   `responseSchema` is also supplied; callers here describe the desired shape in the prompt).
 * @param {object} [schema] Optional JSON Schema-ish object passed through as
 *   `generationConfig.responseSchema` for stricter structured output (Vertex AI supports this on
 *   `gemini-1.5+`/`gemini-2.0` models). Omit to rely on prompt-described JSON only.
 * @returns {Promise<any>} Parsed JSON response body.
 */
async function generateJson(prompt, schema) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("generateJson: prompt (non-empty string) is required.");
  }

  const model = getModel();
  const request = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
  if (schema) {
    request.generationConfig = { responseMimeType: "application/json", responseSchema: schema };
  }

  const result = await model.generateContent(request);
  const response = result.response;
  const text = response?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";

  if (!text.trim()) {
    throw new Error("generateJson: empty response text from Vertex AI.");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`generateJson: response is not valid JSON — ${err.message}. Raw text: ${text.slice(0, 500)}`);
  }
}

module.exports = { generateJson, getModel, DEFAULT_LOCATION, DEFAULT_MODEL };
