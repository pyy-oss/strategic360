import React, { useEffect, useMemo, useState } from "react";
import { T, AX } from "../../../design/tokens";
import { Eyebrow, Card } from "../../../design/ui";
import { useToast } from "../../../design/overlay";
import { LENS } from "../data";
import { DEFAULT_LENS_AXIS_BOOST, type LensWeights } from "../lib/ranking";
import { useLensWeights, mergeWeights, setLensWeights } from "../lib/lensWeights";
import { useClientTenderMonitors, setClientTenderMonitors } from "../lib/clientTenderMonitors";
import type { IntelAxis } from "../lib/intel";
import {
  usePermissions,
  setPermissionsMatrix,
  DEFAULT_PERMISSIONS_MATRIX,
  ROLES,
  MODULES,
  ROLE_LABEL,
  ROLE_GROUP,
  MODULE_LABEL,
  type Role,
  type Module,
  type PermLevel,
  type PermMatrix,
} from "../../../lib/rbac";

/**
 * Réglages & Droits (RBAC) — écran DIRECTION : édite la matrice rôle × module (`config/permissions`)
 * en direct, sans redéploiement. Chaque cellule cycle – (none) → R (read) → W (write). Enregistré
 * via le callable `setPermissionsMatrix` (DG uniquement). La matrice pilote l'accès de tous les
 * profils ESN aux modules (veille, stratégie, innovation, finance, copilote, marketing, admin).
 */
const LEVEL_CYCLE: Record<PermLevel, PermLevel> = { none: "read", read: "write", write: "none" };
const LEVEL_LABEL: Record<PermLevel, string> = { none: "–", read: "R", write: "W" };
const LEVEL_COLOR: Record<PermLevel, string> = { none: T.faint, read: T.steel, write: T.emerald };

function fullMatrix(src: PermMatrix | null): Record<Role, Record<Module, PermLevel>> {
  const out = {} as Record<Role, Record<Module, PermLevel>>;
  for (const r of ROLES) {
    out[r] = {} as Record<Module, PermLevel>;
    for (const m of MODULES) {
      const v = src?.[r]?.[m];
      out[r][m] = v === "read" || v === "write" ? v : "none";
    }
  }
  return out;
}

/**
 * Éditeur des pondérations de FOCALE (rôle-focale × axe) — écran DG. Chaque cellule est un
 * multiplicateur appliqué au tri (Fil / Détection / Radar) selon la focale du lecteur ; 1 = neutre,
 * >1 remonte l'axe, <1 le descend. Enregistré via setLensWeights (config/lensWeights). Défaut calibré
 * ESN/SS2I (Côte d'Ivoire / UEMOA). N'affecte JAMAIS le priorityScore serveur (tri d'affichage seul).
 */
const LENS_AXES: IntelAxis[] = ["partenaires", "concurrents", "clients_prospects", "tech", "reglementaire"];
function LensWeightsEditor() {
  const { weights, loading } = useLensWeights();
  const toast = useToast();
  const [draft, setDraft] = useState<LensWeights | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!dirty && !loading) setDraft(mergeWeights(weights)); }, [weights, loading, dirty]);

  const val = (lens: string, ax: IntelAxis) => draft?.[lens]?.[ax] ?? 1;
  const setVal = (lens: string, ax: IntelAxis, v: number) => {
    setDirty(true);
    setDraft((d) => ({ ...(d || {}), [lens]: { ...(d?.[lens] || {}), [ax]: v } }));
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try { await setLensWeights(draft); setDirty(false); toast.success("Pondérations de focale enregistrées — appliquées en direct."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement."); }
    finally { setSaving(false); }
  };
  const resetDefault = () => { setDirty(true); setDraft(mergeWeights(DEFAULT_LENS_AXIS_BOOST)); toast.info("Défaut ESN chargé — pensez à Enregistrer."); };

  const cellColor = (v: number) => (v > 1.001 ? T.emerald : v < 0.999 ? T.clay : T.dim);

  return (
    <Card style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.steel}>Focales — pondérations par axe (tri Fil / Détection / Radar)</Eyebrow>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="pill" onClick={resetDefault} disabled={saving} style={{ fontSize: 11, padding: "3px 10px" }}>Défaut ESN</button>
          <button className="pill on" onClick={() => void save()} disabled={saving || !dirty} style={{ fontSize: 11, padding: "3px 12px" }}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
        Multiplicateur appliqué au <b>tri</b> selon la focale (1 = neutre, &gt;1 remonte l'axe). Le score serveur reste l'autorité — ceci ne change que l'ordre d'affichage.
      </div>
      {(!draft) ? (
        <div style={{ fontSize: 12.5, color: T.dim, marginTop: 10 }}>Chargement…</div>
      ) : (
        <div className="tbl-scroll" style={{ marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%", minWidth: 460 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", color: T.dim }}>Axe</th>
                {LENS.map(([k, l]) => <th key={k} style={{ padding: "6px 8px", color: T.dim, textAlign: "center" }}>{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {LENS_AXES.map((ax) => (
                <tr key={ax} style={{ borderTop: `1px solid ${T.line}` }}>
                  <td style={{ padding: "6px 8px", color: T.ink }}>{AX[ax]?.l ?? ax}</td>
                  {LENS.map(([lens]) => {
                    const v = val(lens, ax);
                    return (
                      <td key={lens} style={{ textAlign: "center", padding: "4px 6px" }}>
                        <input
                          type="number" step={0.05} min={0} max={3} value={v}
                          onChange={(e) => setVal(lens, ax, Math.min(3, Math.max(0, Number(e.target.value) || 0)))}
                          style={{ width: 62, textAlign: "center", padding: "3px 4px", borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel2, color: cellColor(v), fontWeight: 600, fontSize: 12 }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Surveillance active des appels d'offres de nos clients (config/clientTenderMonitors, exec). */
function ClientTenderMonitorsEditor() {
  const { config, loading } = useClientTenderMonitors();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [includeText, setIncludeText] = useState<string | null>(null);
  const [excludeText, setExcludeText] = useState<string | null>(null);

  const include = includeText ?? config.include.join("\n");
  const exclude = excludeText ?? config.exclude.join("\n");
  const toList = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  const save = async (patch: Parameters<typeof setClientTenderMonitors>[0]) => {
    setSaving(true);
    try { await setClientTenderMonitors(patch); toast.success("Surveillance AO clients enregistrée — appliquée à la prochaine synchro."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement."); }
    finally { setSaving(false); }
  };

  return (
    <Card style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.emerald}>Surveillance des appels d'offres de nos clients</Eyebrow>
        <button className={config.enabled ? "pill on" : "pill"} disabled={saving || loading} onClick={() => void save({ enabled: !config.enabled })} style={{ fontSize: 11, padding: "3px 12px" }}>
          {config.enabled ? "Activée" : "Désactivée"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
        Cherche activement les AO émis par vos comptes prioritaires (recherche par nom) et les remonte dans <b>Appels d'offres</b> avec le badge « client connu ». Appliqué à la synchro quotidienne.
      </div>
      {loading ? (
        <div style={{ fontSize: 12.5, color: T.dim, marginTop: 10 }}>Chargement…</div>
      ) : (
        <div style={{ opacity: config.enabled ? 1 : 0.5, marginTop: 12, display: "grid", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: T.ink }}>
            <input type="checkbox" checked={config.auto} disabled={saving || !config.enabled} onChange={(e) => void save({ auto: e.target.checked })} />
            Sélection automatique des <b>top clients</b> par valeur (CAS / tier nt360)
            <input type="number" min={0} max={60} value={config.max} disabled={saving || !config.enabled || !config.auto}
              onChange={(e) => void save({ max: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })}
              style={{ width: 56, textAlign: "center", padding: "3px 4px", borderRadius: 6, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12 }} />
            comptes
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: T.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Toujours surveiller (1 par ligne)</div>
              <textarea value={include} disabled={saving || !config.enabled} rows={4} placeholder="Ex. SNDI&#10;Groupe BSIC"
                onChange={(e) => setIncludeText(e.target.value)} onBlur={() => { if (includeText !== null) { void save({ include: toList(includeText) }); setIncludeText(null); } }}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5, resize: "vertical" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: T.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Ne jamais surveiller</div>
              <textarea value={exclude} disabled={saving || !config.enabled} rows={4} placeholder="Ex. Client sensible"
                onChange={(e) => setExcludeText(e.target.value)} onBlur={() => { if (excludeText !== null) { void save({ exclude: toList(excludeText) }); setExcludeText(null); } }}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.line}`, background: T.panel2, color: T.ink, fontSize: 12.5, resize: "vertical" }} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Reglages() {
  const { matrix, loading } = usePermissions();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<Role, Record<Module, PermLevel>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty && !loading) setDraft(fullMatrix(matrix));
  }, [matrix, loading, dirty]);

  const cycle = (role: Role, mod: Module) => {
    if (role === "direction") return; // DG = super-admin, non éditable (write partout)
    setDirty(true);
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [role]: { ...d[role], [mod]: LEVEL_CYCLE[d[role][mod]] } };
      return next;
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await setPermissionsMatrix(draft as unknown as PermMatrix);
      setDirty(false);
      toast.success("Matrice des droits enregistrée — appliquée en direct.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const resetDefault = () => {
    setDirty(true);
    setDraft(fullMatrix(DEFAULT_PERMISSIONS_MATRIX as unknown as PermMatrix));
    toast.info("Matrice par défaut chargée — pensez à Enregistrer.");
  };

  const groupedRoles = useMemo(() => {
    const seen = new Set<string>();
    const groups: { group: string; roles: Role[] }[] = [];
    for (const r of ROLES) {
      const g = ROLE_GROUP[r];
      if (!seen.has(g)) { seen.add(g); groups.push({ group: g, roles: [] }); }
      groups.find((x) => x.group === g)!.roles.push(r);
    }
    return groups;
  }, []);

  if (loading || !draft) {
    return <Card><div style={{ fontSize: 12.5, color: T.dim }}>Chargement de la matrice des droits…</div></Card>;
  }

  return (
    <>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Eyebrow color={T.plum}>Réglages & Droits — matrice RBAC (13 profils × 7 modules)</Eyebrow>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="pill" onClick={resetDefault} disabled={saving} style={{ fontSize: 11, padding: "3px 10px" }}>Réinitialiser au défaut</button>
          <button className="pill on" onClick={() => void save()} disabled={saving || !dirty} style={{ fontSize: 11, padding: "3px 12px" }}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
        Cliquez une cellule pour cycler <b style={{ color: LEVEL_COLOR.none }}>–</b> (aucun) → <b style={{ color: LEVEL_COLOR.read }}>R</b> (lecture) → <b style={{ color: LEVEL_COLOR.write }}>W</b> (écriture). La Direction est super-admin (écriture partout, non éditable). Appliqué en direct, sans redéploiement.
      </div>
      <div className="tbl-scroll" style={{ marginTop: 14 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px", color: T.dim, position: "sticky", left: 0, background: T.panel }}>Profil</th>
              {MODULES.map((m) => (
                <th key={m} style={{ padding: "6px 8px", color: T.dim, textAlign: "center", whiteSpace: "nowrap" }}>{MODULE_LABEL[m]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedRoles.map(({ group, roles }) => (
              <React.Fragment key={group}>
                <tr><td colSpan={MODULES.length + 1} style={{ padding: "8px 8px 2px", color: T.faint, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{group}</td></tr>
                {roles.map((r) => (
                  <tr key={r} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: "6px 8px", color: T.ink, position: "sticky", left: 0, background: T.panel, whiteSpace: "nowrap" }}>
                      {ROLE_LABEL[r]}{r === "direction" && <span style={{ color: T.faint, fontSize: 10 }}> · super-admin</span>}
                    </td>
                    {MODULES.map((m) => {
                      const lvl = draft[r][m];
                      const editable = r !== "direction";
                      return (
                        <td key={m} style={{ textAlign: "center", padding: "4px 6px" }}>
                          <button
                            onClick={() => cycle(r, m)}
                            disabled={!editable}
                            title={editable ? "Cliquer pour changer" : "Direction : écriture partout"}
                            style={{
                              width: 30, height: 26, borderRadius: 7, border: `1px solid ${T.line}`, cursor: editable ? "pointer" : "not-allowed",
                              background: lvl === "none" ? T.panel2 : LEVEL_COLOR[lvl] + "22", color: LEVEL_COLOR[lvl], fontWeight: 700, fontSize: 12,
                            }}
                          >
                            {LEVEL_LABEL[lvl]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    <LensWeightsEditor />
    <ClientTenderMonitorsEditor />
    </>
  );
}
