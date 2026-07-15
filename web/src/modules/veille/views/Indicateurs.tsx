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
export function Indicateurs() {
  const { data: quanti, loading } = useQuantiSummary();
  const kris = (quanti?.kris ?? []).filter((k) => k.val != null);

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
          {kris.map((k, i) => {
            const col = k.stat ? STCOL[k.stat] : T.faint;
            return (
              <Card key={i} style={{ borderTop: `3px solid ${col}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Eyebrow>{k.n}</Eyebrow>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: col, marginTop: 2 }} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 24, color: T.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {k.val}
                    {k.u}
                  </div>
                  <div style={{ fontSize: 11, color: T.faint, marginTop: 6 }}>Valeur actuelle — calculée depuis les imports internes.</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
