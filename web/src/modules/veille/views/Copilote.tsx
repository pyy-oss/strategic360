import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { T, fmt as fmtC } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Kpi } from "../../../design/ui";
import { useCan, useClaims } from "../../../lib/rbac";
import {
  useCopiloteAccounts,
  createCopiloteAccount,
  copiloteGenerate,
  copiloteChat,
  syncCopiloteAccountsFromNt360,
  setCopiloteAccountOwners,
  setCopiloteScope,
  fetchCopiloteProfiles,
  slugifyClient,
  type CopiloteAccount,
  type CopiloteProfile,
  type CopiloteAgent,
  type ProspectionResult,
  type CvpResult,
  type TriennalResult,
  type PlanCompteResult,
  type PlanActionResult,
  type RedactionResult,
  type CopiloteChatMessage,
} from "../lib/copilote";

const CHALEUR_C: Record<string, string> = { Chaud: T.clay, Tiède: T.gold, Froid: T.steel };
const NIV_C: Record<string, string> = { "Élevé": T.clay, Moyen: T.gold, Faible: T.steel };

const AGENT_TABS: { k: string; l: string; icon: string }[] = [
  { k: "prospection", l: "Prospection", icon: "🎯" },
  { k: "cvp", l: "Proposition de valeur", icon: "💡" },
  { k: "triennal", l: "Plan triennal", icon: "🗺️" },
  { k: "planCompte", l: "Plan de compte", icon: "📋" },
  { k: "planAction", l: "Plan d'action 90 j", icon: "⚡" },
  { k: "redaction", l: "Rédaction", icon: "✍️" },
  { k: "chat", l: "Chat", icon: "💬" },
];

const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, fontSize: 12.5 };
const lbl: React.CSSProperties = { fontSize: 11, color: T.dim, marginBottom: 3, display: "block" };

/** Bouton « Copier » pour les livrables prêts-à-envoyer (Rédaction, CVP) — audit 2026-07.
 * clipboard.writeText avec repli execCommand pour les contextes non sécurisés. */
function CopyBtn({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      }
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch { /* silencieux : l'utilisateur peut sélectionner à la main */ }
  };
  return (
    <button className="pill" onClick={copy} title="Copier dans le presse-papiers" style={{ fontSize: 11.5 }}>
      {done ? "✓ Copié" : `⧉ ${label}`}
    </button>
  );
}

/** Copilote Commercial (add-on) — réutilise le moteur IA serveur + le PESTEL/les signaux de la veille. */
export function Copilote() {
  const navigate = useNavigate();
  const { accounts, loading, error, scoped, reload } = useCopiloteAccounts();
  const { canWrite } = useCan("veille");
  const { role } = useClaims();
  const isAdmin = role === "direction" || role === "commercial_dir"; // peut attribuer les comptes
  const [accountId, setAccountId] = useState<string>("");
  const [tab, setTab] = useState<string>("prospection");
  const [showNew, setShowNew] = useState(false);
  const [showPerim, setShowPerim] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Poids commercial = CAS réalisé + pipeline pondéré (empreinte nt360). Sert au tri du portefeuille.
  const poids = (a: CopiloteAccount) => (a.nt360?.casTotal ?? 0) + (a.nt360?.pipelinePondere ?? 0);
  // Déduplication par slug(nom) : un compte créé à la main (id auto legacy) et son jumeau
  // synchronisé (id = slug) représentent le MÊME client → on les fusionne pour ne pas dupliquer la
  // ligne ni gonfler les KPIs. On garde l'id le plus « riche » (celui qui porte du qualitatif).
  const sorted = useMemo(() => {
    const byKey = new Map<string, CopiloteAccount>();
    for (const a of accounts) {
      const key = slugifyClient(a.nom) || a.id;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, a); continue; }
      const richer = (a.enjeux?.length ?? 0) + (a.whitespace?.length ?? 0) + (a.contacts?.length ?? 0);
      const prevRich = (prev.enjeux?.length ?? 0) + (prev.whitespace?.length ?? 0) + (prev.contacts?.length ?? 0);
      const base = richer >= prevRich ? a : prev;
      const other = base === a ? prev : a;
      // Fusion : qualitatif du plus riche + empreinte nt360 disponible de l'un ou l'autre.
      byKey.set(key, { ...base, nt360: base.nt360 ?? other.nt360 });
    }
    return [...byKey.values()].sort((x, y) => poids(y) - poids(x));
  }, [accounts]);
  const account = useMemo(() => sorted.find((a) => a.id === accountId), [sorted, accountId]);

  // Le message de synchro s'efface tout seul (ne reste pas indéfiniment dans l'en-tête).
  useEffect(() => {
    if (!syncMsg) return;
    const t = setTimeout(() => setSyncMsg(null), 6000);
    return () => clearTimeout(t);
  }, [syncMsg]);

  const syncFromNt360 = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const { accounts: n } = await syncCopiloteAccountsFromNt360();
      setSyncMsg(`${n} comptes pré-remplis depuis nt360.`);
      reload(); // portefeuille non streamé : on rafraîchit après la synchro
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Échec de la synchronisation.");
    } finally { setSyncing(false); }
  };

  return (
    <div>
      {/* Barre de contexte compte — sticky : le compte pilote tout l'écran, il reste visible pendant
          qu'on lit un livrable (utile en RDV sur mobile). */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: T.bg, paddingBottom: 10, marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <AccountCombobox accounts={sorted} value={accountId} loading={loading} onChange={setAccountId} poids={poids} />
          {account && <Badge c={T.steel}>{account.tier || "compte"}</Badge>}
          {scoped && <Badge c={T.plum}>Mon périmètre</Badge>}
        </div>
        {canWrite && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className={`pill ${accounts.length === 0 && !loading ? "on" : ""}`} disabled={syncing} onClick={() => void syncFromNt360()} title="Pré-remplir le portefeuille et l'empreinte réelle depuis la base nt360">
              {syncing ? <><span className="cop-spin" /> Synchro…</> : "⟳ Empreinte nt360"}
            </button>
            {isAdmin && <button className="pill" onClick={() => setShowPerim((v) => !v)} title="Définir le périmètre des commerciaux (comptes visibles)">Périmètres</button>}
            <button className={`pill ${accounts.length === 0 && !loading ? "" : "on"}`} onClick={() => setShowNew((v) => !v)}>+ Nouveau compte</button>
          </div>
        )}
        {/* Slot réservé (hauteur fixe) : le message de synchro n'écarte plus les boutons en apparaissant. */}
        {syncMsg && <div style={{ flexBasis: "100%", fontSize: 11.5, color: T.dim }}>{syncMsg}</div>}
      </div>

      {error && (
        <Card style={{ marginBottom: 14, borderColor: T.clay }}>
          <div style={{ color: T.clay, fontSize: 13, fontWeight: 600 }}>Chargement du portefeuille impossible</div>
          <div style={{ color: T.dim, fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" }}>{error.message}</div>
          <div style={{ marginTop: 10 }}>
            <button className="pill on" onClick={() => reload()}>Réessayer</button>
          </div>
        </Card>
      )}

      {showPerim && isAdmin && <PerimetresPanel onClose={() => setShowPerim(false)} />}
      {showNew && canWrite && <NewAccountPanel onClose={() => setShowNew(false)} onCreated={(id) => { setAccountId(id); setShowNew(false); reload(); }} />}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {AGENT_TABS.map((t) => (
          <button key={t.k} className={`pill ${tab === t.k ? "on" : ""}`} onClick={() => setTab(t.k)} aria-pressed={tab === t.k}>
            <span aria-hidden style={{ marginRight: 5 }}>{t.icon}</span>{t.l}
          </button>
        ))}
      </div>

      {account && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 20, fontWeight: 700, color: T.ink }}>{account.nom}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              {account.secteur ? <span style={{ fontSize: 12, color: T.dim }}>{account.secteur}</span> : null}
              {/* Maillage interne↔externe (Vague C) : du compte (données internes) vers ses signaux de veille. */}
              {account.nom && (
                <button className="pill" onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(account.nom)}`)}>
                  🔎 Signaux de veille
                </button>
              )}
            </div>
          </div>

          {/* Empreinte chiffrée — traitement KPI (tabular-nums, Bricolage) : la valeur saute aux yeux. */}
          {account.nt360 && (
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 12 }}>
              <Money label="CAS réalisé" value={account.nt360.casTotal ?? 0} accent={T.emerald} />
              <Money label="Pipeline pondéré" value={account.nt360.pipelinePondere ?? 0} accent={T.gold} />
              {typeof account.nt360.wins === "number" && account.nt360.wins > 0 && (
                <div><Eyebrow>Affaires gagnées</Eyebrow><div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 700, color: T.plum, marginTop: 6 }}>{account.nt360.wins}</div></div>
              )}
            </div>
          )}

          {((account.enjeux ?? []).length > 0 || (account.whitespace ?? []).length > 0) && (
            <div style={{ marginTop: 14 }}>
              <Eyebrow>Enjeux &amp; espaces à conquérir</Eyebrow>
              <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                {(account.enjeux ?? []).map((e, i) => <Badge key={`e${i}`} c={T.steel}>{e}</Badge>)}
                {(account.whitespace ?? []).map((w, i) => <Badge key={`w${i}`} c={T.emerald}>↗ {w}</Badge>)}
              </div>
            </div>
          )}

          {((account.nt360?.historique ?? []).length > 0 || (account.nt360?.enCours ?? []).length > 0) && (
            <div style={{ marginTop: 14 }}>
              <Eyebrow>Offres · vendues &amp; en cours</Eyebrow>
              <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                {(account.nt360?.historique ?? []).map((h, i) => <Badge key={`h${i}`} c={T.emerald}>{h.offre} ✓</Badge>)}
                {(account.nt360?.enCours ?? []).map((e, i) => <Badge key={`ec${i}`} c={T.plum}>{e} · en cours</Badge>)}
              </div>
            </div>
          )}

          {(account.nt360?.opportunites ?? []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Eyebrow>Opportunités réelles en cours</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 7 }}>
                {(account.nt360?.opportunites ?? []).map((o, i) => (
                  <DealRow key={`${o.nom}-${i}`} nom={o.nom} bu={o.bu} etape={o.etape} montant={o.montant} probability={o.probability} closingDate={o.closingDate} />
                ))}
              </div>
            </div>
          )}

          {(account.nt360?.ams?.length || account.nt360?.bus?.length) ? (
            <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.dim }}>Rattachement :</span>
              {(account.nt360?.ams ?? []).map((am, i) => <Badge key={`am${i}`} c={T.steel}>AM {am}</Badge>)}
              {(account.nt360?.bus ?? []).map((bu, i) => <Badge key={`bu${i}`} c={T.dim}>{bu}</Badge>)}
            </div>
          ) : null}
          <OwnersEditor account={account} isAdmin={isAdmin} onSaved={reload} />
        </Card>
      )}

      {loading && <PortfolioSkeleton />}
      {!account && !loading && <PortfolioDashboard accounts={sorted} poids={poids} fmt={fmtC} onPick={setAccountId} />}

      {tab === "prospection" && <ProspectionTab accountId={accountId} canWrite={canWrite} />}
      {tab === "cvp" && <CvpTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "triennal" && <TriennalTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "planCompte" && <PlanCompteTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "planAction" && <PlanActionTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "redaction" && <RedactionTab accountId={accountId} compte={account?.nom || ""} canWrite={canWrite} />}
      {tab === "chat" && <ChatTab accountId={accountId} canWrite={canWrite} />}
    </div>
  );
}

/* -------- Combobox compte : recherche typeahead (remplace le <select> à ~800 options) -------- */
function AccountCombobox({
  accounts, value, loading, onChange, poids,
}: {
  accounts: CopiloteAccount[];
  value: string;
  loading: boolean;
  onChange: (id: string) => void;
  poids: (a: CopiloteAccount) => number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = accounts.find((a) => a.id === value);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle ? accounts.filter((a) => a.nom.toLowerCase().includes(needle) || (a.secteur || "").toLowerCase().includes(needle)) : accounts;
    return base.slice(0, 40);
  }, [accounts, q]);
  const pick = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  return (
    <div style={{ position: "relative", minWidth: 240 }}>
      <input
        aria-label="Rechercher un compte commercial"
        style={{ ...inp, minWidth: 240, cursor: "text" }}
        placeholder={loading ? "Chargement du portefeuille…" : "🔎 Rechercher un compte…"}
        value={open ? q : (selected ? selected.nom : "")}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && filtered[0]) pick(filtered[0].id); if (e.key === "Escape") setOpen(false); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, maxHeight: 320, overflowY: "auto", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.4)" }}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick("")}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: value === "" ? T.panel2 : "transparent", border: "none", color: T.dim, fontSize: 12.5, cursor: "pointer" }}>
            — Portefeuille (vue d'ensemble) —
          </button>
          {filtered.map((a) => (
            <button key={a.id} role="option" aria-selected={a.id === value} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a.id)}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", padding: "10px 12px", background: a.id === value ? T.panel2 : "transparent", border: "none", borderTop: `1px solid ${T.line}`, cursor: "pointer" }}>
              <span style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nom}{a.secteur ? <span style={{ color: T.dim }}> · {a.secteur}</span> : null}</span>
              {poids(a) ? <span style={{ fontSize: 12, color: T.gold, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtC(poids(a))}</span> : null}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: "12px", fontSize: 12, color: T.dim }}>Aucun compte trouvé.</div>}
        </div>
      )}
    </div>
  );
}

/* -------- Valeur monétaire au traitement KPI (Bricolage + tabular-nums, compact) -------- */
function Money({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 700, color: accent || T.ink, marginTop: 6, fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>
        {fmtC(value)} <span style={{ fontSize: 13, color: T.dim, fontWeight: 600 }}>XOF</span>
      </div>
    </div>
  );
}

/* -------- Ligne opportunité : montant + jauge de probabilité (met en avant ce qui est jouable) -------- */
function DealRow({ nom, bu, etape, montant, probability, closingDate }: { nom: string; bu?: string; etape: string; montant: number; probability?: number | null; closingDate?: string }) {
  const p = typeof probability === "number" ? Math.max(0, Math.min(100, probability)) : null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 11px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${T.gold}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nom}{bu ? <span style={{ color: T.dim }}> · {bu}</span> : null} <span style={{ color: T.steel }}>— {etape}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          {p !== null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 44, height: 5, borderRadius: 999, background: T.line, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${p}%`, height: "100%", background: p >= 60 ? T.emerald : p >= 30 ? T.gold : T.clay }} />
              </span>
              <span style={{ fontSize: 11, color: T.dim, fontVariantNumeric: "tabular-nums" }}>{p}%</span>
            </span>
          )}
          {closingDate ? <span style={{ fontSize: 11, color: T.dim }}>clôture {closingDate}</span> : null}
        </div>
      </div>
      <span style={{ fontSize: 13, color: T.gold, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontFamily: "'Bricolage Grotesque',sans-serif" }}>{fmtC(montant)} XOF</span>
    </div>
  );
}

/* -------- Squelette de chargement du portefeuille (évite le clignotement blanc) -------- */
function PortfolioSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}><div className="cop-skel" style={{ height: 12, width: "60%" }} /><div className="cop-skel" style={{ height: 26, width: "80%", marginTop: 8 }} /></div>
          ))}
        </div>
      </Card>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {Array.from({ length: 2 }).map((_, c) => (
          <Card key={c}>
            <div className="cop-skel" style={{ height: 12, width: "45%" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="cop-skel" style={{ height: 40 }} />)}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* -------- Portefeuille : vue d'ensemble quand aucun compte n'est sélectionné (jamais d'écran vide) -------- */
function PortfolioDashboard({
  accounts, poids, fmt, onPick,
}: {
  accounts: CopiloteAccount[];
  poids: (a: CopiloteAccount) => number;
  fmt: (n: number) => string;
  onPick: (id: string) => void;
}) {
  // Mémoïsé : recalculer reduces + flatMap + sort sur ~800 comptes à chaque rendu serait du gaspillage.
  const { totalCas, totalPipe, totalWins, hotDeals } = useMemo(() => {
    const totalCas = accounts.reduce((s, a) => s + (a.nt360?.casTotal ?? 0), 0);
    const totalPipe = accounts.reduce((s, a) => s + (a.nt360?.pipelinePondere ?? 0), 0);
    const totalWins = accounts.reduce((s, a) => s + (a.nt360?.wins ?? 0), 0);
    // Deals chauds = opportunités en cours triées par valeur pondérée. Correctif audit 2026-07 : une
    // probabilité INCONNUE ne vaut plus 100 % (elle faisait passer les deals non qualifiés devant des
    // deals qualifiés à 90 %) — repli conservateur à 50 %, probabilité connue bornée 0-100.
    const dealWeight = (o: { montant: number; probability?: number | null }) =>
      o.montant * (typeof o.probability === "number" ? Math.max(0, Math.min(100, o.probability)) / 100 : 0.5);
    const hotDeals = accounts
      .flatMap((a) => (a.nt360?.opportunites ?? []).map((o) => ({ ...o, compte: a.nom, accountId: a.id })))
      .sort((x, y) => dealWeight(y) - dealWeight(x))
      .slice(0, 8);
    return { totalCas, totalPipe, totalWins, hotDeals };
  }, [accounts]);

  if (accounts.length === 0) {
    return (
      <Card>
        <Eyebrow color={T.gold}>Portefeuille commercial</Eyebrow>
        <div style={{ fontSize: 13, color: T.dim, marginTop: 10, lineHeight: 1.6 }}>
          Aucun compte pour l'instant. Cliquez sur <b style={{ color: T.ink }}>⟳ Empreinte nt360</b> pour pré-remplir
          automatiquement votre portefeuille (clients, CAS réalisé, pipeline pondéré, opportunités en cours) depuis
          la base nt360 — ou créez un compte manuellement.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <Eyebrow color={T.gold}>Portefeuille commercial — vue d'ensemble</Eyebrow>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginTop: 12 }}>
          <Kpi label="Comptes actifs" value={accounts.length} accent={T.steel} />
          <Kpi label="CAS réalisé" value={<>{fmt(totalCas)} <span style={{ fontSize: 13, color: T.dim }}>XOF</span></>} accent={T.emerald} />
          <Kpi label="Pipeline pondéré" value={<>{fmt(totalPipe)} <span style={{ fontSize: 13, color: T.dim }}>XOF</span></>} accent={T.gold} />
          <Kpi label="Affaires gagnées" value={totalWins} accent={T.plum} />
        </div>
      </Card>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <Eyebrow color={T.emerald}>Top comptes par poids commercial</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {accounts.slice(0, 8).map((a) => (
              <button key={a.id} onClick={() => onPick(a.id)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "9px 11px", background: T.panel2, borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", textAlign: "left", minHeight: 44 }}>
                <span style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nom}{a.secteur ? <span style={{ color: T.dim }}> · {a.secteur}</span> : null}</span>
                <span style={{ fontSize: 12.5, color: T.gold, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontFamily: "'Bricolage Grotesque',sans-serif" }}>{fmt(poids(a))} XOF</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <Eyebrow color={T.gold}>Deals chauds à jouer</Eyebrow>
          {hotDeals.length === 0 ? (
            <div style={{ fontSize: 12, color: T.dim, marginTop: 10 }}>Aucune opportunité en cours détectée dans le pipeline.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {hotDeals.map((o, i) => (
                <button key={i} onClick={() => onPick(o.accountId)} style={{ display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <DealRow nom={`${o.compte} · ${o.nom}`} bu={o.bu} etape={o.etape} montant={o.montant} probability={o.probability} closingDate={o.closingDate} />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* -------- Générateur générique (bouton + état) -------- */
// Cache de session des livrables générés, clé = `${agent}:${accountId}` (audit 2026-07 : sans cache,
// chaque retour sur un onglet relançait une génération IA de 10-30 s). La clé INCLUT l'accountId :
// aucune fuite inter-comptes possible. Portée session (vidé au reload) ; la persistance Firestore
// inter-sessions reste une amélioration ultérieure.
const AGENT_CACHE = new Map<string, unknown>();

function useAgent<T>(agent: CopiloteAgent, accountId?: string) {
  const cacheKey = `${agent}:${accountId || ""}`;
  const [data, setData] = useState<T | null>((AGENT_CACHE.get(cacheKey) as T) ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(Boolean(AGENT_CACHE.get(cacheKey)));
  // Changement de compte/agent : on réhydrate depuis le cache (livrable déjà généré ré-affiché
  // instantanément) au lieu de repartir vide — tout en garantissant que le livrable montré
  // correspond au compte courant (la clé de cache porte l'accountId).
  useEffect(() => {
    const cached = AGENT_CACHE.get(cacheKey) as T | undefined;
    setData(cached ?? null); setErr(null); setDone(Boolean(cached));
  }, [cacheKey]);
  const run = async (extra?: Record<string, unknown>) => {
    const forKey = cacheKey; // capture : on ignore la réponse si le compte a changé entre-temps
    setBusy(true); setErr(null);
    try {
      const res = await copiloteGenerate<T>(agent, accountId || undefined, extra);
      if (forKey !== `${agent}:${accountId || ""}`) return; // course : compte changé → on jette
      AGENT_CACHE.set(forKey, res);
      setData(res); setDone(true);
    } catch (e) {
      if (forKey !== `${agent}:${accountId || ""}`) return;
      setErr(e instanceof Error ? e.message : "Échec de la génération.");
    } finally {
      if (forKey === `${agent}:${accountId || ""}`) setBusy(false);
    }
  };
  return { data, busy, err, done, run };
}

function GenButton({ busy, onClick, label, disabled }: { busy: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return <button className="pill on" disabled={busy || disabled} onClick={onClick}>{busy ? <><span className="cop-spin" /> Génération…</> : label}</button>;
}
function ErrLine({ err }: { err: string | null }) {
  return err ? <div style={{ color: T.clay, fontSize: 12, marginTop: 8 }}>{err}</div> : null;
}
/** Affiché quand une génération a abouti mais n'a rien produit (jamais de carte vide sans explication). */
function EmptyLine({ show }: { show: boolean }) {
  return show ? <div style={{ fontSize: 12, color: T.dim, marginTop: 10 }}>Aucun résultat — précisez le contexte du compte puis relancez.</div> : null;
}
/** Note affichée aux profils lecture seule (le bouton Générer est désactivé pour eux). */
function ReadOnlyNote({ show }: { show: boolean }) {
  return show ? <div style={{ fontSize: 12, color: T.dim, marginTop: 8 }}>Profil lecture seule : génération réservée aux commerciaux.</div> : null;
}
/** Squelette animé pendant une génération IA (10-30 s) : la carte ne reste plus visuellement inerte. */
function GenSkeleton({ show, lines = 3 }: { show: boolean; lines?: number }) {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="cop-skel" style={{ height: 44, width: `${100 - i * 6}%` }} />
      ))}
    </div>
  );
}
/** Message « sélectionnez un compte » homogène (vous), contraste correct. */
function PickHint({ show, text = "Sélectionnez un compte." }: { show: boolean; text?: string }) {
  return show ? <div style={{ fontSize: 12, color: T.dim, marginTop: 8 }}>{text}</div> : null;
}

function ProspectionTab({ accountId, canWrite }: { accountId: string; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<ProspectionResult>("prospection", accountId);
  const navigate = useNavigate();
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Comptes cibles (adossés aux signaux de veille)</Eyebrow>
        <GenButton busy={busy} disabled={!canWrite} onClick={() => run()} label="Générer la prospection" />
      </div>
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} />
      <EmptyLine show={done && !busy && (data?.cibles ?? []).length === 0} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {(data?.cibles ?? []).map((c, i) => (
          <div key={`${c.nom}-${i}`} style={{ padding: "10px 12px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${CHALEUR_C[c.chaleur] ?? T.faint}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{c.nom}</span>
              <Badge c={CHALEUR_C[c.chaleur] ?? T.faint}>{c.chaleur}</Badge>
            </div>
            {c.source ? <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3 }}>Source : {c.source}</div> : null}
            <div style={{ fontSize: 12.5, color: T.dim, marginTop: 4 }}><b style={{ color: T.steel }}>Angle :</b> {c.angle}</div>
            <div style={{ fontSize: 12.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.gold }}>Accroche :</b> {c.accroche}</div>
            {/* Maillage (audit 2026-07) : une cible sourcée n'est plus un cul-de-sac → ses signaux. */}
            {c.source && (
              <div style={{ marginTop: 8 }}>
                <button className="pill" onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(c.nom)}`)} style={{ fontSize: 11.5 }}>🔎 Signaux</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CvpTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<CvpResult>("cvp", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Proposition de valeur — ancrée sur le compte</Eyebrow>
        <GenButton busy={busy} disabled={disabled || !canWrite} onClick={() => run()} label="Générer la proposition" />
      </div>
      <PickHint show={disabled} text="Sélectionnez un compte pour une proposition ciblée." />
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} lines={2} />
      <EmptyLine show={done && !busy && !data} />
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <CopyBtn text={[data.message, ...(data.differenciateurs ?? [])].filter(Boolean).join("\n\n")} label="Copier la CVP" />
          </div>
          <div style={{ padding: "12px 14px", background: T.panel2, borderRadius: 10, fontSize: 14, color: T.ink, lineHeight: 1.55 }}>{data.message}</div>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: T.dim, fontSize: 13, lineHeight: 1.7 }}>
            {data.differenciateurs.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TriennalTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<TriennalResult>("triennal", accountId);
  const C = [T.emerald, T.gold, T.clay];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Plan de croissance à 3 ans</Eyebrow>
        <GenButton busy={busy} disabled={disabled || !canWrite} onClick={() => run()} label="Générer le plan triennal" />
      </div>
      <PickHint show={disabled} />
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} />
      <EmptyLine show={done && !busy && (data?.roadmap ?? []).length === 0} />
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
        {(data?.roadmap ?? []).map((r, i) => (
          <div key={i} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px", borderTop: `3px solid ${C[i % 3]}` }}>
            <div style={{ fontSize: 12, color: C[i % 3], fontWeight: 700 }}>{r.an}</div>
            <div style={{ fontSize: 13, color: T.ink, fontWeight: 600, margin: "4px 0 6px" }}>{r.titre}</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: T.dim, lineHeight: 1.6 }}>
              {r.offres.map((o, j) => <li key={j}>{o}</li>)}
            </ul>
            {r.jalon && <div style={{ fontSize: 11.5, color: T.gold, marginTop: 6 }}><b>Jalon :</b> {r.jalon}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlanCompteTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<PlanCompteResult>("planCompte", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Plan de compte — actions & risques</Eyebrow>
        <GenButton busy={busy} disabled={disabled || !canWrite} onClick={() => run()} label="Générer le plan de compte" />
      </div>
      <PickHint show={disabled} />
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} />
      <EmptyLine show={done && !busy && !data} />
      {data && (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: T.emerald, fontWeight: 600, marginBottom: 8 }}>Actions priorisées</div>
            {data.actions.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <span style={{ fontSize: 12.5, color: T.ink }}>{a.libelle}</span>
                <Badge c={T.steel}>{a.horizon}</Badge>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.clay, fontWeight: 600, marginBottom: 8 }}>Risques & mitigation</div>
            {data.risques.map((r, i) => (
              <div key={i} style={{ padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: T.ink }}>{r.r}</span>
                  <Badge c={NIV_C[r.niv] ?? T.faint}>{r.niv}</Badge>
                </div>
                <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.emerald }}>Mitigation :</b> {r.m}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const QUAND_C: Record<string, string> = { "0–30 jours": T.clay, "30–60 jours": T.gold, "60–90 jours": T.steel, Continu: T.faint };

function PlanActionTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<PlanActionResult>("planAction", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Plan d'action commercial — 90 prochains jours</Eyebrow>
        <GenButton busy={busy} disabled={disabled || !canWrite} onClick={() => run()} label="Générer le plan d'action" />
      </div>
      <PickHint show={disabled} />
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} />
      <EmptyLine show={done && !busy && (data?.plan ?? []).length === 0} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {(data?.plan ?? []).map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
            <Badge c={QUAND_C[p.quand] ?? T.faint}>{p.quand}</Badge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{p.action}</div>
              {p.objet && <div style={{ fontSize: 11.5, color: T.steel, marginTop: 2 }}>↳ {p.objet}</div>}
              {p.preuve && <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.emerald }}>Preuve :</b> {p.preuve}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RedactionTab({ accountId, compte, canWrite }: { accountId: string; compte: string; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<RedactionResult>("redaction", accountId);
  const [form, setForm] = useState({ kind: "Prise de contact", canal: "email", ton: "Direct", contexte: "" });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card>
      <Eyebrow color={T.emerald}>Rédaction — 2 variantes prêtes à envoyer</Eyebrow>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 130px 150px", gap: 10, marginTop: 12 }}>
        <div><label style={lbl}>Type</label><input style={inp} value={form.kind} onChange={(e) => set("kind", e.target.value)} /></div>
        <div><label style={lbl}>Canal</label>
          <select style={inp} value={form.canal} onChange={(e) => set("canal", e.target.value)}>
            <option value="email">E-mail</option><option value="whatsapp">WhatsApp</option><option value="linkedin">LinkedIn</option>
          </select>
        </div>
        <div><label style={lbl}>Ton</label>
          <select style={inp} value={form.ton} onChange={(e) => set("ton", e.target.value)}>
            <option>Direct</option><option>Institutionnel</option><option>Chaleureux</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Contexte (sans rien inventer)</label>
        <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={form.contexte} onChange={(e) => set("contexte", e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <GenButton busy={busy} disabled={!canWrite} onClick={() => run({ ...form, compte })} label="Rédiger" />
      </div>
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <GenSkeleton show={busy} lines={2} />
      <EmptyLine show={done && !busy && (data?.variantes ?? []).length === 0} />
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {(data?.variantes ?? []).map((v, i) => (
          <div key={i} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Badge c={T.gold}>{v.label}</Badge>
              <CopyBtn text={[v.objet ? `Objet : ${v.objet}` : "", v.corps].filter(Boolean).join("\n\n")} />
            </div>
            {v.objet && <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginTop: 8 }}>Objet : {v.objet}</div>}
            <div style={{ fontSize: 12.5, color: T.dim, whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.55 }}>{v.corps}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChatTab({ accountId, canWrite }: { accountId: string; canWrite: boolean }) {
  const [messages, setMessages] = useState<CopiloteChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const logRef = React.useRef<HTMLDivElement>(null);
  // Réinitialise la conversation quand on change de compte : pas de contexte croisé entre clients.
  useEffect(() => { setMessages([]); setErr(null); }, [accountId]);
  // Défilement auto vers le dernier message (sinon la réponse arrive « sous la ligne de flottaison »).
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, busy]);
  const send = async () => {
    const text = input.trim();
    if (!text || busy || !canWrite) return;
    const forId = accountId;
    const next: CopiloteChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setErr(null);
    try {
      const { reply } = await copiloteChat(next, accountId || undefined, "Copilote");
      if (forId !== accountId) return; // compte changé pendant la réponse → on n'écrit pas dans la mauvaise conversation
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      if (forId === accountId) setErr(e instanceof Error ? e.message : "Échec.");
    } finally {
      if (forId === accountId) setBusy(false);
    }
  };
  return (
    <Card>
      <Eyebrow color={T.emerald}>Copilote conversationnel</Eyebrow>
      <div ref={logRef} role="log" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, maxHeight: 360, overflowY: "auto" }}>
        {messages.length === 0 && <div style={{ fontSize: 12, color: T.dim }}>Posez une question : préparer un RDV, bâtir un argumentaire, traiter une objection…</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%", background: m.role === "user" ? T.emerald + "22" : T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 11px", fontSize: 12.5, color: T.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.content}</div>
        ))}
        {busy && <div style={{ fontSize: 12, color: T.dim }}><span className="cop-spin" /> Le copilote réfléchit…</div>}
      </div>
      <ReadOnlyNote show={!canWrite} />
      <ErrLine err={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input style={inp} value={input} placeholder="Votre message…" disabled={!canWrite} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
        <button className="pill on" disabled={busy || !canWrite} onClick={() => void send()}>Envoyer</button>
      </div>
    </Card>
  );
}

/* -------- Création rapide d'un compte -------- */
function NewAccountPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ nom: "", secteur: "", tier: "Clé", enjeux: "", whitespace: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const submit = async () => {
    if (!f.nom.trim()) return;
    setBusy(true); setErr(null);
    try {
      const id = await createCopiloteAccount({
        nom: f.nom.trim(), secteur: f.secteur.trim(), tier: f.tier,
        enjeux: lines(f.enjeux), whitespace: lines(f.whitespace),
        enCours: [], historique: [], contacts: [], preuves: [], tendances: [],
      });
      onCreated(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de la création du compte.");
    } finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.gold }}>Nouveau compte</span>
        <button className="pill" onClick={onClose}>Fermer</button>
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px", gap: 10 }}>
        <div><label style={lbl}>Nom *</label><input style={inp} value={f.nom} onChange={(e) => set("nom", e.target.value)} /></div>
        <div><label style={lbl}>Secteur</label><input style={inp} value={f.secteur} onChange={(e) => set("secteur", e.target.value)} /></div>
        <div><label style={lbl}>Tier</label>
          <select style={inp} value={f.tier} onChange={(e) => set("tier", e.target.value)}>
            <option>Stratégique</option><option>Clé</option><option>Standard</option>
          </select>
        </div>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div><label style={lbl}>Enjeux (1 par ligne)</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={f.enjeux} onChange={(e) => set("enjeux", e.target.value)} /></div>
        <div><label style={lbl}>Whitespace (1 par ligne)</label><textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={f.whitespace} onChange={(e) => set("whitespace", e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="pill on" disabled={busy || !f.nom.trim()} onClick={() => void submit()}>{busy ? "Création…" : "Créer le compte"}</button>
      </div>
      <ErrLine err={err} />
    </Card>
  );
}

/* -------- Admin des périmètres commerciaux (AM/BU par e-mail) — direction/commercial_dir -------- */
function PerimetresPanel({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<CopiloteProfile[]>([]);
  const [f, setF] = useState({ email: "", ams: "", bus: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const load = () => { void fetchCopiloteProfiles().then(setProfiles).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const lines = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    const email = f.email.trim().toLowerCase();
    if (!email) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await setCopiloteScope(email, lines(f.ams), lines(f.bus));
      setMsg(`Périmètre enregistré pour ${email}.`);
      setF({ email: "", ams: "", bus: "" });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally { setBusy(false); }
  };
  const edit = (p: CopiloteProfile) => setF({ email: p.email, ams: p.ams.join(", "), bus: p.bus.join(", ") });
  return (
    <Card style={{ marginBottom: 14, borderColor: T.plum }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.plum }}>Périmètres commerciaux (AM / BU par e-mail)</span>
        <button className="pill" onClick={onClose}>Fermer</button>
      </div>
      <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 10, lineHeight: 1.5 }}>
        Un commercial voit un compte s'il en est <b>owner</b> (attribution), si l'un de ses <b>AM</b> ou de ses <b>BU</b>
        correspond au compte, ou s'il l'a créé. Direction et directeurs commerciaux voient tout.
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div><label style={lbl}>E-mail du commercial *</label><input style={inp} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="jean@nt.ci" /></div>
        <div><label style={lbl}>Account managers (AM), séparés par des virgules</label><input style={inp} value={f.ams} onChange={(e) => set("ams", e.target.value)} placeholder="K. Diallo, M. Traoré" /></div>
        <div><label style={lbl}>BU / équipes, séparées par des virgules</label><input style={inp} value={f.bus} onChange={(e) => set("bus", e.target.value)} placeholder="ICT, CYBER" /></div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="pill on" disabled={busy || !f.email.trim()} onClick={() => void save()}>{busy ? "…" : "Enregistrer le périmètre"}</button>
        {msg && <span style={{ fontSize: 11.5, color: T.faint }}>{msg}</span>}
      </div>
      <ErrLine err={err} />
      {profiles.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 6 }}>Périmètres définis</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {profiles.map((p) => (
              <button key={p.email} onClick={() => edit(p)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "7px 10px", background: T.panel2, borderRadius: 8, border: `1px solid ${T.line}`, cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 12.5, color: T.ink }}>{p.email}</span>
                <span style={{ fontSize: 11.5, color: T.faint }}>
                  {p.ams.length ? `AM: ${p.ams.join(", ")}` : "AM: —"} · {p.bus.length ? `BU: ${p.bus.join(", ")}` : "BU: —"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* -------- Attribution manuelle du compte (owners) — édition réservée direction/commercial_dir -------- */
function OwnersEditor({ account, isAdmin, onSaved }: { account: CopiloteAccount; isAdmin: boolean; onSaved: () => void }) {
  const owners = account.owners ?? [];
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(owners.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setVal((account.owners ?? []).join(", ")); setEditing(false); }, [account.id, account.owners]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const list = val.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      await setCopiloteAccountOwners(account.id, list);
      setEditing(false); onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'attribution.");
    } finally { setBusy(false); }
  };
  if (!isAdmin && owners.length === 0) return null; // rien à montrer aux non-admins sans attribution
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: T.faint }}>Attribué à :</span>
        {owners.length ? owners.map((o, i) => <Badge key={i} c={T.emerald}>{o}</Badge>) : <span style={{ fontSize: 11.5, color: T.faint }}>non attribué</span>}
        {isAdmin && !editing && <button className="pill" onClick={() => setEditing(true)}>Modifier</button>}
      </div>
      {isAdmin && editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input style={{ ...inp, minWidth: 260, flex: 1 }} value={val} placeholder="e-mails séparés par des virgules" onChange={(e) => setVal(e.target.value)} />
          <button className="pill on" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Enregistrer"}</button>
          <button className="pill" disabled={busy} onClick={() => { setEditing(false); setVal(owners.join(", ")); }}>Annuler</button>
        </div>
      )}
      <ErrLine err={err} />
    </div>
  );
}
