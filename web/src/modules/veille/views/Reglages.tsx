import React, { useEffect, useMemo, useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card } from "../../../design/ui";
import { useToast } from "../../../design/overlay";
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
  );
}
