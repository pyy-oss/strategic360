import React, { useState } from "react";
import { T, AX, ECAT, PROX, IMP, STANCE } from "../../../design/tokens";
import { Eyebrow, Card, Kpi, Badge } from "../../../design/ui";
import { useNavigate } from "react-router-dom";
import { useIntelItems, useSources, withDetectionFields, createSource, updateSource, reactivateSource, deactivateSource, deleteSource, runSyncSourcesNow, type IntelSource, type IntelSourceKind, type IntelAxis } from "../lib/intel";
import { createAction } from "../lib/execution";
import { useCan, useIsExec } from "../../../lib/rbac";
import { effectiveProx, isPastDue } from "../lib/freshness";
import { usePaged, Pager } from "../components/Pager";
import { Select, Input } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";

/** "Radar de détection" — ported from `Detection` in the maquette; data source swapped to
 * Firestore `intelItems` (V2). Rendering (sonar SVG, quadrants, badges) is unchanged.
 *
 * The sonar/list need `cat` (ECAT key) + `prox` (PROX key) to be positioned. Per the "100%
 * données externes automatiques" decision these are derived from `axis` when absent
 * (`withDetectionFields`) so every AI-classified signal is plottable without human touch-up.
 */
export function Detection() {
  const [cat, setCat] = useState("all");
  const { items } = useIntelItems();
  const navigate = useNavigate();
  const { canWrite } = useCan("veille");
  const now = Date.now();
  // Anti-obsolescence : on POSITIONNE sur l'imminence EFFECTIVE (dérivée des vraies dates), pas sur
  // le label IA brut — un item périmé retombe à « horizon » (bord du radar) au lieu du centre.
  const EVENTS = items
    .map(withDetectionFields)
    .filter((e) => e.cat && ECAT[e.cat] && e.prox && PROX[e.prox])
    .map((e) => ({ ...e, eprox: effectiveProx(e, now) ?? e.prox }));
  const CX = 170,
    CY = 170,
    RR = 150;
  const idxIn: Record<number, number> = {};
  const blips = EVENTS.map((e) => {
    const q = ECAT[e.cat as string].q;
    idxIn[q] = idxIn[q] || 0;
    const i = idxIn[q]++;
    const cnt = EVENTS.filter((x) => ECAT[x.cat as string].q === q).length;
    const ang = ((q * 90 + (90 / (cnt + 1)) * (i + 1)) * Math.PI) / 180;
    const rad = PROX[e.eprox as string].r * RR;
    return { ...e, x: CX + rad * Math.cos(ang), y: CY - rad * Math.sin(ang), size: e.impact === "high" ? 7 : e.impact === "medium" ? 5.2 : 4 };
  });
  const rows = EVENTS.filter((e) => cat === "all" || e.cat === cat).sort((a, b) => {
    const P: Record<string, number> = { imminent: 0, court: 1, moyen: 2, horizon: 3 };
    const I: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return P[a.eprox as string] - P[b.eprox as string] || I[a.impact] - I[b.impact];
  });
  const neuf = EVENTS.filter((e) => e.neuf).length;
  const paged = usePaged(rows, 25, cat);
  return (
    <div>
      <div style={{ fontSize: 12, color: T.plum, marginBottom: 14, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
        📡 Détection d'événements : implantations, expansions de groupe, risques/opportunités sectoriels, ruptures techno, réglementation, risque pays. Position = <b>catégorie</b> (secteur) × <b>imminence</b> (proximité du centre) ; taille = <b>impact</b> ; couleur = opportunité/menace.
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        {Object.keys(ECAT).map((k) => (
          <Card key={k}>
            <Kpi label={ECAT[k].l} value={EVENTS.filter((e) => e.cat === k).length} accent={ECAT[k].c} sub="événements suivis" />
          </Card>
        ))}
      </div>
      <div className="g2 g2-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow color={T.emerald}>Radar de détection</Eyebrow>
            <Badge c={T.emerald}>{neuf} nouveaux</Badge>
          </div>
          <svg viewBox="0 0 340 360" style={{ width: "100%", height: 330, marginTop: 4 }}>
            <defs>
              <linearGradient id="sw" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={T.emerald} stopOpacity="0.22" />
                <stop offset="100%" stopColor={T.emerald} stopOpacity="0" />
              </linearGradient>
            </defs>
            {["horizon", "moyen", "court", "imminent"].map((r) => (
              <circle key={r} cx={CX} cy={CY} r={PROX[r].r * RR} fill="none" stroke={T.line} />
            ))}
            <line x1={CX - RR} y1={CY} x2={CX + RR} y2={CY} stroke={T.line} />
            <line x1={CX} y1={CY - RR} x2={CX} y2={CY + RR} stroke={T.line} />
            <g>
              <path d="M170 170 L170 20 A150 150 0 0 1 276 64 Z" fill="url(#sw)" />
              <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 170 170" to="360 170 170" dur="7s" repeatCount="indefinite" />
            </g>
            {Object.keys(ECAT).map((k) => {
              const q = ECAT[k].q;
              const a = ((q * 90 + 45) * Math.PI) / 180;
              return (
                <text key={k} x={CX + (RR - 8) * Math.cos(a)} y={CY - (RR - 8) * Math.sin(a)} fill={ECAT[k].c} fontSize="9.5" textAnchor="middle" opacity="0.8">
                  {ECAT[k].l}
                </text>
              );
            })}
            <circle cx={CX} cy={CY} r="3" fill={T.faint} />
            {blips.map((b, i) => (
              <g key={b.id ?? i} opacity={cat === "all" || cat === b.cat ? 1 : 0.18}>
                {b.neuf && <circle cx={b.x} cy={b.y} r={b.size + 4} fill="none" stroke={STANCE[b.stance].c} strokeOpacity="0.4" />}
                <circle cx={b.x} cy={b.y} r={b.size} fill={STANCE[b.stance].c} />
              </g>
            ))}
          </svg>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, justifyContent: "center", marginTop: 2 }}>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.emerald, marginRight: 4 }} />
              Opportunité
            </span>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.clay, marginRight: 4 }} />
              Menace
            </span>
            <span style={{ color: T.dim }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: T.dim, marginRight: 4 }} />
              Neutre
            </span>
            <span style={{ color: T.faint }}>centre = imminent · bord = horizon</span>
          </div>
        </Card>
        <Card>
          <Eyebrow color={T.gold}>Types d'événements détectés</Eyebrow>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {["Nouvelle implantation", "Expansion de groupe", "Entrée d'un concurrent", "Opportunité sectorielle", "Risque sectoriel", "Rupture / nouvelle techno", "Obsolescence / EOL", "Nouvelle réglementation", "Risque pays"].map((ty, i) => {
              const c = EVENTS.filter((e) => e.subtype === ty).length;
              const ev = EVENTS.find((e) => e.subtype === ty);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderTop: i > 0 ? `1px solid ${T.line}` : "none" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: ev ? ECAT[ev.cat as string].c : T.faint, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: c ? T.ink : T.faint }}>{ty}</span>
                  <Badge c={c ? T.gold : T.faint}>{c}</Badge>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: T.faint, lineHeight: 1.5 }}>
            Détection : veille automatisée (RSS + IA Vertex) + saisie analyste. Chaque événement peut déclencher une <b style={{ color: T.emerald }}>opportunité</b> (Pipeline) ou une <b style={{ color: T.clay }}>alerte sourcing</b> (Crédit Fournisseurs).
          </div>
        </Card>
      </div>
      <SourceHealthPanel />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: T.faint }}>Catégorie :</span>
        <button className={`pill ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
          Toutes
        </button>
        {Object.keys(ECAT).map((k) => (
          <button key={k} className={`pill ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>
            {ECAT[k].l}
          </button>
        ))}
      </div>
      {rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 10 }}>Aucun événement de détection saisi pour l'instant.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {paged.pageItems.map((e) => (
          <Card key={e.id} style={{ borderLeft: `3px solid ${STANCE[e.stance].c}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge c={ECAT[e.cat as string].c}>{ECAT[e.cat as string].l}</Badge>
                  {/* Cohérence de taxonomie (Vague C) : on montre aussi l'AXE précis (même libellé
                      que dans le Fil) pour qu'un même signal ne lise pas « Concurrents » ici et
                      « Acteurs & marché » là sans lien visible. */}
                  {e.axis && AX[e.axis] && <Badge c={AX[e.axis].c}>{AX[e.axis].l}</Badge>}
                  <span style={{ fontSize: 11.5, color: T.gold, fontWeight: 600 }}>{e.subtype}</span>
                  {e.neuf && <Badge c={T.emerald}>Nouveau</Badge>}
                </div>
                <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{e.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Badge c={PROX[e.eprox as string].r < 0.4 ? T.clay : T.faint}>{PROX[e.eprox as string].l}</Badge>
                  {isPastDue(e, now) && <Badge c={T.faint}>Échéance passée</Badge>}
                  <Badge c={IMP[e.impact].c}>Impact {IMP[e.impact].l}</Badge>
                  <Badge c={STANCE[e.stance].c}>{STANCE[e.stance].l}</Badge>
                  <Badge c={T.faint}>
                    {e.ent || "—"} · {e.geo || "—"}
                  </Badge>
                  <Badge c={T.steel}>Fiabilité {e.confidence ?? e.sourceRating}</Badge>
                </div>
                {e.soWhat && (
                  <div style={{ marginTop: 10, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.plum }}>So-what :</b> {e.soWhat}
                  </div>
                )}
                {e.recommendedAction && (
                  <div style={{ marginTop: 4, fontSize: 12.5, color: T.dim }}>
                    <b style={{ color: T.gold }}>Action :</b> {e.recommendedAction}
                  </div>
                )}
                {/* Maillage inter-vues (Vague C) : la carte n'est plus un mur en lecture seule —
                    on relie l'événement au fil (signaux de l'entité) et à l'exécution (action). */}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {e.ent && (
                    <button className="pill" onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(e.ent as string)}`)}>
                      🔎 Signaux « {e.ent} »
                    </button>
                  )}
                  {canWrite && (
                    <DetectionActionCta title={e.recommendedAction?.trim() || e.title} impact={e.impact} prox={e.eprox as string} due={e.dueDate} ent={e.ent} />
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Pager {...paged} />
    </div>
  );
}

/** CTA « Créer une action » sur une carte de détection — port du geste du Fil (signal → exécution). */
function DetectionActionCta({ title, impact, prox, due, ent }: { title: string; impact: string; prox: string; due?: string; ent?: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Action non orpheline (audit 2026-07) : on reporte l'échéance réelle du signal et on trace
      // l'entité source pour que l'action reste exploitable dans le plan d'exécution.
      await createAction({
        title,
        impact: impact === "high" ? 5 : impact === "medium" ? 4 : 3,
        urgence: prox === "imminent" ? 5 : prox === "court" ? 4 : 3,
        effort: 3,
        ev: 0,
        owner: "—",
        echeance: due || "",
        statut: "À planifier",
        source: `Détection${ent ? ` · ${ent}` : ""} : ${title}`,
      });
      setDone(true);
    } finally {
      setBusy(false);
    }
  };
  if (done) return <span style={{ fontSize: 11.5, color: T.emerald }}>✓ Action créée</span>;
  return (
    <button className="pill" onClick={run} disabled={busy}>
      {busy ? "…" : "➕ Créer une action"}
    </button>
  );
}

/** Statut de santé d'une source dérivé de lastStatus/active (fiabilisation 2026-07). */
function sourceHealth(s: IntelSource): { key: "ok" | "degraded" | "error" | "inactive"; label: string; color: string } {
  if (s.active === false) return { key: "inactive", label: "Désactivée", color: T.faint };
  const st = (s.lastStatus || "").toLowerCase();
  if (!st) return { key: "ok", label: "En attente", color: T.steel };
  if (st.startsWith("ok")) return { key: "ok", label: "OK", color: T.emerald };
  if (st.startsWith("degraded")) return { key: "degraded", label: "Dégradée", color: T.gold };
  return { key: "error", label: "En échec", color: T.clay };
}

const SOURCE_KINDS: { value: IntelSourceKind; label: string }[] = [
  { value: "rss", label: "RSS / Atom" },
  { value: "web", label: "Page web" },
  { value: "web-js", label: "Page web (JS / anti-bot)" },
  { value: "newsletter", label: "Newsletter" },
  { value: "portal", label: "Portail" },
];
const SOURCE_AXES: { value: IntelAxis; label: string }[] = (Object.keys(AX) as IntelAxis[]).map((k) => ({ value: k, label: AX[k].l }));

/** Ligne de source problématique + actions d'administration (exec) : réactiver / éditer l'URL / désactiver / supprimer. */
function SourceRow({ s, h, isExec }: { s: IntelSource; h: ReturnType<typeof sourceHealth>; isExec: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(s.url || "");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'action."); } finally { setBusy(false); }
  };
  return (
    <div style={{ padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
          <div style={{ fontSize: 11, color: T.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.lastStatus || s.url}>{s.lastStatus || s.url}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {s.consecutiveFailures ? <span style={{ fontSize: 11, color: T.faint }}>{s.consecutiveFailures}×</span> : null}
          <Badge c={h.color}>{h.label}</Badge>
        </div>
      </div>
      {isExec && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {(h.key === "inactive" || h.key === "error") && (
            <button className="pill" disabled={busy} onClick={() => act(() => reactivateSource(s.id), `« ${s.name} » réactivée`)}>↺ Réactiver</button>
          )}
          <button className="pill" disabled={busy} onClick={() => setEditing((v) => !v)}>✏️ URL</button>
          {s.active !== false && (
            <button className="pill" disabled={busy} onClick={() => act(() => deactivateSource(s.id), `« ${s.name} » désactivée`)}>⏸ Désactiver</button>
          )}
          {!confirmDel ? (
            <button className="pill" disabled={busy} onClick={() => setConfirmDel(true)}>🗑 Supprimer</button>
          ) : (
            <>
              <button className="pill on" disabled={busy} onClick={() => act(() => deleteSource(s.id), `« ${s.name} » supprimée`)}>Confirmer</button>
              <button className="pill" disabled={busy} onClick={() => setConfirmDel(false)}>Annuler</button>
            </>
          )}
        </div>
      )}
      {isExec && editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Input style={{ flex: "1 1 240px" }} value={url} onChange={setUrl} placeholder="https://…/feed.xml" />
          <button className="pill on" disabled={busy || !url.trim()} onClick={() => act(async () => { await updateSource(s.id, { url: url.trim() }); await reactivateSource(s.id); }, "URL corrigée + source réactivée")}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

/** Formulaire d'ajout de source (modale, exec). */
function AddSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<{ name: string; url: string; kind: IntelSourceKind; axis: IntelAxis }>({ name: "", url: "", kind: "rss", axis: "reglementaire" });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const submit = async () => {
    if (!f.name.trim() || !f.url.trim()) return;
    setBusy(true);
    try {
      await createSource({ name: f.name.trim(), url: f.url.trim(), kind: f.kind, axis: f.axis, active: true });
      toast.success(`Source « ${f.name.trim()} » ajoutée.`);
      setF({ name: "", url: "", kind: "rss", axis: "reglementaire" });
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'ajout."); } finally { setBusy(false); }
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: T.faint, display: "block", marginBottom: 4 };
  return (
    <Modal open={open} onClose={onClose} title="Ajouter une source de veille">
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Nom *</label><Input value={f.name} onChange={(v) => set("name", v)} placeholder="ex : ARTCI — communiqués" /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>URL du flux *</label><Input value={f.url} onChange={(v) => set("url", v)} placeholder="https://…/rss ou page à surveiller" /></div>
        <div><label style={lbl}>Type</label><Select value={f.kind} onChange={(v) => set("kind", v as IntelSourceKind)} ariaLabel="Type" options={SOURCE_KINDS} /></div>
        <div><label style={lbl}>Axe</label><Select value={f.axis} onChange={(v) => set("axis", v as IntelAxis)} ariaLabel="Axe" options={SOURCE_AXES} /></div>
      </div>
      <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>Astuce : pour un site sans flux RSS, choisissez « Page web » (ou « Page web (JS) » si le contenu ne s'affiche qu'après chargement JavaScript).</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="pill" onClick={onClose}>Annuler</button>
        <button className="pill on" disabled={busy || !f.name.trim() || !f.url.trim()} onClick={() => void submit()}>{busy ? "Ajout…" : "Ajouter la source"}</button>
      </div>
    </Modal>
  );
}

/**
 * Santé des sources (M4 audit + fiabilisation) : rend visible quelles sources alimentent réellement
 * la veille, ET permet de les CORRIGER (audit 2026-07) — réactiver, éditer l'URL, désactiver,
 * supprimer, ajouter, relancer la synchro. Actions réservées aux rôles exec (firestore.rules).
 */
function SourceHealthPanel() {
  const { sources, loading } = useSources();
  const isExec = useIsExec();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    setSyncing(true);
    try { const r = await runSyncSourcesNow(); toast.success(`Synchronisation lancée${typeof r?.processed === "number" ? ` — ${r.processed} sources traitées` : ""}.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec de la synchro."); } finally { setSyncing(false); }
  };
  if (loading || sources.length === 0) {
    // Même vide, les exec doivent pouvoir ajouter une 1re source.
    if (!isExec) return null;
  }
  const counts = { ok: 0, degraded: 0, error: 0, inactive: 0 };
  const problems: { s: IntelSource; h: ReturnType<typeof sourceHealth> }[] = [];
  for (const s of sources) {
    const h = sourceHealth(s);
    counts[h.key] += 1;
    if (h.key === "error" || h.key === "inactive" || h.key === "degraded") problems.push({ s, h });
  }
  const total = sources.length;
  const okPct = total ? Math.round((counts.ok / total) * 100) : 0;
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Santé des sources — {counts.ok}/{total} actives ({okPct}%)</Eyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {isExec && <button className="pill" disabled={syncing} onClick={() => void syncNow()}>{syncing ? <><span className="cop-spin" /> Synchro…</> : "↻ Relancer la synchro"}</button>}
          {isExec && <button className="pill on" onClick={() => setShowAdd(true)}>+ Ajouter</button>}
          {problems.length > 0 && (
            <button className="pill" onClick={() => setOpen((v) => !v)}>
              {open ? "Masquer" : `${isExec ? "Corriger" : "Voir"} ${problems.length}`}
            </button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Badge c={T.emerald}>OK : {counts.ok}</Badge>
        <Badge c={T.gold}>Dégradées : {counts.degraded}</Badge>
        <Badge c={T.clay}>En échec : {counts.error}</Badge>
        <Badge c={T.faint}>Désactivées : {counts.inactive}</Badge>
      </div>
      {isExec && (
        <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>
          Une source est auto-désactivée après 5 échecs consécutifs. <b>Réactiver</b> lui redonne sa chance à la prochaine synchro ;
          si l'URL a changé, <b>Éditez l'URL</b> (elle est réactivée automatiquement) ; si le flux est mort, <b>Supprimez-la</b>.
        </div>
      )}
      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
          {problems
            .sort((a, b) => (b.s.consecutiveFailures ?? 0) - (a.s.consecutiveFailures ?? 0))
            .map(({ s, h }) => <SourceRow key={s.id} s={s} h={h} isExec={isExec} />)}
        </div>
      )}
      <AddSourceModal open={showAdd} onClose={() => setShowAdd(false)} />
    </Card>
  );
}
