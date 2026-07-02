import React, { useState, useMemo } from "react";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
  BarChart, Bar, LineChart, Line } from "recharts";

const T={bg:"#0E1613",panel:"#151F1A",panel2:"#1B2721",line:"#26352D",ink:"#EEF3EF",dim:"#8FA89B",faint:"#5E7268",gold:"#C9A24B",emerald:"#46C08A",clay:"#D9694C",steel:"#6E9DC0",plum:"#A98AC4"};
const AX={partenaires:{l:"Partenaires",c:"#6E9DC0"},concurrents:{l:"Concurrents",c:"#D9694C"},clients_prospects:{l:"Clients & Prospects",c:"#46C08A"},tech:{l:"Tendances Tech",c:"#A98AC4"},reglementaire:{l:"Réglementaire",c:"#C9A24B"}};
const IMP={high:{l:"Fort",c:"#D9694C"},medium:{l:"Moyen",c:"#C9A24B"},low:{l:"Faible",c:"#5E7268"}};
const STANCE={opportunity:{l:"Opportunité",c:"#46C08A"},threat:{l:"Menace",c:"#D9694C"},neutral:{l:"Neutre",c:"#8FA89B"}};
const RING={adopter:{l:"Adopter",c:"#46C08A",r:0.28},essayer:{l:"Essayer",c:"#6E9DC0",r:0.5},evaluer:{l:"Évaluer",c:"#C9A24B",r:0.72},suspendre:{l:"Suspendre",c:"#D9694C",r:0.92}};

const fmt=(v)=>{v=Number(v)||0;const s=v<0?"-":"";v=Math.abs(v);if(v>=1e9)return s+(v/1e9).toFixed(2)+" Md";if(v>=1e6)return s+(v/1e6).toFixed(0)+" M";if(v>=1e3)return s+(v/1e3).toFixed(0)+" k";return s+v.toFixed(0);};
const pct=(v)=>Math.round((Number(v)||0)*100)+" %";

/* ---- Données d'exemple (Neurones CI) ---- */
const SIGNAUX=[
  {id:1,t:"Cisco annonce la fin de vie (EOL) de la gamme Catalyst 9200",ax:"partenaires",sub:"EOL",ent:"Cisco",geo:"Afrique",date:"2026-06-28",imp:"high",stance:"threat",src:"A1",score:88,sw:"Risque d'appro sur les renouvellements d'infra bancaire ; migration à anticiper.",act:"Sécuriser le stock, préparer une offre de migration proactive vers Catalyst 9300."},
  {id:2,t:"La BAD lance un programme de digitalisation de 200 M$ en Afrique de l'Ouest",ax:"clients_prospects",sub:"Financement",ent:"BAD",geo:"Afrique de l'Ouest",date:"2026-06-25",imp:"high",stance:"opportunity",src:"A2",score:92,sw:"Vague d'AO infrastructures & cybersécurité financés à venir.",act:"Positionner un consortium ; cartographier les guichets et pré-qualifier."},
  {id:3,t:"Orange CI prépare un RFP SD-WAN multi-sites",ax:"clients_prospects",sub:"Appel d'offres",ent:"Orange CI",geo:"Côte d'Ivoire",date:"2026-06-24",imp:"high",stance:"opportunity",src:"B1",score:84,sw:"Compte stratégique ; fenêtre de placement SD-WAN + managed.",act:"Activer le compte, mobiliser l'avant-vente Fortinet/Cisco."},
  {id:4,t:"ARTCI durcit les exigences de localisation des données",ax:"reglementaire",sub:"Réglementation",ent:"ARTCI",geo:"Côte d'Ivoire",date:"2026-06-20",imp:"high",stance:"opportunity",src:"A1",score:80,sw:"Accélère la demande de cloud souverain et de cybersécurité conforme.",act:"Structurer une offre 'conformité & souveraineté' packagée."},
  {id:5,t:"Fortinet relève ses tarifs licences de ~8%",ax:"partenaires",sub:"Tarifs",ent:"Fortinet",geo:"Afrique",date:"2026-06-18",imp:"medium",stance:"threat",src:"B2",score:62,sw:"Érosion de marge sur les renouvellements FortiGate.",act:"Réviser les grilles, anticiper les renouvellements avant application."},
  {id:6,t:"Un intégrateur régional remporte le datacenter d'une banque de la place",ax:"concurrents",sub:"Contrat gagné",ent:"Concurrent A",geo:"Côte d'Ivoire",date:"2026-06-15",imp:"medium",stance:"threat",src:"C2",score:58,sw:"Montée en compétence datacenter d'un rival direct.",act:"Analyse win/loss, renforcer la battlecard, protéger les comptes exposés."},
  {id:7,t:"Palo Alto révise son programme partenaire (rebates conditionnés à la certif)",ax:"partenaires",sub:"Programme",ent:"Palo Alto",geo:"Afrique",date:"2026-06-12",imp:"medium",stance:"threat",src:"B2",score:60,sw:"Risque sur le niveau de rebate si certifications non maintenues.",act:"Planifier les certifications, sécuriser le statut partenaire."},
  {id:8,t:"Microsoft accélère sur le cloud souverain en Afrique",ax:"tech",sub:"Tendance",ent:"Microsoft",geo:"Afrique",date:"2026-06-10",imp:"high",stance:"opportunity",src:"B2",score:78,sw:"Aligne l'offre souveraine avec la pression réglementaire locale.",act:"Monter en compétence Azure Local / souverain, packager une offre."},
  {id:9,t:"Tensions d'approvisionnement et délais allongés côté HPE/serveurs",ax:"partenaires",sub:"Supply",ent:"HPE",geo:"Afrique",date:"2026-06-08",imp:"medium",stance:"threat",src:"B3",score:55,sw:"Allongement des délais de livraison sur projets serveurs.",act:"Rapprocher du module Crédit Fournisseurs ; anticiper les commandes."},
  {id:10,t:"Nouvelle ESN low-cost entre sur le marché ivoirien",ax:"concurrents",sub:"Nouvel entrant",ent:"Concurrent B",geo:"Côte d'Ivoire",date:"2026-06-05",imp:"low",stance:"threat",src:"D3",score:40,sw:"Pression prix potentielle sur le segment PME.",act:"Surveiller ; différencier par le managed et l'expertise cyber."},
  {id:11,t:"Demande croissante de SOC managé dans le secteur bancaire UEMOA",ax:"tech",sub:"Tendance",ent:"—",geo:"Afrique de l'Ouest",date:"2026-06-03",imp:"high",stance:"opportunity",src:"B2",score:82,sw:"Récurrence & marge : cœur de la stratégie managed services.",act:"Industrialiser l'offre SOC managé, staffer les analystes."},
  {id:12,t:"BCEAO renforce les exigences cyber des établissements financiers",ax:"reglementaire",sub:"Réglementation",ent:"BCEAO",geo:"Afrique de l'Ouest",date:"2026-05-30",imp:"high",stance:"opportunity",src:"A1",score:79,sw:"Oblige les banques à investir en cybersécurité et conformité.",act:"Cibler les banques avec une offre de mise en conformité."},
];
const WATCH=[
  {n:"Cisco",t:"Éditeur/Constructeur",sig:1,pr:"Haute"},{n:"Palo Alto",t:"Éditeur",sig:1,pr:"Haute"},
  {n:"Fortinet",t:"Éditeur",sig:1,pr:"Haute"},{n:"HPE",t:"Constructeur",sig:1,pr:"Moyenne"},
  {n:"Microsoft",t:"Éditeur",sig:1,pr:"Haute"},{n:"Hiperdist",t:"Distributeur",sig:0,pr:"Haute"},
  {n:"Westcon",t:"Distributeur",sig:0,pr:"Haute"},{n:"Exclusive Networks",t:"Distributeur",sig:0,pr:"Moyenne"},
  {n:"Orange CI",t:"Client/Prospect",sig:1,pr:"Haute"},{n:"BAD",t:"Client/Bailleur",sig:1,pr:"Haute"},
  {n:"BCEAO",t:"Client/Régulateur",sig:1,pr:"Haute"},{n:"Concurrent A",t:"Concurrent",sig:1,pr:"Haute"},
  {n:"Concurrent B",t:"Concurrent",sig:1,pr:"Moyenne"},
];
const KPIS={pipelineInf:2450000000,menaces:6,menacesTraitees:4,opportunites:5,tti:2.3,okr:0.58,winRate:0.62,fraicheur:0.85};
const SWOT={
  Forces:["Portefeuille multi-éditeurs certifié (Cisco/Palo Alto/Fortinet/HPE/Microsoft)","Expertise cybersécurité (démarche PASSI)","Références bancaires, télécoms, institutionnelles","Capacité projet + managed services","Ancrage régional UEMOA/CEMAC","Capacité de portage/financement fournisseur"],
  Faiblesses:["Marge brute faible sur le hardware (~7–21%)","Concentration fournisseurs & tension sur les lignes de crédit","Cycle commande→facturation long (backlog)","Dépendance à quelques grands comptes","Compétences rares (cyber/cloud)"],
  Opportunités:["Transformation digitale banques/télécoms","Cybersécurité & souveraineté (réglementation, PASSI)","Cloud souverain","Financements bailleurs (BAD, Banque Mondiale, UE)","Managed services récurrents","Montée des AO publics UEMOA"],
  Menaces:["Intensité concurrentielle (ESN + telcos B2B + low-cost)","Désintermédiation (vente directe éditeurs, hyperscalers)","Volatilité FX/logistique & pénuries (EOL)","Durcissement des programmes éditeurs (marges/rebates)","Risque politique/réglementaire régional"]
};
const PESTEL=[
  {f:"Politique",imp:0.6,tr:"↑",d:"Stabilité relative CI, intégration UEMOA, commande publique, souveraineté numérique."},
  {f:"Économique",imp:0.7,tr:"↑",d:"Croissance soutenue, inflation, XOF arrimé EUR, budgets IT bancaires/télécom."},
  {f:"Social",imp:0.5,tr:"↑",d:"Démographie jeune, montée compétences IT, pénurie talents cyber/cloud."},
  {f:"Technologique",imp:0.9,tr:"↑",d:"Cloud, IA, cybersécurité, datacenters régionaux, fibre/5G, SaaS."},
  {f:"Environnemental",imp:0.4,tr:"→",d:"Efficacité énergétique datacenters, contraintes énergie, RSE."},
  {f:"Légal",imp:0.8,tr:"↑",d:"ARTCI, BCEAO, PASSI, localisation des données, fiscalité douanière."},
];
const PORTER=[
  {force:"Rivalité",v:75},{force:"Pouvoir fournisseurs",v:80},{force:"Pouvoir clients",v:70},{force:"Substituts",v:55},{force:"Nouveaux entrants",v:50},
];
const BCG=[
  {n:"Cybersécurité & Managed",part:0.55,croissance:0.9,marge:900,q:"Vedette"},
  {n:"Intégration réseau/infra (ICT)",part:0.8,croissance:0.25,marge:1200,q:"Vache à lait"},
  {n:"Cloud souverain & IA",part:0.2,croissance:0.85,marge:300,q:"Dilemme"},
  {n:"Revente hardware banalisé",part:0.35,croissance:0.1,marge:250,q:"Poids mort"},
];
const QCOL={"Vedette":T.emerald,"Vache à lait":T.gold,"Dilemme":T.steel,"Poids mort":T.faint};
const CANVAS=[
  ["Partenaires clés","Éditeurs, distributeurs, sous-traitants, consortiums (GECA NEURONES–APM)"],
  ["Activités clés","Avant-vente, intégration, delivery, support, sourcing"],
  ["Propositions de valeur","Intégration multi-éditeurs, expertise cyber, managed services, proximité, portage/financement"],
  ["Relations clients","Comptes dédiés (AM), support, SLA managés"],
  ["Segments clients","Banques, télécoms, institutions/bailleurs, grands comptes, secteur public"],
  ["Ressources clés","Certifications, ingénieurs, lignes de crédit fournisseurs, références"],
  ["Canaux","Force commerciale, appels d'offres, partenariats éditeurs"],
  ["Structure de coûts","Achats matériel/licences, masse salariale, certifications, financement"],
  ["Revenus","Projets (CAS), récurrent (managed/support), marge revente"],
];
const RADAR_TECH=[
  {n:"Zero Trust / ZTNA",quad:0,ring:"adopter",mom:"↑"},{n:"XDR",quad:0,ring:"adopter",mom:"↑"},{n:"SASE",quad:0,ring:"essayer",mom:"↑"},
  {n:"Cloud souverain",quad:1,ring:"evaluer",mom:"↑"},{n:"FinOps",quad:1,ring:"essayer",mom:"→"},{n:"Conteneurs/K8s",quad:1,ring:"essayer",mom:"→"},
  {n:"IA générative (RAG)",quad:2,ring:"evaluer",mom:"↑"},{n:"Copilots métier",quad:2,ring:"evaluer",mom:"↑"},{n:"Data platform",quad:2,ring:"essayer",mom:"→"},
  {n:"SD-WAN",quad:3,ring:"adopter",mom:"→"},{n:"Wi-Fi 7",quad:3,ring:"evaluer",mom:"↑"},{n:"MPLS traditionnel",quad:3,ring:"suspendre",mom:"↓"},
];
const QUAD_TECH=["Cybersécurité","Cloud & Infra","Data & IA","Réseau"];
const INNOV=[
  {n:"SOC managé UEMOA",reach:8,impact:9,conf:0.8,effort:6},
  {n:"Offre cloud souverain",reach:6,impact:8,conf:0.6,effort:8},
  {n:"Copilot avant-vente (IA)",reach:5,impact:6,conf:0.7,effort:3},
  {n:"Conformité BCEAO packagée",reach:7,impact:7,conf:0.75,effort:4},
  {n:"Managed SD-WAN",reach:6,impact:6,conf:0.7,effort:5},
];
const CONCURRENTS=[
  {n:"Concurrent A",force:"Datacenter, proximité DSI banques",faible:"Faible sur cybersécurité avancée",gagner:"Notre expertise cyber + managed + portage",win:0.55,deals:11},
  {n:"Concurrent B (low-cost)",force:"Prix agressif segment PME",faible:"Peu de certifications, pas de récurrent",gagner:"Différenciation managed & SLA, valeur long terme",win:0.7,deals:6},
  {n:"Telco B2B",force:"Connectivité intégrée, base installée",faible:"Moins agile sur l'intégration multi-éditeurs",gagner:"Neutralité éditeur + expertise projet",win:0.48,deals:9},
];
const SCENARIOS={axisX:"Pression prix des hyperscalers",axisY:"Exigence de souveraineté réglementaire",worlds:[
  {q:"Souveraineté forte × Prix hyperscalers agressifs",d:"Cloud souverain local valorisé mais concurrence prix. → Miser sur conformité + managed différenciant.",c:T.gold},
  {q:"Souveraineté forte × Prix hyperscalers élevés",d:"Terrain le plus favorable : demande locale, marges préservées. → Investir cloud souverain + cyber.",c:T.emerald},
  {q:"Souveraineté faible × Prix agressifs",d:"Désintermédiation maximale par hyperscalers. → Se replier sur managed/cyber à forte valeur.",c:T.clay},
  {q:"Souveraineté faible × Prix élevés",d:"Statu quo, avantage à l'intégration classique. → Optimiser sourcing et efficacité.",c:T.steel},
]};
const INITIATIVES=[
  {pilier:"Croissance récurrente",t:"Industrialiser le SOC managé",okr:"20 contrats managés d'ici T4",prog:0.45,owner:"Dir. Cyber",h:"H1"},
  {pilier:"Souveraineté & Cloud",t:"Lancer l'offre cloud souverain",okr:"3 références clients signées",prog:0.3,owner:"Dir. Cloud",h:"H2"},
  {pilier:"Excellence commerciale",t:"Battlecards & win/loss systématiques",okr:"Taux de victoire +5 pts",prog:0.6,owner:"Dir. Commercial",h:"H1"},
  {pilier:"Innovation",t:"Copilot avant-vente IA",okr:"−30% temps de réponse AO",prog:0.2,owner:"Dir. Innovation",h:"H2"},
];
const DECISIONS=[
  {t:"Prioriser la montée en compétence Azure souverain",date:"2026-06-26",by:"CODIR",statut:"Actée",lien:"Signaux #4, #8"},
  {t:"Sécuriser le stock Catalyst avant EOL",date:"2026-06-29",by:"DRO",statut:"En cours",lien:"Signal #1"},
  {t:"Constituer un consortium pour le programme BAD",date:"2026-06-27",by:"DG",statut:"En attente",lien:"Signal #2"},
];

/* ---- Composants partagés ---- */
const Eyebrow=({children,color})=>(<div style={{fontSize:11,letterSpacing:".13em",textTransform:"uppercase",color:color||T.faint,fontWeight:600}}>{children}</div>);
const Card=({children,style})=>(<div style={{background:T.panel,border:`1px solid ${T.line}`,borderRadius:16,padding:18,...style}}>{children}</div>);
const Kpi=({label,value,accent,sub})=>(<div><Eyebrow>{label}</Eyebrow>
  <div style={{fontFamily:"'Bricolage Grotesque',sans-serif",fontSize:24,fontWeight:700,color:accent||T.ink,marginTop:6,fontVariantNumeric:"tabular-nums",lineHeight:1.05}}>{value}</div>
  {sub&&<div style={{fontSize:11.5,color:T.dim,marginTop:4}}>{sub}</div>}</div>);
const Badge=({children,c})=>(<span style={{fontSize:10.5,padding:"2px 7px",borderRadius:999,background:(c||T.faint)+"22",color:c||T.faint,fontWeight:600,whiteSpace:"nowrap"}}>{children}</span>);
function Tip({active,payload}){if(!active||!payload||!payload.length)return null;const p=payload[0]&&payload[0].payload;
  return(<div style={{background:T.panel2,border:`1px solid ${T.line}`,borderRadius:10,padding:"8px 11px",fontSize:12,color:T.ink}}>{p&&(p.n||p.force||p.f)}</div>);}

const LENS=[["dg","Vue DG (Board)"],["strategie","Vue Stratégie"],["innovation","Vue Innovation"]];
const NAV=[["radar","Radar exécutif"],["fil","Fil de veille"],["detection","Radar de détection"],["indicateurs","Indicateurs avancés"],["cadres","Cadres stratégiques"],["portefeuille","Portefeuille & Croissance"],["valeur","Création de valeur"],["simulateur","Simulateur stratégique"],["diagnostic","Diagnostic"],["innovation","Tech Radar & Innovation"],["concurrence","Concurrence"],["scenarios","Scénarios"],["execution","Exécution & Décisions"],["plan","Plan d’action"],["briefing","Briefing exécutif"]];

export default function App(){
  const [lens,setLens]=useState("dg");
  const [view,setView]=useState("radar");
  return(<div style={{background:T.bg,minHeight:"100vh",color:T.ink,fontFamily:"'Inter',system-ui,sans-serif",padding:"20px 24px 40px"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Inter:wght@400;500;600&display=swap');
      *{box-sizing:border-box}::selection{background:#C9A24B;color:#0E1613}
      .pill{cursor:pointer;border:1px solid ${T.line};background:${T.panel};color:${T.dim};border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600}
      .pill.on{background:${T.gold};border-color:${T.gold};color:#0E1613}
      .tab{cursor:pointer;border:none;background:none;color:${T.dim};font-size:13.5px;font-weight:600;padding:9px 2px;border-bottom:2px solid transparent;white-space:nowrap}
      .tab.on{color:${T.ink};border-bottom-color:${T.gold}}
      .navwrap::-webkit-scrollbar{height:0}
      @media(max-width:820px){.g2,.g3,.g4{grid-template-columns:1fr!important}}`}</style>

    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:14,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${T.plum},#6b4f86)`,display:"grid",placeItems:"center",fontFamily:"'Bricolage Grotesque'",fontWeight:700,color:"#0E1613",fontSize:18}}>V</div>
        <div><div style={{fontFamily:"'Bricolage Grotesque'",fontSize:19,fontWeight:700}}>Veille Stratégique</div>
          <div style={{fontSize:11.5,color:T.dim}}>Neurones Technologies CI · intelligence & aide à la décision · Afrique / UEMOA / CI</div></div></div>
      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{LENS.map(([k,l])=>(<button key={k} className={`pill ${k===lens?"on":""}`} onClick={()=>setLens(k)}>{l}</button>))}</div>
    </header>
    <div className="navwrap" style={{display:"flex",gap:18,borderBottom:`1px solid ${T.line}`,marginBottom:18,overflowX:"auto"}}>
      {NAV.map(([k,l])=>(<button key={k} className={`tab ${view===k?"on":""}`} onClick={()=>setView(k)}>{l}</button>))}
    </div>

    {view==="radar"&&<Radar_ lens={lens} setView={setView}/>}
    {view==="fil"&&<Fil/>}
    {view==="detection"&&<Detection/>}
    {view==="indicateurs"&&<Indicateurs/>}
    {view==="cadres"&&<Cadres/>}
    {view==="portefeuille"&&<Portefeuille/>}
    {view==="valeur"&&<Valeur/>}
    {view==="simulateur"&&<Simulateur/>}
    {view==="diagnostic"&&<Diagnostic/>}
    {view==="innovation"&&<Innovation/>}
    {view==="concurrence"&&<Concurrence/>}
    {view==="scenarios"&&<Scenarios/>}
    {view==="execution"&&<Execution/>}
    {view==="plan"&&<PlanAction/>}
    {view==="briefing"&&<Briefing/>}

    <footer style={{marginTop:22,paddingTop:14,borderTop:`1px solid ${T.line}`,fontSize:11.5,color:T.faint,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <span>Maquette · données d'exemple · cadres SWOT/PESTEL/Porter/BCG/Canvas + Tech Radar</span>
      <span>Focale : {LENS.find(l=>l[0]===lens)[1]}</span></footer>
  </div>);
}

/* ---- Radar exécutif ---- */
function Radar_({lens,setView}){
  const sorted=[...SIGNAUX].sort((a,b)=>b.score-a.score);
  const menaces=sorted.filter(s=>s.stance==="threat");
  const opps=sorted.filter(s=>s.stance==="opportunity");
  const cell=(imp,st)=>SIGNAUX.filter(s=>s.imp===imp&&s.stance===st).length;
  const intro={dg:"Situation, menaces et opportunités majeures, décisions en attente — l'essentiel pour arbitrer.",strategie:"Signaux prioritaires reliés aux cadres et aux initiatives.",innovation:"Signaux technologiques et d'innovation à fort potentiel."}[lens];
  return(<div>
    <div style={{fontSize:12,color:T.plum,marginBottom:14,background:T.panel,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 12px"}}>🎯 {intro}</div>
    <div className="g4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:14}}>
      <Card><Kpi label="Pipeline influencé par la veille" value={fmt(KPIS.pipelineInf)} accent={T.emerald} sub="opportunités issues de signaux"/></Card>
      <Card><Kpi label="Menaces (traitées / total)" value={KPIS.menacesTraitees+" / "+KPIS.menaces} accent={T.clay} sub="couverture décisionnelle"/></Card>
      <Card><Kpi label="Taux de victoire" value={pct(KPIS.winRate)} accent={T.gold} sub="vs concurrents (win/loss)"/></Card>
      <Card><Kpi label="Avancement OKR" value={pct(KPIS.okr)} accent={T.steel} sub="initiatives stratégiques"/></Card>
    </div>
    <div className="g2" style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:14,marginBottom:14}}>
      <Card><Eyebrow color={T.gold}>Top signaux prioritaires</Eyebrow>
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
          {sorted.slice(0,6).map(s=>(<div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.panel2,borderRadius:9,borderLeft:`3px solid ${STANCE[s.stance].c}`}}>
            <div style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:16,color:STANCE[s.stance].c,minWidth:30,textAlign:"center"}}>{s.score}</div>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:T.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.t}</div>
              <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}><Badge c={AX[s.ax].c}>{AX[s.ax].l}</Badge><Badge c={IMP[s.imp].c}>{IMP[s.imp].l}</Badge><Badge c={T.faint}>{s.src}</Badge></div></div>
          </div>))}</div>
        <button className="tab" style={{color:T.steel,marginTop:8}} onClick={()=>setView("fil")}>Voir le fil complet →</button></Card>
      <Card><Eyebrow color={T.clay}>Carte menaces / opportunités</Eyebrow>
        <div style={{marginTop:14,display:"grid",gridTemplateColumns:"70px 1fr 1fr",gap:6,alignItems:"center"}}>
          <div/><div style={{textAlign:"center",fontSize:11,color:T.emerald,fontWeight:600}}>Opportunité</div><div style={{textAlign:"center",fontSize:11,color:T.clay,fontWeight:600}}>Menace</div>
          {["high","medium","low"].map(imp=>(<React.Fragment key={imp}>
            <div style={{fontSize:11,color:IMP[imp].c,fontWeight:600,textAlign:"right"}}>{IMP[imp].l}</div>
            <div style={{background:T.emerald+(imp==="high"?"33":imp==="medium"?"22":"11"),borderRadius:8,padding:"14px 0",textAlign:"center",fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:18,color:T.emerald}}>{cell(imp,"opportunity")}</div>
            <div style={{background:T.clay+(imp==="high"?"33":imp==="medium"?"22":"11"),borderRadius:8,padding:"14px 0",textAlign:"center",fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:18,color:T.clay}}>{cell(imp,"threat")}</div>
          </React.Fragment>))}</div>
        <div style={{marginTop:14,fontSize:12,color:T.dim}}>{opps.length} opportunités · {menaces.length} menaces sur {SIGNAUX.length} signaux actifs.</div></Card>
    </div>
    <Card><Eyebrow color={T.steel}>Décisions en attente / récentes</Eyebrow>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
        {DECISIONS.map((d,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:12.5,padding:"7px 0",borderTop:i>0?`1px solid ${T.line}`:"none"}}>
          <Badge c={d.statut==="Actée"?T.emerald:d.statut==="En cours"?T.gold:T.clay}>{d.statut}</Badge>
          <span style={{flex:1,color:T.ink}}>{d.t}</span><span style={{color:T.faint}}>{d.by} · {d.lien}</span></div>))}</div></Card>
  </div>);
}

/* ---- Fil de veille ---- */
function Fil(){
  const [ax,setAx]=useState("all");const [st,setSt]=useState("all");
  const rows=SIGNAUX.filter(s=>(ax==="all"||s.ax===ax)&&(st==="all"||s.stance===st)).sort((a,b)=>b.score-a.score);
  return(<div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
      <span style={{fontSize:11.5,color:T.faint}}>Axe :</span>
      <button className={`pill ${ax==="all"?"on":""}`} onClick={()=>setAx("all")}>Tous</button>
      {Object.keys(AX).map(k=>(<button key={k} className={`pill ${ax===k?"on":""}`} onClick={()=>setAx(k)}>{AX[k].l}</button>))}
      <span style={{fontSize:11.5,color:T.faint,marginLeft:10}}>Posture :</span>
      {["all","opportunity","threat"].map(k=>(<button key={k} className={`pill ${st===k?"on":""}`} onClick={()=>setSt(k)}>{k==="all"?"Toutes":STANCE[k].l}</button>))}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {rows.map(s=>(<Card key={s.id} style={{borderLeft:`3px solid ${STANCE[s.stance].c}`}}>
        <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
          <div style={{textAlign:"center",minWidth:44}}><div style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:20,color:STANCE[s.stance].c,lineHeight:1}}>{s.score}</div><div style={{fontSize:9.5,color:T.faint,marginTop:2}}>priorité</div></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,color:T.ink,fontWeight:600}}>{s.t}</div>
            <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}><Badge c={AX[s.ax].c}>{AX[s.ax].l}</Badge><Badge c={IMP[s.imp].c}>Impact {IMP[s.imp].l}</Badge><Badge c={STANCE[s.stance].c}>{STANCE[s.stance].l}</Badge><Badge c={T.faint}>{s.ent} · {s.geo}</Badge><Badge c={T.steel}>Source {s.src}</Badge><Badge c={T.faint}>{s.date}</Badge></div>
            <div style={{marginTop:10,fontSize:12.5,color:T.dim}}><b style={{color:T.plum}}>So-what :</b> {s.sw}</div>
            <div style={{marginTop:4,fontSize:12.5,color:T.dim}}><b style={{color:T.gold}}>Action :</b> {s.act}</div>
          </div></div></Card>))}
    </div>
  </div>);
}

/* ---- Cadres stratégiques ---- */
function Cadres(){
  const [c,setC]=useState("swot");
  const CN=[["swot","SWOT"],["pestel","PESTEL"],["porter","Porter"],["bcg","BCG"],["canvas","Canvas"]];
  const swotC={Forces:T.emerald,Faiblesses:T.clay,Opportunités:T.steel,Menaces:T.gold};
  return(<div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{CN.map(([k,l])=>(<button key={k} className={`pill ${c===k?"on":""}`} onClick={()=>setC(k)}>{l}</button>))}
      <span style={{fontSize:11,color:T.faint,alignSelf:"center",marginLeft:8}}>Documents vivants — connectés aux données du cockpit</span></div>

    {c==="swot"&&<div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {Object.keys(SWOT).map(k=>(<Card key={k} style={{borderTop:`3px solid ${swotC[k]}`}}><Eyebrow color={swotC[k]}>{k}</Eyebrow>
        <ul style={{margin:"10px 0 0",paddingLeft:18,fontSize:12.5,color:T.dim,lineHeight:1.7}}>{SWOT[k].map((x,i)=>(<li key={i}>{x}</li>))}</ul></Card>))}</div>}

    {c==="pestel"&&<Card><Eyebrow color={T.gold}>PESTEL — Afrique de l'Ouest / Côte d'Ivoire</Eyebrow>
      <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>{PESTEL.map((p,i)=>(<div key={i}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span style={{color:T.ink,fontWeight:600}}>{p.f} <span style={{color:p.tr==="↑"?T.emerald:T.faint}}>{p.tr}</span></span><span style={{color:T.dim,fontSize:11.5}}>impact {pct(p.imp)}</span></div>
        <div style={{height:7,background:T.panel2,borderRadius:4,marginBottom:4}}><div style={{width:`${p.imp*100}%`,height:"100%",background:T.gold,borderRadius:4}}/></div>
        <div style={{fontSize:12,color:T.dim}}>{p.d}</div></div>))}</div></Card>}

    {c==="porter"&&<div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <Card><Eyebrow color={T.clay}>Porter — 5 forces (quantifiées)</Eyebrow>
        <div style={{height:280,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><RadarChart data={PORTER} outerRadius="72%">
          <PolarGrid stroke={T.line}/><PolarAngleAxis dataKey="force" tick={{fill:T.dim,fontSize:11}}/><PolarRadiusAxis domain={[0,100]} tick={{fill:T.faint,fontSize:9}} axisLine={false}/>
          <Radar dataKey="v" stroke={T.clay} fill={T.clay} fillOpacity={0.35}/></RadarChart></ResponsiveContainer></div></Card>
      <Card><Eyebrow color={T.clay}>Lecture</Eyebrow>
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10,fontSize:12.5,color:T.dim,lineHeight:1.5}}>
          <div><b style={{color:T.ink}}>Pouvoir fournisseurs (80)</b> — élevé : concentration Top-3 distributeurs, marges & lignes de crédit dictées. <span style={{color:T.steel}}>Alimenté par le module Crédit Fournisseurs.</span></div>
          <div><b style={{color:T.ink}}>Pouvoir clients (70)</b> — grands comptes & AO, pression prix. <span style={{color:T.steel}}>Alimenté par la concentration Top-5 clients.</span></div>
          <div><b style={{color:T.ink}}>Rivalité (75)</b> — intégrateurs + telcos B2B ; densité de signaux concurrents élevée.</div>
          <div><b style={{color:T.ink}}>Substituts (55)</b> — cloud public direct, SaaS, régie interne.</div>
          <div><b style={{color:T.ink}}>Nouveaux entrants (50)</b> — barrières moyennes (certifs, références, capital fournisseur).</div></div></Card></div>}

    {c==="bcg"&&<Card><Eyebrow color={T.emerald}>Matrice BCG — portefeuille d'activités (taille = marge)</Eyebrow>
      <div style={{height:320,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{left:10,right:20,top:10,bottom:20}}>
        <CartesianGrid stroke={T.line}/>
        <XAxis type="number" dataKey="part" name="Part relative" domain={[0,1]} reversed tick={{fill:T.faint,fontSize:10}} tickFormatter={pct} label={{value:"Part de marché relative",position:"insideBottom",offset:-8,fill:T.dim,fontSize:11}}/>
        <YAxis type="number" dataKey="croissance" name="Croissance" domain={[0,1]} tick={{fill:T.faint,fontSize:10}} tickFormatter={pct} label={{value:"Croissance du marché",angle:-90,position:"insideLeft",fill:T.dim,fontSize:11}}/>
        <ZAxis type="number" dataKey="marge" range={[400,2600]}/>
        <ReferenceLine x={0.5} stroke={T.faint}/><ReferenceLine y={0.5} stroke={T.faint}/>
        <Tooltip content={<Tip/>} cursor={{stroke:T.faint}}/>
        <Scatter data={BCG}>{BCG.map((b,i)=>(<Cell key={i} fill={QCOL[b.q]}/>))}</Scatter></ScatterChart></ResponsiveContainer></div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12,marginTop:6}}>{BCG.map((b,i)=>(<span key={i} style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:QCOL[b.q],marginRight:5}}/>{b.n} <span style={{color:T.faint}}>({b.q})</span></span>))}</div></Card>}

    {c==="canvas"&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      {CANVAS.map(([t,d],i)=>(<Card key={i} style={{gridColumn:i===2?"3":i===8?"1 / span 3":"auto"}}><Eyebrow color={T.plum}>{t}</Eyebrow><div style={{marginTop:8,fontSize:12.5,color:T.dim,lineHeight:1.5}}>{d}</div></Card>))}</div>}
  </div>);
}

/* ---- Tech Radar & Innovation ---- */
function Innovation(){
  const R=150,CX=170,CY=170;
  const quadCount={};RADAR_TECH.forEach(b=>{quadCount[b.quad]=(quadCount[b.quad]||0)+1;});
  const idxInQuad={};
  const blips=RADAR_TECH.map(b=>{idxInQuad[b.quad]=(idxInQuad[b.quad]||0);const i=idxInQuad[b.quad]++;const n=quadCount[b.quad];
    const a0=b.quad*90+90/(n+1)*(i+1);const a=(a0)*Math.PI/180;const rad=RING[b.ring].r*R;
    return {...b,x:CX+rad*Math.cos(a),y:CY-rad*Math.sin(a)};});
  const rice=INNOV.map(o=>({...o,rice:Math.round(o.reach*o.impact*o.conf/o.effort*10)/10}));
  return(<div>
    <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
      <Card><Eyebrow color={T.plum}>Tech Radar</Eyebrow>
        <svg viewBox="0 0 340 360" style={{width:"100%",height:320,marginTop:6}}>
          {["suspendre","evaluer","essayer","adopter"].map(r=>(<circle key={r} cx={CX} cy={CY} r={RING[r].r*R} fill="none" stroke={T.line}/>))}
          <line x1={CX-R} y1={CY} x2={CX+R} y2={CY} stroke={T.line}/><line x1={CX} y1={CY-R} x2={CX} y2={CY+R} stroke={T.line}/>
          {QUAD_TECH.map((q,i)=>{const a=(i*90+45)*Math.PI/180;return(<text key={i} x={CX+(R+8)*Math.cos(a)} y={CY-(R+8)*Math.sin(a)} fill={T.faint} fontSize="10" textAnchor="middle">{q}</text>);})}
          {blips.map((b,i)=>(<g key={i}><circle cx={b.x} cy={b.y} r="5" fill={RING[b.ring].c}/><text x={b.x+7} y={b.y+3} fill={T.dim} fontSize="8.5">{b.n}</text></g>))}
        </svg>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,justifyContent:"center"}}>{Object.keys(RING).map(r=>(<span key={r} style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:RING[r].c,marginRight:4}}/>{RING[r].l}</span>))}</div></Card>
      <Card><Eyebrow color={T.emerald}>Portefeuille d'innovation (RICE)</Eyebrow>
        <div style={{height:250,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{left:6,right:16,top:10,bottom:16}}>
          <CartesianGrid stroke={T.line}/>
          <XAxis type="number" dataKey="effort" name="Effort" domain={[0,10]} tick={{fill:T.faint,fontSize:10}} label={{value:"Effort →",position:"insideBottom",offset:-6,fill:T.dim,fontSize:11}}/>
          <YAxis type="number" dataKey="impact" name="Impact" domain={[0,10]} tick={{fill:T.faint,fontSize:10}} label={{value:"Impact →",angle:-90,position:"insideLeft",fill:T.dim,fontSize:11}}/>
          <ZAxis type="number" dataKey="rice" range={[120,900]}/><Tooltip content={<Tip/>} cursor={{stroke:T.faint}}/>
          <Scatter data={rice}>{rice.map((o,i)=>(<Cell key={i} fill={o.effort<=o.impact?T.emerald:T.gold}/>))}</Scatter></ScatterChart></ResponsiveContainer></div>
        <div style={{marginTop:6,fontSize:11.5,color:T.faint}}>Bulle = score RICE. Quadrant haut-gauche (impact fort / effort faible) = à lancer en priorité.</div></Card>
    </div>
    <Card><Eyebrow color={T.emerald}>Paris d'innovation — priorisation RICE</Eyebrow>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>{rice.sort((a,b)=>b.rice-a.rice).map((o,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:12.5,padding:"7px 0",borderTop:i>0?`1px solid ${T.line}`:"none"}}>
        <div style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,color:T.emerald,minWidth:40}}>{o.rice}</div><span style={{flex:1,color:T.ink}}>{o.n}</span>
        <span style={{color:T.faint}}>R{o.reach}·I{o.impact}·C{pct(o.conf)}·E{o.effort}</span></div>))}</div></Card>
  </div>);
}

/* ---- Concurrence ---- */
function Concurrence(){
  return(<div>
    <Card style={{marginBottom:14}}><Eyebrow color={T.clay}>Taux de victoire par concurrent (Win/Loss — relié au Pipeline)</Eyebrow>
      <div style={{height:200,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><BarChart data={CONCURRENTS.map(c=>({n:c.n,win:Math.round(c.win*100),deals:c.deals}))} margin={{left:-10,right:10}}>
        <CartesianGrid stroke={T.line} vertical={false}/><XAxis dataKey="n" tick={{fill:T.dim,fontSize:11}} axisLine={false} tickLine={false}/><YAxis domain={[0,100]} tickFormatter={(v)=>v+"%"} tick={{fill:T.faint,fontSize:10}} axisLine={false} tickLine={false}/>
        <Tooltip cursor={{fill:T.panel2}} content={<Tip/>}/><Bar dataKey="win" name="Taux victoire" fill={T.clay} radius={[4,4,0,0]} barSize={46}/></BarChart></ResponsiveContainer></div></Card>
    <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
      {CONCURRENTS.map((c,i)=>(<Card key={i} style={{borderTop:`3px solid ${T.clay}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><Eyebrow color={T.clay}>{c.n}</Eyebrow><Badge c={c.win>=0.5?T.emerald:T.clay}>{pct(c.win)} · {c.deals} deals</Badge></div>
        <div style={{marginTop:10,fontSize:12.5,color:T.dim,lineHeight:1.6}}>
          <div><b style={{color:T.gold}}>Force :</b> {c.force}</div>
          <div><b style={{color:T.steel}}>Faiblesse :</b> {c.faible}</div>
          <div style={{marginTop:6,padding:"8px 10px",background:T.panel2,borderRadius:8}}><b style={{color:T.emerald}}>Comment gagner :</b> {c.gagner}</div></div></Card>))}</div>
  </div>);
}

/* ---- Scénarios ---- */
function Scenarios(){
  const w=SCENARIOS.worlds;
  return(<div>
    <div style={{fontSize:12,color:T.dim,marginBottom:14}}>Planification par scénarios sur deux axes d'incertitude majeurs : <b style={{color:T.ink}}>{SCENARIOS.axisY}</b> (vertical) × <b style={{color:T.ink}}>{SCENARIOS.axisX}</b> (horizontal).</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {[1,0,3,2].map((idx,pos)=>(<Card key={pos} style={{borderTop:`3px solid ${w[idx].c}`,minHeight:150}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><Eyebrow color={w[idx].c}>{w[idx].q}</Eyebrow><Badge c={w[idx].c}>proba {pct(SCEN_PROB[pos])}</Badge></div>
        <div style={{marginTop:10,fontSize:12.5,color:T.dim,lineHeight:1.6}}>{w[idx].d}</div>
        <div style={{marginTop:8,height:6,background:T.panel2,borderRadius:4}}><div style={{width:`${SCEN_PROB[pos]*100}%`,height:"100%",background:w[idx].c,borderRadius:4}}/></div></Card>))}</div>
    <Card style={{marginTop:14}}><Eyebrow color={T.gold}>Espérance & stratégie robuste</Eyebrow>
      <div style={{marginTop:10,fontSize:12.5,color:T.dim,lineHeight:1.7}}>Le monde <b style={{color:T.emerald}}>« Souveraineté forte × prix hyperscalers élevés » (40%)</b> est le plus probable et le plus favorable : il justifie d'<b style={{color:T.ink}}>investir dès maintenant dans le cloud souverain et la cybersécurité</b>. Une <b style={{color:T.ink}}>stratégie robuste</b> (gagnante dans ≥3 mondes sur 4) : <b style={{color:T.ink}}>miser sur le managed/cyber différenciant</b>, qui reste porteur même si les hyperscalers pressent les prix.</div></Card>
    <Card style={{marginTop:14}}><Eyebrow color={T.steel}>Simulation « what-if »</Eyebrow>
      <div style={{marginTop:10,fontSize:12.5,color:T.dim,lineHeight:1.7}}>
        Exemple : <b style={{color:T.ink}}>« Un éditeur durcit son programme canal (−5 pts de rebate) »</b> → impact chiffré sur la marge des BU concernées et sur le pipeline, en s'appuyant sur les données du cockpit.<br/>
        <b style={{color:T.ink}}>« Un concurrent remporte le compte X »</b> → impact sur le backlog et la part de marché.<br/>
        <span style={{color:T.faint}}>(Moteur de simulation branché sur Prévision / Atterrissage dans l'implémentation.)</span></div></Card>
  </div>);
}

/* ---- Exécution & Décisions ---- */
function Execution(){
  return(<div>
    <Card style={{marginBottom:14}}><Eyebrow color={T.emerald}>Initiatives stratégiques & OKR</Eyebrow>
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:12}}>{INITIATIVES.map((it,i)=>(<div key={i}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:5,flexWrap:"wrap",gap:6}}>
          <span style={{color:T.ink,fontWeight:600}}>{it.t} <Badge c={T.plum}>{it.pilier}</Badge> <Badge c={T.faint}>{it.h}</Badge></span>
          <span style={{color:T.dim,fontSize:11.5}}>{it.owner} · {pct(it.prog)}</span></div>
        <div style={{fontSize:12,color:T.dim,marginBottom:4}}>OKR : {it.okr}</div>
        <div style={{height:8,background:T.panel2,borderRadius:4}}><div style={{width:`${it.prog*100}%`,height:"100%",background:it.prog>=0.5?T.emerald:T.gold,borderRadius:4}}/></div></div>))}</div></Card>
    <Card><Eyebrow color={T.steel}>Registre de décisions stratégiques</Eyebrow>
      <div style={{marginTop:12,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead><tr style={{color:T.faint,fontSize:11,textAlign:"left"}}><th style={{padding:"6px 8px"}}>Décision</th><th style={{padding:"6px 8px"}}>Instance</th><th style={{padding:"6px 8px"}}>Signaux liés</th><th style={{padding:"6px 8px"}}>Date</th><th style={{padding:"6px 8px"}}>Statut</th></tr></thead>
        <tbody>{DECISIONS.map((d,i)=>(<tr key={i} style={{borderTop:`1px solid ${T.line}`}}>
          <td style={{padding:"7px 8px",color:T.ink}}>{d.t}</td><td style={{padding:"7px 8px",color:T.dim}}>{d.by}</td><td style={{padding:"7px 8px",color:T.faint}}>{d.lien}</td><td style={{padding:"7px 8px",color:T.faint}}>{d.date}</td>
          <td style={{padding:"7px 8px"}}><Badge c={d.statut==="Actée"?T.emerald:d.statut==="En cours"?T.gold:T.clay}>{d.statut}</Badge></td></tr>))}</tbody></table></div></Card>
  </div>);
}

/* ---- Briefing exécutif ---- */
function Briefing(){
  const s=[...SIGNAUX].sort((a,b)=>b.score-a.score);
  const opps=s.filter(x=>x.stance==="opportunity").slice(0,3);
  const men=s.filter(x=>x.stance==="threat").slice(0,3);
  return(<div>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
        <Eyebrow color={T.gold}>Briefing exécutif — semaine du 30/06/2026</Eyebrow>
        <span style={{fontSize:11,color:T.faint}}>Généré par IA · revu (maquette) · exportable en board pack PDF</span></div>
      <div style={{marginTop:14,fontSize:13,color:T.dim,lineHeight:1.7}}>
        <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${T.panel2},${T.panel})`,border:`1px solid ${T.line}`,borderRadius:12,marginBottom:14}}>
          <div style={{fontSize:10.5,letterSpacing:".13em",textTransform:"uppercase",color:T.gold,fontWeight:600,marginBottom:6}}>Idée directrice (pyramide de Minto)</div>
          <div style={{fontSize:15,color:T.ink,fontWeight:600,lineHeight:1.5}}>Neurones doit basculer son mix vers le récurrent (cyber & managed) et la souveraineté, en capturant la vague de financements réglementaires — c'est la voie la plus probable et la plus créatrice de valeur pour doubler le revenu rentable en 3 ans.</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginTop:12}}>
            {[["1. La demande est là",T.emerald,"Réglementation (ARTCI/BCEAO), financements (BAD 200 M$), demande de SOC managé — convergence favorable."],
              ["2. Nous pouvons gagner",T.gold,"Expertise cyber, certifications, références bancaires, portage financier — position forte sur les cellules à forte valeur."],
              ["3. Il faut agir vite",T.clay,"Pressions fournisseurs (EOL, rebates) et concurrence : fenêtre d'action limitée, décisions à prendre ce trimestre."]].map((a,i)=>(
              <div key={i} style={{background:T.panel2,borderRadius:9,padding:"10px 12px",borderTop:`3px solid ${a[1]}`}}>
                <div style={{fontSize:12.5,color:a[1],fontWeight:600,marginBottom:5}}>{a[0]}</div><div style={{fontSize:11.5,color:T.dim,lineHeight:1.5}}>{a[2]}</div></div>))}
          </div>
        </div>
        <p style={{margin:"0 0 12px"}}>Le trimestre est porté par une <b style={{color:T.emerald}}>fenêtre d'opportunités réglementaires et de financement</b> (BAD, ARTCI, BCEAO) qui converge avec notre stratégie cybersécurité et souveraineté. En regard, deux <b style={{color:T.clay}}>pressions fournisseurs</b> (EOL Cisco, tarifs Fortinet) appellent des actions d'anticipation sur le sourcing et les marges.</p>
        <div className="g3" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:6}}>
          <div><div style={{fontSize:12,color:T.emerald,fontWeight:600,marginBottom:6}}>3 opportunités majeures</div>
            <ul style={{margin:0,paddingLeft:16,lineHeight:1.7,color:T.dim,fontSize:12.5}}>{opps.map(o=>(<li key={o.id}>{o.t} <span style={{color:T.faint}}>({o.score})</span></li>))}</ul></div>
          <div><div style={{fontSize:12,color:T.clay,fontWeight:600,marginBottom:6}}>3 menaces à traiter</div>
            <ul style={{margin:0,paddingLeft:16,lineHeight:1.7,color:T.dim,fontSize:12.5}}>{men.map(o=>(<li key={o.id}>{o.t} <span style={{color:T.faint}}>({o.score})</span></li>))}</ul></div>
        </div>
        <div style={{marginTop:14,padding:"12px 14px",background:T.panel2,borderRadius:10,borderLeft:`3px solid ${T.gold}`}}>
          <div style={{fontSize:12,color:T.gold,fontWeight:600,marginBottom:6}}>Recommandations au comité</div>
          <ol style={{margin:0,paddingLeft:16,lineHeight:1.8,color:T.ink,fontSize:12.5}}>
            <li>Constituer un consortium pour capter le programme de digitalisation BAD (200 M$).</li>
            <li>Accélérer l'industrialisation du SOC managé (récurrence + marge) et la conformité BCEAO.</li>
            <li>Sécuriser le sourcing avant l'EOL Cisco et renégocier les lignes de crédit exposées.</li>
            <li>Décider de l'investissement cloud souverain (aligné ARTCI + Microsoft).</li>
          </ol></div>
      </div></Card>
  </div>);
}

/* ================= NIVEAU CONSEIL (McKinsey-grade) ================= */
/* Données */
const AMBITION_LABEL="CAS annualisé — trajectoire 3 ans (illustratif)";
const BRIDGE=[
  {name:"CAS actuel",kind:"start",v:8000},
  {name:"SOC / Managed",d:2500},
  {name:"Cloud souverain",d:1500},
  {name:"Programme BAD / AO",d:3000},
  {name:"Cross-sell base installée",d:1200},
  {name:"Attrition / menaces",d:-900},
  {name:"Ambition 3 ans",kind:"end",v:15300},
];
const VAS=[ // value-at-stake : proba × impact (M FCFA)
  {n:"Programme digitalisation BAD",type:"opp",p:0.4,impact:3500},
  {n:"RFP SD-WAN Orange CI",type:"opp",p:0.5,impact:1200},
  {n:"Conformité cyber BCEAO (banques)",type:"opp",p:0.55,impact:2000},
  {n:"Cloud souverain (ARTCI)",type:"opp",p:0.35,impact:1800},
  {n:"SOC managé UEMOA",type:"opp",p:0.6,impact:1500},
  {n:"Perte de comptes (rival datacenter)",type:"threat",p:0.3,impact:-1400},
  {n:"Érosion marge (rebates/tarifs éditeurs)",type:"threat",p:0.5,impact:-700},
  {n:"Ruptures d'appro (EOL/pénuries)",type:"threat",p:0.4,impact:-600},
];
const GE9=[
  {n:"Cybersécurité & Managed",attr:2.6,str:2.2,val:900,z:"Investir / croître"},
  {n:"Cloud souverain",attr:2.4,str:1.2,val:400,z:"Sélectif / construire"},
  {n:"Intégration ICT",attr:1.6,str:2.4,val:1200,z:"Sélectif / rentabiliser"},
  {n:"Data & IA",attr:2.2,str:0.9,val:250,z:"Sélectif / construire"},
  {n:"Revente hardware banalisé",attr:0.9,str:1.4,val:300,z:"Récolter / rationaliser"},
];
const zColor=(a,s)=>{const t=a+s;return t>=4.2?T.emerald:t>=2.6?T.gold:T.clay;};
const HORIZONS=[
  {h:"Horizon 1 — Cœur",share:0.60,c:T.emerald,d:"Défendre et optimiser l'intégration réseau/infra & le support : efficacité, marge, fidélisation grands comptes.",items:["Excellence delivery","Renouvellements sécurisés","Optimisation sourcing"]},
  {h:"Horizon 2 — Émergent",share:0.30,c:T.gold,d:"Construire les moteurs de croissance rentable : SOC managé, cloud souverain, conformité BCEAO/ARTCI.",items:["SOC managé UEMOA","Offre cloud souverain","Conformité packagée"]},
  {h:"Horizon 3 — Options",share:0.10,c:T.steel,d:"Créer des options de rupture : IA d'entreprise, nouveaux modèles récurrents, plateformes.",items:["Copilots métier IA","Plateforme managed","Nouveaux modèles as-a-service"]},
];
const SEGMENTS=["Banques","Télécoms","Institutions/Bailleurs","Secteur public","Grandes entreprises"];
const OFFRES=["Réseau/Infra","Cybersécurité","Cloud","Managed/SOC"];
// score attractivité×position (0-5) par cellule segment×offre
const GRAN={
  "Banques":{"Réseau/Infra":3,"Cybersécurité":5,"Cloud":4,"Managed/SOC":5},
  "Télécoms":{"Réseau/Infra":4,"Cybersécurité":4,"Cloud":3,"Managed/SOC":4},
  "Institutions/Bailleurs":{"Réseau/Infra":4,"Cybersécurité":4,"Cloud":4,"Managed/SOC":3},
  "Secteur public":{"Réseau/Infra":3,"Cybersécurité":4,"Cloud":4,"Managed/SOC":3},
  "Grandes entreprises":{"Réseau/Infra":3,"Cybersécurité":3,"Cloud":3,"Managed/SOC":3},
};
const ISSUE={q:"Comment doubler le revenu rentable en 3 ans ?",branches:[
  {t:"Développer le récurrent (marge & prévisibilité)",h:["Industrialiser le SOC/Managed","Contrats pluriannuels de support"]},
  {t:"Monter en valeur (mix vers cyber/cloud)",h:["Basculer le mix hors hardware banalisé","Packager conformité & souveraineté"]},
  {t:"Conquérir de nouveaux comptes/marchés",h:["Capter les AO financés (BAD, État)","Étendre la couverture régionale UEMOA/CEMAC"]},
]};
const S7=[
  {s:"Stratégie",v:70},{s:"Structure",v:60},{s:"Systèmes",v:55},{s:"Style",v:65},{s:"Staff",v:60},{s:"Skills",v:58},{s:"Valeurs",v:75},
];
const MATURITE=[
  {c:"Avant-vente",v:4},{c:"Delivery",v:4},{c:"Cybersécurité",v:4},{c:"Cloud",v:3},{c:"Managed/SOC",v:3},{c:"Data/IA",v:2},{c:"Sourcing/Finance",v:3},
];
const SCEN_PROB=[0.30,0.40,0.15,0.15]; // proba des 4 mondes (ordre affichage [1,0,3,2] géré côté vue)

/* ---- Portefeuille & Croissance (GE-McKinsey · Three Horizons · Granularité) ---- */
function Portefeuille(){
  const [c,setC]=useState("ge9");
  const CN=[["ge9","Matrice GE-McKinsey"],["horizons","Three Horizons"],["gran","Granularité de la croissance"]];
  const gmax=5;
  return(<div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{CN.map(([k,l])=>(<button key={k} className={`pill ${c===k?"on":""}`} onClick={()=>setC(k)}>{l}</button>))}</div>
    {c==="ge9"&&<Card><Eyebrow color={T.emerald}>Matrice GE-McKinsey — attractivité du marché × position concurrentielle (taille = marge)</Eyebrow>
      <div style={{height:340,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{left:10,right:20,top:10,bottom:20}}>
        <CartesianGrid stroke={T.line}/>
        <XAxis type="number" dataKey="str" name="Position" domain={[0,3]} ticks={[1,2]} tick={{fill:T.faint,fontSize:10}} label={{value:"Position concurrentielle →",position:"insideBottom",offset:-8,fill:T.dim,fontSize:11}}/>
        <YAxis type="number" dataKey="attr" name="Attractivité" domain={[0,3]} ticks={[1,2]} tick={{fill:T.faint,fontSize:10}} label={{value:"Attractivité du marché →",angle:-90,position:"insideLeft",fill:T.dim,fontSize:11}}/>
        <ZAxis type="number" dataKey="val" range={[300,2400]}/>
        <ReferenceLine x={1} stroke={T.faint}/><ReferenceLine x={2} stroke={T.faint}/><ReferenceLine y={1} stroke={T.faint}/><ReferenceLine y={2} stroke={T.faint}/>
        <Tooltip content={<Tip/>} cursor={{stroke:T.faint}}/>
        <Scatter data={GE9}>{GE9.map((g,i)=>(<Cell key={i} fill={zColor(g.attr,g.str)}/>))}</Scatter></ScatterChart></ResponsiveContainer></div>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>{GE9.map((g,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12.5}}>
        <span style={{color:T.ink}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:zColor(g.attr,g.str),marginRight:6}}/>{g.n}</span><Badge c={zColor(g.attr,g.str)}>{g.z}</Badge></div>))}</div></Card>}
    {c==="horizons"&&<div><Card style={{marginBottom:14}}><Eyebrow color={T.gold}>Three Horizons — allocation de la valeur & de l'ambition</Eyebrow>
      <div style={{display:"flex",height:26,borderRadius:6,overflow:"hidden",marginTop:14}}>{HORIZONS.map((h,i)=>(<div key={i} style={{width:`${h.share*100}%`,background:h.c,display:"grid",placeItems:"center",fontSize:11,color:"#0E1613",fontWeight:700}}>{pct(h.share)}</div>))}</div></Card>
      <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>{HORIZONS.map((h,i)=>(<Card key={i} style={{borderTop:`3px solid ${h.c}`}}>
        <Eyebrow color={h.c}>{h.h}</Eyebrow><div style={{marginTop:8,fontSize:12.5,color:T.dim,lineHeight:1.55}}>{h.d}</div>
        <ul style={{margin:"10px 0 0",paddingLeft:16,fontSize:12,color:T.dim,lineHeight:1.7}}>{h.items.map((x,j)=>(<li key={j}>{x}</li>))}</ul></Card>))}</div></div>}
    {c==="gran"&&<Card><Eyebrow color={T.steel}>Granularité de la croissance — où gagner (segment × offre)</Eyebrow>
      <div style={{marginTop:14,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr><th style={{textAlign:"left",padding:"6px 8px",color:T.faint,fontSize:11}}>Segment \\ Offre</th>{OFFRES.map(o=>(<th key={o} style={{padding:"6px 8px",color:T.faint,fontSize:11}}>{o}</th>))}</tr></thead>
        <tbody>{SEGMENTS.map(s=>(<tr key={s}><td style={{padding:"6px 8px",color:T.ink,fontWeight:600}}>{s}</td>
          {OFFRES.map(o=>{const v=GRAN[s][o];const c=v>=5?T.emerald:v>=4?T.gold:v>=3?T.steel:T.faint;return(<td key={o} style={{padding:"4px"}}>
            <div style={{background:c+"22",border:`1px solid ${c}55`,borderRadius:7,textAlign:"center",padding:"10px 0",color:c,fontWeight:700,fontFamily:"'Bricolage Grotesque'"}}>{v}</div></td>);})}</tr>))}</tbody></table></div>
      <div style={{marginTop:10,fontSize:12,color:T.dim}}>Score attractivité × position (1-5). Les cellules <b style={{color:T.emerald}}>5</b> (ex. Cyber & Managed dans les banques) sont les <b style={{color:T.ink}}>micro-batailles prioritaires</b> — concentrer les ressources là où l'on peut gagner.</div></Card>}
  </div>);
}

/* ---- Création de valeur (value bridge · value-at-stake · driver tree) ---- */
function Valeur(){
  let cum=0;const wf=BRIDGE.map(b=>{if(b.kind==="start"||b.kind==="end"){cum=b.v;return {name:b.name,base:0,pos:b.v,neg:0,total:b.v,kind:b.kind};}
    const d=b.d;const base=d>=0?cum:cum+d;cum+=d;return {name:b.name,base,pos:d>=0?d:0,neg:d<0?-d:0,total:cum,d};});
  const vas=[...VAS].map(v=>({...v,ev:Math.round(v.p*v.impact)})).sort((a,b)=>Math.abs(b.ev)-Math.abs(a.ev));
  const evOpp=vas.filter(v=>v.type==="opp").reduce((s,v)=>s+v.ev,0);
  const evThreat=vas.filter(v=>v.type==="threat").reduce((s,v)=>s+v.ev,0);
  return(<div>
    <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:14}}>
      <Card><Kpi label="Valeur attendue — opportunités" value={fmt(evOpp*1e6)} accent={T.emerald} sub="Σ (proba × impact)"/></Card>
      <Card><Kpi label="Valeur à risque — menaces" value={fmt(evThreat*1e6)} accent={T.clay} sub="Σ (proba × impact)"/></Card>
      <Card><Kpi label="Valeur nette en jeu" value={fmt((evOpp+evThreat)*1e6)} accent={T.gold} sub="net at stake"/></Card>
    </div>
    <Card style={{marginBottom:14}}><Eyebrow color={T.gold}>Pont de création de valeur — {AMBITION_LABEL}</Eyebrow>
      <div style={{height:280,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><BarChart data={wf} margin={{left:0,right:10,top:10,bottom:30}}>
        <CartesianGrid stroke={T.line} vertical={false}/><XAxis dataKey="name" tick={{fill:T.dim,fontSize:10}} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60}/><YAxis tickFormatter={(v)=>fmt(v*1e6)} tick={{fill:T.faint,fontSize:10}} axisLine={false} tickLine={false}/>
        <Tooltip content={<Tip/>} cursor={{fill:T.panel2}}/>
        <Bar dataKey="base" stackId="a" fill="transparent"/>
        <Bar dataKey="pos" stackId="a" radius={[3,3,0,0]}>{wf.map((r,i)=>(<Cell key={i} fill={r.kind==="start"?T.steel:r.kind==="end"?T.gold:T.emerald}/>))}</Bar>
        <Bar dataKey="neg" stackId="a" radius={[3,3,0,0]}>{wf.map((r,i)=>(<Cell key={i} fill={T.clay}/>))}</Bar>
      </BarChart></ResponsiveContainer></div>
      <div style={{fontSize:11.5,color:T.faint}}>En M FCFA (illustratif). Vert = leviers de croissance, rouge = pertes/menaces, or = ambition cible.</div></Card>
    <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <Card><Eyebrow color={T.emerald}>Value-at-stake (proba × impact)</Eyebrow>
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>{vas.map((v,i)=>(<div key={i}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,marginBottom:3}}><span style={{color:T.ink}}>{v.n} <span style={{color:T.faint}}>· {pct(v.p)}</span></span><span style={{color:v.ev>=0?T.emerald:T.clay,fontVariantNumeric:"tabular-nums"}}>{v.ev>=0?"+":""}{fmt(v.ev*1e6)}</span></div>
          <div style={{height:6,background:T.panel2,borderRadius:4}}><div style={{width:`${Math.min(Math.abs(v.ev)/2000*100,100)}%`,height:"100%",background:v.ev>=0?T.emerald:T.clay,borderRadius:4}}/></div></div>))}</div></Card>
      <Card><Eyebrow color={T.plum}>Arbre des leviers de valeur</Eyebrow>
        <div style={{marginTop:12,fontSize:12.5,lineHeight:1.5}}>
          <div style={{padding:"8px 10px",background:T.panel2,borderRadius:8,color:T.ink,fontWeight:600}}>Résultat = Revenu récurrent + Revenu projet − Coûts</div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <div style={{flex:1}}><div style={{padding:"7px 9px",background:T.panel2,borderRadius:8,borderLeft:`3px solid ${T.emerald}`,color:T.dim}}><b style={{color:T.emerald}}>Récurrent</b><br/>Managed × ARR × rétention</div></div>
            <div style={{flex:1}}><div style={{padding:"7px 9px",background:T.panel2,borderRadius:8,borderLeft:`3px solid ${T.gold}`,color:T.dim}}><b style={{color:T.gold}}>Projet</b><br/>Pipeline pondéré × taux transfo × marge</div></div>
            <div style={{flex:1}}><div style={{padding:"7px 9px",background:T.panel2,borderRadius:8,borderLeft:`3px solid ${T.clay}`,color:T.dim}}><b style={{color:T.clay}}>Coûts</b><br/>Achats + masse salariale + financement</div></div></div>
          <div style={{marginTop:10,fontSize:11.5,color:T.faint}}>Chaque levier est actionnable et relié aux modules (Pipeline, Rentabilité, Crédit Fournisseurs).</div></div></Card>
    </div>
  </div>);
}

/* ---- Diagnostic (7S · arbre MECE · maturité) ---- */
function Diagnostic(){
  const [c,setC]=useState("issue");
  const CN=[["issue","Arbre du problème (MECE)"],["s7","McKinsey 7S"],["mat","Maturité des capacités"]];
  return(<div>
    <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{CN.map(([k,l])=>(<button key={k} className={`pill ${c===k?"on":""}`} onClick={()=>setC(k)}>{l}</button>))}</div>
    {c==="issue"&&<Card><Eyebrow color={T.gold}>Résolution hypothético-déductive — arbre MECE</Eyebrow>
      <div style={{display:"flex",gap:14,marginTop:14,alignItems:"stretch"}}>
        <div style={{minWidth:180,display:"flex",alignItems:"center"}}><div style={{padding:"12px 14px",background:`linear-gradient(135deg,${T.gold},#8E6F2A)`,color:"#0E1613",borderRadius:10,fontWeight:700,fontSize:13.5}}>{ISSUE.q}</div></div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>{ISSUE.branches.map((b,i)=>(<div key={i} style={{display:"flex",gap:10,alignItems:"stretch"}}>
          <div style={{minWidth:230,padding:"9px 11px",background:T.panel2,borderRadius:8,borderLeft:`3px solid ${T.steel}`,color:T.ink,fontSize:12.5,fontWeight:600,display:"flex",alignItems:"center"}}>{b.t}</div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:6,justifyContent:"center"}}>{b.h.map((h,j)=>(<div key={j} style={{fontSize:12,color:T.dim,padding:"5px 9px",background:T.panel2,borderRadius:7}}>Hypothèse : {h}</div>))}</div></div>))}</div></div>
      <div style={{marginTop:12,fontSize:11.5,color:T.faint}}>Décomposition MECE (mutuellement exclusive, collectivement exhaustive) : chaque hypothèse est testable par les données du cockpit et les signaux de veille.</div></Card>}
    {c==="s7"&&<div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <Card><Eyebrow color={T.plum}>McKinsey 7S — alignement organisationnel</Eyebrow>
        <div style={{height:290,marginTop:8}}><ResponsiveContainer width="100%" height="100%"><RadarChart data={S7} outerRadius="72%">
          <PolarGrid stroke={T.line}/><PolarAngleAxis dataKey="s" tick={{fill:T.dim,fontSize:11}}/><PolarRadiusAxis domain={[0,100]} tick={{fill:T.faint,fontSize:9}} axisLine={false}/>
          <Radar dataKey="v" stroke={T.plum} fill={T.plum} fillOpacity={0.35}/></RadarChart></ResponsiveContainer></div></Card>
      <Card><Eyebrow color={T.plum}>Lecture</Eyebrow><div style={{marginTop:12,fontSize:12.5,color:T.dim,lineHeight:1.6}}>
        Alignement « soft » (Style, Staff, Skills) à renforcer pour exécuter la bascule vers le récurrent et le cloud/IA : <b style={{color:T.ink}}>compétences rares (cyber/cloud/IA)</b> et <b style={{color:T.ink}}>systèmes/process</b> sont les maillons à consolider. Les <b style={{color:T.ink}}>valeurs partagées</b> et la <b style={{color:T.ink}}>stratégie</b> sont des points forts sur lesquels capitaliser.</div></Card></div>}
    {c==="mat"&&<Card><Eyebrow color={T.steel}>Maturité des capacités (0-5)</Eyebrow>
      <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:9}}>{MATURITE.map((m,i)=>(<div key={i}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,marginBottom:3}}><span style={{color:T.ink}}>{m.c}</span><span style={{color:T.dim}}>{m.v}/5</span></div>
        <div style={{height:8,background:T.panel2,borderRadius:4}}><div style={{width:`${m.v/5*100}%`,height:"100%",background:m.v>=4?T.emerald:m.v>=3?T.gold:T.clay,borderRadius:4}}/></div></div>))}</div>
      <div style={{marginTop:12,fontSize:11.5,color:T.faint}}>Data/IA (2/5) et Cloud (3/5) sont les capacités à hausser en priorité pour soutenir les Horizons 2 et 3.</div></Card>}
  </div>);
}

/* ================= SIMULATEUR STRATÉGIQUE ================= */
const SIM_BASE={cas:8000,recurrent:1500,margePct:0.21,winBase:62,pipe:13780,ambition:15300,objMarge:0.24};
const SCEN_OPTS=[
  {k:"central",l:"Central (pondéré)",cloud:1.0,mp:1.0},
  {k:"s1",l:"Souveraineté forte × prix élevés (favorable)",cloud:1.2,mp:0.7},
  {k:"s2",l:"Souveraineté forte × prix agressifs",cloud:1.1,mp:1.3},
  {k:"s3",l:"Souveraineté faible × prix agressifs (adverse)",cloud:0.7,mp:1.3},
  {k:"s0",l:"Souveraineté faible × prix élevés",cloud:0.8,mp:0.8},
];
function simCompute(p){
  const {managed,cloud,aoBad,win,newAcc,mix,tarif,attrition,invest,horizon,scenario}=p;
  const ramp=horizon/3;const scen=SCEN_OPTS.find(s=>s.k===scenario)||SCEN_OPTS[0];
  const addManaged=managed/100*2500*ramp;
  const addCloud=cloud/100*1800*ramp*scen.cloud;
  const addAO=aoBad/100*3500*ramp;
  const addWin=(win-SIM_BASE.winBase)/100*SIM_BASE.pipe*0.30;
  const addNew=newAcc/100*1500*ramp;
  const lossAttr=attrition/100*1400;
  const revenu=SIM_BASE.cas+addManaged+addCloud+addAO+addWin+addNew-lossAttr;
  const recurrent=SIM_BASE.recurrent+addManaged+0.6*addCloud;
  const recShare=recurrent/revenu;const baseShare=SIM_BASE.recurrent/SIM_BASE.cas;
  let margin=0.21+mix/100*0.06+Math.max(recShare-baseShare,0)*0.25-tarif/100*0.05*scen.mp-invest/100*0.02;
  margin=Math.max(0.10,Math.min(0.45,margin));
  const margeVal=revenu*margin;
  const sC=Math.min(revenu/SIM_BASE.ambition,1.2)/1.2;const sM=Math.min(margin/SIM_BASE.objMarge,1.2)/1.2;
  const sR=Math.min(recShare/0.35,1);const sRes=Math.max(0,1-(attrition+tarif)/200);
  const score=Math.max(0,Math.min(100,Math.round(100*(0.4*sC+0.25*sM+0.2*sR+0.15*sRes))));
  const tension=Math.max(0,Math.min(1,(addAO+addWin)*0.5/SIM_BASE.cas+invest/100*0.3-recShare*0.2));
  const steps=[{name:"CAS base",kind:"start",v:SIM_BASE.cas},{name:"Managed",d:addManaged},{name:"Cloud",d:addCloud},{name:"AO/BAD",d:addAO},{name:"Win rate",d:addWin},{name:"Nvx comptes",d:addNew},{name:"Attrition",d:-lossAttr},{name:"Projeté",kind:"end",v:revenu}];
  let cum=0;const wf=steps.map(b=>{if(b.kind){cum=b.v;return {name:b.name,base:0,pos:b.v,neg:0,kind:b.kind};}const d=b.d;const base=d>=0?cum:cum+d;cum+=d;return {name:b.name,base,pos:d>=0?d:0,neg:d<0?-d:0};});
  const traj=[];for(let y=0;y<=horizon;y++){traj.push({y:"An "+y,v:Math.round(SIM_BASE.cas+(revenu-SIM_BASE.cas)*(y/horizon))});}
  return {revenu,recurrent,recShare,margin,margeVal,score,tension,wf,traj,delta:revenu-SIM_BASE.cas};
}
const LEVMETA=[{k:"managed",l:"Récurrent (SOC/Managed)",min:0,max:100},{k:"cloud",l:"Cloud souverain",min:0,max:100},{k:"aoBad",l:"Capture AO / BAD",min:0,max:100},{k:"win",l:"Taux de conversion",min:40,max:80},{k:"newAcc",l:"Nouveaux comptes",min:0,max:100},{k:"mix",l:"Montée en gamme",min:0,max:100},{k:"tarif",l:"Pression tarifaire",min:0,max:100},{k:"attrition",l:"Attrition/concurrence",min:0,max:100},{k:"invest",l:"Investissement",min:0,max:100}];
const PRESETS={
  Prudent:{managed:20,cloud:15,aoBad:25,win:58,newAcc:20,mix:20,tarif:60,attrition:50,invest:25,horizon:3,scenario:"s3"},
  Base:{managed:40,cloud:30,aoBad:40,win:62,newAcc:30,mix:35,tarif:40,attrition:30,invest:40,horizon:3,scenario:"central"},
  Ambition:{managed:80,cloud:70,aoBad:60,win:70,newAcc:60,mix:70,tarif:30,attrition:20,invest:70,horizon:3,scenario:"s1"},
};
function Slider({label,val,set,min=0,max=100,step=1,unit="%",color,hint}){
  return(<div style={{marginBottom:13}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
      <span style={{color:T.dim}}>{label}</span><span style={{color:color||T.ink,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{val}{unit}</span></div>
    <input type="range" min={min} max={max} step={step} value={val} onChange={(e)=>set(Number(e.target.value))} style={{width:"100%",accentColor:color||T.gold,cursor:"pointer"}}/>
    {hint&&<div style={{fontSize:10.5,color:T.faint,marginTop:2}}>{hint}</div>}
  </div>);
}
function Gauge({score}){
  const c=score>=70?T.emerald:score>=45?T.gold:T.clay;const R=52,circ=2*Math.PI*R,off=circ*(1-score/100);
  return(<div style={{position:"relative",width:130,height:130,margin:"0 auto"}}>
    <svg viewBox="0 0 130 130" style={{transform:"rotate(-90deg)"}}><circle cx="65" cy="65" r={R} fill="none" stroke={T.line} strokeWidth="11"/>
      <circle cx="65" cy="65" r={R} fill="none" stroke={c} strokeWidth="11" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}/></svg>
    <div style={{position:"absolute",inset:0,display:"grid",placeItems:"center"}}><div style={{textAlign:"center"}}>
      <div style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:30,color:c,lineHeight:1}}>{score}</div>
      <div style={{fontSize:9.5,color:T.faint,letterSpacing:".1em"}}>/ 100</div></div></div></div>);
}
function Simulateur(){
  const D={managed:40,cloud:30,aoBad:40,win:62,newAcc:30,mix:35,tarif:40,attrition:30,invest:40,horizon:3,scenario:"central"};
  const [managed,setManaged]=useState(D.managed);const [cloud,setCloud]=useState(D.cloud);
  const [aoBad,setAoBad]=useState(D.aoBad);const [win,setWin]=useState(D.win);
  const [newAcc,setNewAcc]=useState(D.newAcc);const [mix,setMix]=useState(D.mix);
  const [tarif,setTarif]=useState(D.tarif);const [attrition,setAttrition]=useState(D.attrition);
  const [invest,setInvest]=useState(D.invest);const [horizon,setHorizon]=useState(D.horizon);
  const [scenario,setScenario]=useState(D.scenario);
  const reset=()=>{setManaged(D.managed);setCloud(D.cloud);setAoBad(D.aoBad);setWin(D.win);setNewAcc(D.newAcc);setMix(D.mix);setTarif(D.tarif);setAttrition(D.attrition);setInvest(D.invest);setHorizon(D.horizon);setScenario(D.scenario);};

  const deps=[managed,cloud,aoBad,win,newAcc,mix,tarif,attrition,invest,horizon,scenario];
  const params={managed,cloud,aoBad,win,newAcc,mix,tarif,attrition,invest,horizon,scenario};
  const R=useMemo(()=>simCompute(params),deps);
  const tor=useMemo(()=>LEVMETA.map(m=>{const lo=simCompute({...params,[m.k]:m.min}).score;const hi=simCompute({...params,[m.k]:m.max}).score;return {l:m.l,lo:Math.min(lo,hi),hi:Math.max(lo,hi),sw:Math.abs(hi-lo)};}).sort((a,b)=>b.sw-a.sw),deps);
  const cmp=useMemo(()=>{const r={};Object.keys(PRESETS).forEach(k=>{r[k]=simCompute(PRESETS[k]);});r["Ma simulation"]=R;return r;},[R]);

  const tensLbl=R.tension>=0.66?["Élevée",T.clay]:R.tension>=0.33?["Modérée",T.gold]:["Maîtrisée",T.emerald];
  const reco=R.score>=70?"Trajectoire ambitieuse et équilibrée : cap sur le récurrent et la souveraineté, surveiller la trésorerie fournisseurs.":R.score>=45?"Trajectoire correcte : pousser le mix vers cyber/cloud et le récurrent pour hausser marge et résilience.":"Trajectoire fragile : réduire l'exposition aux menaces et rééquilibrer vers le récurrent à forte marge.";

  return(<div>
    <div style={{fontSize:12,color:T.plum,marginBottom:14,background:T.panel,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 12px"}}>🎛️ Manipulez les leviers : le revenu projeté, la marge, la part de récurrent, la valeur en jeu et le score stratégique se recalculent en direct. Chiffres illustratifs — à brancher sur les données réelles en implémentation.</div>
    <div style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:16,alignItems:"start"}} className="g2">
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><Eyebrow color={T.gold}>Leviers stratégiques</Eyebrow><button className="pill" onClick={reset}>Réinitialiser</button></div>
        <div style={{fontSize:10.5,letterSpacing:".1em",textTransform:"uppercase",color:T.emerald,fontWeight:600,margin:"6px 0 8px"}}>Croissance</div>
        <Slider label="Récurrent (SOC / Managed)" val={managed} set={setManaged} color={T.emerald} hint="Développement des contrats managés"/>
        <Slider label="Cloud souverain & conformité" val={cloud} set={setCloud} color={T.emerald}/>
        <Slider label="Capture AO / programme BAD" val={aoBad} set={setAoBad} color={T.emerald} unit="%" hint="Probabilité de gain des AO financés"/>
        <Slider label="Taux de conversion (win rate)" val={win} set={setWin} min={40} max={80} color={T.emerald} hint="Base actuelle : 62%"/>
        <Slider label="Effort nouveaux comptes" val={newAcc} set={setNewAcc} color={T.emerald}/>
        <Slider label="Montée en gamme (mix cyber/cloud)" val={mix} set={setMix} color={T.steel} hint="Bascule hors hardware banalisé → marge"/>
        <div style={{fontSize:10.5,letterSpacing:".1em",textTransform:"uppercase",color:T.clay,fontWeight:600,margin:"12px 0 8px"}}>Risques</div>
        <Slider label="Pression tarifaire / rebates éditeurs" val={tarif} set={setTarif} color={T.clay}/>
        <Slider label="Attrition / pression concurrentielle" val={attrition} set={setAttrition} color={T.clay}/>
        <div style={{fontSize:10.5,letterSpacing:".1em",textTransform:"uppercase",color:T.gold,fontWeight:600,margin:"12px 0 8px"}}>Moyens & contexte</div>
        <Slider label="Investissement (certifs, staffing)" val={invest} set={setInvest} color={T.gold} hint="Prérequis des leviers de croissance"/>
        <Slider label="Horizon" val={horizon} set={setHorizon} min={1} max={3} step={1} unit=" an(s)" color={T.gold}/>
        <div style={{marginTop:8}}><div style={{fontSize:12,color:T.dim,marginBottom:5}}>Scénario</div>
          <select value={scenario} onChange={(e)=>setScenario(e.target.value)} style={{width:"100%",background:T.panel2,color:T.ink,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 10px",fontSize:12}}>
            {SCEN_OPTS.map(s=>(<option key={s.k} value={s.k}>{s.l}</option>))}</select></div>
      </Card>

      <div>
        <div className="g4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
          <Card><Kpi label="Revenu projeté" value={fmt(R.revenu*1e6)} accent={T.emerald} sub={(R.delta>=0?"+":"")+fmt(R.delta*1e6)+" vs base"}/></Card>
          <Card><Kpi label="Marge brute" value={pct(R.margin)} accent={R.margin>=SIM_BASE.objMarge?T.emerald:T.gold} sub={"objectif "+pct(SIM_BASE.objMarge)}/></Card>
          <Card><Kpi label="Part de récurrent" value={pct(R.recShare)} accent={T.steel} sub="santé stratégique"/></Card>
          <Card><Kpi label="Marge en valeur" value={fmt(R.margeVal*1e6)} accent={T.gold} sub="revenu × marge"/></Card>
        </div>
        <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1.5fr",gap:12,marginBottom:12}}>
          <Card><Eyebrow color={T.gold}>Score stratégique</Eyebrow><div style={{marginTop:10}}><Gauge score={R.score}/></div>
            <div style={{marginTop:10,fontSize:11.5,color:T.dim,lineHeight:1.5}}>{reco}</div>
            <div style={{marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12}}><span style={{color:T.dim}}>Tension trésorerie / fournisseurs</span><Badge c={tensLbl[1]}>{tensLbl[0]}</Badge></div>
            <div style={{marginTop:5,height:7,background:T.panel2,borderRadius:4}}><div style={{width:`${R.tension*100}%`,height:"100%",background:tensLbl[1],borderRadius:4}}/></div></Card>
          <Card><Eyebrow color={T.emerald}>Pont de valeur — base → projeté (M FCFA)</Eyebrow>
            <div style={{height:230,marginTop:8}}><ResponsiveContainer width="100%" height="100%"><BarChart data={R.wf} margin={{left:0,right:8,top:8,bottom:24}}>
              <CartesianGrid stroke={T.line} vertical={false}/><XAxis dataKey="name" tick={{fill:T.dim,fontSize:9.5}} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={54}/><YAxis tickFormatter={(v)=>(v/1000).toFixed(0)+"k"} tick={{fill:T.faint,fontSize:9}} axisLine={false} tickLine={false}/>
              <Bar dataKey="base" stackId="a" fill="transparent"/>
              <Bar dataKey="pos" stackId="a" radius={[3,3,0,0]}>{R.wf.map((r,i)=>(<Cell key={i} fill={r.kind==="start"?T.steel:r.kind==="end"?T.gold:T.emerald}/>))}</Bar>
              <Bar dataKey="neg" stackId="a" radius={[3,3,0,0]}>{R.wf.map((r,i)=>(<Cell key={i} fill={T.clay}/>))}</Bar></BarChart></ResponsiveContainer></div></Card>
        </div>
        <Card><Eyebrow color={T.steel}>Trajectoire du revenu (annualisé)</Eyebrow>
          <div style={{height:180,marginTop:8}}><ResponsiveContainer width="100%" height="100%"><LineChart data={R.traj} margin={{left:0,right:12,top:8,bottom:6}}>
            <CartesianGrid stroke={T.line} vertical={false}/><XAxis dataKey="y" tick={{fill:T.dim,fontSize:11}} axisLine={false} tickLine={false}/><YAxis tickFormatter={(v)=>fmt(v*1e6)} tick={{fill:T.faint,fontSize:10}} axisLine={false} tickLine={false}/>
            <ReferenceLine y={SIM_BASE.ambition} stroke={T.gold} strokeDasharray="4 4" label={{value:"Ambition",fill:T.gold,fontSize:10,position:"insideTopRight"}}/>
            <Line type="monotone" dataKey="v" stroke={T.emerald} strokeWidth={2.5} dot={{r:3,fill:T.emerald}}/></LineChart></ResponsiveContainer></div>
          <div style={{marginTop:6,fontSize:11.5,color:T.faint}}>Atterrissage à l'horizon : <b style={{color:R.revenu>=SIM_BASE.ambition?T.emerald:T.gold}}>{pct(R.revenu/SIM_BASE.ambition)}</b> de l'ambition ({fmt(SIM_BASE.ambition*1e6)}).</div></Card>
      </div>
    </div>
    <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:14}}>
      <Card><Eyebrow color={T.gold}>Analyse de sensibilité (tornado)</Eyebrow>
        <div style={{marginTop:12}}>{tor.map((m,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
          <div style={{width:150,fontSize:11.5,color:T.dim,textAlign:"right",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.l}</div>
          <div style={{flex:1,position:"relative",height:16,background:T.panel2,borderRadius:4}}>
            <div style={{position:"absolute",left:m.lo+"%",width:Math.max(m.hi-m.lo,1)+"%",top:0,bottom:0,background:T.gold+"99",borderRadius:4}}/>
            <div style={{position:"absolute",left:R.score+"%",top:-2,bottom:-2,width:2,background:T.ink}}/></div>
          <div style={{width:34,fontSize:11,color:T.gold,textAlign:"right",fontWeight:600}}>±{Math.round(m.sw)}</div></div>))}</div>
        <div style={{marginTop:8,fontSize:11,color:T.faint,lineHeight:1.5}}>Amplitude du score stratégique quand chaque levier varie de son minimum à son maximum (autres leviers inchangés). Trait blanc = score actuel. Les leviers du haut sont ceux sur lesquels agir en priorité.</div></Card>
      <Card><Eyebrow color={T.steel}>Comparaison de scénarios</Eyebrow>
        <div style={{marginTop:12,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{color:T.faint,fontSize:10.5,textAlign:"right"}}><th style={{textAlign:"left",padding:"5px 6px"}}>Profil</th><th style={{padding:"5px 6px"}}>Revenu</th><th style={{padding:"5px 6px"}}>Marge</th><th style={{padding:"5px 6px"}}>Récur.</th><th style={{padding:"5px 6px"}}>Score</th></tr></thead>
          <tbody>{["Prudent","Base","Ambition","Ma simulation"].map((k,i)=>{const c=cmp[k];const col=k==="Ma simulation"?T.gold:k==="Ambition"?T.emerald:k==="Prudent"?T.clay:T.steel;return(<tr key={i} style={{borderTop:`1px solid ${T.line}`}}>
            <td style={{padding:"7px 6px",color:T.ink,fontWeight:k==="Ma simulation"?700:500}}><span style={{display:"inline-block",width:8,height:8,borderRadius:8,background:col,marginRight:6}}/>{k}</td>
            <td style={{padding:"7px 6px",textAlign:"right",color:T.dim,fontVariantNumeric:"tabular-nums"}}>{fmt(c.revenu*1e6)}</td>
            <td style={{padding:"7px 6px",textAlign:"right",color:T.dim}}>{pct(c.margin)}</td>
            <td style={{padding:"7px 6px",textAlign:"right",color:T.dim}}>{pct(c.recShare)}</td>
            <td style={{padding:"7px 6px",textAlign:"right"}}><span style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,color:col}}>{c.score}</span></td></tr>);})}</tbody></table></div>
        <div style={{marginTop:10}}>{["Prudent","Base","Ambition","Ma simulation"].map((k,i)=>{const c=cmp[k];const col=k==="Ma simulation"?T.gold:k==="Ambition"?T.emerald:k==="Prudent"?T.clay:T.steel;return(<div key={i} style={{marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:T.dim,marginBottom:2}}><span>{k}</span><span>{c.score}/100</span></div>
          <div style={{height:6,background:T.panel2,borderRadius:4}}><div style={{width:c.score+"%",height:"100%",background:col,borderRadius:4}}/></div></div>);})}</div></Card>
    </div>
  </div>);
}

/* ================= RADAR DE DÉTECTION D'ÉVÉNEMENTS ================= */
const ECAT={
  marche:{l:"Acteurs & marché",c:T.steel,q:0},
  sectoriel:{l:"Sectoriel",c:T.emerald,q:1},
  tech:{l:"Technologique",c:T.plum,q:2},
  regpays:{l:"Réglementaire & pays",c:T.gold,q:3},
};
const PROX={imminent:{l:"Imminent",r:0.30},court:{l:"Court terme",r:0.52},moyen:{l:"Moyen terme",r:0.74},horizon:{l:"Horizon",r:0.94}};
const EVENTS=[
  {id:1,cat:"marche",type:"Nouvelle implantation",t:"Une banque panafricaine ouvre une filiale à Abidjan",ent:"Banque X",geo:"CI",prox:"court",imp:"high",stance:"opportunity",conf:"B1",neuf:true,sw:"Nouveau compte à fort potentiel infra & cybersécurité.",act:"Qualifier le prospect, activer une approche avant l'appel d'offres d'équipement."},
  {id:2,cat:"marche",type:"Expansion de groupe",t:"Un groupe bancaire régional étend son réseau (≈10 pays UEMOA/CEMAC)",ent:"Groupe bancaire",geo:"UEMOA/CEMAC",prox:"moyen",imp:"high",stance:"opportunity",conf:"A2",neuf:true,sw:"Vague de projets réseau/sécurité multi-pays.",act:"Positionner une offre régionale coordonnée (delivery multi-pays)."},
  {id:3,cat:"marche",type:"Entrée d'un concurrent",t:"Une ESN étrangère ouvre un bureau à Abidjan",ent:"Concurrent C",geo:"CI",prox:"court",imp:"medium",stance:"threat",conf:"B2",neuf:true,sw:"Pression concurrentielle accrue sur les grands comptes.",act:"Renforcer les battlecards et verrouiller les comptes clés."},
  {id:4,cat:"marche",type:"Rachat / M&A",t:"Un distributeur régional racheté par un acteur mondial",ent:"Distributeur",geo:"Afrique",prox:"court",imp:"medium",stance:"neutral",conf:"B2",neuf:false,sw:"Possible évolution des conditions & lignes de crédit.",act:"Rapprocher du module Crédit Fournisseurs, renégocier les termes."},
  {id:5,cat:"marche",type:"Levée de fonds",t:"Une fintech locale lève des fonds pour son expansion",ent:"Fintech",geo:"CI",prox:"moyen",imp:"low",stance:"opportunity",conf:"C2",neuf:false,sw:"Prospect en croissance, besoins cloud/sécurité à venir.",act:"Surveiller ; entrer en relation en amont des besoins."},
  {id:6,cat:"sectoriel",type:"Opportunité sectorielle",t:"Plan national de digitalisation de la santé",ent:"État CI",geo:"CI",prox:"moyen",imp:"high",stance:"opportunity",conf:"A2",neuf:true,sw:"Programme structurant : infrastructures, data, cybersécurité.",act:"Cartographier les guichets, préparer un consortium sectoriel."},
  {id:7,cat:"sectoriel",type:"Programme d'investissement",t:"Programme e-gouvernement financé par un bailleur",ent:"Bailleur",geo:"Afrique de l'Ouest",prox:"court",imp:"high",stance:"opportunity",conf:"A2",neuf:true,sw:"Financement disponible : AO à fort volume.",act:"Pré-qualifier, aligner l'offre sur les critères du bailleur."},
  {id:8,cat:"sectoriel",type:"Risque sectoriel",t:"Ralentissement des investissements IT dans un secteur exposé",ent:"—",geo:"UEMOA",prox:"moyen",imp:"medium",stance:"threat",conf:"C3",neuf:false,sw:"Pipeline potentiellement affecté sur ce segment.",act:"Rééquilibrer l'effort commercial vers les secteurs porteurs."},
  {id:9,cat:"tech",type:"Tendance techno",t:"Adoption accélérée du SASE / Zero Trust dans la banque",ent:"—",geo:"Afrique",prox:"court",imp:"high",stance:"opportunity",conf:"B2",neuf:true,sw:"Demande cyber alignée avec notre expertise.",act:"Packager une offre SASE/ZTNA, monter en certif."},
  {id:10,cat:"tech",type:"Rupture / nouvelle techno",t:"GenAI dans le service client bancaire",ent:"—",geo:"Afrique",prox:"moyen",imp:"medium",stance:"opportunity",conf:"B3",neuf:true,sw:"Nouveau terrain de jeu (copilots, RAG) à structurer.",act:"Lancer un POC, évaluer la valeur pour les comptes clés."},
  {id:11,cat:"tech",type:"Obsolescence / EOL",t:"Fin de vie d'une gamme d'équipements majeure",ent:"Cisco",geo:"Afrique",prox:"imminent",imp:"high",stance:"threat",conf:"A1",neuf:true,sw:"Risque appro + fenêtre de migration à saisir.",act:"Sécuriser le stock, proposer des migrations proactives."},
  {id:12,cat:"tech",type:"Impact techno",t:"Ouverture d'une région cloud d'un hyperscaler en Afrique de l'Ouest",ent:"Hyperscaler",geo:"Afrique de l'Ouest",prox:"moyen",imp:"high",stance:"neutral",conf:"B2",neuf:true,sw:"Opportunité (services managés) et menace (désintermédiation).",act:"Se positionner en intégrateur/MSP au-dessus du cloud."},
  {id:13,cat:"regpays",type:"Nouvelle réglementation",t:"ARTCI impose la localisation des données",ent:"ARTCI",geo:"CI",prox:"imminent",imp:"high",stance:"opportunity",conf:"A1",neuf:true,sw:"Accélère cloud souverain & conformité.",act:"Structurer une offre souveraineté & conformité packagée."},
  {id:14,cat:"regpays",type:"Évolution normative",t:"BCEAO renforce les exigences cyber des banques",ent:"BCEAO",geo:"UEMOA",prox:"court",imp:"high",stance:"opportunity",conf:"A1",neuf:false,sw:"Obligation d'investissement cyber pour les banques.",act:"Cibler les banques avec une offre de mise en conformité."},
  {id:15,cat:"regpays",type:"Fiscalité / douane",t:"Nouvelle taxe douanière sur le matériel IT importé",ent:"État",geo:"CI",prox:"moyen",imp:"medium",stance:"threat",conf:"C2",neuf:false,sw:"Hausse du coût du hardware → pression sur la marge.",act:"Revoir le pricing, accélérer la bascule vers services/récurrent."},
  {id:16,cat:"regpays",type:"Risque pays",t:"Tensions et élections dans un pays cible → gel possible des marchés publics",ent:"—",geo:"CEMAC",prox:"moyen",imp:"medium",stance:"threat",conf:"C3",neuf:true,sw:"Risque de report des AO et sur le delivery local.",act:"Diversifier l'exposition pays, sécuriser les contrats en cours."},
];

function Detection(){
  const [cat,setCat]=useState("all");
  const CX=170,CY=170,RR=150;
  const idxIn={};
  const blips=EVENTS.map(e=>{const q=ECAT[e.cat].q;idxIn[q]=(idxIn[q]||0);const i=idxIn[q]++;const cnt=EVENTS.filter(x=>ECAT[x.cat].q===q).length;
    const ang=(q*90+90/(cnt+1)*(i+1))*Math.PI/180;const rad=PROX[e.prox].r*RR;
    return {...e,x:CX+rad*Math.cos(ang),y:CY-rad*Math.sin(ang),size:e.imp==="high"?7:e.imp==="medium"?5.2:4};});
  const rows=EVENTS.filter(e=>cat==="all"||e.cat===cat).sort((a,b)=>{const P={imminent:0,court:1,moyen:2,horizon:3};const I={high:0,medium:1,low:2};return P[a.prox]-P[b.prox]||I[a.imp]-I[b.imp];});
  const neuf=EVENTS.filter(e=>e.neuf).length;
  return(<div>
    <div style={{fontSize:12,color:T.plum,marginBottom:14,background:T.panel,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 12px"}}>📡 Détection d'événements : implantations, expansions de groupe, risques/opportunités sectoriels, ruptures techno, réglementation, risque pays. Position = <b>catégorie</b> (secteur) × <b>imminence</b> (proximité du centre) ; taille = <b>impact</b> ; couleur = opportunité/menace.</div>
    <div className="g4" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
      {Object.keys(ECAT).map(k=>(<Card key={k}><Kpi label={ECAT[k].l} value={EVENTS.filter(e=>e.cat===k).length} accent={ECAT[k].c} sub="événements suivis"/></Card>))}
    </div>
    <div className="g2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
      <Card><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><Eyebrow color={T.emerald}>Radar de détection</Eyebrow><Badge c={T.emerald}>{neuf} nouveaux</Badge></div>
        <svg viewBox="0 0 340 360" style={{width:"100%",height:330,marginTop:4}}>
          <defs><linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={T.emerald} stopOpacity="0.22"/><stop offset="100%" stopColor={T.emerald} stopOpacity="0"/></linearGradient></defs>
          {["horizon","moyen","court","imminent"].map(r=>(<circle key={r} cx={CX} cy={CY} r={PROX[r].r*RR} fill="none" stroke={T.line}/>))}
          <line x1={CX-RR} y1={CY} x2={CX+RR} y2={CY} stroke={T.line}/><line x1={CX} y1={CY-RR} x2={CX} y2={CY+RR} stroke={T.line}/>
          <g><path d="M170 170 L170 20 A150 150 0 0 1 276 64 Z" fill="url(#sw)"/><animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 170 170" to="360 170 170" dur="7s" repeatCount="indefinite"/></g>
          {Object.keys(ECAT).map(k=>{const q=ECAT[k].q;const a=(q*90+45)*Math.PI/180;return(<text key={k} x={CX+(RR-8)*Math.cos(a)} y={CY-(RR-8)*Math.sin(a)} fill={ECAT[k].c} fontSize="9.5" textAnchor="middle" opacity="0.8">{ECAT[k].l}</text>);})}
          <circle cx={CX} cy={CY} r="3" fill={T.faint}/>
          {blips.map((b,i)=>(<g key={i} opacity={cat==="all"||cat===b.cat?1:0.18}>
            {b.neuf&&<circle cx={b.x} cy={b.y} r={b.size+4} fill="none" stroke={STANCE[b.stance].c} strokeOpacity="0.4"/>}
            <circle cx={b.x} cy={b.y} r={b.size} fill={STANCE[b.stance].c}/></g>))}
        </svg>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,justifyContent:"center",marginTop:2}}>
          <span style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:T.emerald,marginRight:4}}/>Opportunité</span>
          <span style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:T.clay,marginRight:4}}/>Menace</span>
          <span style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:T.dim,marginRight:4}}/>Neutre</span>
          <span style={{color:T.faint}}>centre = imminent · bord = horizon</span></div></Card>
      <Card><Eyebrow color={T.gold}>Types d'événements détectés</Eyebrow>
        <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:7}}>
          {["Nouvelle implantation","Expansion de groupe","Entrée d'un concurrent","Opportunité sectorielle","Risque sectoriel","Rupture / nouvelle techno","Obsolescence / EOL","Nouvelle réglementation","Risque pays"].map((ty,i)=>{const c=EVENTS.filter(e=>e.type===ty).length;const ev=EVENTS.find(e=>e.type===ty);return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,padding:"5px 0",borderTop:i>0?`1px solid ${T.line}`:"none"}}>
            <span style={{width:8,height:8,borderRadius:8,background:ev?ECAT[ev.cat].c:T.faint,flexShrink:0}}/>
            <span style={{flex:1,color:c?T.ink:T.faint}}>{ty}</span><Badge c={c?T.gold:T.faint}>{c}</Badge></div>);})}</div>
        <div style={{marginTop:12,fontSize:11.5,color:T.faint,lineHeight:1.5}}>Détection : veille automatisée (RSS + IA Vertex) + saisie analyste. Chaque événement peut déclencher une <b style={{color:T.emerald}}>opportunité</b> (Pipeline) ou une <b style={{color:T.clay}}>alerte sourcing</b> (Crédit Fournisseurs).</div></Card>
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
      <span style={{fontSize:11.5,color:T.faint}}>Catégorie :</span>
      <button className={`pill ${cat==="all"?"on":""}`} onClick={()=>setCat("all")}>Toutes</button>
      {Object.keys(ECAT).map(k=>(<button key={k} className={`pill ${cat===k?"on":""}`} onClick={()=>setCat(k)}>{ECAT[k].l}</button>))}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {rows.map(e=>(<Card key={e.id} style={{borderLeft:`3px solid ${STANCE[e.stance].c}`}}>
        <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:220}}>
            <div style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}><Badge c={ECAT[e.cat].c}>{ECAT[e.cat].l}</Badge><span style={{fontSize:11.5,color:T.gold,fontWeight:600}}>{e.type}</span>{e.neuf&&<Badge c={T.emerald}>Nouveau</Badge>}</div>
            <div style={{fontSize:14,color:T.ink,fontWeight:600}}>{e.t}</div>
            <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}><Badge c={PROX[e.prox].r<0.4?T.clay:T.faint}>{PROX[e.prox].l}</Badge><Badge c={IMP[e.imp].c}>Impact {IMP[e.imp].l}</Badge><Badge c={STANCE[e.stance].c}>{STANCE[e.stance].l}</Badge><Badge c={T.faint}>{e.ent} · {e.geo}</Badge><Badge c={T.steel}>Fiabilité {e.conf}</Badge></div>
            <div style={{marginTop:10,fontSize:12.5,color:T.dim}}><b style={{color:T.plum}}>So-what :</b> {e.sw}</div>
            <div style={{marginTop:4,fontSize:12.5,color:T.dim}}><b style={{color:T.gold}}>Action :</b> {e.act}</div>
          </div></div></Card>))}
    </div>
  </div>);
}

/* ================= INDICATEURS AVANCÉS (leading KRIs) ================= */
function Spark({data,color,w=96,h=28}){
  const max=Math.max(...data),min=Math.min(...data),rng=(max-min)||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/rng)*(h-4)-2}`).join(" ");
  const lx=w,ly=h-((data[data.length-1]-min)/rng)*(h-4)-2;
  return(<svg width={w} height={h} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/><circle cx={lx} cy={ly} r="2.6" fill={color}/></svg>);
}
const KRI=[
  {n:"Pipeline pondéré",u:" Md",val:13.8,data:[11.2,11.8,12.4,12.1,12.9,13.3,13.6,13.8],dir:"up",stat:"ok"},
  {n:"Taux de conversion",u:"%",val:62,data:[57,58,60,59,61,61,62,62],dir:"up",stat:"ok"},
  {n:"Part de récurrent",u:"%",val:19,data:[14,15,15,16,17,18,18,19],dir:"up",stat:"warn"},
  {n:"Marge brute moyenne",u:"%",val:21,data:[22,21,21,20,21,21,21,21],dir:"up",stat:"warn"},
  {n:"Saturation lignes fournisseurs",u:"%",val:78,data:[62,65,68,70,73,75,77,78],dir:"down",stat:"alert"},
  {n:"Délai commande→facturation",u:" j",val:96,data:[110,108,104,101,99,98,97,96],dir:"down",stat:"ok"},
  {n:"AO actifs suivis",u:"",val:14,data:[8,9,10,11,11,12,13,14],dir:"up",stat:"ok"},
  {n:"Menaces fort impact non traitées",u:"",val:2,data:[4,4,3,3,2,3,2,2],dir:"down",stat:"ok"},
  {n:"Fraîcheur watchlist",u:"%",val:85,data:[70,74,78,80,82,83,84,85],dir:"up",stat:"ok"},
  {n:"Time-to-insight",u:" j",val:2.3,data:[4.1,3.8,3.4,3.0,2.8,2.6,2.4,2.3],dir:"down",stat:"ok"},
];
const STCOL={ok:T.emerald,warn:T.gold,alert:T.clay};
function Indicateurs(){
  return(<div>
    <div style={{fontSize:12,color:T.plum,marginBottom:14,background:T.panel,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 12px"}}>📈 Indicateurs avancés (leading) suivis dans le temps, avec seuils d'alerte. Contrairement aux KPIs de résultat, ils <b>anticipent</b> la performance et le risque — ce sont les capteurs du radar stratégique.</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:14}}>
      {KRI.map((k,i)=>{const first=k.data[0],last=k.data[k.data.length-1];const chg=last-first;const good=(k.dir==="up"&&chg>=0)||(k.dir==="down"&&chg<=0);const arrow=chg>0?"▲":chg<0?"▼":"—";const col=STCOL[k.stat];
        return(<Card key={i} style={{borderTop:`3px solid ${col}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <Eyebrow>{k.n}</Eyebrow><span style={{width:9,height:9,borderRadius:9,background:col,marginTop:2}}/></div>
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginTop:8}}>
            <div><div style={{fontFamily:"'Bricolage Grotesque'",fontWeight:700,fontSize:24,color:T.ink,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{k.val}{k.u}</div>
              <div style={{fontSize:11,color:good?T.emerald:T.clay,marginTop:4}}>{arrow} {Math.abs(Math.round(chg*10)/10)}{k.u} <span style={{color:T.faint}}>/ 8 pér.</span></div></div>
            <Spark data={k.data} color={col}/></div></Card>);})}
    </div>
    <Card style={{marginTop:14}}><Eyebrow color={T.clay}>Alertes de seuil</Eyebrow>
      <div style={{marginTop:10,fontSize:12.5,color:T.dim,lineHeight:1.7}}>
        <div><span style={{color:T.clay,fontWeight:700}}>● Saturation lignes fournisseurs (78%)</span> — seuil de tension franchi : renégocier les lignes exposées et lisser les commandes (lien module Crédit Fournisseurs).</div>
        <div style={{marginTop:6}}><span style={{color:T.gold,fontWeight:700}}>● Part de récurrent (19%)</span> — sous la cible de 35% : accélérer le managed/SOC pour la prévisibilité et la marge.</div>
        <div style={{marginTop:6}}><span style={{color:T.gold,fontWeight:700}}>● Marge brute (21%)</span> — sous l'objectif 24% : pousser la montée en gamme (mix cyber/cloud).</div></div></Card>
  </div>);
}

/* ================= PLAN D'ACTION PRIORISÉ ================= */
const ACTIONS=[
  {t:"Constituer un consortium pour le programme BAD",imp:5,urg:4,eff:3,ev:1400,owner:"DG",ech:"T3",st:"À lancer",src:"Signal #2 · Évén. #7"},
  {t:"Sécuriser le stock avant l'EOL Cisco",imp:4,urg:5,eff:2,ev:600,owner:"DRO",ech:"Immédiat",st:"En cours",src:"Évén. #11"},
  {t:"Industrialiser le SOC managé (récurrence + marge)",imp:5,urg:3,eff:4,ev:900,owner:"Dir. Cyber",ech:"T4",st:"En cours",src:"Tendance #11"},
  {t:"Offre conformité BCEAO / ARTCI packagée",imp:4,urg:4,eff:3,ev:1100,owner:"Dir. Cyber",ech:"T3",st:"À lancer",src:"Évén. #13/#14"},
  {t:"Positionner le RFP SD-WAN Orange CI",imp:4,urg:4,eff:2,ev:600,owner:"AM Orange",ech:"T3",st:"À lancer",src:"Signal #3"},
  {t:"Renégocier les lignes de crédit exposées",imp:3,urg:4,eff:2,ev:300,owner:"DAF / DRO",ech:"T3",st:"À planifier",src:"Évén. #4"},
  {t:"POC GenAI service client bancaire",imp:3,urg:2,eff:3,ev:250,owner:"Dir. Innovation",ech:"T4",st:"À planifier",src:"Évén. #10"},
  {t:"Diversifier l'exposition pays (CEMAC)",imp:3,urg:3,eff:3,ev:200,owner:"DRO",ech:"T4",st:"À surveiller",src:"Évén. #16"},
];
function quadrant(a){if(a.imp>=4&&a.urg>=4)return {l:"Faire maintenant",c:T.clay};if(a.imp>=4&&a.urg<4)return {l:"Planifier",c:T.emerald};if(a.imp<4&&a.urg>=4)return {l:"Traiter vite",c:T.gold};return {l:"Surveiller",c:T.faint};}
function PlanAction(){
  const acts=ACTIONS.map(a=>({...a,prio:Math.round(a.imp*a.urg/a.eff*10)/10,q:quadrant(a)})).sort((x,y)=>y.prio-x.prio);
  const totEv=acts.reduce((s,a)=>s+a.ev,0);const now=acts.filter(a=>a.q.l==="Faire maintenant").length;const lancer=acts.filter(a=>a.st==="À lancer"||a.st==="Immédiat").length;
  return(<div>
    <div style={{fontSize:12,color:T.plum,marginBottom:14,background:T.panel,border:`1px solid ${T.line}`,borderRadius:8,padding:"8px 12px"}}>✅ La boucle « et maintenant ? » : chaque signal et événement converge en actions priorisées (impact × urgence, effort, valeur attendue), avec porteur et échéance. C'est ce qui relie l'intelligence à la valeur.</div>
    <div className="g3" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:14}}>
      <Card><Kpi label="Valeur attendue du plan" value={fmt(totEv*1e6)} accent={T.emerald} sub="Σ des actions"/></Card>
      <Card><Kpi label="À faire maintenant" value={now} accent={T.clay} sub="impact & urgence forts"/></Card>
      <Card><Kpi label="À lancer / immédiat" value={lancer} accent={T.gold} sub="actions non démarrées"/></Card>
    </div>
    <Card style={{marginBottom:14}}><Eyebrow color={T.gold}>Matrice de priorisation — impact × urgence (taille = valeur attendue)</Eyebrow>
      <div style={{height:300,marginTop:10}}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{left:6,right:20,top:10,bottom:20}}>
        <CartesianGrid stroke={T.line}/>
        <XAxis type="number" dataKey="urg" name="Urgence" domain={[0,6]} ticks={[1,2,3,4,5]} tick={{fill:T.faint,fontSize:10}} label={{value:"Urgence →",position:"insideBottom",offset:-8,fill:T.dim,fontSize:11}}/>
        <YAxis type="number" dataKey="imp" name="Impact" domain={[0,6]} ticks={[1,2,3,4,5]} tick={{fill:T.faint,fontSize:10}} label={{value:"Impact →",angle:-90,position:"insideLeft",fill:T.dim,fontSize:11}}/>
        <ZAxis type="number" dataKey="ev" range={[120,1000]}/>
        <ReferenceLine x={3.5} stroke={T.faint}/><ReferenceLine y={3.5} stroke={T.faint}/>
        <Tooltip content={<Tip/>} cursor={{stroke:T.faint}}/>
        <Scatter data={acts.map(a=>({...a,n:a.t}))}>{acts.map((a,i)=>(<Cell key={i} fill={a.q.c}/>))}</Scatter></ScatterChart></ResponsiveContainer></div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11,marginTop:4}}>{[["Faire maintenant",T.clay],["Traiter vite",T.gold],["Planifier",T.emerald],["Surveiller",T.faint]].map(([l,c],i)=>(<span key={i} style={{color:T.dim}}><span style={{display:"inline-block",width:9,height:9,borderRadius:9,background:c,marginRight:5}}/>{l}</span>))}</div></Card>
    <Card><Eyebrow color={T.steel}>Plan d'action priorisé</Eyebrow>
      <div style={{marginTop:12,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead><tr style={{color:T.faint,fontSize:10.5,textAlign:"left"}}><th style={{padding:"6px 8px"}}>#</th><th style={{padding:"6px 8px"}}>Action</th><th style={{padding:"6px 8px"}}>Zone</th><th style={{padding:"6px 8px",textAlign:"right"}}>Val. att.</th><th style={{padding:"6px 8px"}}>Porteur</th><th style={{padding:"6px 8px"}}>Échéance</th><th style={{padding:"6px 8px"}}>Statut</th></tr></thead>
        <tbody>{acts.map((a,i)=>(<tr key={i} style={{borderTop:`1px solid ${T.line}`}}>
          <td style={{padding:"8px",color:T.gold,fontFamily:"'Bricolage Grotesque'",fontWeight:700}}>{i+1}</td>
          <td style={{padding:"8px",color:T.ink}}>{a.t}<div style={{fontSize:10.5,color:T.faint,marginTop:2}}>{a.src} · I{a.imp}·U{a.urg}·E{a.eff}</div></td>
          <td style={{padding:"8px"}}><Badge c={a.q.c}>{a.q.l}</Badge></td>
          <td style={{padding:"8px",textAlign:"right",color:T.emerald,fontVariantNumeric:"tabular-nums"}}>{fmt(a.ev*1e6)}</td>
          <td style={{padding:"8px",color:T.dim}}>{a.owner}</td><td style={{padding:"8px",color:T.dim}}>{a.ech}</td>
          <td style={{padding:"8px"}}><Badge c={a.st==="En cours"?T.emerald:a.st==="À surveiller"?T.faint:T.gold}>{a.st}</Badge></td></tr>))}</tbody></table></div></Card>
  </div>);
}
