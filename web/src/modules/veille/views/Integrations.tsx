import React, { useEffect, useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card } from "../../../design/ui";
import { useToast, useConfirm } from "../../../design/overlay";
import { ROLES, ROLE_LABEL, type Role } from "../../../lib/rbac";
import {
  OUTBOUND_EVENTS, INBOUND_ACTIONS, EVENT_LABEL, ACTION_LABEL,
  listUsers, inviteUser, assignRole, revokeUser,
  listEndpoints, upsertEndpoint, rotateEndpointSecret, deleteEndpoint, listDeliveries,
  listInboundSources, upsertInboundSource, rotateInboundSecret, deleteInboundSource, listInboundLog,
  type AppUser, type WebhookEndpoint, type InboundSource, type Delivery, type InboundLogEntry,
  type OutboundEvent, type InboundAction,
} from "../../../lib/integrations";

/**
 * Intégrations & API (écran DIRECTION) — 3 onglets :
 *  1. Utilisateurs : liste des comptes de l'app (par rôle), invitation par e-mail, ré-attribution /
 *     révocation du rôle (l'Auth Firebase est partagée entre apps → on ne gère QUE le claim role).
 *  2. Webhooks sortants : endpoints tiers notifiés (signés HMAC) sur les événements choisis + journal.
 *  3. Webhooks entrants : sources tierces autorisées à appeler l'endpoint public signé + journal.
 * Tout passe par les callables userAdmin/webhookAdmin (Direction only). Les secrets ne s'affichent
 * qu'UNE fois (création/rotation).
 */

const INBOUND_URL = "https://europe-west1-sentinel-360.cloudfunctions.net/webhookInbound";
const TABS = [
  { key: "users", label: "Utilisateurs" },
  { key: "outbound", label: "Webhooks sortants" },
  { key: "inbound", label: "Webhooks entrants" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function SecretReveal({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 8, border: `1px solid ${T.gold}`, background: T.gold + "14" }}>
      <div style={{ fontSize: 11.5, color: T.gold, fontWeight: 700 }}>⚠️ Copiez ce secret maintenant — il ne sera plus jamais affiché.</div>
      <code style={{ display: "block", marginTop: 6, fontSize: 12, wordBreak: "break-all", color: T.ink }}>{secret}</code>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="pill" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => void navigator.clipboard?.writeText(secret)}>Copier</button>
        <button className="pill" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}

function Toggle<T extends string>({ all, selected, label, onToggle }: { all: readonly T[]; selected: T[]; label: (v: T) => string; onToggle: (v: T) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {all.map((v) => {
        const on = selected.includes(v);
        return (
          <button key={v} onClick={() => onToggle(v)} className={on ? "pill on" : "pill"} style={{ fontSize: 11, padding: "3px 10px" }}>
            {on ? "✓ " : ""}{label(v)}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Utilisateurs
function UsersTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("lecture");
  const [busy, setBusy] = useState(false);

  const reload = () => listUsers().then(setUsers).catch((e) => toast.error(e?.message || "Chargement impossible."));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const r = await inviteUser(email.trim(), role);
      toast.success(`${r.created ? "Compte créé" : "Compte existant"} · rôle ${ROLE_LABEL[role]}${r.passwordEmailSent ? " · e-mail de mot de passe envoyé" : ""}.`);
      setEmail("");
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'invitation."); } finally { setBusy(false); }
  };
  const change = async (u: AppUser, next: Role) => {
    try { await assignRole(u.uid, next); toast.success(`Rôle mis à jour → ${ROLE_LABEL[next]}.`); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };
  const revoke = async (u: AppUser) => {
    if (!(await confirm({ title: "Révoquer l'accès", danger: true, confirmLabel: "Révoquer", message: `Révoquer l'accès de ${u.email} ? Le compte Firebase reste, seul le rôle de l'app est retiré.` }))) return;
    try { await revokeUser(u.uid); toast.success("Accès révoqué."); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@entreprise.com" type="email"
          style={{ flex: "1 1 220px", minWidth: 180, padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }} />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button className="pill on" disabled={busy || !email.trim()} onClick={() => void invite()} style={{ fontSize: 12, padding: "5px 14px" }}>
          {busy ? "…" : "Inviter"}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: T.dim, marginTop: 6 }}>
        L'invitation crée le compte s'il n'existe pas et envoie un e-mail « définissez votre mot de passe » (aucun mot de passe ne transite).
      </div>
      <div className="tbl-scroll" style={{ marginTop: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 560 }}>
          <thead><tr>{["Utilisateur", "Rôle", "Dernière connexion", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: T.dim }}>{h}</th>)}</tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.uid} style={{ borderTop: `1px solid ${T.line}` }}>
                <td style={{ padding: "6px 8px", color: T.ink }}>{u.email || u.uid}</td>
                <td style={{ padding: "6px 8px" }}>
                  <select value={u.role} onChange={(e) => void change(u, e.target.value as Role)} style={{ padding: "3px 6px", borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td style={{ padding: "6px 8px", color: T.dim }}>{u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString("fr-FR") : "—"}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button className="pill" style={{ fontSize: 11, padding: "2px 9px" }} onClick={() => void revoke(u)}>Révoquer</button>
                </td>
              </tr>
            ))}
            {users && !users.length && <tr><td colSpan={4} style={{ padding: 10, color: T.dim, fontSize: 12 }}>Aucun utilisateur avec un rôle attribué.</td></tr>}
            {!users && <tr><td colSpan={4} style={{ padding: 10, color: T.dim, fontSize: 12 }}>Chargement…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Webhooks sortants
function OutboundTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<OutboundEvent[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => Promise.all([listEndpoints().then(setEndpoints), listDeliveries().then(setDeliveries)]).catch((e) => toast.error(e?.message || "Chargement impossible."));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!url.trim() || !events.length) { toast.error("URL et au moins un événement requis."); return; }
    setBusy(true);
    try {
      const r = await upsertEndpoint({ url: url.trim(), events, label: label.trim(), active: true });
      if (r.secret) setSecret(r.secret);
      toast.success("Endpoint créé.");
      setLabel(""); setUrl(""); setEvents([]);
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); } finally { setBusy(false); }
  };
  const toggleActive = async (ep: WebhookEndpoint) => {
    try { await upsertEndpoint({ url: ep.url, events: ep.events, label: ep.label, active: !ep.active }, ep.id); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };
  const rotate = async (ep: WebhookEndpoint) => {
    try { const r = await rotateEndpointSecret(ep.id); setSecret(r.secret); toast.success("Secret régénéré."); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };
  const remove = async (ep: WebhookEndpoint) => {
    if (!(await confirm({ title: "Supprimer l'endpoint", danger: true, message: `Supprimer l'endpoint ${ep.label || ep.url} ? Les événements ne lui seront plus livrés.` }))) return;
    try { await deleteEndpoint(ep.id); toast.success("Supprimé."); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: T.dim }}>
        Chaque événement est envoyé en POST JSON signé (<code>HMAC-SHA256</code>, en-têtes <code>x-sentinel-signature</code> / <code>x-sentinel-timestamp</code>). Vérifiez la signature côté récepteur.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé (ex. CRM)" style={{ flex: "1 1 140px", padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/webhook" style={{ flex: "2 1 260px", padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }} />
      </div>
      <div style={{ marginTop: 8 }}><Toggle all={OUTBOUND_EVENTS} selected={events} label={(v) => EVENT_LABEL[v]} onToggle={(v) => setEvents((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))} /></div>
      <button className="pill on" disabled={busy} onClick={() => void create()} style={{ fontSize: 12, padding: "5px 14px", marginTop: 8 }}>{busy ? "…" : "Ajouter l'endpoint"}</button>
      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}

      <div className="tbl-scroll" style={{ marginTop: 14 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 640 }}>
          <thead><tr>{["Endpoint", "Événements", "Dernière livraison", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: T.dim }}>{h}</th>)}</tr></thead>
          <tbody>
            {(endpoints || []).map((ep) => (
              <tr key={ep.id} style={{ borderTop: `1px solid ${T.line}`, opacity: ep.active ? 1 : 0.5 }}>
                <td style={{ padding: "6px 8px", color: T.ink }}>{ep.label || "—"}<div style={{ fontSize: 10.5, color: T.dim, wordBreak: "break-all" }}>{ep.url}</div></td>
                <td style={{ padding: "6px 8px", color: T.dim }}>{ep.events.map((e) => EVENT_LABEL[e]).join(", ")}</td>
                <td style={{ padding: "6px 8px" }}>{ep.lastDeliveryOk === null ? <span style={{ color: T.faint }}>—</span> : ep.lastDeliveryOk ? <span style={{ color: T.emerald }}>OK</span> : <span style={{ color: T.clay }} title={ep.lastError || ""}>Échec</span>}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void toggleActive(ep)}>{ep.active ? "Pause" : "Activer"}</button>{" "}
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void rotate(ep)}>Secret</button>{" "}
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void remove(ep)}>Suppr.</button>
                </td>
              </tr>
            ))}
            {endpoints && !endpoints.length && <tr><td colSpan={4} style={{ padding: 10, color: T.dim, fontSize: 12 }}>Aucun endpoint sortant.</td></tr>}
          </tbody>
        </table>
      </div>
      {!!deliveries.length && (
        <>
          <Eyebrow color={T.steel}>Journal des livraisons (50 dernières)</Eyebrow>
          <div className="tbl-scroll" style={{ marginTop: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5, minWidth: 520 }}>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "4px 8px", color: d.ok ? T.emerald : T.clay }}>{d.ok ? "✓" : "✗"} {d.status || ""}</td>
                    <td style={{ padding: "4px 8px", color: T.dim }}>{d.event}</td>
                    <td style={{ padding: "4px 8px", color: T.dim, wordBreak: "break-all" }}>{d.error || d.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Webhooks entrants
function InboundTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sources, setSources] = useState<InboundSource[] | null>(null);
  const [log, setLog] = useState<InboundLogEntry[]>([]);
  const [label, setLabel] = useState("");
  const [actions, setActions] = useState<InboundAction[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => Promise.all([listInboundSources().then(setSources), listInboundLog().then(setLog)]).catch((e) => toast.error(e?.message || "Chargement impossible."));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!label.trim() || !actions.length) { toast.error("Libellé et au moins une action requis."); return; }
    setBusy(true);
    try {
      const r = await upsertInboundSource({ label: label.trim(), actions, active: true });
      if (r.secret) setSecret(`${r.id}\n${r.secret}`);
      toast.success("Source créée.");
      setLabel(""); setActions([]);
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); } finally { setBusy(false); }
  };
  const toggleActive = async (s: InboundSource) => {
    try { await upsertInboundSource({ label: s.label, actions: s.actions, active: !s.active }, s.id); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };
  const rotate = async (s: InboundSource) => {
    try { const r = await rotateInboundSecret(s.id); setSecret(`${s.id}\n${r.secret}`); toast.success("Secret régénéré."); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };
  const remove = async (s: InboundSource) => {
    if (!(await confirm({ title: "Supprimer la source", danger: true, message: `Supprimer la source ${s.label} ? Ses requêtes entrantes seront rejetées.` }))) return;
    try { await deleteInboundSource(s.id); toast.success("Supprimée."); await reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec."); }
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: T.dim }}>
        Endpoint public (protégé par signature HMAC, pas par l'accès réseau) :
      </div>
      <code style={{ display: "block", margin: "6px 0", fontSize: 11.5, wordBreak: "break-all", color: T.ink, background: T.panel2, padding: "6px 8px", borderRadius: 6 }}>{INBOUND_URL}</code>
      <div style={{ fontSize: 11.5, color: T.dim }}>
        En-têtes : <code>x-sentinel-source</code> (id), <code>x-sentinel-timestamp</code> (epoch s), <code>x-sentinel-signature</code> (<code>sha256=</code> HMAC de <code>{"`${ts}.${body}`"}</code>), <code>x-sentinel-action</code> (ingest/action/sync ; GET ⇒ pull).
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé source (ex. Zapier)" style={{ flex: "1 1 200px", padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5 }} />
      </div>
      <div style={{ marginTop: 8 }}><Toggle all={INBOUND_ACTIONS} selected={actions} label={(v) => ACTION_LABEL[v]} onToggle={(v) => setActions((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))} /></div>
      <button className="pill on" disabled={busy} onClick={() => void create()} style={{ fontSize: 12, padding: "5px 14px", marginTop: 8 }}>{busy ? "…" : "Ajouter la source"}</button>
      {secret && <SecretReveal secret={secret} onClose={() => setSecret(null)} />}

      <div className="tbl-scroll" style={{ marginTop: 14 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 560 }}>
          <thead><tr>{["Source (id)", "Actions", "Vue le", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: T.dim }}>{h}</th>)}</tr></thead>
          <tbody>
            {(sources || []).map((s) => (
              <tr key={s.id} style={{ borderTop: `1px solid ${T.line}`, opacity: s.active ? 1 : 0.5 }}>
                <td style={{ padding: "6px 8px", color: T.ink }}>{s.label}<div style={{ fontSize: 10.5, color: T.dim }}>{s.id}</div></td>
                <td style={{ padding: "6px 8px", color: T.dim }}>{s.actions.map((a) => ACTION_LABEL[a]).join(", ")}</td>
                <td style={{ padding: "6px 8px", color: T.dim }}>{s.lastSeenAt ? "récemment" : "—"}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void toggleActive(s)}>{s.active ? "Pause" : "Activer"}</button>{" "}
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void rotate(s)}>Secret</button>{" "}
                  <button className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }} onClick={() => void remove(s)}>Suppr.</button>
                </td>
              </tr>
            ))}
            {sources && !sources.length && <tr><td colSpan={4} style={{ padding: 10, color: T.dim, fontSize: 12 }}>Aucune source entrante.</td></tr>}
          </tbody>
        </table>
      </div>
      {!!log.length && (
        <>
          <Eyebrow color={T.steel}>Journal des requêtes entrantes (50 dernières)</Eyebrow>
          <div className="tbl-scroll" style={{ marginTop: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5, minWidth: 460 }}>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "4px 8px", color: l.ok ? T.emerald : T.clay }}>{l.ok ? "✓" : "✗"} {l.status}</td>
                    <td style={{ padding: "4px 8px", color: T.dim }}>{l.action || "—"}</td>
                    <td style={{ padding: "4px 8px", color: T.dim }}>{l.error || (l.sourceId ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function Integrations() {
  const [tab, setTab] = useState<TabKey>("users");
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.plum}>Intégrations & API</Eyebrow>
        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "pill on" : "pill"} onClick={() => setTab(t.key)} style={{ fontSize: 11.5, padding: "4px 12px" }}>{t.label}</button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        {tab === "users" && <UsersTab />}
        {tab === "outbound" && <OutboundTab />}
        {tab === "inbound" && <InboundTab />}
      </div>
    </Card>
  );
}
