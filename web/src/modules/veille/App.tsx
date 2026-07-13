import React, { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { T } from "../../design/tokens";
import { Badge } from "../../design/ui";
import { auth } from "../../lib/firebase";
import { useAuthClaims } from "../../lib/AuthProvider";
import { LENS, NAV, NAV_GROUPS } from "./data";

const NAV_LABEL = (k: string) => NAV.find(([kk]) => kk === k)?.[1] ?? k;

/** Navigation à DEUX NIVEAUX — remplace la barre plate de 16 onglets qui débordait et masquait des
 * vues. Rang 1 : les 4 groupes (le groupe actif surligné). Rang 2 : les vues du groupe actif. Rien
 * n'est masqué, le contexte courant est toujours visible, et ça tient à toute largeur (chaque rang,
 * court, passe à la ligne au besoin). Cliquer un groupe ouvre sa vue principale. */
function GroupedNav({ view, setView, groups }: { view: string; setView: (v: string) => void; groups: typeof NAV_GROUPS }) {
  const activeGroup = groups.find((g) => g.items.includes(view)) ?? groups[0];
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", borderBottom: `1px solid ${T.line}` }}>
        {groups.map((g) => {
          const on = g.label === activeGroup.label;
          return (
            <button
              key={g.label}
              className="tab"
              onClick={() => setView(g.home)}
              aria-current={on ? "page" : undefined}
              style={{ padding: "9px 15px", fontSize: 14, color: on ? T.ink : T.dim, borderBottomColor: on ? T.gold : "transparent" }}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "9px 2px 0" }}>
        {activeGroup.items.map((k) => {
          const on = k === view;
          return (
            <button
              key={k}
              className="tab"
              onClick={() => setView(k)}
              aria-current={on ? "page" : undefined}
              style={{ padding: "4px 2px", fontSize: 12.5, color: on ? T.ink : T.dim, borderBottomColor: on ? T.gold : "transparent" }}
            >
              {NAV_LABEL(k)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
import { RadarExecutif } from "./views/RadarExecutif";
import { Fil } from "./views/Fil";
import { Detection } from "./views/Detection";
import { Indicateurs } from "./views/Indicateurs";
import { Cadres } from "./views/Cadres";
import { Portefeuille } from "./views/Portefeuille";
import { Valeur } from "./views/Valeur";
import { Simulateur } from "./views/Simulateur";
import { Diagnostic } from "./views/Diagnostic";
import { Innovation } from "./views/Innovation";
import { Concurrence } from "./views/Concurrence";
import { Scenarios } from "./views/Scenarios";
import { Execution } from "./views/Execution";
import { PlanAction } from "./views/PlanAction";
import { Briefing } from "./views/Briefing";
import { Copilote } from "./views/Copilote";
import { Equipe } from "./views/Equipe";
import { Onboarding } from "./views/Onboarding";
import { useIsExec, usePermissions, ROLE_LABEL, type Role } from "../../lib/rbac";
import { VIEW_MODULE } from "./data";
import { Reglages } from "./views/Reglages";

const VIEW_KEYS = NAV.map(([k]) => k);
/** Vues réservées aux profils exécutifs (paramétrage produit) — masquées de la nav aux autres. */
const EXEC_ONLY_VIEWS = new Set(["onboarding"]);
/** Vues réservées à la Direction (édition des droits RBAC). */
const DIRECTION_ONLY_VIEWS = new Set(["reglages"]);

/** App shell — header (logo + lens pill selector) + nav tab bar + view switcher + footer.
 * Ported from the maquette's `export default function App()`. The active view now comes from
 * the router (`/veille/:view`, set by the parent Route in src/App.tsx) instead of local state;
 * the lens/focale selector remains local `useState`, exactly like the maquette.
 */
export default function VeilleApp() {
  const [lens, setLens] = useState("dg");
  const navigate = useNavigate();
  const { view } = useParams<{ view: string }>();
  const { user, role } = useAuthClaims();
  const isExec = useIsExec();
  const perms = usePermissions();

  // Visibilité d'une vue selon le RBAC : onboarding = exec ; reglages = Direction ; sinon lecture
  // du module associé (VIEW_MODULE). Pendant le chargement de la matrice, on n'occulte pas les vues
  // à module (optimiste) pour éviter un flash de nav vide / une redirection intempestive.
  const canSeeView = (k: string): boolean => {
    if (EXEC_ONLY_VIEWS.has(k)) return isExec;
    if (DIRECTION_ONLY_VIEWS.has(k)) return role === "direction";
    const m = VIEW_MODULE[k];
    if (!m) return true;
    return perms.loading ? true : perms.canRead(m);
  };

  const visibleGroups = useMemo(
    () => NAV_GROUPS
      .map((g) => ({ ...g, items: g.items.filter(canSeeView) }))
      .filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isExec, role, perms.loading, perms.matrix]
  );

  if (!view || !VIEW_KEYS.includes(view) || !canSeeView(view)) {
    return <Navigate to="/veille/radar" replace />;
  }
  const setView = (v: string) => navigate(`/veille/${v}`);

  return (
    <div className="appshell" style={{ background: T.bg, minHeight: "100vh", color: T.ink, fontFamily: "'Inter',system-ui,sans-serif", padding: "20px 24px 40px" }}>
      <style>{`*{box-sizing:border-box}::selection{background:#C9A24B;color:#0E1613}
      html,body{max-width:100%;overflow-x:clip}
      .appshell{overflow-x:clip;max-width:100vw}
      img,svg,video,canvas{max-width:100%}
      .g2>*,.g3>*,.g4>*,.g2-stack>*,.canvas-grid>*,.pestel-row>*{min-width:0}
      .pill{cursor:pointer;border:1px solid ${T.line};background:${T.panel};color:${T.dim};border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600}
      .pill.on{background:${T.gold};border-color:${T.gold};color:#0E1613}
      .pill:disabled{opacity:.55;cursor:not-allowed}
      .tab{cursor:pointer;border:none;background:none;color:${T.dim};font-size:13.5px;font-weight:600;padding:9px 2px;border-bottom:2px solid transparent;white-space:nowrap}
      .tab.on{color:${T.ink};border-bottom-color:${T.gold}}
      .navwrap::-webkit-scrollbar{height:0}
      .tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;min-width:0}
      .pill:focus-visible,.tab:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid ${T.gold};outline-offset:2px}
      @keyframes cop-spin{to{transform:rotate(360deg)}}
      @keyframes cop-pulse{0%,100%{opacity:.45}50%{opacity:.9}}
      .cop-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:cop-spin .7s linear infinite;vertical-align:-1px}
      .cop-skel{background:${T.panel2};border-radius:8px;animation:cop-pulse 1.2s ease-in-out infinite}
      @media(max-width:1180px){.g3,.g4{grid-template-columns:repeat(2,1fr)!important}}
      @media(max-width:1024px){.g2-stack{grid-template-columns:1fr!important}}
      @media(max-width:820px){.g2,.g3,.g4,.canvas-grid{grid-template-columns:1fr!important}.gform>*,.canvas-grid>*{grid-column:auto!important}
        .pill{min-height:44px;padding:10px 16px}}
      @media(max-width:640px){.pestel-row{grid-template-columns:1fr!important}.appshell{padding:14px 12px 32px!important}.apptitle{font-size:17px!important}}`}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${T.plum},#6b4f86)`, display: "grid", placeItems: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 700, color: "#0E1613", fontSize: 18 }}>
            V
          </div>
          <div>
            <div className="apptitle" style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 19, fontWeight: 700 }}>Veille Stratégique</div>
            <div style={{ fontSize: 11.5, color: T.dim }}>Neurones Technologies CI · intelligence & aide à la décision · Afrique / UEMOA / CI</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          {LENS.map(([k, l]) => (
            <button key={k} className={`pill ${k === lens ? "on" : ""}`} onClick={() => setLens(k)}>
              {l}
            </button>
          ))}
          <Badge c={T.steel}>{role ? (ROLE_LABEL[role as Role] ?? role) : "sans rôle"}</Badge>
          {user?.email && <span style={{ fontSize: 11, color: T.faint }}>{user.email}</span>}
          <button
            className="pill"
            onClick={() => signOut(auth)}
            title="Se déconnecter"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <GroupedNav view={view} setView={setView} groups={visibleGroups} />

      {view === "radar" && <RadarExecutif lens={lens} setView={setView} />}
      {view === "fil" && <Fil />}
      {view === "detection" && <Detection />}
      {view === "indicateurs" && <Indicateurs />}
      {view === "cadres" && <Cadres />}
      {view === "portefeuille" && <Portefeuille />}
      {view === "valeur" && <Valeur />}
      {view === "simulateur" && <Simulateur />}
      {view === "diagnostic" && <Diagnostic />}
      {view === "innovation" && <Innovation />}
      {view === "concurrence" && <Concurrence />}
      {view === "scenarios" && <Scenarios />}
      {view === "execution" && <Execution />}
      {view === "plan" && <PlanAction />}
      {view === "briefing" && <Briefing />}
      {view === "copilote" && <Copilote />}
      {view === "equipe" && <Equipe />}
      {view === "onboarding" && <Onboarding />}
      {view === "reglages" && <Reglages />}

      <footer style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${T.line}`, fontSize: 11.5, color: T.faint, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span>Veille Stratégique · données réelles (Firestore) · IA Gemini avec revue humaine</span>
        <span>Focale : {LENS.find((l) => l[0] === lens)?.[1]}</span>
      </footer>
    </div>
  );
}
