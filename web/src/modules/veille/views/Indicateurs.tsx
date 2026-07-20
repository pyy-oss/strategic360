import React from "react";
import { T, STCOL } from "../../../design/tokens";
import { Eyebrow, Card } from "../../../design/ui";
import { useQuantiSummary } from "../lib/quanti";
import { Freshness } from "../components/Freshness";

/**
 * "Indicateurs avancés" (leading KRIs) — renders ONLY the KRIs actually computed by the internal
 * ingest pipeline (`summaries/quanti.kris`, written by the `ingestInternal` Cloud Function from
 * the P&L/LIVE/Facturation imports). No sample values or illustrative sparklines are rendered:
 * until the first import lands, a single explicit empty state is shown. (Sparklines will come
 * back once a `quanti` history store exists — a single snapshot has no real trend to draw.)
 */
// Libellé texte de l'état d'un KRI (passe finale 2026-07) : la pastille de couleur seule échouait
// l'accessibilité daltonisme et n'était pas explicite pour un DG. On DOUBLE la couleur d'un mot.
const STLABEL: Record<string, string> = { ok: "OK", warn: "Vigilance", alert: "Alerte" };

export function Indicateurs() {
  const { data: quanti, loading } = useQuantiSummary();
  // On garde les KRI à valeur nulle QUI PORTENT UN CAVEAT (ex. « Part de récurrent » : indisponible
  // faute de tag récurrent/projet) — l'intention backend était de montrer l'indisponibilité et sa
  // raison, pas de masquer le KRI (sinon la liste paraît faussement complète). Null SANS caveat = bruit.
  const kris = (quanti?.kris ?? []).filter((k) => k.val != null || k.caveat);

  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        📈 Indicateurs avancés (leading) avec seuils d'alerte. Contrairement aux KPIs de résultat, ils <b>anticipent</b> la performance et le risque — ce sont les capteurs du radar stratégique.
      </div>
      {loading && (
        <Card>
          <div style={{ fontSize: 12.5, color: T.faint }}>Chargement…</div>
        </Card>
      )}
      {!loading && kris.length === 0 && (
        <Card>
          <Eyebrow color={T.faint}>Indicateurs avancés</Eyebrow>
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.faint }}>
            Indicateurs avancés — en attente des imports internes (P&L/LIVE/Facturation).
          </div>
        </Card>
      )}
      {kris.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <Freshness at={(quanti?.updatedAt as { toMillis?: () => number } | undefined) ?? null} label="Données internes synchronisées" />
        </div>
      )}
      {kris.length > 0 && (
        <>
          {/* Légende des états — la couleur ne doit jamais porter le sens seule (accessibilité). */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10, fontSize: 11, color: T.dim }}>
            {(["ok", "warn", "alert"] as const).map((s) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: STCOL[s], display: "inline-block" }} />
                {STLABEL[s]}
              </span>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
            {kris.map((k, i) => {
              const pending = k.val == null;
              const col = pending ? T.faint : (k.stat ? STCOL[k.stat] : T.faint);
              return (
                <Card key={i} style={{ borderTop: `3px solid ${col}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <Eyebrow>{k.n}{k.hint && <span title={k.hint} style={{ color: T.faint, cursor: "help", marginLeft: 4, fontSize: 11 }}>ⓘ</span>}</Eyebrow>
                    {!pending && k.stat && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: col, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 8, background: col, display: "inline-block" }} />
                        {STLABEL[k.stat] ?? k.stat}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 24, color: pending ? T.faint : T.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {pending ? "—" : <>{k.val}{k.u}</>}
                    </div>
                    <div style={{ fontSize: 11, color: pending ? T.dim : (k.sub && !k.stat ? T.gold : T.dim), marginTop: 6 }}>
                      {pending ? (k.caveat || "Indisponible.") : (k.sub || "Valeur actuelle — calculée depuis les imports internes.")}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
