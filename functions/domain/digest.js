"use strict";

/**
 * domain/digest.js — CANAL SORTANT (audit valeur CXO 2026-07). Le systeme etait 100% "pull" : le
 * signal critique attendait que le DG se connecte. Ce module PUR construit la charge utile d'un
 * digest quotidien (top signaux prioritaires nouveaux depuis le dernier envoi) + une alerte
 * "briefing pret a revoir". L'I/O (lecture Firestore, POST webhook) vit dans index.js
 * (sendDailyDigest). Aucune dependance : transport = webhook JSON (l'utilisateur le branche sur son
 * relais email / Make / Zapier), donc aucune cle SMTP ni compte tiers a livrer.
 *
 * DISCIPLINE : on ne pousse JAMAIS un briefing (draft sous garde de revue humaine) — on notifie
 * seulement qu'il est pret a etre revu. Les signaux poussés sont des faits captés, deja classés.
 */

// Statuts EXCLUS du digest (un signal archive/rejete/en attente n'a pas a etre pousse a un dirigeant).
const DIGEST_EXCLUDED_STATUSES = new Set(["archived", "rejected", "pending", "duplicate"]);
const DEFAULT_MIN_SCORE = 70; // seuil de priorite au-dela duquel un signal merite une notification proactive
const DEFAULT_MAX = 8; // plafond d'items par digest (lisible en 30 s sur mobile)

/** ms d'un item depuis createdAt (Timestamp/Date/number) sinon la date ISO `date`, sinon null. PUR. */
function itemMillis(it) {
  const c = it && it.createdAt;
  if (c && typeof c.toMillis === "function") return c.toMillis();
  if (c instanceof Date) return c.getTime();
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (it && typeof it.date === "string") {
    const t = Date.parse(it.date);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/**
 * selectDigestSignals(items, opts) -> items a pousser. Filtre: non exclu, priorityScore>=minScore,
 * NOUVEAU depuis sinceMs (createdAt/date > sinceMs ; un item sans horodatage n'est retenu qu'au
 * TOUT PREMIER envoi sinceMs<=0, pour ne jamais re-pousser le meme signal). Tri score desc, plafond max. PUR.
 */
function selectDigestSignals(items, opts) {
  const o = opts || {};
  const minScore = Number.isFinite(o.minScore) ? o.minScore : DEFAULT_MIN_SCORE;
  const max = Number.isFinite(o.max) ? o.max : DEFAULT_MAX;
  const sinceMs = Number.isFinite(o.sinceMs) ? o.sinceMs : 0;
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((it) => it && typeof it === "object" && !Array.isArray(it))
    .filter((it) => !DIGEST_EXCLUDED_STATUSES.has(it.status))
    .filter((it) => typeof it.priorityScore === "number" && it.priorityScore >= minScore)
    .filter((it) => {
      const m = itemMillis(it);
      if (m == null) return sinceMs <= 0; // sans horodatage : seulement au 1er envoi (anti-renvoi)
      return m > sinceMs;
    })
    .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
    .slice(0, Math.max(0, max));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * buildDigestPayload({signals, briefingReady, appUrl, asOfMs, title}) -> {subject, text, html,
 * signalCount, briefingReady, url}. Compose le message poussé. `title` = nom du tenant (defaut
 * "Sentinel"). Les liens pointent vers l'app (deep-link radar/briefing), jamais vers le contenu brut. PUR.
 */
function buildDigestPayload(args) {
  const a = args || {};
  const signals = Array.isArray(a.signals) ? a.signals : [];
  const title = (typeof a.title === "string" && a.title.trim()) ? a.title.trim() : "Sentinel";
  const base = String(a.appUrl || "").replace(/\/+$/, "");
  const radarUrl = base ? `${base}/veille/radar` : "";
  const briefingUrl = base ? `${base}/veille/briefing` : "";
  const n = signals.length;
  const subject = n > 0
    ? `${title} — ${n} signal${n > 1 ? "aux" : ""} prioritaire${n > 1 ? "s" : ""} a arbitrer`
    : (a.briefingReady ? `${title} — briefing hebdo pret a revoir` : `${title} — rien de prioritaire aujourd'hui`);

  const textLines = [];
  const htmlParts = [];
  if (a.briefingReady) {
    textLines.push(`>> Briefing hebdo genere : a revoir et valider${briefingUrl ? ` — ${briefingUrl}` : ""}`, "");
    htmlParts.push(`<p style="font-weight:600">📋 Briefing hebdo généré : à revoir et valider${briefingUrl ? ` — <a href="${esc(briefingUrl)}">ouvrir</a>` : ""}</p>`);
  }
  if (n > 0) {
    textLines.push(`Top ${n} signal${n > 1 ? "aux" : ""} prioritaire${n > 1 ? "s" : ""} :`);
    htmlParts.push(`<p style="font-weight:600">Top ${n} signal${n > 1 ? "aux" : ""} prioritaire${n > 1 ? "s" : ""} :</p><ol>`);
    signals.forEach((it) => {
      const ent = it.ent ? ` — ${it.ent}` : "";
      const so = it.soWhat ? `\n   ${it.soWhat}` : "";
      textLines.push(`• [${it.priorityScore}] ${it.title || "(sans titre)"}${ent}${so}`);
      htmlParts.push(`<li><b>[${esc(it.priorityScore)}]</b> ${esc(it.title || "(sans titre)")}${esc(ent)}${it.soWhat ? `<br><span style="color:#666">${esc(it.soWhat)}</span>` : ""}</li>`);
    });
    htmlParts.push(`</ol>`);
  } else if (!a.briefingReady) {
    textLines.push("Rien de prioritaire a arbitrer aujourd'hui. La veille tourne.");
    htmlParts.push(`<p>Rien de prioritaire à arbitrer aujourd'hui. La veille tourne.</p>`);
  }
  if (radarUrl) {
    textLines.push("", `Ouvrir le radar : ${radarUrl}`);
    htmlParts.push(`<p><a href="${esc(radarUrl)}">Ouvrir le radar exécutif →</a></p>`);
  }

  return {
    subject,
    text: textLines.join("\n"),
    html: htmlParts.join("\n"),
    signalCount: n,
    briefingReady: !!a.briefingReady,
    url: radarUrl,
  };
}

/** Y a-t-il quelque chose a envoyer ? (au moins un signal OU un briefing a revoir). PUR. */
function hasDigestContent(payload) {
  return !!payload && (payload.signalCount > 0 || payload.briefingReady === true);
}

module.exports = {
  DIGEST_EXCLUDED_STATUSES,
  DEFAULT_MIN_SCORE,
  DEFAULT_MAX,
  itemMillis,
  selectDigestSignals,
  buildDigestPayload,
  hasDigestContent,
};
