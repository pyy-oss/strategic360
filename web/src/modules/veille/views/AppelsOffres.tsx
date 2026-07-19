import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { T, PROX } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge, LoadError } from "../../../design/ui";
import { useToast } from "../../../design/overlay";
import { usePaged, Pager } from "../components/Pager";
import { PUBLISHED_STATUSES, useIntelItems, updateIntelItem, runEnrichTendersNow, type IntelItem } from "../lib/intel";
import { createAction } from "../lib/execution";
import { effectiveProx, isPastDue } from "../lib/freshness";
import { useIsExec } from "../../../lib/rbac";
import { useCopiloteAccounts, type CopiloteAccount } from "../lib/copilote";

/**
 * Détection Appels d'offres — vue DÉDIÉE aux signaux d'AO / financements (subtype "tender", et en
 * option "funding"/"budget"), sortis du Fil pour un pilotage business development. Chaque ligne
 * expose l'angle business extrait par l'IA (acheteur, montant estimé, échéance, référence du
 * portail) + un CTA « Créer une action » (rattachée au signal) et le lien vers la source officielle.
 * Trié par proximité d'échéance effective (imminent d'abord) puis score. Données réelles Firestore.
 */

// Un VRAI appel d'offres se distingue d'une simple actu « qui parle » de financement/marché par un
// signal fort : une RÉFÉRENCE de portail extraite (ex. « AOOR N°2026-005/MESRI »), OU un INTITULÉ
// d'avis d'appel d'offres (2026-07 : le classifieur sur-taguait des news en subtype tender/funding
// → la vue se remplissait de commentaires au lieu d'AO réels. On filtre donc sur la forme de l'avis,
// pas sur le subtype ni sur des mots-clés noyés dans le corps du texte).
// NB : l'acronyme AMI exige ses POINTS (`A\.M\.I`) — sans eux, `/i` matchait le mot courant « ami »
// (« Orange, l'ami des PME » passait pour un AO). Les vrais « Avis à Manifestation d'Intérêt » restent
// captés par la branche « manifestation … d'intérêt » en toutes lettres (audit 2026-07-19, M1).
const AO_NOTICE_RE = /\bappel\s?s?\s+(?:d['’ ]?)?offres?\b|avis\s+(?:d['’ ]?)?appel|manifestation\s+(?:d['’ ]?)?int[ée]r[êe]ts?|sollicitation\s+de\s+prix|demande\s+de\s+(?:propositions?|cotations?|prix)|appel\s+à\s+(?:candidatures?|projets?|manifestation)|\b(?:A\.?A\.?O|A\.?O\.?O\.?R?|A\.?O\.?[NIR]|A\.M\.I|D\.?A\.?O|D\.?R\.?P|R\.?F\.?[PQ])\b/i;
// Une VRAIE référence de dossier contient un numéro/code (ex. « AOOR N°2026-005/MESRI », « DAO 12/2026 »).
// Un simple NOM de portail (« Portail Malien des Marchés Publics ») n'en est pas une : le classifieur
// mettait parfois le nom de la source dans tenderRef, ce qui faisait passer des actualités pour des AO.
const REAL_REF_RE = /\d{2,}|N[°o]\s*\d|\b[A-Z]{2,}[-/]\d/;
// Opérations de MARCHÉ FINANCIER (émission de dette/capital) : ce ne sont PAS des appels d'offres
// auxquels on peut soumissionner — une « réf » chiffrée (ISIN, code FCTC…) les faisait passer à tort
// (ex. « titrisation de créances Groupe BSIC »). On les exclut explicitement de la vue AO (2026-07).
const FINANCIAL_OP_RE = /titrisation|obligataire|emprunt\s+obligataire|lev[ée]{1,2}\s+de\s+fonds|augmentation\s+de\s+capital|introduction\s+en\s+bourse|\bIPO\b|notation\s+financi|eurobond|\bFCTC\b|[ée]mission\s+(?:d['’ ]?)?(?:obligations?|titres|emprunt)/i;
function isAoItem(s: IntelItem): boolean {
  // Provenance obligatoire (validation 2026-07) : un AO qu'on ne peut pas OUVRIR n'a aucune valeur
  // opérationnelle. On exige donc une URL source — cela masque aussi les avis déjà publiés AVANT le
  // gate backend (qui, lui, ne rejette que les nouveaux items `pending`).
  if (!s.url || !s.url.trim()) return false;
  // Exclusion des opérations financières (titrisation, obligataire…) : jamais des AO soumissionnables.
  if (FINANCIAL_OP_RE.test(s.title || "")) return false;
  // Subtype "tender" = source de vérité du backend (WB le force ; le classifieur tague les vrais AO).
  // Sans ça, un AO IT à titre sobre et sans réf (que le recall #145 publie exprès, ex. « Acquisition
  // d'équipements informatiques ») restait masqué ici alors qu'il est bien un appel d'offres (2026-07-19, H1).
  if (s.subtype === "tender") return true;
  const ref = s.businessAngle?.tenderRef || "";
  // Réf de dossier crédible (avec numéro/code) = signal le plus fiable.
  if (REAL_REF_RE.test(ref)) return true;
  // Sinon, l'intitulé doit être un avis d'appel d'offres (pas une actu générale).
  return AO_NOTICE_RE.test(s.title || "");
}
const PROX_ORDER: Record<string, number> = { imminent: 0, court: 1, moyen: 2, horizon: 3 };
const PROX_COLOR: Record<string, string> = { imminent: T.clay, court: T.gold, moyen: T.steel, horizon: T.faint };

function deadlineOf(it: IntelItem): string | undefined {
  return it.businessAngle?.deadline || it.dueDate || undefined;
}

const normName = (v: string) => (v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function AoRow({ it, account }: { it: IntelItem; account?: CopiloteAccount }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sp, setSp] = useSearchParams();
  const ba = it.businessAngle || {};
  const bus = account?.nt360?.bus && account.nt360.bus.length ? account.nt360.bus.join(", ") : ba.bu || "";
  const prox = effectiveProx(it) ?? it.prox ?? "horizon";
  const past = isPastDue(it);
  const buyer = ba.buyer || it.ent || "—";
  const deadline = deadlineOf(it);

  const createLinkedAction = async () => {
    setBusy(true);
    try {
      await createAction({
        title: `Répondre à l'AO : ${it.title}`.slice(0, 200),
        impact: it.impact === "high" ? 5 : it.impact === "medium" ? 4 : 3,
        urgence: past ? 2 : prox === "imminent" ? 5 : prox === "court" ? 4 : 3,
        effort: 3,
        ev: 0,
        owner: "—",
        echeance: deadline || "",
        statut: "À planifier",
        source: `AO : ${buyer}`,
        linkedItemId: it.id,
      });
      await updateIntelItem(it.id, { status: "actioned" });
      toast.success("Action créée (rattachée à l'AO).");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); } finally { setBusy(false); }
  };
  const openInFil = () => { const n = new URLSearchParams(sp); n.set("q", it.title.slice(0, 40)); setSp(n); };

  // Carte responsive (2026-07) : remplace la ligne de tableau large (illisible/tronquée sur mobile —
  // « décalé ») par un bloc empilé où TOUT est visible sans défilement horizontal.
  const chip = (bg: string, color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: bg, color, whiteSpace: "nowrap" });
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: "12px 14px", background: T.panel2, opacity: past ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ fontWeight: 700, color: T.ink, fontSize: 13.5, lineHeight: 1.3 }}>{it.title}</div>
        <span title="Score de priorité" style={{ ...chip(T.line, T.dim), flexShrink: 0 }}>{Math.round(it.priorityScore ?? 0)}</span>
      </div>
      {it.soWhat && (
        <div title={it.soWhat} style={{ fontSize: 12, color: T.dim, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.soWhat}</div>
      )}
      {/* Chips clés : acheteur + client connu, montant, échéance — toujours visibles, jamais coupés. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={chip(T.line, T.ink)}>{buyer}</span>
        {account && <span style={chip(T.emerald + "22", T.emerald)}>● client connu{account.tier ? ` · ${account.tier}` : ""}</span>}
        <span style={chip(ba.estAmount ? T.emerald + "22" : T.line, ba.estAmount ? T.emerald : T.faint)}>💰 {ba.estAmount || "montant n.c."}</span>
        <span style={chip((PROX_COLOR[prox] || T.dim) + "22", PROX_COLOR[prox] || T.dim)}>{PROX[prox]?.l || prox}{deadline ? ` · ${deadline}${past ? " (dépassée)" : ""}` : ""}</span>
        {bus && !account && <span style={chip(T.line, T.faint)}>{bus}</span>}
      </div>
      {ba.tenderRef && <div style={{ fontSize: 10.5, color: T.faint }}>Réf : {ba.tenderRef}</div>}
      {/* Provenance vérifiable. */}
      <div style={{ fontSize: 10.5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {it.url
          ? <a href={it.url} target="_blank" rel="noreferrer" style={{ color: T.steel, textDecoration: "none" }}>🔗 {it.sourceName || "Source"}</a>
          : <span style={{ color: T.clay, fontWeight: 600 }}>⚠ Source non tracée</span>}
        {it.date && <span style={{ color: T.faint }}>· {it.date}</span>}
        {it.sourceRating && <span style={{ color: T.faint }}>· {it.sourceRating}</span>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="pill" style={{ fontSize: 11, padding: "3px 10px", textDecoration: "none" }}>Portail ↗</a>}
        <button className="pill" style={{ fontSize: 11, padding: "3px 10px" }} onClick={openInFil}>Voir dans le Fil</button>
        <button className="pill on" style={{ fontSize: 11, padding: "3px 10px" }} disabled={busy} onClick={() => void createLinkedAction()}>{busy ? "…" : "Créer une action"}</button>
      </div>
    </div>
  );
}

export function AppelsOffres() {
  const { items, loading, error } = useIntelItems();
  const { accounts } = useCopiloteAccounts();
  const isExec = useIsExec();
  const toast = useToast();
  const [enriching, setEnriching] = useState(false);
  const [withAmount, setWithAmount] = useState(false);
  const [withDeadline, setWithDeadline] = useState(false);
  const [proxFilter, setProxFilter] = useState("all");
  const [zone, setZone] = useState("all");
  const [onlyClients, setOnlyClients] = useState(false);
  const [q, setQ] = useState("");
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  const aoItems = useMemo(
    () => items.filter((s) => isAoItem(s) && PUBLISHED_STATUSES.has(s.status)),
    [items]
  );
  // Corrélation AO ↔ compte nt360 (levier 5) : rapproche l'acheteur d'un compte connu du pipeline.
  const accIndex = useMemo(() => accounts.map((a) => ({ n: normName(a.nom), a })).filter((x) => x.n.length >= 3), [accounts]);
  // Table item→compte MÉMOÏSÉE (audit 2026-07-19, M4/M5) : `matchAccount` était un O(comptes) rappelé
  // dans le tri (n·log n fois), les KPI et à CHAQUE rendu de ligne → coût superlinéaire à chaque frappe.
  // De plus `rows` ignorait `accIndex` dans ses deps : quand les comptes chargeaient APRÈS les items, le
  // tri « clients d'abord » et le filtre « Mes clients » restaient inertes. La Map dépend d'aoItems+accIndex.
  const matchByItem = useMemo(() => {
    const m = new Map<string, CopiloteAccount | undefined>();
    for (const it of aoItems) {
      const hay = normName(`${it.businessAngle?.buyer || ""} ${it.ent || ""}`);
      m.set(it.id, hay.length < 3 ? undefined : accIndex.find((x) => hay.includes(x.n) || x.n.includes(hay))?.a);
    }
    return m;
  }, [aoItems, accIndex]);
  const matchAccount = (it: IntelItem): CopiloteAccount | undefined => matchByItem.get(it.id);
  const enrich = async () => {
    setEnriching(true);
    try {
      const r = await runEnrichTendersNow();
      toast.success(`Enrichissement AO : ${r.enriched}/${r.processed} complété(s) (${r.candidates} candidat(s)).`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'enrichissement."); } finally { setEnriching(false); }
  };
  const zones = useMemo(() => {
    const set = new Set<string>();
    aoItems.forEach((s) => { if (s.geo) set.add(s.geo); });
    return Array.from(set).sort();
  }, [aoItems]);

  const rows = useMemo(() =>
    aoItems
      .filter((s) => {
        const ba = s.businessAngle || {};
        const prox = effectiveProx(s) ?? s.prox ?? "horizon";
        return (
          (!withAmount || !!ba.estAmount) &&
          (!withDeadline || !!deadlineOf(s)) &&
          (!onlyClients || !!matchAccount(s)) &&
          (proxFilter === "all" || prox === proxFilter) &&
          (zone === "all" || s.geo === zone) &&
          (!q || norm(`${s.title} ${s.summary || ""} ${ba.buyer || ""} ${s.ent || ""} ${ba.tenderRef || ""}`).includes(norm(q)))
        );
      })
      .sort((a, b) => {
        // « Mes clients d'abord » : un AO rattaché à un compte connu remonte en tête (à imminence égale).
        const ca = matchAccount(a) ? 1 : 0;
        const cb = matchAccount(b) ? 1 : 0;
        const pa = PROX_ORDER[effectiveProx(a) ?? a.prox ?? "horizon"] ?? 3;
        const pb = PROX_ORDER[effectiveProx(b) ?? b.prox ?? "horizon"] ?? 3;
        return cb - ca || pa - pb || (b.priorityScore ?? 0) - (a.priorityScore ?? 0) || (b.date ?? "").localeCompare(a.date ?? "");
      }),
    [aoItems, matchByItem, withAmount, withDeadline, onlyClients, proxFilter, zone, q] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const kpiOuverts = aoItems.filter((s) => !isPastDue(s)).length;
  const kpiUrgent = aoItems.filter((s) => { const p = effectiveProx(s) ?? s.prox; return (p === "imminent" || p === "court") && !isPastDue(s); }).length;
  const kpiMontant = aoItems.filter((s) => !!s.businessAngle?.estAmount).length;
  const kpiEcheance = aoItems.filter((s) => !!deadlineOf(s)).length;
  const kpiComptes = accIndex.length ? aoItems.filter((s) => !!matchAccount(s)).length : 0;

  const paged = usePaged(rows, 25);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.gold}>Appels d'offres &amp; financements</Eyebrow>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {isExec && (
            <button className="pill" disabled={enriching} onClick={() => void enrich()} title="Va lire la page officielle des AO pour compléter montant / échéance" style={{ fontSize: 11, padding: "3px 10px" }}>
              {enriching ? "Enrichissement…" : "Enrichir les AO ↻"}
            </button>
          )}
          <Badge>{rows.length} affiché(s)</Badge>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 12 }}>
        <Kpi label="AO ouverts" value={String(kpiOuverts)} />
        <Kpi label="Échéance imminente / courte" value={String(kpiUrgent)} />
        <Kpi label="Montant chiffré" value={String(kpiMontant)} />
        <Kpi label="Avec échéance" value={String(kpiEcheance)} />
        {accIndex.length > 0 && <Kpi label="Sur comptes connus" value={String(kpiComptes)} />}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (acheteur, réf, mots-clés)…"
          style={{ flex: "1 1 220px", minWidth: 160, padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["all", "imminent", "court", "moyen", "horizon"].map((k) => (
            <button key={k} className={proxFilter === k ? "pill on" : "pill"} onClick={() => setProxFilter(k)} style={{ fontSize: 11, padding: "3px 9px" }}>
              {k === "all" ? "Toutes échéances" : PROX[k]?.l || k}
            </button>
          ))}
        </div>
        {zones.length > 0 && (
          <select value={zone} onChange={(e) => setZone(e.target.value)} style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12 }}>
            <option value="all">Toutes zones</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        )}
        <button className={withAmount ? "pill on" : "pill"} onClick={() => setWithAmount((v) => !v)} style={{ fontSize: 11, padding: "3px 9px" }}>Montant chiffré</button>
        <button className={withDeadline ? "pill on" : "pill"} onClick={() => setWithDeadline((v) => !v)} style={{ fontSize: 11, padding: "3px 9px" }}>Avec échéance</button>
        {accIndex.length > 0 && (
          <button className={onlyClients ? "pill on" : "pill"} onClick={() => setOnlyClients((v) => !v)} title="N'afficher que les AO émis par un compte connu du Copilote" style={{ fontSize: 11, padding: "3px 9px" }}>● Mes clients</button>
        )}
      </div>

      <LoadError error={error} what="les appels d'offres" style={{ marginTop: 12 }} />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {paged.pageItems.map((it) => <AoRow key={it.id} it={it} account={matchAccount(it)} />)}
        {!loading && !error && !rows.length && (
          <div style={{ padding: "18px 14px", color: T.dim, fontSize: 12.5 }}>
            {aoItems.length
              ? <>Aucun AO ne correspond à ces filtres. <button className="pill" onClick={() => { setWithAmount(false); setWithDeadline(false); setProxFilter("all"); setZone("all"); setQ(""); setOnlyClients(false); }} style={{ fontSize: 11, padding: "2px 9px" }}>Réinitialiser les filtres</button></>
              : <>Pas encore d'appel d'offres capté.{isExec ? <> Lancez une synchro (Radar de détection) puis <button className="pill" disabled={enriching} onClick={() => void enrich()} style={{ fontSize: 11, padding: "2px 9px" }}>{enriching ? "Enrichissement…" : "Enrichir les AO"}</button> pour compléter montant &amp; échéance.</> : " Ils apparaîtront après la prochaine synchro des portails de marchés publics."}</>}
          </div>
        )}
        {loading && !items.length && <div style={{ padding: 14, color: T.dim, fontSize: 12.5 }}>Chargement…</div>}
      </div>
      <Pager {...paged} />
    </Card>
  );
}
