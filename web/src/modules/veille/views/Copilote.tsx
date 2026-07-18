import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { T, fmt as fmtC } from "../../../design/tokens";
import { Eyebrow, Card, Badge, Kpi } from "../../../design/ui";
import { Select, Input, Textarea } from "../../../design/fields";
import { Modal, useToast } from "../../../design/overlay";
import { useCan, useClaims } from "../../../lib/rbac";
import { useAuthClaims } from "../../../lib/AuthProvider";
import { createAction, useActions, actionPriority, ACTION_TERMINAL, type StrategicAction } from "../lib/execution";
import {
  useMarketingContent,
  saveMarketingContent,
  updateMarketingStatus,
  deleteMarketingContent,
  MARKETING_STATUS_LABEL,
  type MarketingStatus,
} from "../lib/marketing";
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
  type ContenuResult,
  type CopiloteChatMessage,
  type MeddicResult,
  type BriefResult,
  type DealAnalysisResult,
  type BusinessCaseResult,
  type SequenceResult,
  type StakeholdersResult,
} from "../lib/copilote";
import { Freshness } from "../components/Freshness";

// Chaleur d'un prospect = intensité POSITIVE (passe finale 2026-07) : un lead « Chaud » est le plus
// désirable — il ne doit JAMAIS s'afficher dans le rouge « clay » réservé aux menaces/retards.
const CHALEUR_C: Record<string, string> = { Chaud: T.emerald, Tiède: T.gold, Froid: T.steel };
// NIV_C sert le NIVEAU DE RISQUE (risques cachés) : « Élevé » en rouge est ici correct (danger).
const NIV_C: Record<string, string> = { "Élevé": T.clay, Moyen: T.gold, Faible: T.steel };

const AGENT_TABS: { k: string; l: string; icon: string }[] = [
  { k: "prospection", l: "Prospection", icon: "🎯" },
  { k: "sequence", l: "Séquence multi-touch", icon: "📨" },
  { k: "cvp", l: "Proposition de valeur", icon: "💡" },
  { k: "businessCase", l: "Dossier de rentabilité", icon: "💰" },
  { k: "meddic", l: "Qualification MEDDIC", icon: "🩺" },
  { k: "dealAnalysis", l: "Analyse d'affaire", icon: "♟️" },
  { k: "stakeholders", l: "Parties prenantes", icon: "🕸️" },
  { k: "brief", l: "Brief RDV", icon: "📑" },
  { k: "triennal", l: "Plan triennal", icon: "🗺️" },
  { k: "planCompte", l: "Stratégie de compte", icon: "📋" },
  { k: "planAction", l: "Plan d'action 90 j", icon: "⚡" },
  { k: "redaction", l: "Rédaction", icon: "✍️" },
  { k: "contenu", l: "Contenu marketing", icon: "📣" },
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

/** Boutons d'envoi direct (audit doublement CA) : en zone CI/UEMOA WhatsApp est le canal B2B dominant ;
 * le dernier centimètre copier→coller (5 gestes) devient un tap → plus de messages réellement envoyés. */
function MsgActions({ objet, corps }: { objet?: string; corps: string }) {
  const body = encodeURIComponent(corps);
  const wa = `https://wa.me/?text=${body}`;
  const mail = `mailto:?subject=${encodeURIComponent(objet || "")}&body=${body}`;
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <a className="pill" href={wa} target="_blank" rel="noopener noreferrer" title="Envoyer via WhatsApp" style={{ fontSize: 11.5, textDecoration: "none" }}>WhatsApp</a>
      <a className="pill" href={mail} title="Ouvrir dans l'e-mail" style={{ fontSize: 11.5, textDecoration: "none" }}>E-mail</a>
      <CopyBtn text={objet ? `${objet}\n\n${corps}` : corps} />
    </span>
  );
}

/** Copilote Commercial (add-on) — réutilise le moteur IA serveur + le PESTEL/les signaux de la veille. */
export function Copilote() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { accounts, loading, error, scoped, reload } = useCopiloteAccounts();
  const { canWrite } = useCan("veille");
  const { role } = useClaims();
  const isAdmin = role === "direction" || role === "commercial_dir"; // peut attribuer les comptes
  // Deep-link (audit 2026-07 — unification des référentiels) : ?account=<slug> présélectionne le
  // compte (ex. depuis une opportunité IA du Plan d'action), reliant l'opportunité externe au
  // portefeuille réel. Sans correspondance, on retombe sur le tableau de bord (inoffensif).
  const [accountId, setAccountId] = useState<string>(sp.get("account") || "");
  // Deep-link inter-vues (audit doublement CA) : ?tab=<agent> ouvre directement le bon onglet
  // (ex. un signal chaud du Fil → copilote?account=…&tab=prospection). Débloque tout le maillage insight→action.
  const [tab, setTab] = useState<string>(() => {
    const t = sp.get("tab") || "";
    return AGENT_TABS.some((x) => x.k === t) ? t : "prospection";
  });
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

      {isAdmin && <PerimetresPanel open={showPerim} onClose={() => setShowPerim(false)} />}
      {canWrite && <NewAccountPanel open={showNew} onClose={() => setShowNew(false)} onCreated={(id) => { setAccountId(id); setShowNew(false); reload(); }} />}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {AGENT_TABS.map((t) => (
          <button key={t.k} className={`pill ${tab === t.k ? "on" : ""}`} onClick={() => setTab(t.k)} aria-pressed={tab === t.k}>
            <span aria-hidden style={{ marginRight: 5 }}>{t.icon}</span>{t.l}
          </button>
        ))}
      </div>

      {/* Panneau de l'agent sélectionné (bouton Générer + livrable) — placé JUSTE sous la barre
          d'actions pour que l'output apparaisse là où on clique, et non tout en bas après le détail
          du compte (correctif UX 2026-07). Le détail chiffré du compte suit en contexte. */}
      {tab === "prospection" && <ProspectionTab accountId={accountId} canWrite={canWrite} />}
      {tab === "sequence" && <SequenceTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "cvp" && <CvpTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "businessCase" && <BusinessCaseTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "meddic" && <MeddicTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "dealAnalysis" && <DealAnalysisTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "stakeholders" && <StakeholdersTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "brief" && <BriefTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "triennal" && <TriennalTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "planCompte" && <PlanCompteTab accountId={accountId} disabled={!accountId} canWrite={canWrite} />}
      {tab === "planAction" && <PlanActionTab accountId={accountId} disabled={!accountId} canWrite={canWrite} accountName={account?.nom} />}
      {tab === "redaction" && <RedactionTab accountId={accountId} compte={account?.nom || ""} canWrite={canWrite} />}
      {tab === "contenu" && <ContenuTab accountId={accountId} canWrite={canWrite} />}
      {tab === "chat" && <ChatTab accountId={accountId} canWrite={canWrite} />}

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
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                <Money label="CAS réalisé" value={account.nt360.casTotal ?? 0} accent={T.emerald} />
                <Money label="Pipeline pondéré" value={account.nt360.pipelinePondere ?? 0} accent={T.gold} />
                {typeof account.nt360.wins === "number" && account.nt360.wins > 0 && (
                  <div><Eyebrow>Affaires gagnées</Eyebrow><div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 24, fontWeight: 700, color: T.plum, marginTop: 6 }}>{account.nt360.wins}</div></div>
                )}
              </div>
              {/* Fraicheur de l'empreinte nt360 : credibilite du chiffre visible (audit valeur CXO 2026-07). */}
              <div style={{ marginTop: 6 }}>
                <Freshness at={(account.nt360.updatedAt as { toMillis?: () => number } | undefined) ?? null} label="Empreinte nt360" />
              </div>
            </div>
          )}

          {/* Réserve de valeur CHIFFRÉE (audit doubler-CA) : cross-sell + upsell visibles d'un coup
              d'œil, sans lancer de génération IA — chiffrés au panier de référence réel fiable. */}
          {((account.nt360?.whitespaceValue ?? []).length > 0 || (account.nt360?.upsellHeadroom ?? 0) > 0) && (
            <div style={{ marginTop: 14, background: T.panel2, borderRadius: 10, padding: "11px 13px", borderLeft: `3px solid ${T.emerald}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <Eyebrow color={T.emerald}>Réserve de valeur non captée</Eyebrow>
                <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 17, fontWeight: 700, color: T.emerald }}>
                  ≈ {fmtC((account.nt360?.whitespacePotential ?? 0) + (account.nt360?.upsellHeadroom ?? 0))} FCFA
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {(account.nt360?.whitespaceValue ?? []).map((w, i) => (
                  <div key={`ws${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                    <span style={{ color: T.ink }}>↗ Cross-sell <b>{w.offre}</b></span>
                    <span style={{ color: T.emerald, fontVariantNumeric: "tabular-nums" }}>{fmtC(w.montant)}</span>
                  </div>
                ))}
                {(account.nt360?.upsellByOffre ?? []).map((u, i) => (
                  <div key={`up${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                    <span style={{ color: T.ink }}>⤴ Upsell <b>{u.offre}</b> (sous-pénétré)</span>
                    <span style={{ color: T.gold, fontVariantNumeric: "tabular-nums" }}>{fmtC(u.montant)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bascule vers le récurrent (levier RÉCURRENCE) : compte 100% projet ponctuel → managé/OPEX. */}
          {account.nt360?.managedReco && (
            <div style={{ marginTop: 12, background: `${T.plum}14`, borderRadius: 10, padding: "10px 13px", borderLeft: `3px solid ${T.plum}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <Eyebrow color={T.plum}>Passer au récurrent (managé / OPEX)</Eyebrow>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: T.plum }}>ARR ≈ {fmtC(account.nt360.managedReco.arr)} FCFA</span>
              </div>
              <div style={{ fontSize: 12, color: T.dim, marginTop: 6, lineHeight: 1.45 }}>
                Ce compte n'achète que du projet ponctuel. Proposer <b style={{ color: T.ink }}>{account.nt360.managedReco.offre}</b> en offre managée transforme un CA one-shot en revenu récurrent.
              </div>
            </div>
          )}

          {/* Boucle veille → action : les déclencheurs de veille EXTERNES rattachés à ce compte. C'est
              ce qui fait qu'un signal d'environnement produit une action commerciale (direction intégrée). */}
          {(account.nt360?.veille?.top ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Eyebrow color={T.plum}>Déclencheurs de veille {account.nt360?.veille?.hot ? "· 🔴 actif" : ""}</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 7 }}>
                {(account.nt360?.veille?.top ?? []).map((v, i) => (
                  <button key={i} onClick={() => navigate(`/veille/fil?ent=${encodeURIComponent(account.nom)}`)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: T.panel2, border: `1px solid ${v.impact === "high" || v.prox === "imminent" ? T.plum + "66" : T.line}`, borderRadius: 8, padding: "8px 11px", cursor: "pointer" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                      {v.impact === "high" && <Badge c={T.clay}>Impact fort</Badge>}
                      {v.prox === "imminent" && <Badge c={T.gold}>Imminent</Badge>}
                      <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{v.title}</span>
                    </div>
                    {v.soWhat ? <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2 }}>↳ {v.soWhat}</div> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cross-sell/upsell DÉCLENCHÉ par un événement de veille : l'offre opportune MAINTENANT, avec
              son déclencheur externe. C'est le point de jonction veille ↔ vente (direction intégrée). */}
          {(account.nt360?.eventOffers ?? []).length > 0 && (
            <div style={{ marginTop: 12, background: `${T.gold}14`, borderRadius: 10, padding: "10px 13px", borderLeft: `3px solid ${T.gold}` }}>
              <Eyebrow color={T.gold}>⚡ Opportun maintenant (déclenché par la veille)</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {(account.nt360?.eventOffers ?? []).map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.ink, lineHeight: 1.45 }}>
                    <b>{e.kind === "upsell" ? "Upsell" : "Cross-sell"} {e.offre}</b> {e.montant > 0 ? <span style={{ color: T.emerald, fontVariantNumeric: "tabular-nums" }}>({fmtC(e.montant)} FCFA)</span> : null}
                    <div style={{ fontSize: 11, color: T.dim, marginTop: 1 }}>↳ déclenché par : {e.event}</div>
                  </div>
                ))}
              </div>
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
                  <DealRow key={`${o.ref || o.nom}-${i}`} nom={o.nom} dealRef={o.ref} bu={o.bu} etape={o.etape} montant={o.montant} probability={o.probability} closingDate={o.closingDate} />
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
    <div style={{ position: "relative", minWidth: 180, flex: 1 }}>
      <input
        aria-label="Rechercher un compte commercial"
        style={{ ...inp, minWidth: 0, width: "100%", cursor: "text" }}
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
        {fmtC(value)} <span style={{ fontSize: 13, color: T.dim, fontWeight: 600 }}>FCFA</span>
      </div>
    </div>
  );
}

/* -------- Ligne opportunité : montant + jauge de probabilité (met en avant ce qui est jouable) -------- */
function DealRow({ nom, bu, etape, montant, probability, closingDate, dealRef }: { nom: string; bu?: string; etape: string; montant: number; probability?: number | null; closingDate?: string; dealRef?: string }) {
  // Echelle canonique 0-100. nt360 stocke la probabilite en fraction 0-1 (0.5 = 50 %) : sans
  // normalisation, « 0.5 » s'affichait « 0.5% ». Defensif ici aussi (docs deja stockes en 0-1, avant
  // resync) : une valeur <= 1 est une fraction (x100), > 1 est deja un pourcentage. Borne 0-100.
  const p =
    typeof probability === "number" && Number.isFinite(probability)
      ? Math.round(Math.max(0, Math.min(100, probability <= 1 ? probability * 100 : probability)))
      : null;
  // Le libellé (fiche projet ou « Opportunité <offre> ») peut déjà contenir l'offre → on n'affiche le
  // BU en second que s'il n'y est pas déjà, pour éviter « Opportunité ICT · ICT ».
  const showBu = bu && !nom.toLowerCase().includes(bu.toLowerCase());
  // Urgence de closing (audit doubler-CA) : dépassée = à requalifier (fantôme) ; ≤14 j = à fermer.
  const cd = closingDate && /^\d{4}-\d{2}-\d{2}/.test(closingDate) ? closingDate : "";
  const todayIso = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const overdue = cd !== "" && cd < todayIso;
  const soon = cd !== "" && !overdue && cd <= in14;
  const edge = overdue ? T.clay : soon ? T.emerald : T.gold;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 11px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${edge}` }}>
      <div style={{ minWidth: 0 }}>
        <div title={dealRef ? `réf. ${dealRef}` : undefined} style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nom}{showBu ? <span style={{ color: T.dim }}> · {bu}</span> : null} <span style={{ color: T.steel }}>— {etape}</span>
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
          {closingDate ? <span style={{ fontSize: 11, color: overdue ? T.clay : soon ? T.emerald : T.dim, fontWeight: overdue || soon ? 700 : 400 }}>clôture {closingDate}{overdue ? " · dépassée → requalifier" : soon ? " · sous 14 j" : ""}</span> : null}
        </div>
      </div>
      <span style={{ fontSize: 13, color: T.gold, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontFamily: "'Bricolage Grotesque',sans-serif" }}>{fmtC(montant)} FCFA</span>
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

/* -------- « Ma journée » : file d'actions personnelles datées (adoption — audit doubler-CA) --------
 * Le commercial ouvre le Copilote et voit d'abord CE QU'IL A À FAIRE (ses actions, échéance ≤ J+7 ou
 * en retard), pas une vue d'ensemble passive. Sans réponse à « par quoi je commence ce matin »,
 * l'outil n'entre pas dans la routine quotidienne — prérequis de tous les autres leviers. */
function MaJournee({ onPick }: { onPick: (id: string) => void }) {
  const { actions } = useActions();
  const { user } = useAuthClaims();
  const uid = user?.uid ?? "";
  const me = (user?.displayName || user?.email || "").trim().toLowerCase();
  const todayIso = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  const mine = useMemo(() => {
    const isMine = (a: StrategicAction) =>
      (a.createdBy && a.createdBy === uid) || (me && (a.owner || "").trim().toLowerCase() === me);
    const dated = (a: StrategicAction) => {
      const d = a.echeance || "";
      return /^\d{4}-\d{2}-\d{2}/.test(d) ? d : "";
    };
    return actions
      .filter((a) => isMine(a) && !ACTION_TERMINAL.has(a.statut))
      .map((a) => ({ a, d: dated(a) }))
      // On garde : en retard, ou dû sous 7 j, ou sans date (à cadrer).
      .filter(({ d }) => d === "" || d <= in7)
      .sort((x, y) => {
        const rank = (v: { d: string }) => (v.d === "" ? 2 : v.d < todayIso ? 0 : 1); // retard d'abord, sans-date en dernier
        if (rank(x) !== rank(y)) return rank(x) - rank(y);
        if (x.d && y.d && x.d !== y.d) return x.d < y.d ? -1 : 1;
        return actionPriority(y.a) - actionPriority(x.a);
      })
      .slice(0, 6);
  }, [actions, uid, me, todayIso, in7]);

  if (mine.length === 0) return null;
  const fmtEch = (d: string) => {
    if (!d) return "à cadrer";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) return d;
    const MO = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    return `${+m[3]} ${MO[+m[2] - 1]}`;
  };
  return (
    <Card style={{ borderLeft: `3px solid ${T.gold}` }}>
      <Eyebrow color={T.gold}>Ma journée — {mine.length} action{mine.length > 1 ? "s" : ""} à traiter</Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {mine.map(({ a, d }, i) => {
          const overdue = d !== "" && d < todayIso;
          const row = (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 11px", background: T.panel2, borderRadius: 9, border: `1px solid ${overdue ? T.clay + "55" : T.line}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                {a.source ? <div style={{ fontSize: 10.5, color: T.faint, marginTop: 2 }}>{a.source}</div> : null}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color: overdue ? T.clay : d === "" ? T.faint : T.emerald }}>
                {overdue ? "⚠ en retard · " : ""}{fmtEch(d)}
              </span>
            </div>
          );
          return a.accountId ? (
            <button key={i} onClick={() => onPick(a.accountId!)} style={{ display: "block", width: "100%", padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>{row}</button>
          ) : (
            <div key={i}>{row}</div>
          );
        })}
      </div>
    </Card>
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
  const { totalCas, totalPipe, hotDeals, reserveTotale, topPotential, worklist, churn } = useMemo(() => {
    const totalCas = accounts.reduce((s, a) => s + (a.nt360?.casTotal ?? 0), 0);
    const totalPipe = accounts.reduce((s, a) => s + (a.nt360?.pipelinePondere ?? 0), 0);
    // Réserve de valeur non captée (audit doubler-CA — leviers PANIER/COUVERTURE) : cross-sell + upsell
    // chiffrés au panier réel, persistés au sync. Rend visible « où il reste du CA à aller chercher ».
    const reserveTotale = accounts.reduce((s, a) => s + (a.nt360?.whitespacePotential ?? 0) + (a.nt360?.upsellHeadroom ?? 0), 0);
    // Classement par POTENTIEL non capté (pas par taille actuelle) : les comptes à plus fort headroom.
    const topPotential = accounts
      .filter((a) => (a.nt360?.scorePotentiel ?? 0) > 0)
      .slice()
      .sort((x, y) => (y.nt360?.scorePotentiel ?? 0) - (x.nt360?.scorePotentiel ?? 0))
      .slice(0, 8);
    // File « à traiter cette semaine » : signaux d'action pré-calculés (dormance, deal fantôme, point
    // mort) agrégés sur tout le portefeuille, triés par € en jeu — la réponse à « qui relancer ».
    // Boucle veille → action : un déclencheur de veille externe (chaud) ou un deal fantôme remonte en
    // tête, AVANT le tri par € — c'est l'environnement externe qui pilote l'urgence, pas que la donnée
    // interne. Puis, à urgence égale, par montant en jeu.
    const urg = (s: { type: string; hot?: boolean; armed?: boolean }) =>
      (s.type === "veille" && s.hot) || s.type === "fantome" || (s.type === "dormante" && s.armed) ? 1 : 0;
    const worklist = accounts
      .flatMap((a) => (a.nt360?.signals ?? []).map((sig) => ({ ...sig, compte: a.nom, accountId: a.id })))
      .sort((x, y) => urg(y) - urg(x) || (y.montant ?? 0) - (x.montant ?? 0))
      .slice(0, 8);
    // Churn silencieux (levier RÉCURRENCE) : récurrent qui s'éteint = offres dormantes matérielles.
    let churnComptes = 0, churnMontant = 0;
    for (const a of accounts) {
      const dorm = (a.nt360?.signals ?? []).filter((s) => s.type === "dormante");
      if (dorm.length) { churnComptes += 1; churnMontant += dorm.reduce((s, x) => s + (x.montant ?? 0), 0); }
    }
    const churn = { comptes: churnComptes, montant: churnMontant };
    // Deals chauds = opportunités en cours triées par valeur pondérée. Correctif audit 2026-07 : une
    // probabilité INCONNUE ne vaut plus 100 % (elle faisait passer les deals non qualifiés devant des
    // deals qualifiés à 90 %) — repli conservateur à 50 %, probabilité connue bornée 0-100.
    // Audit doubler-CA (levier VICTOIRE) : un deal à closing DÉPASSÉE n'est pas « chaud » (à requalifier)
    // → on le rétrograde fortement ; un deal qui se ferme sous 14 j est boosté (l'attention doit aller
    // au CA réellement fermable ce trimestre, pas à un gros deal fantôme).
    const todayIso = new Date().toISOString().slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const dealWeight = (o: { montant: number; probability?: number | null; closingDate?: string }) => {
      const base = o.montant * (typeof o.probability === "number" ? Math.max(0, Math.min(100, o.probability)) / 100 : 0.5);
      const cd = o.closingDate;
      if (cd && /^\d{4}-\d{2}-\d{2}/.test(cd)) {
        if (cd < todayIso) return base * 0.1; // closing dépassée → fantôme, rétrogradé
        if (cd <= in14) return base * 1.5; // fenêtre de closing imminente → priorité
      }
      return base;
    };
    const hotDeals = accounts
      .flatMap((a) => (a.nt360?.opportunites ?? []).map((o) => ({ ...o, compte: a.nom, accountId: a.id })))
      .sort((x, y) => dealWeight(y) - dealWeight(x))
      .slice(0, 8);
    return { totalCas, totalPipe, hotDeals, reserveTotale, topPotential, worklist, churn };
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
      <MaJournee onPick={onPick} />
      {churn.montant > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${T.clay}18`, border: `1px solid ${T.clay}55`, borderRadius: 10, padding: "10px 13px" }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.45 }}>
            <b style={{ color: T.clay }}>Récurrent en train de s'éteindre :</b> {churn.comptes} compte{churn.comptes > 1 ? "s" : ""} avec des offres dormantes ≈ <b>{fmt(churn.montant)} FCFA</b>/an à relancer. Voir « À traiter cette semaine ».
          </span>
        </div>
      )}
      <Card>
        <Eyebrow color={T.gold}>Portefeuille commercial — vue d'ensemble</Eyebrow>
        <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginTop: 12 }}>
          <Kpi label="Comptes actifs" value={accounts.length} accent={T.steel} />
          <Kpi label="CAS réalisé" value={<>{fmt(totalCas)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></>} accent={T.emerald} />
          <Kpi label="Pipeline pondéré" value={<>{fmt(totalPipe)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></>} accent={T.gold} />
          <Kpi label="Réserve cross-sell + upsell" value={<>{fmt(reserveTotale)} <span style={{ fontSize: 13, color: T.dim }}>FCFA</span></>} accent={T.emerald} />
        </div>
      </Card>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          {/* Composition explicite (audit 2026-07) : le « poids » agrège CA RÉALISÉ (passé) + pipeline
              pondéré (futur) — deux natures différentes. On le libelle comme tel et on montre le détail
              (vert = réalisé, or = pipeline) pour ne pas masquer le mélange derrière un seul chiffre. */}
          <Eyebrow color={T.emerald}>Top comptes — CAS réalisé + pipeline pondéré</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {accounts.slice(0, 8).map((a) => (
              <button key={a.id} onClick={() => onPick(a.id)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "9px 11px", background: T.panel2, borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", textAlign: "left", minHeight: 44 }}>
                <span style={{ fontSize: 12.5, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nom}{a.secteur ? <span style={{ color: T.dim }}> · {a.secteur}</span> : null}</span>
                <span style={{ fontSize: 11, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  <span style={{ color: T.emerald, fontWeight: 700 }}>{fmt(a.nt360?.casTotal ?? 0)}</span>
                  <span style={{ color: T.faint }}> + </span>
                  <span style={{ color: T.gold, fontWeight: 700 }}>{fmt(a.nt360?.pipelinePondere ?? 0)}</span>
                </span>
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
                  <DealRow nom={`${o.compte} · ${o.nom}`} dealRef={o.ref} bu={o.bu} etape={o.etape} montant={o.montant} probability={o.probability} closingDate={o.closingDate} />
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* COUVERTURE : classer par potentiel non capté, pas par taille — orienter l'effort vers le CA
            adressable (audit doubler-CA). Le tri « Top comptes » ci-dessus met en tête les comptes déjà
            pénétrés ; celui-ci met en tête ceux où il reste le plus à aller chercher. */}
        <Card>
          <Eyebrow color={T.emerald}>Comptes à plus fort potentiel non capté</Eyebrow>
          {topPotential.length === 0 ? (
            <div style={{ fontSize: 12, color: T.dim, marginTop: 10 }}>Réserve de valeur en cours de calcul (synchro nt360).</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {topPotential.map((a) => {
                const reserve = (a.nt360?.whitespacePotential ?? 0) + (a.nt360?.upsellHeadroom ?? 0);
                const top = a.nt360?.whitespaceValue?.[0]?.offre;
                return (
                  <button key={a.id} onClick={() => onPick(a.id)}
                    style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "9px 11px", background: T.panel2, borderRadius: 9, border: `1px solid ${T.line}`, cursor: "pointer", textAlign: "left", minHeight: 44 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: T.ink, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nom}</span>
                      {top ? <span style={{ fontSize: 10.5, color: T.faint }}>↗ {top}</span> : null}
                    </span>
                    <span style={{ fontSize: 12, color: T.emerald, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmt(reserve)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {/* File « à traiter cette semaine » — signaux d'action pré-calculés au sync (dormance/deal
            fantôme/point mort), triés par € en jeu. La réponse concrète à « qui relancer, et pourquoi ». */}
        <Card>
          <Eyebrow color={T.clay}>À traiter cette semaine</Eyebrow>
          {worklist.length === 0 ? (
            <div style={{ fontSize: 12, color: T.dim, marginTop: 10 }}>Aucun signal d'action en attente — portefeuille à jour.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {worklist.map((s, i) => {
                const armed = s.type === "dormante" && s.armed;
                const c = s.type === "veille" ? T.plum : s.type === "fantome" ? T.clay : s.type === "pointmort" ? T.gold : armed ? T.clay : T.steel;
                return (
                  <button key={i} onClick={() => onPick(s.accountId)} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "9px 11px", background: T.panel2, borderRadius: 9, border: `1px solid ${armed ? T.clay + "55" : T.line}`, cursor: "pointer", textAlign: "left", minHeight: 44 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, color: T.ink, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.compte}</span>
                      <span style={{ fontSize: 10.5, color: c }}>{armed ? "⚡ " : ""}{s.label}</span>
                      {armed && s.triggerEvent ? <span style={{ fontSize: 10, color: T.faint, display: "block" }}>fenêtre rouverte : {s.triggerEvent}</span> : null}
                    </span>
                    {s.montant > 0 ? <span style={{ fontSize: 11.5, color: T.dim, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmt(s.montant)}</span> : null}
                  </button>
                );
              })}
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
// Persistance offline (audit doublement CA) : les livrables générés au bureau survivent au reload et à la
// coupure réseau → consultables en RDV/mobilité (salle d'attente). localStorage, clé portant l'accountId.
const LS_PREFIX = "copiloteRun:";
function lsGet<T>(key: string): T | undefined {
  try { const v = localStorage.getItem(LS_PREFIX + key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
}
function lsSet(key: string, val: unknown) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch { /* quota/private mode : silencieux */ }
}
function cacheGet<T>(key: string): T | undefined {
  return (AGENT_CACHE.get(key) as T | undefined) ?? lsGet<T>(key);
}
function cacheSet(key: string, val: unknown) { AGENT_CACHE.set(key, val); lsSet(key, val); }

function useAgent<T>(agent: CopiloteAgent, accountId?: string) {
  const cacheKey = `${agent}:${accountId || ""}`;
  const [data, setData] = useState<T | null>(() => cacheGet<T>(cacheKey) ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(Boolean(cacheGet(cacheKey)));
  // Bouton déclencheur capturé au clic : après une génération fraîche on le remonte en haut du
  // viewport pour révéler le livrable rendu juste en dessous (sinon il apparaît hors écran et
  // l'utilisateur doit deviner qu'il faut faire défiler vers le bas).
  const triggerElRef = useRef<HTMLElement | null>(null);
  const justRan = useRef(false);
  // Changement de compte/agent : on réhydrate depuis le cache (livrable déjà généré ré-affiché
  // instantanément) au lieu de repartir vide — tout en garantissant que le livrable montré
  // correspond au compte courant (la clé de cache porte l'accountId).
  useEffect(() => {
    const cached = cacheGet<T>(cacheKey);
    setData(cached ?? null); setErr(null); setDone(Boolean(cached));
  }, [cacheKey]);
  // Remontée uniquement après une génération fraîche (justRan), jamais sur une réhydratation cache.
  useEffect(() => {
    if (!justRan.current || busy || !done) return;
    justRan.current = false;
    const el = triggerElRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [done, busy]);
  const run = async (extra?: Record<string, unknown>) => {
    const forKey = cacheKey; // capture : on ignore la réponse si le compte a changé entre-temps
    triggerElRef.current = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    setBusy(true); setErr(null);
    try {
      const res = await copiloteGenerate<T>(agent, accountId || undefined, extra);
      if (forKey !== `${agent}:${accountId || ""}`) return; // course : compte changé → on jette
      cacheSet(forKey, res);
      justRan.current = true;
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
            {c.offre && <div style={{ fontSize: 12, color: T.emerald, marginTop: 2 }}><b>Offre à pousser :</b> {c.offre}</div>}
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
          {/* Ferme la boucle insight->envoi (audit 4 zones 2026-07) : la CVP etait le seul livrable
              pret-a-envoyer sans bouton d'envoi direct (WhatsApp/e-mail), contrairement aux 4 autres. */}
          <MsgActions corps={[data.message, ...(data.differenciateurs ?? [])].filter(Boolean).join("\n\n")} />
          {data.prochaineEtape && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: T.panel2, borderRadius: 9, borderLeft: `3px solid ${T.gold}`, fontSize: 12.5, color: T.ink }}>
              <b style={{ color: T.gold }}>▶ Prochaine étape :</b> {data.prochaineEtape}
            </div>
          )}
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
            {r.caCible && <div style={{ fontSize: 12, color: T.emerald, fontWeight: 700, marginTop: 6 }}>🎯 {r.caCible}</div>}
            {r.jalon && <div style={{ fontSize: 11.5, color: T.gold, marginTop: 4 }}><b>Jalon :</b> {r.jalon}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlanCompteTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<PlanCompteResult>("planCompte", accountId);
  const HZ_C: Record<string, string> = { "Court terme": T.clay, "Moyen terme": T.gold, Continu: T.steel };
  return (
    <TabShell title="Stratégie de développement du compte" busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run()} label="Élaborer la stratégie" hint="Sélectionnez un compte pour sa stratégie de développement.">
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          {data.diagnostic && (
            <div style={{ padding: "12px 14px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${T.plum}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: T.plum }}>Diagnostic</div>
              <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.55, marginTop: 4 }}>{data.diagnostic}</div>
            </div>
          )}
          {data.these && (
            <div style={{ marginTop: 10, padding: "12px 14px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${T.gold}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: T.gold }}>Thèse de développement</div>
              <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.55, marginTop: 4 }}>{data.these}</div>
            </div>
          )}
          {data.mouvements.length > 0 && (
            <Section title="Mouvements prioritaires (tranchés)" color={T.emerald}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                {data.mouvements.map((m, i) => (
                  <div key={i} style={{ background: T.panel2, borderRadius: 9, padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{i === 0 ? "① " : `${i + 1}. `}{m.titre}</span>
                      <Badge c={HZ_C[m.horizon] ?? T.faint}>{m.horizon}</Badge>
                    </div>
                    {m.pourquoi && <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}><b style={{ color: T.steel }}>Pourquoi :</b> {m.pourquoi}</div>}
                    {m.impact && <div style={{ fontSize: 12.5, color: T.emerald, marginTop: 2, fontWeight: 600 }}>📈 {m.impact}</div>}
                  </div>
                ))}
              </div>
            </Section>
          )}
          {data.risquesCaches.length > 0 && (
            <Section title="Risques cachés" color={T.clay}>
              <div style={{ marginTop: 6 }}>
                {data.risquesCaches.map((r, i) => (
                  <div key={i} style={{ padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 12.5, color: T.ink }}>{r.r}</span>
                      <Badge c={NIV_C[r.niv] ?? T.faint}>{r.niv}</Badge>
                    </div>
                    <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.emerald }}>Parade :</b> {r.m}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </TabShell>
  );
}

const QUAND_C: Record<string, string> = { "0–30 jours": T.clay, "30–60 jours": T.gold, "60–90 jours": T.steel, Continu: T.faint };

// Urgence dérivée de l'échéance du plan (pour prioriser l'action une fois ajoutée). Les clés DOIVENT
// être les buckets réellement produits par le plan (copilote.js normalizeQuand → « 0–30 jours »…),
// pas des libellés « Immédiat/Cette semaine » qui ne matchaient JAMAIS `p.quand` (audit 4 zones
// 2026-07) : le lookup retombait toujours sur 3, rendant le quadrant « Faire maintenant » inatteignable.
const QUAND_URGENCE: Record<string, number> = { "0–30 jours": 5, "30–60 jours": 4, "60–90 jours": 3, Continu: 2 };

function PlanActionTab({ accountId, disabled, canWrite, accountName }: { accountId: string; disabled: boolean; canWrite: boolean; accountName?: string }) {
  const { data, busy, err, done, run } = useAgent<PlanActionResult>("planAction", accountId);
  const { user } = useAuthClaims();
  const toast = useToast();
  const [added, setAdded] = useState<Set<number>>(new Set());

  async function addToPlan(i: number, p: PlanActionResult["plan"][number]) {
    if (added.has(i)) return;
    const urgence = QUAND_URGENCE[p.quand] ?? 3;
    try {
      await createAction({
        title: p.action,
        impact: 4, urgence, effort: 2,
        ev: Math.round(actionPriority({ impact: 4, urgence, effort: 2 }) * 100),
        owner: user?.displayName || user?.email || "",
        echeance: /^\d{4}-\d{2}-\d{2}/.test(p.echeance || "") ? (p.echeance || "") : "",
        statut: "À lancer",
        source: `Copilote · plan 90j${accountName ? ` · ${accountName}` : ""}`,
        accountId,
      });
      setAdded((s) => new Set(s).add(i));
      toast.success("Ajouté à ton plan d'action.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'ajout.");
    }
  }

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
              <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{p.action}</div>
                {p.echeance && <Badge c={T.gold}>📅 {p.echeance}</Badge>}
              </div>
              {p.objet && <div style={{ fontSize: 11.5, color: T.steel, marginTop: 2 }}>↳ {p.objet}</div>}
              {p.preuve && <div style={{ fontSize: 11.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.emerald }}>Preuve :</b> {p.preuve}</div>}
            </div>
            {canWrite && (
              <button
                onClick={() => addToPlan(i, p)}
                disabled={added.has(i)}
                title="Enregistrer cette étape dans mon plan d'action suivi"
                style={{ flexShrink: 0, border: `1px solid ${added.has(i) ? T.emerald : T.line}`, background: added.has(i) ? T.emerald + "22" : "transparent", color: added.has(i) ? T.emerald : T.dim, cursor: added.has(i) ? "default" : "pointer", fontSize: 11, padding: "4px 9px", borderRadius: 7, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {added.has(i) ? "✓ Ajouté" : "＋ Au plan"}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Livrables à forte valeur (audit profondeur 2026-07) ---------- */

const PROBA_C: Record<string, string> = { "Élevée": T.emerald, Moyenne: T.gold, Faible: T.clay };
// Le POUVOIR d'une partie prenante est une MAGNITUDE NEUTRE, pas un danger (passe finale 2026-07) :
// un décideur à fort pouvoir peut être un allié. On l'affiche en accent neutre (plum), pas en rouge menace.
const POUVOIR_C: Record<string, string> = { "Élevé": T.plum, Moyen: T.gold, Faible: T.steel };
const POSTURE_C: Record<string, string> = { Champion: T.emerald, Favorable: T.emerald, Neutre: T.steel, Sceptique: T.gold, "Détracteur": T.clay, Inconnu: T.faint };

/** En-tête + états communs d'un onglet livrable (réduit la répétition). */
function TabShell({ title, color = T.emerald, busy, disabled, canWrite, done, empty, onRun, label, children, hint }: {
  title: string; color?: string; busy: boolean; disabled: boolean; canWrite: boolean; done: boolean; empty: boolean;
  onRun: () => void; label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={color}>{title}</Eyebrow>
        <GenButton busy={busy} disabled={disabled || !canWrite} onClick={onRun} label={label} />
      </div>
      <PickHint show={disabled} text={hint || "Sélectionnez un compte."} />
      <ReadOnlyNote show={!canWrite} />
      <GenSkeleton show={busy} />
      <EmptyLine show={done && !busy && empty} />
      {children}
    </Card>
  );
}
function Chips({ items, color = T.dim }: { items: string[]; color?: string }) {
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color, lineHeight: 1.65 }}>
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}
function QaList({ pairs }: { pairs: { objection: string; reponse: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
      {pairs.map((q, i) => (
        <div key={i} style={{ background: T.panel2, borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 12.5, color: T.ink }}><b style={{ color: T.clay }}>Objection :</b> {q.objection}</div>
          <div style={{ fontSize: 12.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.emerald }}>Réponse :</b> {q.reponse}</div>
        </div>
      ))}
    </div>
  );
}
function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color }}>{title}</div>
      {children}
    </div>
  );
}

function SequenceTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<SequenceResult>("sequence", accountId);
  const CANAL_C: Record<string, string> = { "E-mail": T.steel, WhatsApp: T.emerald, LinkedIn: T.plum, Appel: T.gold, RDV: T.clay };
  return (
    <TabShell title="Séquence de prospection multi-touch (datée)" busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={(data?.touches ?? []).length === 0} onRun={() => run()} label="Générer la séquence" hint="Sélectionnez un compte pour une séquence ancrée sur ses faits.">
      <ErrLine err={err} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {(data?.touches ?? []).map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
            <div style={{ minWidth: 44, textAlign: "center", fontWeight: 700, fontFamily: "'Bricolage Grotesque',sans-serif", color: T.gold }}>{t.jour}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Badge c={CANAL_C[t.canal] ?? T.faint}>{t.canal}</Badge>
                <span style={{ fontSize: 12, color: T.steel }}>{t.objectif}</span>
                <MsgActions corps={t.message} />
              </div>
              <div style={{ fontSize: 12.5, color: T.ink, marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </TabShell>
  );
}

function BusinessCaseTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<BusinessCaseResult>("businessCase", accountId);
  return (
    <TabShell title="Business case chiffré (ROI)" color={T.gold} busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run()} label="Générer le business case" hint="Sélectionnez un compte pour chiffrer sa valeur.">
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: "12px 14px", background: T.panel2, borderRadius: 10, fontSize: 14, color: T.ink, lineHeight: 1.55 }}>{data.synthese}</div>
          {data.potentielTotal && <div style={{ fontSize: 16, fontWeight: 700, color: T.emerald, marginTop: 10, fontFamily: "'Bricolage Grotesque',sans-serif" }}>Potentiel adressable : {data.potentielTotal}</div>}
          {data.gains.length > 0 && (
            <Section title="Leviers de valeur (chiffrés sur paniers de référence réels)" color={T.emerald}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {data.gains.map((g, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: T.panel2, borderRadius: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>{g.levier}</div>
                      {g.base && <div style={{ fontSize: 11, color: T.faint }}>{g.base}</div>}
                    </div>
                    <div style={{ fontSize: 13, color: T.gold, fontWeight: 700, whiteSpace: "nowrap" }}>{g.montant}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {data.hypotheses.length > 0 && <Section title="Hypothèses" color={T.steel}><Chips items={data.hypotheses} /></Section>}
          {data.risques.length > 0 && <Section title="Conditions / risques" color={T.clay}><Chips items={data.risques} /></Section>}
          {data.recommandation && <div style={{ fontSize: 12.5, color: T.dim, marginTop: 12 }}><b style={{ color: T.gold }}>Première action :</b> {data.recommandation}</div>}
        </div>
      )}
    </TabShell>
  );
}

function MeddicTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<MeddicResult>("meddic", accountId);
  const rows: [string, string][] = data ? [
    ["Metrics (gains chiffrés)", data.metrics], ["Economic buyer", data.economicBuyer],
    ["Decision criteria", data.decisionCriteria], ["Decision process", data.decisionProcess],
    ["Identified pain", data.identifiedPain], ["Champion", data.champion], ["Concurrence", data.competition],
  ] : [];
  const scoreC = data ? (data.score >= 66 ? T.emerald : data.score >= 33 ? T.gold : T.clay) : T.faint;
  const verdict = data?.verdict;
  const vC = verdict === "poursuivre" ? T.emerald : verdict === "désengager" ? T.clay : T.gold;
  const vLabel = verdict === "poursuivre" ? "POURSUIVRE" : verdict === "désengager" ? "DÉSENGAGER" : "REQUALIFIER";
  return (
    <TabShell title="Qualification MEDDIC" color={T.plum} busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run()} label="Qualifier le deal" hint="Sélectionnez un compte pour qualifier son opportunité.">
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          {verdict && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${vC}18`, border: `1px solid ${vC}55`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: vC, background: `${vC}22`, padding: "3px 8px", borderRadius: 6, flexShrink: 0 }}>{vLabel}</span>
              <span style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.45 }}>{data.blocageCritique || "Verdict de qualification du deal."}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: scoreC, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{data.score}/100</div>
            <div style={{ flex: 1, height: 8, background: T.panel2, borderRadius: 4, minWidth: 0 }}>
              <div style={{ width: `${data.score}%`, height: "100%", background: scoreC, borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 11.5, color: T.faint }}>maturité de qualification</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {rows.map(([k, v], i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <div style={{ width: 150, flexShrink: 0, fontSize: 11.5, color: T.faint, fontWeight: 600 }}>{k}</div>
                <div style={{ fontSize: 12.5, color: /qualifier|identifier|inconnu/i.test(v) ? T.gold : T.ink }}>{v}</div>
              </div>
            ))}
          </div>
          {data.trous.length > 0 && <Section title="Trous à combler" color={T.clay}><Chips items={data.trous} /></Section>}
          {data.prochainesActions.length > 0 && <Section title="Prochaines actions de qualification" color={T.emerald}><Chips items={data.prochainesActions} /></Section>}
        </div>
      )}
    </TabShell>
  );
}

function DealAnalysisTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<DealAnalysisResult>("dealAnalysis", accountId);
  return (
    <TabShell title="Analyse de deal & stratégie de gain" color={T.clay} busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run()} label="Analyser le deal" hint="Sélectionnez un compte avec un deal en cours.">
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{data.deal || "Deal principal"}</span>
            <Badge c={PROBA_C[data.probabilite] ?? T.faint}>Probabilité {data.probabilite}</Badge>
            <Badge c={T.steel}>vs {data.concurrent}</Badge>
          </div>
          {data.forcesConcurrent.length > 0 && <Section title="Forces adverses à neutraliser" color={T.clay}><Chips items={data.forcesConcurrent} /></Section>}
          {data.parades.length > 0 && <Section title="Parades" color={T.emerald}><Chips items={data.parades} /></Section>}
          {data.winThemes.length > 0 && <Section title="Axes de victoire" color={T.gold}><Chips items={data.winThemes} /></Section>}
          {data.objections.length > 0 && <Section title="Objections & réponses" color={T.steel}><QaList pairs={data.objections} /></Section>}
          {data.planClosing.length > 0 && (
            <Section title="Plan de closing daté" color={T.emerald}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {data.planClosing.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <Badge c={T.gold}>{s.quand}</Badge>
                    <span style={{ fontSize: 12.5, color: T.ink }}>{s.action}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </TabShell>
  );
}

function StakeholdersTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<StakeholdersResult>("stakeholders", accountId);
  return (
    <TabShell title="Cartographie des parties prenantes" color={T.steel} busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run()} label="Cartographier" hint="Sélectionnez un compte pour cartographier ses décideurs.">
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.parties.map((p, i) => (
              <div key={i} style={{ background: T.panel2, borderRadius: 8, padding: "9px 11px", borderLeft: `3px solid ${POSTURE_C[p.posture] ?? T.faint}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{p.nom}{p.role && p.role !== p.nom ? ` — ${p.role}` : ""}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge c={POUVOIR_C[p.pouvoir] ?? T.faint}>Pouvoir {p.pouvoir}</Badge>
                    <Badge c={POSTURE_C[p.posture] ?? T.faint}>{p.posture}</Badge>
                  </div>
                </div>
                {p.strategie && <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>{p.strategie}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {data.champion && <Badge c={T.emerald}>Champion : {data.champion}</Badge>}
          </div>
          {data.risqueRelationnel && <div style={{ fontSize: 12.5, color: T.dim, marginTop: 8 }}><b style={{ color: T.clay }}>Risque relationnel :</b> {data.risqueRelationnel}</div>}
          {data.multiThread.length > 0 && <Section title="Élargir la couverture (multi-thread)" color={T.emerald}><Chips items={data.multiThread} /></Section>}
        </div>
      )}
    </TabShell>
  );
}

function BriefTab({ accountId, disabled, canWrite }: { accountId: string; disabled: boolean; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<BriefResult>("brief", accountId);
  const [obj, setObj] = useState("");
  const copyText = data ? [
    `Snapshot : ${data.snapshot}`,
    data.objectifs.length ? `Objectifs :\n- ${data.objectifs.join("\n- ")}` : "",
    data.questions.length ? `Questions :\n- ${data.questions.join("\n- ")}` : "",
    data.aValoriser.length ? `À valoriser :\n- ${data.aValoriser.join("\n- ")}` : "",
    data.objections.length ? `Objections :\n${data.objections.map((o) => `- ${o.objection} → ${o.reponse}`).join("\n")}` : "",
    data.prochainesEtapes.length ? `Next steps :\n- ${data.prochainesEtapes.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n") : "";
  return (
    <TabShell title="Brief de rendez-vous" color={T.plum} busy={busy} disabled={disabled} canWrite={canWrite} done={done} empty={!data} onRun={() => run(obj.trim() ? { objectif: obj.trim() } : undefined)} label="Générer le brief" hint="Sélectionnez un compte pour préparer un RDV.">
      <ErrLine err={err} />
      {!disabled && (
        <div style={{ marginTop: 10 }}>
          <label style={lbl}>Objectif du RDV (optionnel)</label>
          <Input value={obj} onChange={setObj} placeholder="ex : ouvrir le SOC managé / renouveler le contrat ICT" />
        </div>
      )}
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><CopyBtn text={copyText} label="Copier le brief" /></div>
          <div style={{ padding: "12px 14px", background: T.panel2, borderRadius: 10, fontSize: 13.5, color: T.ink, lineHeight: 1.55 }}>{data.snapshot}</div>
          {data.objectifs.length > 0 && <Section title="Objectifs du RDV" color={T.emerald}><Chips items={data.objectifs} /></Section>}
          {data.questions.length > 0 && <Section title="Questions à poser" color={T.steel}><Chips items={data.questions} /></Section>}
          {data.aValoriser.length > 0 && <Section title="À valoriser" color={T.gold}><Chips items={data.aValoriser} /></Section>}
          {data.objections.length > 0 && <Section title="Objections probables & réponses" color={T.clay}><QaList pairs={data.objections} /></Section>}
          {data.prochainesEtapes.length > 0 && <Section title="Next steps à obtenir" color={T.emerald}><Chips items={data.prochainesEtapes} /></Section>}
        </div>
      )}
    </TabShell>
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
        <div><label style={lbl}>Type</label><Input value={form.kind} onChange={(v) => set("kind", v)} /></div>
        <div><label style={lbl}>Canal</label>
          <Select value={form.canal} onChange={(v) => set("canal", v)} ariaLabel="Canal"
            options={[{ value: "email", label: "E-mail" }, { value: "whatsapp", label: "WhatsApp" }, { value: "linkedin", label: "LinkedIn" }]} />
        </div>
        <div><label style={lbl}>Ton</label>
          <Select value={form.ton} onChange={(v) => set("ton", v)} ariaLabel="Ton"
            options={["Direct", "Institutionnel", "Chaleureux"].map((s) => ({ value: s, label: s }))} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={lbl}>Contexte (sans rien inventer)</label>
        <Textarea value={form.contexte} onChange={(v) => set("contexte", v)} />
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
              <MsgActions objet={v.objet} corps={v.corps} />
            </div>
            {v.objet && <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginTop: 8 }}>Objet : {v.objet}</div>}
            <div style={{ fontSize: 12.5, color: T.dim, whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.55 }}>{v.corps}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Contenu marketing (levier « waouh » n°2) — angles de contenu 1:N nourris par la veille. Ne
 * requiert PAS de compte (niveau marché) ; un compte sélectionné affine le secteur d'éclairage. */
function ContenuTab({ accountId, canWrite }: { accountId: string; canWrite: boolean }) {
  const { data, busy, err, done, run } = useAgent<ContenuResult>("contenu", accountId);
  const toast = useToast();
  const [savedKeys, setSavedKeys] = useState<Record<number, boolean>>({});
  // Enregistre un angle généré dans le backlog éditorial (persistance — levier « waouh » n°2).
  const save = async (a: ContenuResult["angles"][number], i: number) => {
    try {
      await saveMarketingContent({
        format: a.format, titre: a.titre, accroche: a.accroche, corps: a.corps, cta: a.cta,
        hashtags: a.hashtags ?? [], differenciateur: a.differenciateur, signalSource: a.signalSource,
        accountId: accountId || null,
      });
      setSavedKeys((s) => ({ ...s, [i]: true }));
      toast.success("Contenu enregistré dans le calendrier éditorial.");
    } catch {
      toast.error("Échec de l'enregistrement.");
    }
  };
  return (
    <>
      <Card>
        <Eyebrow color={T.plum}>Contenu marketing — 3 angles nourris par la veille</Eyebrow>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
          Posts LinkedIn / tribunes positionnant Neurones, ancrés sur un signal de veille RÉEL et un différenciateur RÉEL.
          {accountId ? " Le compte sélectionné affine le secteur." : " Sélectionnez un compte pour cibler un secteur, ou générez au niveau marché."}
        </div>
        <div style={{ marginTop: 12 }}>
          <GenButton busy={busy} disabled={!canWrite} onClick={() => { setSavedKeys({}); run(); }} label="Générer des angles de contenu" />
        </div>
        <ReadOnlyNote show={!canWrite} />
        <ErrLine err={err} />
        <GenSkeleton show={busy} lines={3} />
        <EmptyLine show={done && !busy && (data?.angles ?? []).length === 0} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {(data?.angles ?? []).map((a, i) => (
            <div key={i} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${T.plum}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge c={a.format === "Tribune" ? T.gold : T.steel}>{a.format}</Badge>
                  {a.differenciateur && <Badge c={T.emerald}>{a.differenciateur}</Badge>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <button className="pill" onClick={() => save(a, i)} disabled={!canWrite || savedKeys[i]} title="Enregistrer dans le calendrier éditorial" style={{ fontSize: 11, padding: "3px 10px" }}>
                    {savedKeys[i] ? "✓ Enregistré" : "💾 Enregistrer"}
                  </button>
                  <MsgActions objet={a.titre} corps={`${a.accroche}\n\n${a.corps}\n\n${a.cta}${a.hashtags?.length ? "\n\n" + a.hashtags.map((h) => (h.startsWith("#") ? h : "#" + h)).join(" ") : ""}`} />
                </div>
              </div>
              {a.titre && <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 700, marginTop: 8 }}>{a.titre}</div>}
              {a.accroche && <div style={{ fontSize: 12.5, color: T.ink, marginTop: 4, fontStyle: "italic" }}>{a.accroche}</div>}
              <div style={{ fontSize: 12.5, color: T.dim, whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.55 }}>{a.corps}</div>
              {a.cta && <div style={{ fontSize: 12, color: T.plum, marginTop: 8 }}>→ {a.cta}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {a.signalSource && <span style={{ fontSize: 10.5, color: T.faint }}>📡 {a.signalSource}</span>}
                {(a.hashtags ?? []).map((h, j) => <span key={j} style={{ fontSize: 10.5, color: T.steel }}>{h.startsWith("#") ? h : "#" + h}</span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <MarketingCalendar canWrite={canWrite} />
    </>
  );
}

const MARKETING_STATUS_C: Record<MarketingStatus, string> = { idee: T.steel, planifie: T.gold, publie: T.emerald };
const MARKETING_STATUS_ORDER: MarketingStatus[] = ["idee", "planifie", "publie"];

/** Calendrier éditorial (persistance marketing — levier « waouh » n°2) : backlog des contenus
 * enregistrés, avec cycle idée → planifié → publié, date de programmation et suppression. */
function MarketingCalendar({ canWrite }: { canWrite: boolean }) {
  const { items, loading } = useMarketingContent();
  const toast = useToast();
  if (loading && items.length === 0) return null;
  const setStatus = async (id: string, status: MarketingStatus) => {
    try { await updateMarketingStatus(id, status); } catch { toast.error("Échec de la mise à jour."); }
  };
  const setDate = async (id: string, status: MarketingStatus, date: string) => {
    try { await updateMarketingStatus(id, date ? "planifie" : status, date || null); } catch { toast.error("Échec."); }
  };
  const remove = async (id: string) => {
    try { await deleteMarketingContent(id); toast.success("Contenu supprimé."); } catch { toast.error("Échec de la suppression."); }
  };
  return (
    <Card style={{ marginTop: 14 }}>
      <Eyebrow color={T.plum}>Calendrier éditorial</Eyebrow>
      <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
        Backlog des contenus enregistrés — faites-les avancer idée → planifié → publié, programmez une date.
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: T.faint, marginTop: 12 }}>Aucun contenu enregistré. Générez des angles ci-dessus puis « 💾 Enregistrer ».</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {items.map((m) => (
            <div key={m.id} style={{ background: T.panel2, borderRadius: 10, padding: "10px 12px", borderLeft: `3px solid ${MARKETING_STATUS_C[m.status] ?? T.steel}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge c={m.format === "Tribune" ? T.gold : T.steel}>{m.format}</Badge>
                  <Badge c={MARKETING_STATUS_C[m.status] ?? T.steel}>{MARKETING_STATUS_LABEL[m.status]}</Badge>
                  {m.scheduledDate && <span style={{ fontSize: 10.5, color: T.faint }}>🗓️ {m.scheduledDate}</span>}
                </div>
                <MsgActions objet={m.titre} corps={`${m.accroche ?? ""}\n\n${m.corps}\n\n${m.cta ?? ""}${m.hashtags?.length ? "\n\n" + m.hashtags.map((h) => (h.startsWith("#") ? h : "#" + h)).join(" ") : ""}`} />
              </div>
              {m.titre && <div style={{ fontSize: 13, color: T.ink, fontWeight: 700, marginTop: 6 }}>{m.titre}</div>}
              {m.accroche && <div style={{ fontSize: 12, color: T.dim, marginTop: 3, fontStyle: "italic" }}>{m.accroche}</div>}
              {canWrite && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {MARKETING_STATUS_ORDER.map((s) => (
                    <button key={s} className={m.status === s ? "pill on" : "pill"} onClick={() => setStatus(m.id, s)} style={{ fontSize: 10.5, padding: "2px 8px" }}>
                      {MARKETING_STATUS_LABEL[s]}
                    </button>
                  ))}
                  <input type="date" value={m.scheduledDate ?? ""} onChange={(e) => setDate(m.id, m.status, e.target.value)}
                    style={{ fontSize: 11, padding: "2px 6px", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, color: T.ink }} />
                  <button className="pill" onClick={() => remove(m.id)} title="Supprimer" style={{ fontSize: 10.5, padding: "2px 8px", color: T.clay }}>Supprimer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
        <Input style={{ flex: 1 }} value={input} placeholder="Votre message…" disabled={!canWrite} onChange={setInput} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
        <button className="pill on" disabled={busy || !canWrite} onClick={() => void send()}>Envoyer</button>
      </div>
    </Card>
  );
}

/* -------- Création rapide d'un compte -------- */
function NewAccountPanel({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ nom: "", secteur: "", tier: "Clé", enjeux: "", whitespace: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
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
      toast.success(`Compte « ${f.nom.trim()} » créé.`);
      onCreated(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de la création du compte.");
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nouveau compte" width={620}>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px", gap: 10 }}>
        <div><label style={lbl}>Nom *</label><Input value={f.nom} onChange={(v) => set("nom", v)} /></div>
        <div><label style={lbl}>Secteur</label><Input value={f.secteur} onChange={(v) => set("secteur", v)} /></div>
        <div><label style={lbl}>Tier</label>
          <Select value={f.tier} onChange={(v) => set("tier", v)} ariaLabel="Tier"
            options={["Stratégique", "Clé", "Standard"].map((s) => ({ value: s, label: s }))} />
        </div>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        <div><label style={lbl}>Enjeux (1 par ligne)</label><Textarea value={f.enjeux} onChange={(v) => set("enjeux", v)} /></div>
        <div><label style={lbl}>Whitespace (1 par ligne)</label><Textarea value={f.whitespace} onChange={(v) => set("whitespace", v)} /></div>
      </div>
      <ErrLine err={err} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="pill" onClick={onClose}>Annuler</button>
        <button className="pill on" disabled={busy || !f.nom.trim()} onClick={() => void submit()}>{busy ? "Création…" : "Créer le compte"}</button>
      </div>
    </Modal>
  );
}

/* -------- Admin des périmètres commerciaux (AM/BU par e-mail) — direction/commercial_dir -------- */
function PerimetresPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profiles, setProfiles] = useState<CopiloteProfile[]>([]);
  const [f, setF] = useState({ email: "", ams: "", bus: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const load = () => { void fetchCopiloteProfiles().then(setProfiles).catch(() => {}); };
  useEffect(() => { if (open) load(); }, [open]);
  const lines = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    const email = f.email.trim().toLowerCase();
    if (!email) return;
    setBusy(true); setErr(null);
    try {
      await setCopiloteScope(email, lines(f.ams), lines(f.bus));
      toast.success(`Périmètre enregistré pour ${email}.`);
      setF({ email: "", ams: "", bus: "" });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally { setBusy(false); }
  };
  const edit = (p: CopiloteProfile) => setF({ email: p.email, ams: p.ams.join(", "), bus: p.bus.join(", ") });
  return (
    <Modal open={open} onClose={onClose} title="Périmètres commerciaux (AM / BU par e-mail)" width={680}>
      <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 10, lineHeight: 1.5 }}>
        Un commercial voit un compte s'il en est <b>owner</b> (attribution), si l'un de ses <b>AM</b> ou de ses <b>BU</b>
        correspond au compte, ou s'il l'a créé. Direction et directeurs commerciaux voient tout.
      </div>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div><label style={lbl}>E-mail du commercial *</label><Input value={f.email} onChange={(v) => set("email", v)} placeholder="jean@nt.ci" /></div>
        <div><label style={lbl}>Account managers (AM), séparés par des virgules</label><Input value={f.ams} onChange={(v) => set("ams", v)} placeholder="K. Diallo, M. Traoré" /></div>
        <div><label style={lbl}>BU / équipes, séparées par des virgules</label><Input value={f.bus} onChange={(v) => set("bus", v)} placeholder="ICT, CYBER" /></div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="pill on" disabled={busy || !f.email.trim()} onClick={() => void save()}>{busy ? "…" : "Enregistrer le périmètre"}</button>
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
    </Modal>
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
          <Input style={{ minWidth: 0, flex: 1 }} value={val} placeholder="e-mails séparés par des virgules" onChange={setVal} />
          <button className="pill on" disabled={busy} onClick={() => void save()}>{busy ? "…" : "Enregistrer"}</button>
          <button className="pill" disabled={busy} onClick={() => { setEditing(false); setVal(owners.join(", ")); }}>Annuler</button>
        </div>
      )}
      <ErrLine err={err} />
    </div>
  );
}
