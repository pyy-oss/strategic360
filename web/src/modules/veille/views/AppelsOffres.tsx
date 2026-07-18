import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { T, PROX } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useToast } from "../../../design/overlay";
import { usePaged, Pager } from "../components/Pager";
import { PUBLISHED_STATUSES, useIntelItems, updateIntelItem, type IntelItem } from "../lib/intel";
import { createAction } from "../lib/execution";
import { effectiveProx, isPastDue } from "../lib/freshness";

/**
 * Détection Appels d'offres — vue DÉDIÉE aux signaux d'AO / financements (subtype "tender", et en
 * option "funding"/"budget"), sortis du Fil pour un pilotage business development. Chaque ligne
 * expose l'angle business extrait par l'IA (acheteur, montant estimé, échéance, référence du
 * portail) + un CTA « Créer une action » (rattachée au signal) et le lien vers la source officielle.
 * Trié par proximité d'échéance effective (imminent d'abord) puis score. Données réelles Firestore.
 */

const AO_SUBTYPES = new Set(["tender", "funding", "budget"]);
const PROX_ORDER: Record<string, number> = { imminent: 0, court: 1, moyen: 2, horizon: 3 };
const PROX_COLOR: Record<string, string> = { imminent: T.clay, court: T.gold, moyen: T.steel, horizon: T.faint };

function deadlineOf(it: IntelItem): string | undefined {
  return it.businessAngle?.deadline || it.dueDate || undefined;
}

function AoRow({ it }: { it: IntelItem }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sp, setSp] = useSearchParams();
  const ba = it.businessAngle || {};
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

  return (
    <tr style={{ borderTop: `1px solid ${T.line}`, opacity: past ? 0.6 : 1 }}>
      <td style={{ padding: "8px 8px", color: T.ink, maxWidth: 320 }}>
        <div style={{ fontWeight: 600 }}>{it.title}</div>
        {it.soWhat && <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{it.soWhat}</div>}
        {ba.tenderRef && <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>Réf : {ba.tenderRef}</div>}
      </td>
      <td style={{ padding: "8px 8px", color: T.ink }}>{buyer}{ba.bu ? <div style={{ fontSize: 10.5, color: T.faint }}>{ba.bu}</div> : null}</td>
      <td style={{ padding: "8px 8px", color: ba.estAmount ? T.emerald : T.faint, whiteSpace: "nowrap" }}>{ba.estAmount || "n.c."}</td>
      <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
        <span style={{ color: PROX_COLOR[prox] || T.dim, fontWeight: 600 }}>{PROX[prox]?.l || prox}</span>
        {deadline && <div style={{ fontSize: 10.5, color: past ? T.clay : T.faint }}>{deadline}{past ? " (dépassée)" : ""}</div>}
      </td>
      <td style={{ padding: "8px 8px", textAlign: "center", color: T.ink }}>{Math.round(it.priorityScore ?? 0)}</td>
      <td style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
        {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="pill" style={{ fontSize: 10.5, padding: "2px 8px", textDecoration: "none" }}>Portail ↗</a>}{" "}
        <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={openInFil}>Fil</button>{" "}
        <button className="pill on" style={{ fontSize: 10.5, padding: "2px 8px" }} disabled={busy} onClick={() => void createLinkedAction()}>{busy ? "…" : "Action"}</button>
      </td>
    </tr>
  );
}

export function AppelsOffres() {
  const { items, loading } = useIntelItems();
  const [withAmount, setWithAmount] = useState(false);
  const [withDeadline, setWithDeadline] = useState(false);
  const [proxFilter, setProxFilter] = useState("all");
  const [zone, setZone] = useState("all");
  const [q, setQ] = useState("");
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  const aoItems = useMemo(
    () => items.filter((s) => AO_SUBTYPES.has(s.subtype ?? "") && PUBLISHED_STATUSES.has(s.status)),
    [items]
  );
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
          (proxFilter === "all" || prox === proxFilter) &&
          (zone === "all" || s.geo === zone) &&
          (!q || norm(`${s.title} ${s.summary || ""} ${ba.buyer || ""} ${s.ent || ""} ${ba.tenderRef || ""}`).includes(norm(q)))
        );
      })
      .sort((a, b) => {
        const pa = PROX_ORDER[effectiveProx(a) ?? a.prox ?? "horizon"] ?? 3;
        const pb = PROX_ORDER[effectiveProx(b) ?? b.prox ?? "horizon"] ?? 3;
        return pa - pb || (b.priorityScore ?? 0) - (a.priorityScore ?? 0) || (b.date ?? "").localeCompare(a.date ?? "");
      }),
    [aoItems, withAmount, withDeadline, proxFilter, zone, q]
  );

  const kpiOuverts = aoItems.filter((s) => !isPastDue(s)).length;
  const kpiUrgent = aoItems.filter((s) => { const p = effectiveProx(s) ?? s.prox; return (p === "imminent" || p === "court") && !isPastDue(s); }).length;
  const kpiMontant = aoItems.filter((s) => !!s.businessAngle?.estAmount).length;
  const kpiEcheance = aoItems.filter((s) => !!deadlineOf(s)).length;

  const paged = usePaged(rows, 25);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.gold}>Détection Appels d'offres — opportunités marché (AO · financements · budgets)</Eyebrow>
        <Badge>{rows.length} affiché(s)</Badge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 12 }}>
        <Kpi label="AO ouverts" value={String(kpiOuverts)} />
        <Kpi label="Échéance imminente / courte" value={String(kpiUrgent)} />
        <Kpi label="Montant chiffré" value={String(kpiMontant)} />
        <Kpi label="Avec échéance" value={String(kpiEcheance)} />
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
      </div>

      <div className="tbl-scroll" style={{ marginTop: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 720 }}>
          <thead>
            <tr>
              {["Appel d'offres", "Acheteur", "Montant est.", "Échéance", "Score", ""].map((h) => (
                <th key={h} style={{ textAlign: h === "Score" ? "center" : "left", padding: "6px 8px", color: T.dim, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((it) => <AoRow key={it.id} it={it} />)}
            {!loading && !rows.length && (
              <tr><td colSpan={6} style={{ padding: 14, color: T.dim, fontSize: 12.5 }}>
                Aucun appel d'offres détecté pour ces filtres. Les AO proviennent des portails branchés (marchés publics, UEMOA, bailleurs) via la synchro de veille — élargissez les sources dans Détection ou relancez une synchro.
              </td></tr>
            )}
            {loading && !items.length && <tr><td colSpan={6} style={{ padding: 14, color: T.dim, fontSize: 12.5 }}>Chargement…</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager {...paged} />
    </Card>
  );
}
