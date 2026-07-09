import React, { useState } from "react";
import { T } from "../../../design/tokens";
import { buildSignalMessage, whatsappHref } from "../lib/signalMessage";
import type { IntelItem } from "../lib/intel";

/**
 * Bouton « ✉️ Message » (levier « waouh » n°4) sur un signal : ouvre un brouillon de prise de
 * contact DÉTERMINISTE (buildSignalMessage, sans IA), éditable, avec Copier + WhatsApp en un geste.
 * Boucle le « dernier centimètre » entre un signal chaud et l'action commerciale.
 */
export function SignalMessageButton({ item }: { item: Partial<IntelItem> }) {
  const [open, setOpen] = useState(false);
  const [corps, setCorps] = useState("");
  const [copied, setCopied] = useState(false);

  const openPanel = () => {
    if (!open) { setCorps(buildSignalMessage(item).corps); setCopied(false); }
    setOpen((v) => !v);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(corps); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard indispo */ }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start" }}>
      <button className="pill" onClick={openPanel} title="Générer un message prêt à envoyer" style={{ fontSize: 11, padding: "3px 8px" }}>
        {open ? "Fermer" : "✉️ Message"}
      </button>
      {open && (
        <div style={{ marginTop: 8, width: "min(420px, 80vw)", background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: 10 }}>
          <textarea
            value={corps}
            onChange={(e) => setCorps(e.target.value)}
            rows={9}
            style={{ width: "100%", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, fontSize: 12, fontFamily: "inherit", lineHeight: 1.5, padding: 8, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="pill on" onClick={copy} style={{ fontSize: 11, padding: "3px 10px" }}>{copied ? "✓ Copié" : "Copier"}</button>
            <a className="pill" href={whatsappHref(corps)} target="_blank" rel="noreferrer" style={{ fontSize: 11, padding: "3px 10px", textDecoration: "none" }}>WhatsApp</a>
          </div>
          <div style={{ fontSize: 10.5, color: T.faint, marginTop: 6 }}>Brouillon généré depuis le signal — relisez et personnalisez avant d'envoyer.</div>
        </div>
      )}
    </span>
  );
}
