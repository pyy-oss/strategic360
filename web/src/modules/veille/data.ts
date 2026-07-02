/**
 * Sample data module — ported verbatim from docs/maquette_reference.jsx.
 *
 * NOTE (V0): all constants below are LOCAL SAMPLE DATA, isolated in this single module on
 * purpose. In a later phase (V2-V4 per BUILD_KIT.md roadmap) these will be replaced by
 * Firestore queries / `summaries/*` reads, WITHOUT changing the views' rendering — views only
 * import from this module, so the swap only touches this file plus the data-fetching hooks.
 */
import { T } from "../../design/tokens";

/* ---- Signaux & watchlist ---- */
export const SIGNAUX = [
  { id: 1, t: "Cisco annonce la fin de vie (EOL) de la gamme Catalyst 9200", ax: "partenaires", sub: "EOL", ent: "Cisco", geo: "Afrique", date: "2026-06-28", imp: "high", stance: "threat", src: "A1", score: 88, sw: "Risque d'appro sur les renouvellements d'infra bancaire ; migration à anticiper.", act: "Sécuriser le stock, préparer une offre de migration proactive vers Catalyst 9300." },
  { id: 2, t: "La BAD lance un programme de digitalisation de 200 M$ en Afrique de l'Ouest", ax: "clients_prospects", sub: "Financement", ent: "BAD", geo: "Afrique de l'Ouest", date: "2026-06-25", imp: "high", stance: "opportunity", src: "A2", score: 92, sw: "Vague d'AO infrastructures & cybersécurité financés à venir.", act: "Positionner un consortium ; cartographier les guichets et pré-qualifier." },
  { id: 3, t: "Orange CI prépare un RFP SD-WAN multi-sites", ax: "clients_prospects", sub: "Appel d'offres", ent: "Orange CI", geo: "Côte d'Ivoire", date: "2026-06-24", imp: "high", stance: "opportunity", src: "B1", score: 84, sw: "Compte stratégique ; fenêtre de placement SD-WAN + managed.", act: "Activer le compte, mobiliser l'avant-vente Fortinet/Cisco." },
  { id: 4, t: "ARTCI durcit les exigences de localisation des données", ax: "reglementaire", sub: "Réglementation", ent: "ARTCI", geo: "Côte d'Ivoire", date: "2026-06-20", imp: "high", stance: "opportunity", src: "A1", score: 80, sw: "Accélère la demande de cloud souverain et de cybersécurité conforme.", act: "Structurer une offre 'conformité & souveraineté' packagée." },
  { id: 5, t: "Fortinet relève ses tarifs licences de ~8%", ax: "partenaires", sub: "Tarifs", ent: "Fortinet", geo: "Afrique", date: "2026-06-18", imp: "medium", stance: "threat", src: "B2", score: 62, sw: "Érosion de marge sur les renouvellements FortiGate.", act: "Réviser les grilles, anticiper les renouvellements avant application." },
  { id: 6, t: "Un intégrateur régional remporte le datacenter d'une banque de la place", ax: "concurrents", sub: "Contrat gagné", ent: "Concurrent A", geo: "Côte d'Ivoire", date: "2026-06-15", imp: "medium", stance: "threat", src: "C2", score: 58, sw: "Montée en compétence datacenter d'un rival direct.", act: "Analyse win/loss, renforcer la battlecard, protéger les comptes exposés." },
  { id: 7, t: "Palo Alto révise son programme partenaire (rebates conditionnés à la certif)", ax: "partenaires", sub: "Programme", ent: "Palo Alto", geo: "Afrique", date: "2026-06-12", imp: "medium", stance: "threat", src: "B2", score: 60, sw: "Risque sur le niveau de rebate si certifications non maintenues.", act: "Planifier les certifications, sécuriser le statut partenaire." },
  { id: 8, t: "Microsoft accélère sur le cloud souverain en Afrique", ax: "tech", sub: "Tendance", ent: "Microsoft", geo: "Afrique", date: "2026-06-10", imp: "high", stance: "opportunity", src: "B2", score: 78, sw: "Aligne l'offre souveraine avec la pression réglementaire locale.", act: "Monter en compétence Azure Local / souverain, packager une offre." },
  { id: 9, t: "Tensions d'approvisionnement et délais allongés côté HPE/serveurs", ax: "partenaires", sub: "Supply", ent: "HPE", geo: "Afrique", date: "2026-06-08", imp: "medium", stance: "threat", src: "B3", score: 55, sw: "Allongement des délais de livraison sur projets serveurs.", act: "Rapprocher du module Crédit Fournisseurs ; anticiper les commandes." },
  { id: 10, t: "Nouvelle ESN low-cost entre sur le marché ivoirien", ax: "concurrents", sub: "Nouvel entrant", ent: "Concurrent B", geo: "Côte d'Ivoire", date: "2026-06-05", imp: "low", stance: "threat", src: "D3", score: 40, sw: "Pression prix potentielle sur le segment PME.", act: "Surveiller ; différencier par le managed et l'expertise cyber." },
  { id: 11, t: "Demande croissante de SOC managé dans le secteur bancaire UEMOA", ax: "tech", sub: "Tendance", ent: "—", geo: "Afrique de l'Ouest", date: "2026-06-03", imp: "high", stance: "opportunity", src: "B2", score: 82, sw: "Récurrence & marge : cœur de la stratégie managed services.", act: "Industrialiser l'offre SOC managé, staffer les analystes." },
  { id: 12, t: "BCEAO renforce les exigences cyber des établissements financiers", ax: "reglementaire", sub: "Réglementation", ent: "BCEAO", geo: "Afrique de l'Ouest", date: "2026-05-30", imp: "high", stance: "opportunity", src: "A1", score: 79, sw: "Oblige les banques à investir en cybersécurité et conformité.", act: "Cibler les banques avec une offre de mise en conformité." },
] as const;

export const WATCH = [
  { n: "Cisco", t: "Éditeur/Constructeur", sig: 1, pr: "Haute" },
  { n: "Palo Alto", t: "Éditeur", sig: 1, pr: "Haute" },
  { n: "Fortinet", t: "Éditeur", sig: 1, pr: "Haute" },
  { n: "HPE", t: "Constructeur", sig: 1, pr: "Moyenne" },
  { n: "Microsoft", t: "Éditeur", sig: 1, pr: "Haute" },
  { n: "Hiperdist", t: "Distributeur", sig: 0, pr: "Haute" },
  { n: "Westcon", t: "Distributeur", sig: 0, pr: "Haute" },
  { n: "Exclusive Networks", t: "Distributeur", sig: 0, pr: "Moyenne" },
  { n: "Orange CI", t: "Client/Prospect", sig: 1, pr: "Haute" },
  { n: "BAD", t: "Client/Bailleur", sig: 1, pr: "Haute" },
  { n: "BCEAO", t: "Client/Régulateur", sig: 1, pr: "Haute" },
  { n: "Concurrent A", t: "Concurrent", sig: 1, pr: "Haute" },
  { n: "Concurrent B", t: "Concurrent", sig: 1, pr: "Moyenne" },
];

export const KPIS = {
  pipelineInf: 2450000000,
  menaces: 6,
  menacesTraitees: 4,
  opportunites: 5,
  tti: 2.3,
  okr: 0.58,
  winRate: 0.62,
  fraicheur: 0.85,
};

export const SWOT: Record<string, string[]> = {
  Forces: [
    "Portefeuille multi-éditeurs certifié (Cisco/Palo Alto/Fortinet/HPE/Microsoft)",
    "Expertise cybersécurité (démarche PASSI)",
    "Références bancaires, télécoms, institutionnelles",
    "Capacité projet + managed services",
    "Ancrage régional UEMOA/CEMAC",
    "Capacité de portage/financement fournisseur",
  ],
  Faiblesses: [
    "Marge brute faible sur le hardware (~7–21%)",
    "Concentration fournisseurs & tension sur les lignes de crédit",
    "Cycle commande→facturation long (backlog)",
    "Dépendance à quelques grands comptes",
    "Compétences rares (cyber/cloud)",
  ],
  Opportunités: [
    "Transformation digitale banques/télécoms",
    "Cybersécurité & souveraineté (réglementation, PASSI)",
    "Cloud souverain",
    "Financements bailleurs (BAD, Banque Mondiale, UE)",
    "Managed services récurrents",
    "Montée des AO publics UEMOA",
  ],
  Menaces: [
    "Intensité concurrentielle (ESN + telcos B2B + low-cost)",
    "Désintermédiation (vente directe éditeurs, hyperscalers)",
    "Volatilité FX/logistique & pénuries (EOL)",
    "Durcissement des programmes éditeurs (marges/rebates)",
    "Risque politique/réglementaire régional",
  ],
};

export const PESTEL = [
  { f: "Politique", imp: 0.6, tr: "↑", d: "Stabilité relative CI, intégration UEMOA, commande publique, souveraineté numérique." },
  { f: "Économique", imp: 0.7, tr: "↑", d: "Croissance soutenue, inflation, XOF arrimé EUR, budgets IT bancaires/télécom." },
  { f: "Social", imp: 0.5, tr: "↑", d: "Démographie jeune, montée compétences IT, pénurie talents cyber/cloud." },
  { f: "Technologique", imp: 0.9, tr: "↑", d: "Cloud, IA, cybersécurité, datacenters régionaux, fibre/5G, SaaS." },
  { f: "Environnemental", imp: 0.4, tr: "→", d: "Efficacité énergétique datacenters, contraintes énergie, RSE." },
  { f: "Légal", imp: 0.8, tr: "↑", d: "ARTCI, BCEAO, PASSI, localisation des données, fiscalité douanière." },
];

export const PORTER = [
  { force: "Rivalité", v: 75 },
  { force: "Pouvoir fournisseurs", v: 80 },
  { force: "Pouvoir clients", v: 70 },
  { force: "Substituts", v: 55 },
  { force: "Nouveaux entrants", v: 50 },
];

export const BCG = [
  { n: "Cybersécurité & Managed", part: 0.55, croissance: 0.9, marge: 900, q: "Vedette" },
  { n: "Intégration réseau/infra (ICT)", part: 0.8, croissance: 0.25, marge: 1200, q: "Vache à lait" },
  { n: "Cloud souverain & IA", part: 0.2, croissance: 0.85, marge: 300, q: "Dilemme" },
  { n: "Revente hardware banalisé", part: 0.35, croissance: 0.1, marge: 250, q: "Poids mort" },
];

export const CANVAS: [string, string][] = [
  ["Partenaires clés", "Éditeurs, distributeurs, sous-traitants, consortiums (GECA NEURONES–APM)"],
  ["Activités clés", "Avant-vente, intégration, delivery, support, sourcing"],
  ["Propositions de valeur", "Intégration multi-éditeurs, expertise cyber, managed services, proximité, portage/financement"],
  ["Relations clients", "Comptes dédiés (AM), support, SLA managés"],
  ["Segments clients", "Banques, télécoms, institutions/bailleurs, grands comptes, secteur public"],
  ["Ressources clés", "Certifications, ingénieurs, lignes de crédit fournisseurs, références"],
  ["Canaux", "Force commerciale, appels d'offres, partenariats éditeurs"],
  ["Structure de coûts", "Achats matériel/licences, masse salariale, certifications, financement"],
  ["Revenus", "Projets (CAS), récurrent (managed/support), marge revente"],
];

export const RADAR_TECH = [
  { n: "Zero Trust / ZTNA", quad: 0, ring: "adopter", mom: "↑" },
  { n: "XDR", quad: 0, ring: "adopter", mom: "↑" },
  { n: "SASE", quad: 0, ring: "essayer", mom: "↑" },
  { n: "Cloud souverain", quad: 1, ring: "evaluer", mom: "↑" },
  { n: "FinOps", quad: 1, ring: "essayer", mom: "→" },
  { n: "Conteneurs/K8s", quad: 1, ring: "essayer", mom: "→" },
  { n: "IA générative (RAG)", quad: 2, ring: "evaluer", mom: "↑" },
  { n: "Copilots métier", quad: 2, ring: "evaluer", mom: "↑" },
  { n: "Data platform", quad: 2, ring: "essayer", mom: "→" },
  { n: "SD-WAN", quad: 3, ring: "adopter", mom: "→" },
  { n: "Wi-Fi 7", quad: 3, ring: "evaluer", mom: "↑" },
  { n: "MPLS traditionnel", quad: 3, ring: "suspendre", mom: "↓" },
];

export const INNOV = [
  { n: "SOC managé UEMOA", reach: 8, impact: 9, conf: 0.8, effort: 6 },
  { n: "Offre cloud souverain", reach: 6, impact: 8, conf: 0.6, effort: 8 },
  { n: "Copilot avant-vente (IA)", reach: 5, impact: 6, conf: 0.7, effort: 3 },
  { n: "Conformité BCEAO packagée", reach: 7, impact: 7, conf: 0.75, effort: 4 },
  { n: "Managed SD-WAN", reach: 6, impact: 6, conf: 0.7, effort: 5 },
];

export const CONCURRENTS = [
  { n: "Concurrent A", force: "Datacenter, proximité DSI banques", faible: "Faible sur cybersécurité avancée", gagner: "Notre expertise cyber + managed + portage", win: 0.55, deals: 11 },
  { n: "Concurrent B (low-cost)", force: "Prix agressif segment PME", faible: "Peu de certifications, pas de récurrent", gagner: "Différenciation managed & SLA, valeur long terme", win: 0.7, deals: 6 },
  { n: "Telco B2B", force: "Connectivité intégrée, base installée", faible: "Moins agile sur l'intégration multi-éditeurs", gagner: "Neutralité éditeur + expertise projet", win: 0.48, deals: 9 },
];

export const SCENARIOS = {
  axisX: "Pression prix des hyperscalers",
  axisY: "Exigence de souveraineté réglementaire",
  worlds: [
    { q: "Souveraineté forte × Prix hyperscalers agressifs", d: "Cloud souverain local valorisé mais concurrence prix. → Miser sur conformité + managed différenciant.", c: T.gold },
    { q: "Souveraineté forte × Prix hyperscalers élevés", d: "Terrain le plus favorable : demande locale, marges préservées. → Investir cloud souverain + cyber.", c: T.emerald },
    { q: "Souveraineté faible × Prix agressifs", d: "Désintermédiation maximale par hyperscalers. → Se replier sur managed/cyber à forte valeur.", c: T.clay },
    { q: "Souveraineté faible × Prix élevés", d: "Statu quo, avantage à l'intégration classique. → Optimiser sourcing et efficacité.", c: T.steel },
  ],
};

export const INITIATIVES = [
  { pilier: "Croissance récurrente", t: "Industrialiser le SOC managé", okr: "20 contrats managés d'ici T4", prog: 0.45, owner: "Dir. Cyber", h: "H1" },
  { pilier: "Souveraineté & Cloud", t: "Lancer l'offre cloud souverain", okr: "3 références clients signées", prog: 0.3, owner: "Dir. Cloud", h: "H2" },
  { pilier: "Excellence commerciale", t: "Battlecards & win/loss systématiques", okr: "Taux de victoire +5 pts", prog: 0.6, owner: "Dir. Commercial", h: "H1" },
  { pilier: "Innovation", t: "Copilot avant-vente IA", okr: "−30% temps de réponse AO", prog: 0.2, owner: "Dir. Innovation", h: "H2" },
];

export const DECISIONS = [
  { t: "Prioriser la montée en compétence Azure souverain", date: "2026-06-26", by: "CODIR", statut: "Actée", lien: "Signaux #4, #8" },
  { t: "Sécuriser le stock Catalyst avant EOL", date: "2026-06-29", by: "DRO", statut: "En cours", lien: "Signal #1" },
  { t: "Constituer un consortium pour le programme BAD", date: "2026-06-27", by: "DG", statut: "En attente", lien: "Signal #2" },
];

/* ---- Niveau conseil (McKinsey-grade) ---- */
export interface BridgeStep {
  name: string;
  kind?: "start" | "end";
  v?: number;
  d?: number;
}

export const BRIDGE: BridgeStep[] = [
  { name: "CAS actuel", kind: "start", v: 8000 },
  { name: "SOC / Managed", d: 2500 },
  { name: "Cloud souverain", d: 1500 },
  { name: "Programme BAD / AO", d: 3000 },
  { name: "Cross-sell base installée", d: 1200 },
  { name: "Attrition / menaces", d: -900 },
  { name: "Ambition 3 ans", kind: "end", v: 15300 },
];

export const VAS = [
  { n: "Programme digitalisation BAD", type: "opp", p: 0.4, impact: 3500 },
  { n: "RFP SD-WAN Orange CI", type: "opp", p: 0.5, impact: 1200 },
  { n: "Conformité cyber BCEAO (banques)", type: "opp", p: 0.55, impact: 2000 },
  { n: "Cloud souverain (ARTCI)", type: "opp", p: 0.35, impact: 1800 },
  { n: "SOC managé UEMOA", type: "opp", p: 0.6, impact: 1500 },
  { n: "Perte de comptes (rival datacenter)", type: "threat", p: 0.3, impact: -1400 },
  { n: "Érosion marge (rebates/tarifs éditeurs)", type: "threat", p: 0.5, impact: -700 },
  { n: "Ruptures d'appro (EOL/pénuries)", type: "threat", p: 0.4, impact: -600 },
];

export const GE9 = [
  { n: "Cybersécurité & Managed", attr: 2.6, str: 2.2, val: 900, z: "Investir / croître" },
  { n: "Cloud souverain", attr: 2.4, str: 1.2, val: 400, z: "Sélectif / construire" },
  { n: "Intégration ICT", attr: 1.6, str: 2.4, val: 1200, z: "Sélectif / rentabiliser" },
  { n: "Data & IA", attr: 2.2, str: 0.9, val: 250, z: "Sélectif / construire" },
  { n: "Revente hardware banalisé", attr: 0.9, str: 1.4, val: 300, z: "Récolter / rationaliser" },
];

export const HORIZONS = [
  { h: "Horizon 1 — Cœur", share: 0.6, c: T.emerald, d: "Défendre et optimiser l'intégration réseau/infra & le support : efficacité, marge, fidélisation grands comptes.", items: ["Excellence delivery", "Renouvellements sécurisés", "Optimisation sourcing"] },
  { h: "Horizon 2 — Émergent", share: 0.3, c: T.gold, d: "Construire les moteurs de croissance rentable : SOC managé, cloud souverain, conformité BCEAO/ARTCI.", items: ["SOC managé UEMOA", "Offre cloud souverain", "Conformité packagée"] },
  { h: "Horizon 3 — Options", share: 0.1, c: T.steel, d: "Créer des options de rupture : IA d'entreprise, nouveaux modèles récurrents, plateformes.", items: ["Copilots métier IA", "Plateforme managed", "Nouveaux modèles as-a-service"] },
];

export const SEGMENTS = ["Banques", "Télécoms", "Institutions/Bailleurs", "Secteur public", "Grandes entreprises"];
export const OFFRES = ["Réseau/Infra", "Cybersécurité", "Cloud", "Managed/SOC"];

export const GRAN: Record<string, Record<string, number>> = {
  Banques: { "Réseau/Infra": 3, Cybersécurité: 5, Cloud: 4, "Managed/SOC": 5 },
  Télécoms: { "Réseau/Infra": 4, Cybersécurité: 4, Cloud: 3, "Managed/SOC": 4 },
  "Institutions/Bailleurs": { "Réseau/Infra": 4, Cybersécurité: 4, Cloud: 4, "Managed/SOC": 3 },
  "Secteur public": { "Réseau/Infra": 3, Cybersécurité: 4, Cloud: 4, "Managed/SOC": 3 },
  "Grandes entreprises": { "Réseau/Infra": 3, Cybersécurité: 3, Cloud: 3, "Managed/SOC": 3 },
};

export const ISSUE = {
  q: "Comment doubler le revenu rentable en 3 ans ?",
  branches: [
    { t: "Développer le récurrent (marge & prévisibilité)", h: ["Industrialiser le SOC/Managed", "Contrats pluriannuels de support"] },
    { t: "Monter en valeur (mix vers cyber/cloud)", h: ["Basculer le mix hors hardware banalisé", "Packager conformité & souveraineté"] },
    { t: "Conquérir de nouveaux comptes/marchés", h: ["Capter les AO financés (BAD, État)", "Étendre la couverture régionale UEMOA/CEMAC"] },
  ],
};

export const S7 = [
  { s: "Stratégie", v: 70 },
  { s: "Structure", v: 60 },
  { s: "Systèmes", v: 55 },
  { s: "Style", v: 65 },
  { s: "Staff", v: 60 },
  { s: "Skills", v: 58 },
  { s: "Valeurs", v: 75 },
];

export const MATURITE = [
  { c: "Avant-vente", v: 4 },
  { c: "Delivery", v: 4 },
  { c: "Cybersécurité", v: 4 },
  { c: "Cloud", v: 3 },
  { c: "Managed/SOC", v: 3 },
  { c: "Data/IA", v: 2 },
  { c: "Sourcing/Finance", v: 3 },
];

export const SCEN_PROB = [0.3, 0.4, 0.15, 0.15];

/* ---- Simulateur stratégique ---- */
export const SIM_BASE = {
  cas: 8000,
  recurrent: 1500,
  margePct: 0.21,
  winBase: 62,
  pipe: 13780,
  ambition: 15300,
  objMarge: 0.24,
};

export interface ScenOpt {
  k: string;
  l: string;
  cloud: number;
  mp: number;
}

export const SCEN_OPTS: ScenOpt[] = [
  { k: "central", l: "Central (pondéré)", cloud: 1.0, mp: 1.0 },
  { k: "s1", l: "Souveraineté forte × prix élevés (favorable)", cloud: 1.2, mp: 0.7 },
  { k: "s2", l: "Souveraineté forte × prix agressifs", cloud: 1.1, mp: 1.3 },
  { k: "s3", l: "Souveraineté faible × prix agressifs (adverse)", cloud: 0.7, mp: 1.3 },
  { k: "s0", l: "Souveraineté faible × prix élevés", cloud: 0.8, mp: 0.8 },
];

export interface SimParams {
  managed: number;
  cloud: number;
  aoBad: number;
  win: number;
  newAcc: number;
  mix: number;
  tarif: number;
  attrition: number;
  invest: number;
  horizon: number;
  scenario: string;
}

export interface SimWfStep {
  name: string;
  base: number;
  pos: number;
  neg: number;
  kind?: "start" | "end";
}

export interface SimResult {
  revenu: number;
  recurrent: number;
  recShare: number;
  margin: number;
  margeVal: number;
  score: number;
  tension: number;
  wf: SimWfStep[];
  traj: { y: string; v: number }[];
  delta: number;
}

/** Domain logic — identical to maquette / functions/domain/sim.js (BUILD_KIT.md §8.2). */
export function simCompute(p: SimParams): SimResult {
  const { managed, cloud, aoBad, win, newAcc, mix, tarif, attrition, invest, horizon, scenario } = p;
  const ramp = horizon / 3;
  const scen = SCEN_OPTS.find((s) => s.k === scenario) || SCEN_OPTS[0];
  const addManaged = (managed / 100) * 2500 * ramp;
  const addCloud = (cloud / 100) * 1800 * ramp * scen.cloud;
  const addAO = (aoBad / 100) * 3500 * ramp;
  const addWin = ((win - SIM_BASE.winBase) / 100) * SIM_BASE.pipe * 0.3;
  const addNew = (newAcc / 100) * 1500 * ramp;
  const lossAttr = (attrition / 100) * 1400;
  const revenu = SIM_BASE.cas + addManaged + addCloud + addAO + addWin + addNew - lossAttr;
  const recurrent = SIM_BASE.recurrent + addManaged + 0.6 * addCloud;
  const recShare = recurrent / revenu;
  const baseShare = SIM_BASE.recurrent / SIM_BASE.cas;
  let margin =
    0.21 + (mix / 100) * 0.06 + Math.max(recShare - baseShare, 0) * 0.25 - (tarif / 100) * 0.05 * scen.mp - (invest / 100) * 0.02;
  margin = Math.max(0.1, Math.min(0.45, margin));
  const margeVal = revenu * margin;
  const sC = Math.min(revenu / SIM_BASE.ambition, 1.2) / 1.2;
  const sM = Math.min(margin / SIM_BASE.objMarge, 1.2) / 1.2;
  const sR = Math.min(recShare / 0.35, 1);
  const sRes = Math.max(0, 1 - (attrition + tarif) / 200);
  const score = Math.max(0, Math.min(100, Math.round(100 * (0.4 * sC + 0.25 * sM + 0.2 * sR + 0.15 * sRes))));
  const tension = Math.max(0, Math.min(1, ((addAO + addWin) * 0.5) / SIM_BASE.cas + (invest / 100) * 0.3 - recShare * 0.2));
  const steps: { name: string; kind?: "start" | "end"; v?: number; d?: number }[] = [
    { name: "CAS base", kind: "start", v: SIM_BASE.cas },
    { name: "Managed", d: addManaged },
    { name: "Cloud", d: addCloud },
    { name: "AO/BAD", d: addAO },
    { name: "Win rate", d: addWin },
    { name: "Nvx comptes", d: addNew },
    { name: "Attrition", d: -lossAttr },
    { name: "Projeté", kind: "end", v: revenu },
  ];
  let cum = 0;
  const wf: SimWfStep[] = steps.map((b) => {
    if (b.kind) {
      cum = b.v as number;
      return { name: b.name, base: 0, pos: b.v as number, neg: 0, kind: b.kind };
    }
    const d = b.d as number;
    const base = d >= 0 ? cum : cum + d;
    cum += d;
    return { name: b.name, base, pos: d >= 0 ? d : 0, neg: d < 0 ? -d : 0 };
  });
  const traj: { y: string; v: number }[] = [];
  for (let y = 0; y <= horizon; y++) {
    traj.push({ y: "An " + y, v: Math.round(SIM_BASE.cas + (revenu - SIM_BASE.cas) * (y / horizon)) });
  }
  return { revenu, recurrent, recShare, margin, margeVal, score, tension, wf, traj, delta: revenu - SIM_BASE.cas };
}

export interface LevMeta {
  k: keyof SimParams;
  l: string;
  min: number;
  max: number;
}

export const LEVMETA: LevMeta[] = [
  { k: "managed", l: "Récurrent (SOC/Managed)", min: 0, max: 100 },
  { k: "cloud", l: "Cloud souverain", min: 0, max: 100 },
  { k: "aoBad", l: "Capture AO / BAD", min: 0, max: 100 },
  { k: "win", l: "Taux de conversion", min: 40, max: 80 },
  { k: "newAcc", l: "Nouveaux comptes", min: 0, max: 100 },
  { k: "mix", l: "Montée en gamme", min: 0, max: 100 },
  { k: "tarif", l: "Pression tarifaire", min: 0, max: 100 },
  { k: "attrition", l: "Attrition/concurrence", min: 0, max: 100 },
  { k: "invest", l: "Investissement", min: 0, max: 100 },
];

export const PRESETS: Record<string, SimParams> = {
  Prudent: { managed: 20, cloud: 15, aoBad: 25, win: 58, newAcc: 20, mix: 20, tarif: 60, attrition: 50, invest: 25, horizon: 3, scenario: "s3" },
  Base: { managed: 40, cloud: 30, aoBad: 40, win: 62, newAcc: 30, mix: 35, tarif: 40, attrition: 30, invest: 40, horizon: 3, scenario: "central" },
  Ambition: { managed: 80, cloud: 70, aoBad: 60, win: 70, newAcc: 60, mix: 70, tarif: 30, attrition: 20, invest: 70, horizon: 3, scenario: "s1" },
};

/* ---- Radar de détection ---- */
export const EVENTS = [
  { id: 1, cat: "marche", type: "Nouvelle implantation", t: "Une banque panafricaine ouvre une filiale à Abidjan", ent: "Banque X", geo: "CI", prox: "court", imp: "high", stance: "opportunity", conf: "B1", neuf: true, sw: "Nouveau compte à fort potentiel infra & cybersécurité.", act: "Qualifier le prospect, activer une approche avant l'appel d'offres d'équipement." },
  { id: 2, cat: "marche", type: "Expansion de groupe", t: "Un groupe bancaire régional étend son réseau (≈10 pays UEMOA/CEMAC)", ent: "Groupe bancaire", geo: "UEMOA/CEMAC", prox: "moyen", imp: "high", stance: "opportunity", conf: "A2", neuf: true, sw: "Vague de projets réseau/sécurité multi-pays.", act: "Positionner une offre régionale coordonnée (delivery multi-pays)." },
  { id: 3, cat: "marche", type: "Entrée d'un concurrent", t: "Une ESN étrangère ouvre un bureau à Abidjan", ent: "Concurrent C", geo: "CI", prox: "court", imp: "medium", stance: "threat", conf: "B2", neuf: true, sw: "Pression concurrentielle accrue sur les grands comptes.", act: "Renforcer les battlecards et verrouiller les comptes clés." },
  { id: 4, cat: "marche", type: "Rachat / M&A", t: "Un distributeur régional racheté par un acteur mondial", ent: "Distributeur", geo: "Afrique", prox: "court", imp: "medium", stance: "neutral", conf: "B2", neuf: false, sw: "Possible évolution des conditions & lignes de crédit.", act: "Rapprocher du module Crédit Fournisseurs, renégocier les termes." },
  { id: 5, cat: "marche", type: "Levée de fonds", t: "Une fintech locale lève des fonds pour son expansion", ent: "Fintech", geo: "CI", prox: "moyen", imp: "low", stance: "opportunity", conf: "C2", neuf: false, sw: "Prospect en croissance, besoins cloud/sécurité à venir.", act: "Surveiller ; entrer en relation en amont des besoins." },
  { id: 6, cat: "sectoriel", type: "Opportunité sectorielle", t: "Plan national de digitalisation de la santé", ent: "État CI", geo: "CI", prox: "moyen", imp: "high", stance: "opportunity", conf: "A2", neuf: true, sw: "Programme structurant : infrastructures, data, cybersécurité.", act: "Cartographier les guichets, préparer un consortium sectoriel." },
  { id: 7, cat: "sectoriel", type: "Programme d'investissement", t: "Programme e-gouvernement financé par un bailleur", ent: "Bailleur", geo: "Afrique de l'Ouest", prox: "court", imp: "high", stance: "opportunity", conf: "A2", neuf: true, sw: "Financement disponible : AO à fort volume.", act: "Pré-qualifier, aligner l'offre sur les critères du bailleur." },
  { id: 8, cat: "sectoriel", type: "Risque sectoriel", t: "Ralentissement des investissements IT dans un secteur exposé", ent: "—", geo: "UEMOA", prox: "moyen", imp: "medium", stance: "threat", conf: "C3", neuf: false, sw: "Pipeline potentiellement affecté sur ce segment.", act: "Rééquilibrer l'effort commercial vers les secteurs porteurs." },
  { id: 9, cat: "tech", type: "Tendance techno", t: "Adoption accélérée du SASE / Zero Trust dans la banque", ent: "—", geo: "Afrique", prox: "court", imp: "high", stance: "opportunity", conf: "B2", neuf: true, sw: "Demande cyber alignée avec notre expertise.", act: "Packager une offre SASE/ZTNA, monter en certif." },
  { id: 10, cat: "tech", type: "Rupture / nouvelle techno", t: "GenAI dans le service client bancaire", ent: "—", geo: "Afrique", prox: "moyen", imp: "medium", stance: "opportunity", conf: "B3", neuf: true, sw: "Nouveau terrain de jeu (copilots, RAG) à structurer.", act: "Lancer un POC, évaluer la valeur pour les comptes clés." },
  { id: 11, cat: "tech", type: "Obsolescence / EOL", t: "Fin de vie d'une gamme d'équipements majeure", ent: "Cisco", geo: "Afrique", prox: "imminent", imp: "high", stance: "threat", conf: "A1", neuf: true, sw: "Risque appro + fenêtre de migration à saisir.", act: "Sécuriser le stock, proposer des migrations proactives." },
  { id: 12, cat: "tech", type: "Impact techno", t: "Ouverture d'une région cloud d'un hyperscaler en Afrique de l'Ouest", ent: "Hyperscaler", geo: "Afrique de l'Ouest", prox: "moyen", imp: "high", stance: "neutral", conf: "B2", neuf: true, sw: "Opportunité (services managés) et menace (désintermédiation).", act: "Se positionner en intégrateur/MSP au-dessus du cloud." },
  { id: 13, cat: "regpays", type: "Nouvelle réglementation", t: "ARTCI impose la localisation des données", ent: "ARTCI", geo: "CI", prox: "imminent", imp: "high", stance: "opportunity", conf: "A1", neuf: true, sw: "Accélère cloud souverain & conformité.", act: "Structurer une offre souveraineté & conformité packagée." },
  { id: 14, cat: "regpays", type: "Évolution normative", t: "BCEAO renforce les exigences cyber des banques", ent: "BCEAO", geo: "UEMOA", prox: "court", imp: "high", stance: "opportunity", conf: "A1", neuf: false, sw: "Obligation d'investissement cyber pour les banques.", act: "Cibler les banques avec une offre de mise en conformité." },
  { id: 15, cat: "regpays", type: "Fiscalité / douane", t: "Nouvelle taxe douanière sur le matériel IT importé", ent: "État", geo: "CI", prox: "moyen", imp: "medium", stance: "threat", conf: "C2", neuf: false, sw: "Hausse du coût du hardware → pression sur la marge.", act: "Revoir le pricing, accélérer la bascule vers services/récurrent." },
  { id: 16, cat: "regpays", type: "Risque pays", t: "Tensions et élections dans un pays cible → gel possible des marchés publics", ent: "—", geo: "CEMAC", prox: "moyen", imp: "medium", stance: "threat", conf: "C3", neuf: true, sw: "Risque de report des AO et sur le delivery local.", act: "Diversifier l'exposition pays, sécuriser les contrats en cours." },
];

/* ---- Indicateurs avancés (leading KRIs) ---- */
export const KRI = [
  { n: "Pipeline pondéré", u: " Md", val: 13.8, data: [11.2, 11.8, 12.4, 12.1, 12.9, 13.3, 13.6, 13.8], dir: "up", stat: "ok" },
  { n: "Taux de conversion", u: "%", val: 62, data: [57, 58, 60, 59, 61, 61, 62, 62], dir: "up", stat: "ok" },
  { n: "Part de récurrent", u: "%", val: 19, data: [14, 15, 15, 16, 17, 18, 18, 19], dir: "up", stat: "warn" },
  { n: "Marge brute moyenne", u: "%", val: 21, data: [22, 21, 21, 20, 21, 21, 21, 21], dir: "up", stat: "warn" },
  { n: "Saturation lignes fournisseurs", u: "%", val: 78, data: [62, 65, 68, 70, 73, 75, 77, 78], dir: "down", stat: "alert" },
  { n: "Délai commande→facturation", u: " j", val: 96, data: [110, 108, 104, 101, 99, 98, 97, 96], dir: "down", stat: "ok" },
  { n: "AO actifs suivis", u: "", val: 14, data: [8, 9, 10, 11, 11, 12, 13, 14], dir: "up", stat: "ok" },
  { n: "Menaces fort impact non traitées", u: "", val: 2, data: [4, 4, 3, 3, 2, 3, 2, 2], dir: "down", stat: "ok" },
  { n: "Fraîcheur watchlist", u: "%", val: 85, data: [70, 74, 78, 80, 82, 83, 84, 85], dir: "up", stat: "ok" },
  { n: "Time-to-insight", u: " j", val: 2.3, data: [4.1, 3.8, 3.4, 3.0, 2.8, 2.6, 2.4, 2.3], dir: "down", stat: "ok" },
];

/* ---- Plan d'action priorisé ---- */
export const ACTIONS = [
  { t: "Constituer un consortium pour le programme BAD", imp: 5, urg: 4, eff: 3, ev: 1400, owner: "DG", ech: "T3", st: "À lancer", src: "Signal #2 · Évén. #7" },
  { t: "Sécuriser le stock avant l'EOL Cisco", imp: 4, urg: 5, eff: 2, ev: 600, owner: "DRO", ech: "Immédiat", st: "En cours", src: "Évén. #11" },
  { t: "Industrialiser le SOC managé (récurrence + marge)", imp: 5, urg: 3, eff: 4, ev: 900, owner: "Dir. Cyber", ech: "T4", st: "En cours", src: "Tendance #11" },
  { t: "Offre conformité BCEAO / ARTCI packagée", imp: 4, urg: 4, eff: 3, ev: 1100, owner: "Dir. Cyber", ech: "T3", st: "À lancer", src: "Évén. #13/#14" },
  { t: "Positionner le RFP SD-WAN Orange CI", imp: 4, urg: 4, eff: 2, ev: 600, owner: "AM Orange", ech: "T3", st: "À lancer", src: "Signal #3" },
  { t: "Renégocier les lignes de crédit exposées", imp: 3, urg: 4, eff: 2, ev: 300, owner: "DAF / DRO", ech: "T3", st: "À planifier", src: "Évén. #4" },
  { t: "POC GenAI service client bancaire", imp: 3, urg: 2, eff: 3, ev: 250, owner: "Dir. Innovation", ech: "T4", st: "À planifier", src: "Évén. #10" },
  { t: "Diversifier l'exposition pays (CEMAC)", imp: 3, urg: 3, eff: 3, ev: 200, owner: "DRO", ech: "T4", st: "À surveiller", src: "Évén. #16" },
];

export function quadrant(a: { imp: number; urg: number }): { l: string; c: string } {
  if (a.imp >= 4 && a.urg >= 4) return { l: "Faire maintenant", c: T.clay };
  if (a.imp >= 4 && a.urg < 4) return { l: "Planifier", c: T.emerald };
  if (a.imp < 4 && a.urg >= 4) return { l: "Traiter vite", c: T.gold };
  return { l: "Surveiller", c: T.faint };
}

/* ---- Navigation / focales ---- */
export const LENS: [string, string][] = [
  ["dg", "Vue DG (Board)"],
  ["strategie", "Vue Stratégie"],
  ["innovation", "Vue Innovation"],
];

export const NAV: [string, string][] = [
  ["radar", "Radar exécutif"],
  ["fil", "Fil de veille"],
  ["detection", "Radar de détection"],
  ["indicateurs", "Indicateurs avancés"],
  ["cadres", "Cadres stratégiques"],
  ["portefeuille", "Portefeuille & Croissance"],
  ["valeur", "Création de valeur"],
  ["simulateur", "Simulateur stratégique"],
  ["diagnostic", "Diagnostic"],
  ["innovation", "Tech Radar & Innovation"],
  ["concurrence", "Concurrence"],
  ["scenarios", "Scénarios"],
  ["execution", "Exécution & Décisions"],
  ["plan", "Plan d'action"],
  ["briefing", "Briefing exécutif"],
];
