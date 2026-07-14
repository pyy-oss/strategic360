import React, { useEffect, useMemo, useState } from "react";
import { T } from "../../../design/tokens";
import { Eyebrow, Card, Badge } from "../../../design/ui";
import { Input, Textarea, Toggle } from "../../../design/fields";
import { useToast } from "../../../design/overlay";
import { useIsExec } from "../../../lib/rbac";
import {
  onboardCompany, applyOnboardingDraft, useOnboardingDraft,
  type OnboardingDraft, type OnboardingCandidateSource, type EntityType,
} from "../lib/onboarding";

/**
 * « Onboarding » (Phase 1, P5) — écran EXEC de paramétrage produit : à partir de l'URL du site d'un
 * client, lance `onboardCompany` (crawl + IA → brouillon), laisse REVOIR/ÉDITER le brouillon, puis
 * `applyOnboardingDraft` écrit les docs config/* de production + amorce les sources. Rien n'est
 * appliqué sans clic explicite « Appliquer ». Le moteur (crawl, IA, écritures) vit côté serveur ;
 * ici, saisie + revue humaine uniquement.
 */

const ENTITY_COLOR: Record<EntityType, string> = {
  concurrent: T.clay, client: T.emerald, partenaire: T.steel, regulateur: T.gold, editeur: T.plum,
};
const ENTITY_LABEL: Record<EntityType, string> = {
  concurrent: "concurrent", client: "client", partenaire: "partenaire", regulateur: "régulateur", editeur: "éditeur",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, color: T.dim, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}

export function Onboarding() {
  const isExec = useIsExec();
  const toast = useToast();
  const { data: stored } = useOnboardingDraft();

  // Saisie initiale.
  const [url, setUrl] = useState("");
  const [hintName, setHintName] = useState("");
  const [hintSector, setHintSector] = useState("");
  const [validateSources, setValidateSources] = useState(true);
  const [activateSources, setActivateSources] = useState(false);

  // Brouillon en cours de revue (copie locale éditable).
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Réhydrate depuis le dernier brouillon stocké (tant qu'aucune analyse locale n'a démarré).
  useEffect(() => {
    if (!draft && stored && stored.status !== "applied") setDraft(stored);
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchDraft = (patch: Partial<OnboardingDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const patchProfile = (patch: Partial<OnboardingDraft["profile"]>) =>
    setDraft((d) => (d ? { ...d, profile: { ...d.profile, ...patch } } : d));

  const sources: OnboardingCandidateSource[] = draft?.plan?.candidateSources ?? [];
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  // À chaque nouveau brouillon : inclure par défaut les sources valides (ou toutes si pas de validation).
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const s of sources) next[s.url] = s.valid !== false;
    setIncluded(next);
  }, [draft?.sourceUrl, draft?.stats?.candidateSources]); // eslint-disable-line react-hooks/exhaustive-deps

  const includedCount = useMemo(() => sources.filter((s) => included[s.url]).length, [sources, included]);

  if (!isExec) {
    return (
      <Card>
        <Eyebrow color={T.gold}>Onboarding</Eyebrow>
        <div style={{ fontSize: 13, color: T.dim, marginTop: 8 }}>
          Le paramétrage d'un déploiement client est réservé aux profils exécutifs (direction / stratégie / innovation).
        </div>
      </Card>
    );
  }

  const runAnalyse = async () => {
    if (!/^https?:\/\//i.test(url.trim())) { setErr("Saisissez une URL http(s) valide (ex. https://exemple.com)."); return; }
    setAnalysing(true); setErr(null);
    try {
      const res = await onboardCompany({
        url: url.trim(),
        hints: { name: hintName.trim() || undefined, sector: hintSector.trim() || undefined },
        validateSources,
      });
      setDraft(res);
      toast.success(`Analyse terminée : ${res.stats?.entities ?? 0} entités · ${res.stats?.candidateSources ?? 0} sources`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'analyse du site.";
      setErr(msg); toast.error(msg);
    } finally { setAnalysing(false); }
  };

  const runApply = async () => {
    if (!draft) return;
    setApplying(true); setErr(null);
    try {
      // On n'envoie que les sources incluses ; forcées à valid=true pour être bien amorcées.
      const chosen = sources.filter((s) => included[s.url]).map((s) => ({ ...s, valid: true }));
      const edited: OnboardingDraft = { ...draft, plan: { ...(draft.plan ?? {}), candidateSources: chosen } };
      const res = await applyOnboardingDraft({ draft: edited, activateSources });
      toast.success(
        `Configuration appliquée : ${res.companyName} · ${res.sourcesWritten} source(s)${res.sourcesActive ? " actives" : " inactives"} · ${res.watchlistWritten} entité(s)`
      );
      setDraft(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec de l'application.";
      setErr(msg); toast.error(msg);
    } finally { setApplying(false); }
  };

  const geographies = (draft?.profile?.geographies ?? []).join(", ");
  const entities = draft?.ecosystem?.entities ?? [];
  const axes = draft?.plan?.axes?.length ? draft.plan.axes : draft?.ecosystem?.axes ?? [];
  const keywords = draft?.plan?.keywords ?? [];
  const offerMarkers = Object.entries(draft?.plan?.offerMarkers ?? {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Eyebrow color={T.gold}>Onboarding — paramétrage d'un déploiement client</Eyebrow>
        <div style={{ fontSize: 12.5, color: T.dim, marginTop: 6, maxWidth: 720 }}>
          À partir de l'URL du site d'une entreprise, l'outil aspire son contenu et propose son profil, son
          écosystème et son plan de veille. <strong style={{ color: T.ink }}>Rien n'est appliqué</strong> tant que
          vous n'avez pas revu puis cliqué « Appliquer la configuration ».
        </div>
      </div>

      {/* 1 — Saisie */}
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }} className="gform">
          <Field label="URL du site de l'entreprise">
            <Input value={url} onChange={setUrl} placeholder="https://exemple-client.com" disabled={analysing} />
          </Field>
          <Field label="Nom (indice, optionnel)">
            <Input value={hintName} onChange={setHintName} placeholder="Ex. ACME SA" disabled={analysing} />
          </Field>
          <Field label="Secteur (indice, optionnel)">
            <Input value={hintSector} onChange={setHintSector} placeholder="Ex. Assurance" disabled={analysing} />
          </Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
          <Toggle checked={validateSources} onChange={setValidateSources} disabled={analysing}
            label="Valider techniquement les sources proposées (plus lent, recommandé)" />
          <button className="pill on" disabled={analysing || !url.trim()} onClick={() => void runAnalyse()}>
            {analysing ? <><span className="cop-spin" /> Analyse du site… (30–90 s)</> : "Analyser le site"}
          </button>
        </div>
        {err && <div style={{ color: T.clay, fontSize: 12, marginTop: 10 }}>{err}</div>}
      </Card>

      {/* 2 — Revue du brouillon */}
      {draft && (
        <>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <Eyebrow color={T.emerald}>Profil & contexte</Eyebrow>
              {draft.sourceUrl && <span style={{ fontSize: 11, color: T.faint }}>source : {draft.sourceUrl}</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }} className="gform">
              <Field label="Nom de l'entreprise">
                <Input value={draft.profile.companyName ?? ""} onChange={(v) => patchProfile({ companyName: v })} />
              </Field>
              <Field label="Secteur">
                <Input value={draft.profile.sector ?? ""} onChange={(v) => patchProfile({ sector: v })} />
              </Field>
              <Field label="Zones géographiques (séparées par des virgules)">
                <Input value={geographies}
                  onChange={(v) => patchProfile({ geographies: v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
              </Field>
              <Field label="Devise">
                <Input value={draft.profile.currency ?? ""} onChange={(v) => patchProfile({ currency: v || null })} />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Contexte entreprise (injecté dans les prompts de veille)">
                <Textarea value={draft.contextText ?? ""} onChange={(v) => patchDraft({ contextText: v })} style={{ minHeight: 120 }} />
              </Field>
            </div>
            {draft.plan?.homonymyRule && (
              <div style={{ fontSize: 11.5, color: T.dim, marginTop: 10 }}>
                <strong style={{ color: T.ink }}>Homonymie :</strong> {draft.plan.homonymyRule}
              </div>
            )}
          </Card>

          {/* Écosystème */}
          <Card>
            <Eyebrow color={T.steel}>Écosystème — {entities.length} entité(s)</Eyebrow>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
              {entities.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>Aucune entité nommée détectée.</span>}
              {entities.map((e, i) => (
                <span key={i} title={e.note || undefined}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${T.line}`, borderRadius: 999, padding: "4px 10px", fontSize: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: ENTITY_COLOR[e.type] ?? T.faint }} />
                  {e.name}
                  <span style={{ color: T.faint, fontSize: 10.5 }}>{ENTITY_LABEL[e.type] ?? e.type}{e.geo ? ` · ${e.geo}` : ""}</span>
                </span>
              ))}
            </div>
            {axes.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: T.dim, fontWeight: 600, marginBottom: 6 }}>Axes de veille</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {axes.map((a, i) => (
                    <Badge key={i} c={T.plum}>{a.label || a.key}{typeof a.alignWeight === "number" ? ` · ${a.alignWeight.toFixed(2)}` : ""}</Badge>
                  ))}
                </div>
              </div>
            )}
            {keywords.length > 0 && (
              <div style={{ fontSize: 11.5, color: T.dim, marginTop: 12 }}>
                <strong style={{ color: T.ink }}>Mots-clés :</strong> {keywords.join(" · ")}
              </div>
            )}
            {offerMarkers.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: T.dim, fontWeight: 600, marginBottom: 6 }}>
                  Déclencheurs veille → offres (boucle cross-sell)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {offerMarkers.map(([subtype, markers]) => (
                    <div key={subtype} style={{ fontSize: 11.5, color: T.dim }}>
                      <span style={{ color: T.plum, fontWeight: 600 }}>{subtype}</span> → {(markers ?? []).join(", ")}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Sources candidates */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <Eyebrow color={T.gold}>Sources candidates — {includedCount}/{sources.length} retenue(s)</Eyebrow>
              <span style={{ fontSize: 11, color: T.faint }}>décochez celles à écarter</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {sources.length === 0 && <span style={{ fontSize: 12, color: T.faint }}>Aucune source proposée.</span>}
              {sources.map((s) => {
                const on = !!included[s.url];
                const validColor = s.valid === true ? T.emerald : s.valid === false ? T.clay : T.faint;
                const validText = s.valid === true ? `OK · ${s.itemCount ?? 0} items` : s.valid === false ? (s.validationReason || "invalide") : "non testée";
                return (
                  <div key={s.url} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${T.line}`, borderRadius: 8, opacity: on ? 1 : 0.5 }}>
                    <input type="checkbox" checked={on} onChange={(e) => setIncluded((m) => ({ ...m, [s.url]: e.target.checked }))} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.steel, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{s.url}</a>
                    </div>
                    <Badge c={T.faint}>{s.kind}</Badge>
                    {s.axis && <span style={{ fontSize: 10.5, color: T.faint }}>{s.axis}</span>}
                    <span style={{ fontSize: 10.5, color: validColor, minWidth: 76, textAlign: "right" }}>{validText}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Application */}
          <Card>
            <Eyebrow color={T.emerald}>Appliquer</Eyebrow>
            <div style={{ fontSize: 12, color: T.dim, marginTop: 8, maxWidth: 720 }}>
              Écrit <code>config/profile</code>, <code>config/veilleTaxonomy</code>, le contexte entreprise, et — quand ils sont
              dérivables — <code>config/scoring</code> (bonus géographique de vos zones), <code>config/sourceAuthority</code>
              (vos régulateurs) et <code>config/offerMapping</code> (déclencheurs veille → vos offres). Amorce aussi les
              sources retenues + les entités de l'écosystème.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
              <Toggle checked={activateSources} onChange={setActivateSources} color={T.gold}
                label="Activer les sources immédiatement (sinon créées inactives, à activer après revue)" />
              <button className="pill on" disabled={applying || !draft.profile.companyName} onClick={() => void runApply()}>
                {applying ? <><span className="cop-spin" /> Application…</> : "Appliquer la configuration"}
              </button>
              <button className="pill" disabled={applying} onClick={() => setDraft(null)}>Annuler</button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
