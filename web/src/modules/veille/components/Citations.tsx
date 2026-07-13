import React from "react";
import { useNavigate } from "react-router-dom";
import { T } from "../../../design/tokens";
import type { FrameworkSource } from "../lib/frameworks";

/**
 * Citations [n] CLIQUABLES (levier « waouh » n°3 : la provenance « défendable en comité »). Les
 * cadres (SWOT/PESTEL) citent leurs signaux par numéro [n] ; sans mapping, ce n'était que du texte
 * mort (« on croit sur parole »). `sources` (persisté par l'enrichissement) associe chaque n au
 * signal source → un clic ouvre le Fil sur ce signal (par entité, sinon vue générale).
 */
function openSource(navigate: ReturnType<typeof useNavigate>, src?: FrameworkSource) {
  if (src?.ent) navigate(`/veille/fil?ent=${encodeURIComponent(src.ent)}`);
  else navigate("/veille/fil");
}

/** Rend un texte en transformant chaque `[n]` en pastille cliquable vers le signal n. */
export function CitedText({ text, sources }: { text: string; sources?: FrameworkSource[] }) {
  const navigate = useNavigate();
  const byN = React.useMemo(() => {
    const m = new Map<number, FrameworkSource>();
    for (const s of sources ?? []) m.set(s.n, s);
    return m;
  }, [sources]);
  if (!sources || sources.length === 0) return <>{text}</>;
  const parts = String(text).split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const mm = /^\[(\d+)\]$/.exec(part);
        if (!mm) return <React.Fragment key={i}>{part}</React.Fragment>;
        const n = Number(mm[1]);
        const src = byN.get(n);
        return (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); openSource(navigate, src); }}
            title={src ? `Source [${n}] : ${src.title}` : `Source [${n}]`}
            style={{ border: "none", background: T.steel + "26", color: T.steel, cursor: "pointer", fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 6, margin: "0 2px", verticalAlign: "1px", lineHeight: 1.6 }}
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

/** Bandeau « Sources » sous un cadre : les signaux numérotés, cliquables. */
export function SourcesFooter({ sources }: { sources?: FrameworkSource[] }) {
  const navigate = useNavigate();
  if (!sources || sources.length === 0) return null;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
      <div style={{ fontSize: 10.5, color: T.faint, marginBottom: 6, fontWeight: 600 }}>Sources ({sources.length}) — cliquez pour ouvrir le signal</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sources.map((s) => (
          <button
            key={s.n}
            onClick={() => openSource(navigate, s)}
            title={s.title}
            style={{ border: `1px solid ${T.line}`, background: T.panel2, color: T.dim, cursor: "pointer", fontSize: 10.5, padding: "3px 8px", borderRadius: 999, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            <span style={{ color: T.steel, fontWeight: 700 }}>[{s.n}]</span> {s.title || "signal"}
          </button>
        ))}
      </div>
    </div>
  );
}
