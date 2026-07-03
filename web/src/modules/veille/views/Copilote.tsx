import React, { useMemo, useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { useCan } from "../../../lib/rbac";
import {
  useCopiloteAccounts,
  createCopiloteAccount,
  copiloteGenerate,
  copiloteChat,
  syncCopiloteAccountsFromNt360,
  type CopiloteAccount,
  type CopiloteAgent,
  type ProspectionResult,
  type CvpResult,
  type TriennalResult,
  type PlanCompteResult,
  type RedactionResult,
  type CopiloteChatMessage,
} from "../lib/copilote";

const CHALEUR_C: Record<string, string> = { Chaud: T.clay, Tiède: T.gold, Froid: T.steel };
const NIV_C: Record<string, string> = { "Élevé": T.clay, Moyen: T.gold, Faible: T.steel };

const AGENT_TABS: { k: string; l: string }[] = [
  { k: "prospection", l: "Prospection" },
  { k: "cvp", l: "Proposition de valeur" },
  { k: "triennal", l: "Plan triennal" },
  { k: "planCompte", l: "Plan de compte" },
  { k: "redaction", l: "Rédaction" },
  { k: "chat", l: "Chat" },
];

const inp: React.CSSProperties = { width: "100%", padding: "7px 10px", background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, fontSize: 12.5 };
const lbl: React.CSSProperties = { fontSize: 11, color: T.faint, marginBottom: 3, display: "block" };

/** Copilote Commercial (add-on) — réutilise le moteur IA serveur + le PESTEL/les signaux de la veille. */
export function Copilote() {
  const { accounts, loading } = useCopiloteAccounts();
  const { canWrite } = useCan("veille");
  const [accountId, setAccountId] = useState<string>("");
  const [tab, setTab] = useState<string>("prospection");
  const [showNew, setShowNew] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Poids commercial = CAS réalisé + pipeline pondéré (empreinte nt360). Sert au tri du portefeuille.
  const poids = (a: CopiloteAccount) => (a.nt360?.casTotal ?? 0) + (a.nt360?.pipelinePondere ?? 0);
  const sorted = useMemo(() => [...accounts].sort((x, y) => poids(y) - poids(x)), [accounts]);
  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  const syncFromNt360 = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const { accounts: n } = await syncCopiloteAccountsFromNt360();
      setSyncMsg(`${n} comptes pré-remplis depuis nt360.`);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Échec de la synchronisation.");
    } finally { setSyncing(false); }
  };

  const fmt = (n?: number) => (typeof n === "number" ? new Intl.NumberFormat("fr-FR").format(n) : "—");

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: T.faint }}>Compte :</span>
          <select style={{ ...inp, width: "auto", minWidth: 220 }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{loading ? "Chargement…" : "— Portefeuille (vue d'ensemble) —"}</option>
            {sorted.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}{a.secteur ? ` · ${a.secteur}` : ""}{poids(a) ? ` — ${fmt(poids(a))} XOF` : ""}
              </option>
            ))}
          </select>
          {account && <Badge c={T.steel}>{account.tier || "compte"}</Badge>}
        </div>
        {canWrite && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {syncMsg && <span style={{ fontSize: 11.5, color: T.faint }}>{syncMsg}</span>}
            <button className="pill" disabled={syncing} onClick={() => void syncFromNt360()}>
              {syncing ? "Synchro…" : "⟳ Empreinte nt360"}
            </button>
            <button className="pill on" onClick={() => setShowNew((v) => !v)}>+ Nouveau compte</button>
          </div>
        )}
      </div>

      {showNew && canWrite && <NewAccountPanel onClose={() => setShowNew(false)} onCreated={(id) => { setAccountId(id); setShowNew(false); }} />}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {AGENT_TABS.map((t) => (
          <button key={t.k} className={`pill ${tab === t.k ? "on" : ""}`} onClick={() => setTab(t.k)}>{t.l}</button>
        ))}
      </div>

      {account && (
        <Card style={{ marginBottom: 14 }}>
          <Eyebrow color={T.gold}>{account.nom}</Eyebrow>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {account.enjeux.map((e, i) => <Badge key={`e${i}`} c={T.clay}>{e}</Badge>)}
            {account.whitespace.map((w, i) => <Badge key={`w${i}`} c={T.emerald}>Whitespace : {w}</Badge>)}
          </div>
          {account.nt360 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.faint }}>Empreinte nt360 :</span>
              <Badge c={T.gold}>CAS {fmt(account.nt360.casTotal)} XOF</Badge>
              <Badge c={T.steel}>Pipeline pondéré {fmt(account.nt360.pipelinePondere)} XOF</Badge>
              {typeof account.nt360.wins === "number" && account.nt360.wins > 0 && <Badge c={T.emerald}>{account.nt360.wins} affaire(s) gagnée(s)</Badge>}
              {(account.nt360.historique ?? []).map((h, i) => <Badge key={`h${i}`} c={T.emerald}>{h.offre} ✓</Badge>)}
              {(account.nt360.enCours ?? []).map((e, i) => <Badge key={`ec${i}`} c={T.plum}>{e} (en cours)</Badge>)}
            </div>
          )}
          {(account.nt360?.opportunites ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, color: T.faint, marginBottom: 6 }}>Opportunités réelles en cours (pipeline nt360)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(account.nt360?.opportunites ?? []).map((o, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "6px 10px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.gold}` }}>
                    <span style={{ fontSize: 12.5, color: T.ink }}>
                      {o.nom}{o.bu ? <span style={{ color: T.faint }}> · {o.bu}</span> : null}
                      <span style={{ color: T.steel }}> — {o.etape}</span>
                    </span>
                    <span style={{ fontSize: 12.5, color: T.gold, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(o.montant)} XOF</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {!account && !loading && <PortfolioDashboard accounts={sorted} poids={poids} fmt={fmt} onPick={setAccountId} />}

      {tab === "prospection" && <ProspectionTab accountId={accountId} />}
      {tab === "cvp" && <CvpTab accountId={accountId} disabled={!accountId} />}
      {tab === "triennal" && <TriennalTab accountId={accountId} disabled={!accountId} />}
      {tab === "planCompte" && <PlanCompteTab accountId={accountId} disabled={!accountId} />}
      {tab === "redaction" && <RedactionTab accountId={accountId} compte={account?.nom || ""} />}
      {tab === "chat" && <ChatTab accountId={accountId} />}
    </div>
  );
}

/* -------- Portefeuille : vue d'ensemble quand aucun compte n'est sélectionné (jamais d'écran vide) -------- */
function PortfolioDashboard({
  accounts, poids, fmt, onPick,
}: {
  accounts: CopiloteAccount[];
  poids: (a: CopiloteAccount) => number;
  fmt: (n?: number) => string;
  onPick: (id: string) => void;
}) {
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

  const totalCas = accounts.reduce((s, a) => s + (a.nt360?.casTotal ?? 0), 0);
  const totalPipe = accounts.reduce((s, a) => s + (a.nt360?.pipelinePondere ?? 0), 0);
  const totalWins = accounts.reduce((s, a) => s + (a.nt360?.wins ?? 0), 0);
  // Deals chauds = toutes les opportunités en cours, à plat, triées par montant.
  const hotDeals = accounts
    .flatMap((a) => (a.nt360?.opportunites ?? []).map((o) => ({ ...o, compte: a.nom, accountId: a.id })))
    .sort((x, y) => y.montant - x.montant)
    .slice(0, 8);

  const kpi = (label: string, value: string, color: string) => (
    <div style={{ flex: "1 1 160px", background: T.panel2, borderRadius: 10, padding: "12px 14px", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: T.faint }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: T.ink, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <Eyebrow color={T.gold}>Portefeuille commercial — vue d'ensemble</Eyebrow>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          {kpi("Comptes actifs", String(accounts.length), T.steel)}
          {kpi("CAS réalisé (XOF)", fmt(totalCas), T.emerald)}
          {kpi("Pipeline pondéré (XOF)", fmt(totalPipe), T.gold)}
          {kpi("Affaires gagnées", String(totalWins), T.plum)}
        </div>
      </Card>

      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <Eyebrow color={T.emerald}>Top comptes par poids commercial</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {accounts.slice(0, 8).map((a) => (
              <button key={a.id} onClick={() => onPick(a.id)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "8px 10px", background: T.panel2, borderRadius: 8, border: `1px solid ${T.line}`, cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 12.5, color: T.ink }}>{a.nom}{a.secteur ? <span style={{ color: T.faint }}> · {a.secteur}</span> : null}</span>
                <span style={{ fontSize: 12.5, color: T.gold, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(poids(a))} XOF</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <Eyebrow color={T.gold}>Deals chauds à jouer</Eyebrow>
          {hotDeals.length === 0 ? (
            <div style={{ fontSize: 12, color: T.faint, marginTop: 10 }}>Aucune opportunité en cours détectée dans le pipeline.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {hotDeals.map((o, i) => (
                <button key={i} onClick={() => onPick(o.accountId)}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "8px 10px", background: T.panel2, borderRadius: 8, borderLeft: `3px solid ${T.gold}`, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 12, color: T.ink }}>
                    <b>{o.compte}</b> · {o.nom}<span style={{ color: T.steel }}> — {o.etape}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: T.gold, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt(o.montant)} XOF</span>
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
function useAgent<T>(agent: CopiloteAgent, accountId?: string) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (extra?: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { setData(await copiloteGenerate<T>(agent, accountId || undefined, extra)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Échec de la génération."); }
    finally { setBusy(false); }
  };
  return { data, busy, err, run };
}

function GenButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return <button className="pill on" disabled={busy} onClick={onClick}>{busy ? "Génération…" : label}</button>;
}
function ErrLine({ err }: { err: string | null }) {
  return err ? <div style={{ color: T.clay, fontSize: 12, marginTop: 8 }}>{err}</div> : null;
}

function ProspectionTab({ accountId }: { accountId: string }) {
  const { data, busy, err, run } = useAgent<ProspectionResult>("prospection", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Comptes cibles (adossés aux signaux de veille)</Eyebrow>
        <GenButton busy={busy} onClick={() => run()} label="Générer la prospection" />
      </div>
      <ErrLine err={err} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {(data?.cibles ?? []).map((c, i) => (
          <div key={i} style={{ padding: "10px 12px", background: T.panel2, borderRadius: 10, borderLeft: `3px solid ${CHALEUR_C[c.chaleur] ?? T.faint}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{c.nom}</span>
              <Badge c={CHALEUR_C[c.chaleur] ?? T.faint}>{c.chaleur}</Badge>
            </div>
            <div style={{ fontSize: 12.5, color: T.dim, marginTop: 4 }}><b style={{ color: T.steel }}>Angle :</b> {c.angle}</div>
            <div style={{ fontSize: 12.5, color: T.dim, marginTop: 2 }}><b style={{ color: T.gold }}>Accroche :</b> {c.accroche}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CvpTab({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const { data, busy, err, run } = useAgent<CvpResult>("cvp", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Proposition de valeur (réutilise le PESTEL de la veille)</Eyebrow>
        <GenButton busy={busy} onClick={() => run()} label="Générer la CVP" />
      </div>
      {disabled && <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>Sélectionne un compte pour une CVP ciblée.</div>}
      <ErrLine err={err} />
      {data && (
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: "12px 14px", background: T.panel2, borderRadius: 10, fontSize: 14, color: T.ink, lineHeight: 1.55 }}>{data.message}</div>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: T.dim, fontSize: 13, lineHeight: 1.7 }}>
            {data.differenciateurs.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TriennalTab({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const { data, busy, err, run } = useAgent<TriennalResult>("triennal", accountId);
  const C = [T.emerald, T.gold, T.clay];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Plan de croissance à 3 ans</Eyebrow>
        <GenButton busy={busy} onClick={() => run()} label="Générer le plan triennal" />
      </div>
      {disabled && <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>Sélectionne un compte.</div>}
      <ErrLine err={err} />
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

function PlanCompteTab({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const { data, busy, err, run } = useAgent<PlanCompteResult>("planCompte", accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Plan de compte — actions & risques</Eyebrow>
        <GenButton busy={busy} onClick={() => run()} label="Générer le plan de compte" />
      </div>
      {disabled && <div style={{ fontSize: 12, color: T.faint, marginTop: 8 }}>Sélectionne un compte.</div>}
      <ErrLine err={err} />
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

function RedactionTab({ accountId, compte }: { accountId: string; compte: string }) {
  const { data, busy, err, run } = useAgent<RedactionResult>("redaction", accountId);
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
        <GenButton busy={busy} onClick={() => run({ ...form, compte })} label="Rédiger" />
      </div>
      <ErrLine err={err} />
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        {(data?.variantes ?? []).map((v, i) => (
          <div key={i} style={{ background: T.panel2, borderRadius: 10, padding: "12px 14px" }}>
            <Badge c={T.gold}>{v.label}</Badge>
            {v.objet && <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 600, marginTop: 8 }}>Objet : {v.objet}</div>}
            <div style={{ fontSize: 12.5, color: T.dim, whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.55 }}>{v.corps}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChatTab({ accountId }: { accountId: string }) {
  const [messages, setMessages] = useState<CopiloteChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: CopiloteChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setErr(null);
    try {
      const { reply } = await copiloteChat(next, accountId || undefined, "Copilote");
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec.");
    } finally { setBusy(false); }
  };
  return (
    <Card>
      <Eyebrow color={T.emerald}>Copilote conversationnel</Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, maxHeight: 360, overflowY: "auto" }}>
        {messages.length === 0 && <div style={{ fontSize: 12, color: T.faint }}>Pose une question (préparer un RDV, un argumentaire, une objection…).</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%", background: m.role === "user" ? T.emerald + "22" : T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 11px", fontSize: 12.5, color: T.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.content}</div>
        ))}
        {busy && <div style={{ fontSize: 12, color: T.faint }}>Le copilote réfléchit…</div>}
      </div>
      <ErrLine err={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input style={inp} value={input} placeholder="Votre message…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
        <button className="pill on" disabled={busy} onClick={() => void send()}>Envoyer</button>
      </div>
    </Card>
  );
}

/* -------- Création rapide d'un compte -------- */
function NewAccountPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ nom: "", secteur: "", tier: "Clé", enjeux: "", whitespace: "" });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const submit = async () => {
    if (!f.nom.trim()) return;
    setBusy(true);
    try {
      const id = await createCopiloteAccount({
        nom: f.nom.trim(), secteur: f.secteur.trim(), tier: f.tier,
        enjeux: lines(f.enjeux), whitespace: lines(f.whitespace),
        enCours: [], historique: [], contacts: [], preuves: [], tendances: [],
      });
      onCreated(id);
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
    </Card>
  );
}
