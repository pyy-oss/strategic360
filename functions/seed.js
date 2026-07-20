"use strict";

/**
 * Seed script — writes `config/permissions` with the default RBAC matrix from
 * BUILD_KIT.md §7 ("Défauts `config/permissions` pour le module `veille`").
 *
 * IMPORTANT — matrix shape mirrors firestore.rules' `lvl(m)` exactly:
 *   lvl(m) = role() in ['direction'] ? 'write' : matrix()[role()][m]
 *   canRead(m) = lvl(m) in ['read', 'write']
 *   canWrite(m) = lvl(m) == 'write'
 * So each `matrix[role][module]` value must be one of: 'none' | 'read' | 'write'.
 * (`direction` doesn't strictly need an entry — the rules short-circuit it to 'write' — but we
 * write one anyway for clarity/consistency when the matrix doc is inspected directly.)
 *
 * BUILD_KIT.md §7 defaults for module "veille":
 *   write        -> direction, strategie, innovation
 *   contribution -> commercial_dir, commercial   (= 'write' at the rules level: rules only
 *                    distinguish none/read/write; "contribution" just means create/update
 *                    intelItems, which the rules gate the same way as full write)
 *   read         -> pmo, achats, lecture
 *
 * No real Firebase project is provisioned in this sandbox. To run this against the local
 * Emulator Suite:
 *
 *   1. firebase emulators:start --only firestore
 *   2. In another shell:
 *        export FIRESTORE_EMULATOR_HOST=localhost:8080
 *        export GCLOUD_PROJECT=veille-nt-ci   # or your .firebaserc project id
 *        node functions/seed.js
 *
 * Against a real project instead, unset FIRESTORE_EMULATOR_HOST and provide credentials
 * (e.g. GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key), then run the same
 * `node functions/seed.js`.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Matrice RBAC (13 rôles ESN × 7 modules) — SOURCE UNIQUE dans domain/rbac.js (partagée avec
// index.js et le miroir front web/src/lib/rbac.ts).
const { DEFAULT_PERMISSIONS_MATRIX } = require("./domain/rbac");

// intelWatchlist seed entries — taken from the maquette's `WATCH` sample data (docs/maquette_reference.jsx)
// so the emulator-backed app has something to show for BUILD_KIT.md V2 ("intelWatchlist/intelSources").
// Deliberately NOT seeding `intelItems`: V2's point is switching the Fil/Détection views from static
// sample constants to real Firestore writes made through the app's contribution UI (or later ingestion),
// so fake intelItems here would defeat that purpose.
const WATCHLIST_SEED = [
  { name: "Cisco", type: "Éditeur/Constructeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Palo Alto", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Fortinet", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "HPE", type: "Constructeur", geo: "Afrique", priority: "Moyenne", active: true },
  { name: "Microsoft", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Hiperdist", type: "Distributeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Westcon", type: "Distributeur", geo: "Afrique", priority: "Haute", active: true },
  { name: "Exclusive Networks", type: "Distributeur", geo: "Afrique", priority: "Moyenne", active: true },
  { name: "Orange CI", type: "Client/Prospect", geo: "Côte d'Ivoire", priority: "Haute", active: true },
  { name: "BAD", type: "Client/Bailleur", geo: "Afrique de l'Ouest", priority: "Haute", active: true },
  { name: "BCEAO", type: "Client/Régulateur", geo: "Afrique de l'Ouest", priority: "Haute", active: true },
  // Concurrents ESN / intégrateurs (cartographie terrain 2026 — CI & UEMOA)
  { name: "Talentys", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Concurrent cyber le plus direct : Fortinet West Africa + Wallix (mêmes éditeurs), références SOC CNPS/CNAM" },
  { name: "CBI Côte d'Ivoire", type: "Concurrent", geo: "UEMOA", priority: "Haute", active: true, note: "Intégrateur marocain Cisco Gold, Abidjan (2016) et Dakar — frontal sur les gros deals Cisco" },
  { name: "Orange Business CI / OC2S", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Filiale cloud souverain + cyber créée 2025, 60+ experts, 3 datacenters ISO27001 — grands comptes ; Orange CI est aussi notre client" },
  { name: "SNDI", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Société d'État, prestataire IT quasi-captif du secteur public ivoirien (SIGFIP), présente au Sénégal/Bénin/Togo" },
  { name: "Inovatec", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Pure player cyber Abidjan : SOC 24/7, partenaire Fortinet/Palo Alto/Veeam (cybersecurite.ci)" },
  { name: "SNEDAI Groupe", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Champion national (biométrie, cyber, datacenters), très introduit auprès de l'État" },
  { name: "Groupe INOVA", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "SSII 1999, Microsoft/ERP + centre de formation certifié — concurrent direct BU Formation" },
  { name: "SGCI", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "ESN 23+ ans : cyber, audit, formation, digitalisation — recoupe conseil+formation sur le mid-market" },
  { name: "New Digital Africa (ex-NSIA Technologies)", type: "Concurrent", geo: "Afrique francophone", priority: "Moyenne", active: true, note: "Leader services managés/datacenters Afrique francophone, repositionné après rachat" },
  { name: "Inetum Côte d'Ivoire", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "ESN internationale (ex-Somafor 2015), partenaire Sage — conseil et applicatif grands comptes" },
  { name: "Atos", type: "Concurrent", geo: "UEMOA", priority: "Moyenne", active: true, note: "Présent Abidjan Plateau + Dakar, acteur SOC managé Sénégal — comptes bancaires et régulateurs" },
  { name: "MTN Business CI", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Opérateur B2B : réseaux managés, cloud, Security-as-a-Service" },
  { name: "Sonatel CyberDefense", type: "Concurrent", geo: "Sénégal", priority: "Moyenne", active: true, note: "Acteur SOC dominant au Sénégal — barrière d'entrée si expansion Dakar (obligation SOC BCEAO 2025)" },
  { name: "GTN CI", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Basse", active: true, note: "Intégrateur sécurité réseau/identité/email Abidjan" },
  { name: "Cloudmania (Liquid C2)", type: "Concurrent", geo: "Afrique", priority: "Basse", active: true, note: "Microsoft Partner of the Year CI, 22 pays — concurrent sur le CSP/cloud Microsoft" },
  // Extension top 20 concurrents (cartographie terrain 2026 — intégrateurs/ESN Abidjan)
  { name: "CIS (Computer Information Systems)", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Intégrateur historique Abidjan : infrastructures, réseaux, systèmes — recoupe la BU ICT sur le mid-market" },
  { name: "COMPUTEC", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Intégration et distribution IT — matériel, réseaux, solutions bureautiques/serveurs" },
  { name: "OSTEC", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Infrastructures et sécurité IT — concurrent sur les projets réseau/sécurité PME-grands comptes" },
  { name: "COGITEC", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Basse", active: true, note: "Services et infogérance IT — support, maintenance, solutions de gestion" },
  { name: "N'SOCITECH", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Basse", active: true, note: "Intégration réseaux/IT — concurrent sur les déploiements d'infrastructure" },
  { name: "3R", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Basse", active: true, note: "Solutions IT/télécoms — intégration et équipements" },
  { name: "INNOVATEC", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Moyenne", active: true, note: "Intégrateur / services numériques Abidjan (distinct d'Inovatec) — transformation digitale et solutions métier" },
  { name: "DATA PROTECT", type: "Concurrent", geo: "UEMOA", priority: "Haute", active: true, note: "Cybersécurité & conformité (audits PCI DSS, ISO 27001, PASSI) — acteur régional très frontal sur l'axe conformité/audit, notre terrain réglementaire" },
  { name: "TECHSO", type: "Concurrent", geo: "Côte d'Ivoire", priority: "Basse", active: true, note: "Services et solutions IT — intégration et support" },
  // Éditeurs / constructeurs complémentaires
  { name: "WALLIX", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true, note: "Partenariat Premier confirmé (PAM) — annonces produit et programme partenaires" },
  { name: "Odoo", type: "Éditeur", geo: "Afrique de l'Ouest", priority: "Moyenne", active: true, note: "Partenaire Odoo CI — axe ERP/logiciel" },
  { name: "Huawei", type: "Constructeur", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Challenger agressif en CI (ESATIC, formation 1000 Ivoiriens, AO publics) face à Cisco/HPE" },
  { name: "VMware / Broadcom", type: "Éditeur", geo: "Afrique", priority: "Moyenne", active: true, note: "Hausses de prix 800-1500%, purge VCSP — opportunité migrations Nutanix/alternatives" },
  { name: "Kaspersky", type: "Éditeur", geo: "Afrique de l'Ouest", priority: "Moyenne", active: true, note: "Hub ouest-africain à Abidjan (KNext 2026), push EDR/XDR/SOC — partenariat ou concurrence" },
  // Régulateurs générateurs d'obligations monétisables
  { name: "ANSSI-CI", type: "Régulateur", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Audits SI triennaux obligatoires (décret 2021-917), agréments PASSI, RGSSI, OIV — générateur n°1 d'obligations monétisables" },
  { name: "ARTCI", type: "Régulateur", geo: "Côte d'Ivoire", priority: "Haute", active: true, note: "Homologation équipements, données personnelles (loi 2013-450), agréments PSCE" },
  { name: "AMF-UMOA", type: "Régulateur", geo: "Afrique de l'Ouest", priority: "Moyenne", active: true, note: "Instructions mars 2024 sur les SI BRVM/DC-BR/SGI — levier d'upsell direct chez la BRVM cliente" },
  // Éditeurs/distributeurs suivis dans le contexte mais absents de la watchlist (M10 audit 2026-07)
  { name: "Nutanix", type: "Éditeur", geo: "Afrique", priority: "Haute", active: true, note: "Cible de MIGRATION suite aux hausses VMware/Broadcom — opportunité d'offre hyperconvergence ; à capter activement" },
  { name: "Ingram Micro", type: "Distributeur", geo: "Afrique", priority: "Moyenne", active: true, note: "Distributeur pivot de la fusion HPE/Juniper Partner Ready Vantage (01/11/2026)" },
  { name: "TD SYNNEX", type: "Distributeur", geo: "Afrique", priority: "Moyenne", active: true, note: "Distribution mondiale HPE/Juniper Vantage — conditions & lignes de crédit à surveiller" },
  { name: "Dell Technologies", type: "Constructeur", geo: "Afrique", priority: "Moyenne", active: true, note: "Serveurs/stockage — alternative HPE, pipeline refresh datacenter" },
  { name: "Veeam", type: "Éditeur", geo: "Afrique", priority: "Moyenne", active: true, note: "Sauvegarde/DRP — brique récurrente des offres managées et conformité" },
  { name: "Sophos", type: "Éditeur", geo: "Afrique", priority: "Basse", active: true, note: "Endpoint/MDR — concurrence/complément Fortinet sur le mid-market cyber" },
  { name: "Trend Micro", type: "Éditeur", geo: "Afrique", priority: "Basse", active: true, note: "Sécurité cloud/endpoint — veille produit & programme partenaire" },
  { name: "IBM", type: "Éditeur", geo: "Afrique", priority: "Basse", active: true, note: "Infra/QRadar SIEM/services — grands comptes bancaires" },
  // Hyperscalers — menace de désintermédiation (vente/cloud en direct), à surveiller (M11 audit)
  { name: "AWS", type: "Concurrent", geo: "Afrique", priority: "Moyenne", active: true, note: "Hyperscaler — désintermédiation cloud directe ; opportunité de partenariat CSP/revente aussi" },
  { name: "Microsoft Azure", type: "Concurrent", geo: "Afrique", priority: "Moyenne", active: true, note: "Cloud direct + réseau CSP (nous sommes partenaire Microsoft) — ambivalent partenaire/concurrent" },
  { name: "Google Cloud", type: "Concurrent", geo: "Afrique", priority: "Basse", active: true, note: "Hyperscaler — implantations et offres directes en zone à surveiller" },
];

// intelSources seed entries — first jet per BUILD_KIT.md §9.B (AO & financements, réglementaire,
// partenaires), EXPANDED per the "100% automatique" decision with candidate RSS feeds from the
// regional economic/tech press (DELTA_01 §3bis.B: Jeune Afrique, Financial Afrik, Sika Finance,
// Abidjan.net, APA, Agence Ecofin). Feed URLs are standard/best-effort and could NOT be verified
// from the dev sandbox (its network policy blocks those domains) — the pipeline is deliberately
// SELF-CURATING instead: syncSources tracks per-source health (lastStatus, consecutiveFailures)
// and auto-deactivates any source after 5 consecutive failures, so dead candidates prune
// themselves out within a few daily runs and working ones keep feeding the AI classifier.
// NOTE parsing (index.js runSyncSources) : kind 'rss' | 'newsletter' | 'portal' → extractRssItems (XML attendu) ;
// kind 'web' → extractWebText (HTML). Un portail d'AO en HTML (SIGOMAP, ARCOP, DGMP) doit donc être kind: 'web'.
// Les URLs de feeds n'ont pas pu être vérifiées depuis le sandbox (proxy 403) — le pipeline s'auto-cure
// (désactivation après 5 échecs consécutifs), mais vérifier lastStatus après le premier run réel.
const SOURCES_SEED = [
  // Réglementaire / institutions
  { name: "ARTCI — Autorité de Régulation des Télécommunications/TIC de Côte d'Ivoire", kind: "web", url: "https://www.artci.ci", axis: "reglementaire", active: true },
  { name: "BCEAO — Banque Centrale des États de l'Afrique de l'Ouest", kind: "web", url: "https://www.bceao.int", axis: "reglementaire", active: true },
  // Renfort réglementaire (audit 2026-07, Action 3.3)
  { name: "ANSSI-CI — réglementations & agréments PASSI", kind: "web", url: "https://anssi.gouv.ci/reglementations/textes-nationaux/", axis: "reglementaire", active: true },
  { name: "ARTCI — actualités & décisions", kind: "web", url: "https://www.artci.ci/", axis: "reglementaire", active: true },
  { name: "Autorité de protection des données (CI)", kind: "web", url: "https://www.autoritedeprotection.ci/", axis: "reglementaire", active: true },
  { name: "BCEAO — Réglementations", kind: "web", url: "https://www.bceao.int/fr/reglementations", axis: "reglementaire", active: true },
  { name: "AMF-UMOA — Instructions", kind: "web", url: "https://www.amf-umoa.org/reglementation/instruction", axis: "reglementaire", active: true },
  { name: "Ministère de la Transition Numérique — publications", kind: "web", url: "https://telecom.gouv.ci/new/publications/sous-categorie/1", axis: "reglementaire", active: true },
  { name: "Africa Cybersecurity Magazine", kind: "rss", url: "https://cybersecuritymag.africa/feed/", axis: "reglementaire", active: true },
  // AO & financements (audit 2026-07, Actions 3.1 + 3.4 — remplace SIGMAP/ARMP sénégalais/BAD racine).
  // BEST-EFFORT ASSUMÉ (constat 2026-07-18) : SIGOMAP/marchespublics.ci sont des SPA sous WAF + INSCRIPTION
  // obligatoire (depuis nov. 2023), SANS API/RSS publique. Le rendu headless n'en tire souvent que la page
  // d'accueil (« Accès au portail… »), écartée à juste titre par l'évaluateur — d'où un rendement faible.
  // On les GARDE en filet best-effort (elles produisent parfois un avis), mais le canal AO PRIMAIRE est
  // désormais l'API World Bank élargie à toute l'UEMOA (structurée, joignable, une URL par avis).
  { name: "SIGOMAP — portail officiel des marchés publics CI", kind: "web-js", url: "https://www.sigomap.gouv.ci", axis: "clients_prospects", active: true },
  { name: "DGMP — marchespublics.ci (avis d'AO)", kind: "web-js", url: "https://www.marchespublics.ci/appel_offre", axis: "clients_prospects", active: true },
  { name: "ARCOP — Autorité de Régulation de la Commande Publique (ex-ANRMP)", kind: "web-js", url: "https://arcop.ci/", axis: "clients_prospects", active: true },
  // URL d'AO PRÉCISES fournies par l'utilisateur (2026-07-19) + passage en web-js (rendu headless, meilleure
  // chance face au JS/anti-bot). Le seed met à jour l'URL des sources existantes (par nom) et remet les
  // compteurs de santé à zéro. La SANTÉ de chaque source en prod dira laquelle passe (ok) ou reste murée
  // (403/timeout — cas probable de la BAD, WAF Cloudflare déjà constaté).
  { name: "BAD — Corporate procurement (avis d'AO)", kind: "web-js", url: "https://www.afdb.org/en/about-us/corporate-procurement/procurement-notices/current-solicitations", axis: "clients_prospects", active: true },
  // BCEAO/BOAD : kind "portal-ao" (2026-07-19) — DOM réel = liste de LIENS DE DÉTAIL par avis
  // (/fr/appels-offres/{slug}, /fr/opportunites/appels-doffre/{slug}). L'extraction générique les
  // ratait ; l'extracteur dédié (domain/portalTenders) suit chaque lien via `detailPrefix`.
  { name: "BCEAO — Appels d'offres", kind: "portal-ao", url: "https://www.bceao.int/fr/appels-offres/appels-offres-marches-publics-achats", detailPrefix: "/fr/appels-offres/", axis: "clients_prospects", active: true },
  { name: "Banque mondiale — projets Côte d'Ivoire", kind: "web", url: "https://projects.worldbank.org/en/projects-operations/projects-list?countrycode_exact=CI", axis: "clients_prospects", active: true },
  // UEMOA : kind "portal-ao" (preuve DOM 2026-07-19 via noticeHrefs) — les avis sont des PIÈCES
  // JOINTES PDF sous /sites/default/files/opportunite_affaire/ (portail Drupal, pas de page de détail
  // par avis). detailPrefix pointe donc sur ce répertoire : chaque PDF = un avis, son URL = provenance.
  { name: "UEMOA — Appels d'offres", kind: "portal-ao", url: "https://www.uemoa.int/appel-d-offre", detailPrefix: "/sites/default/files/opportunite_affaire/", axis: "clients_prospects", active: true },
  { name: "Banque Atlantique — appels d'offres (client)", kind: "web-js", url: "https://www.banqueatlantique.net/appels-doffres/", axis: "clients_prospects", active: true },
  // Élargissement RÉGIONAL des portails AO (audit pertinence 2026-07, levier 3) : UEMOA/CEDEAO +
  // bailleurs, pour piloter la croissance au-delà de la CI. Une source dont l'URL change/casse se
  // désactive d'elle-même après échecs consécutifs (non bloquant) — voir la santé des sources dans Détection.
  { name: "Sénégal — Marchés publics (DCMP/SYGMAP)", kind: "web-js", url: "https://www.marchespublics.sn/", axis: "clients_prospects", active: true },
  // L'ARMP Sénégal est devenue l'ARCOP et a migré de domaine (preuve DOM 2026-07-20 : armp.sn ne sert
  // qu'un redirect JS « window.location='http://arcop.sn' »). On garde le MÊME nom (clé de re-seed) mais
  // on bascule l'URL sur le nouveau site — même famille de CMS que les ARCOP CI/TG/BF qui, eux,
  // répondent. Le changement d'URL remet les compteurs de santé à zéro (logique de re-seed).
  { name: "ARMP Sénégal — régulation & avis", kind: "web", url: "https://arcop.sn/", axis: "clients_prospects", active: true },
  { name: "Bénin — ARMP (marchés publics)", kind: "web", url: "https://armp.bj/", axis: "clients_prospects", active: true },
  { name: "Burkina Faso — ARCOP (marchés publics)", kind: "web", url: "https://www.arcop.bf/", axis: "clients_prospects", active: true },
  { name: "Mali — DGMP-DSP (marchés publics)", kind: "web", url: "https://dgmp.gouv.ml/", axis: "clients_prospects", active: true },
  { name: "Togo — ARCOP (marchés publics)", kind: "web", url: "https://arcop.tg/", axis: "clients_prospects", active: true },
  { name: "Niger — ARMP (marchés publics)", kind: "web", url: "https://www.armp-niger.org/", axis: "clients_prospects", active: true },
  { name: "BOAD — Appels d'offres", kind: "portal-ao", url: "https://www.boad.org/fr/opportunites/appels-doffre/", detailPrefix: "/fr/opportunites/appels-doffre/", axis: "clients_prospects", active: true },
  { name: "AFD — Appels d'offres & consultations", kind: "web", url: "https://www.afd.fr/fr/appels-offres", axis: "clients_prospects", active: true },
  { name: "UNGM — avis de marchés (agences ONU)", kind: "web-js", url: "https://www.ungm.org/Public/Notice", axis: "clients_prospects", active: true },
  // Concurrents (audit 2026-07, Action 3.2 — aucune source n'existait sur cet axe)
  { name: "CIO Mag (RSS)", kind: "rss", url: "https://cio-mag.com/feed/", axis: "concurrents", active: true },
  { name: "Agence Ecofin — Numérique (RSS)", kind: "rss", url: "https://www.agenceecofin.com/actualites-numerique?format=feed", axis: "concurrents", active: true },
  { name: "Afrique IT News (RSS)", kind: "rss", url: "https://afriqueitnews.com/feed/", axis: "concurrents", active: true },
  { name: "Talentys — actualités & réalisations", kind: "web", url: "https://talentys.ci/nos-realisations/", axis: "concurrents", active: true },
  { name: "SNDI — actualités", kind: "web", url: "https://sndi.ci/", axis: "concurrents", active: true },
  { name: "Orange Business CI", kind: "web", url: "https://business.orange.ci/", axis: "concurrents", active: true },
  { name: "CBI — actualités", kind: "web", url: "https://www.cbi.ma/", axis: "concurrents", active: true },
  // Partenaires / éditeurs (audit 2026-07, Actions 3.1 + 3.5 — remplace les 2 sources Cisco mortes-nées)
  { name: "Cisco EOL/EOS Bulletins", kind: "web", url: "https://www.cisco.com/c/en/us/support/eol/index.html", axis: "partenaires", active: true },
  { name: "Cisco Blogs (RSS)", kind: "rss", url: "https://blogs.cisco.com/feed", axis: "partenaires", active: true }, // remplace le feed JSON newsroom
  { name: "Fortinet Blog (RSS)", kind: "rss", url: "https://www.fortinet.com/blog/rss", axis: "partenaires", active: true },
  { name: "Palo Alto Networks Blog (RSS)", kind: "rss", url: "https://www.paloaltonetworks.com/blog/feed/", axis: "partenaires", active: true },
  { name: "HPE Newsroom", kind: "web", url: "https://www.hpe.com/us/en/newsroom.html", axis: "partenaires", active: true },
  { name: "WALLIX Newsroom", kind: "web", url: "https://www.wallix.com/newsroom/", axis: "partenaires", active: true },
  { name: "Microsoft Partner Blog", kind: "web", url: "https://partner.microsoft.com/en-US/blog", axis: "partenaires", active: true },
  { name: "Westcon-Comstor — News (distributeur)", kind: "web", url: "https://www.westconcomstor.com/global/en/news.html", axis: "partenaires", active: true },
  { name: "Exclusive Networks — Media centre (distributeur)", kind: "web", url: "https://www.exclusive-networks.com/resources/media-centre/news", axis: "partenaires", active: true },
  { name: "Huawei — News", kind: "web", url: "https://www.huawei.com/en/news", axis: "partenaires", active: true },
  { name: "Broadcom Newsroom (VMware)", kind: "web", url: "https://news.broadcom.com/", axis: "partenaires", active: true },
  // Presse économique / tech régionale (candidats RSS — auto-élagués si morts)
  { name: "Agence Ecofin (RSS)", kind: "rss", url: "https://www.agenceecofin.com/rss/toute-lactu", axis: "clients_prospects", active: true },
  { name: "Jeune Afrique (RSS)", kind: "rss", url: "https://www.jeuneafrique.com/feed/", axis: "clients_prospects", active: true },
  { name: "Financial Afrik (RSS)", kind: "rss", url: "https://www.financialafrik.com/feed/", axis: "clients_prospects", active: true },
  { name: "Sika Finance (RSS)", kind: "rss", url: "https://www.sikafinance.com/rss/news", axis: "clients_prospects", active: true },
  { name: "Abidjan.net Actualités (RSS)", kind: "rss", url: "https://news.abidjan.net/rss", axis: "clients_prospects", active: true },
  { name: "APA News (RSS)", kind: "rss", url: "https://apanews.net/feed/", axis: "clients_prospects", active: true },
  // Mouvements d'acteurs — créations d'entreprises, investissements, implantations, expansions
  // ("guetter les opportunités liées à la création/arrivée de nouvelles entreprises, l'expansion
  // de groupes régionaux ou internationaux", 2026-07). Candidates auto-élaguées si mortes.
  { name: "CEPICI — investissements & création d'entreprises (CI)", kind: "web-js", url: "https://www.cepici.gouv.ci/", axis: "clients_prospects", active: true },
  { name: "Fraternité Matin — Économie", kind: "web", url: "https://www.fratmat.info/", axis: "clients_prospects", active: true },
  { name: "Agence Ecofin — Entreprises (RSS)", kind: "rss", url: "https://www.agenceecofin.com/entreprises?format=feed", axis: "concurrents", active: true },
  { name: "Jeune Afrique — Économie & Entreprises", kind: "web", url: "https://www.jeuneafrique.com/economie-entreprises/", axis: "clients_prospects", active: true },
  // Tendances tech / cybersécurité (mondial, pertinent pour le Tech Radar)
  { name: "The Hacker News (RSS)", kind: "rss", url: "https://feeds.feedburner.com/TheHackersNews", axis: "tech", active: true },
  { name: "BleepingComputer (RSS)", kind: "rss", url: "https://www.bleepingcomputer.com/feed/", axis: "tech", active: true },
  // Équilibrage des feeds mondiaux anglophones (audit 2026-07, Action 3.6)
  { name: "Check Point Blog (RSS)", kind: "rss", url: "https://blog.checkpoint.com/feed/", axis: "tech", active: true },
  { name: "We Are Tech Africa (RSS)", kind: "rss", url: "https://www.wearetech.africa/fr/?format=feed", axis: "tech", active: true },
  // Enjeux « critiques » du modèle économique jusqu'ici sans capteur (M10 audit 2026-07) :
  // change (FX USD/XOF), douanes à l'import, talents/salaires ingénieurs cyber/cloud.
  { name: "BCEAO — Taux & cours de change", kind: "web", url: "https://www.bceao.int/fr/cours-de-change", axis: "reglementaire", active: true },
  // Douanes en détail (M10 audit) : actualités, tarifs à l'import, guichet unique du commerce extérieur.
  { name: "Direction Générale des Douanes CI — actualités & tarifs", kind: "web-js", url: "https://www.douanes.ci/", axis: "reglementaire", active: true },
  { name: "Douanes CI — communiqués & circulaires", kind: "web-js", url: "https://www.douanes.ci/actualites", axis: "reglementaire", active: true },
  { name: "GUCE-CI — Guichet Unique du Commerce Extérieur (actualités import)", kind: "web-js", url: "https://www.guce.gouv.ci/", axis: "reglementaire", active: true },
  { name: "Ministère du Commerce CI — réglementation import/export", kind: "web-js", url: "https://www.commerce.gouv.ci/", axis: "reglementaire", active: true },
  // Jobboards / tension talents (M10 audit) : recrutements IT/cyber/cloud = chaleur du marché,
  // expansion de concurrents, veille salaires ingénieurs rares.
  { name: "Emploi.ci — offres IT/télécom (tension talents)", kind: "web-js", url: "https://www.emploi.ci/recherche-jobs-cote-ivoire/informatique-t%C3%A9l%C3%A9com", axis: "concurrents", active: true },
  { name: "Educarriere.ci — offres d'emploi informatique", kind: "web-js", url: "https://emploi.educarriere.ci/", axis: "concurrents", active: true },
  { name: "Novojob Côte d'Ivoire — IT/télécom", kind: "web-js", url: "https://www.novojob.com/cote-d-ivoire/offres-d-emploi", axis: "concurrents", active: true },
  { name: "RMO Jobcenter CI — offres IT", kind: "web-js", url: "https://www.rmo-jobcenter.com/", axis: "concurrents", active: true },
  // Distributeurs pivots de la fusion HPE/Juniper Vantage & éditeur cible de migration VMware (M10).
  // Désactivée (revue santé 2026-07-20) : newsroom SPA JS que l'extracteur lit mal (dégradée 5/8),
  // faible valeur (distributeur). La veille Ingram Micro passe déjà par le monitor d'entité watchlist.
  { name: "Ingram Micro — Newsroom", kind: "web", url: "https://www.ingrammicro.com/en-us/newsroom", axis: "partenaires", active: false },
  { name: "TD SYNNEX — Newsroom", kind: "web", url: "https://www.tdsynnex.com/na/us/news-events/", axis: "partenaires", active: true },
  { name: "Nutanix — Blog (RSS)", kind: "rss", url: "https://www.nutanix.com/blog/rss.xml", axis: "partenaires", active: true },
  // Couverture régionale réelle (M11 audit) : filiale Burkina, expansion Sénégal/UEMOA.
  { name: "Direction Générale des Marchés Publics — Burkina Faso", kind: "web", url: "https://www.dgmp.gov.bf/", axis: "clients_prospects", active: true },
  { name: "ARCEP Burkina Faso — actualités", kind: "web", url: "https://www.arcep.bf/actualites/", axis: "reglementaire", active: true },
  // BAILLEURS — flux STRUCTURÉS (fiabilisation AO 2026-07) : l'API JSON World Bank Procurement Notices
  // fournit des avis avec URL + pays + échéance + référence par avis (contrairement aux portails
  // nationaux JS qui se scrapent mal). C'est là que se trouvent les gros AO ICT/infra financés en
  // CI/UEMOA. kind "wb-procnotices" → parseur dédié (domain/donorFeeds.js), provenance forcée.
  // Endpoint procnotices = API v2 (le v3 n'existe que pour les documents/wds — le v3 renvoyait 404,
  // corrigé après validation live 2026-07). format=json + apilang=en.
  { name: "Banque Mondiale — Avis d'AO Côte d'Ivoire (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=20&order=desc&srt=noticedate&countryname_exact=Cote%20d%27Ivoire", axis: "clients_prospects", active: true },
  { name: "Banque Mondiale — Avis d'AO Sénégal (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Senegal", axis: "clients_prospects", active: true },
  // Couverture UEMOA (révisé 2026-07-18, APRÈS validation prod) : le portail national CI
  // (SIGOMAP/marchespublics.ci) est un SPA sous WAF + inscription, sans API/RSS publique → non scrapable.
  // On voulait élargir l'API World Bank pays par pays pour toute l'UEMOA — MAIS la validation montre que
  // l'endpoint procnotices IGNORE le filtre pays (`countryname_exact`) : chaque requête pays renvoie le
  // MÊME flux MONDIAL (Éthiopie/Inde/Pakistan en tête), dédoublonné → 0 avis distinct (les 6 sources pays
  // n'ont produit AUCUNE ligne AO après 3 synchros). Elles sont donc REDONDANTES → désactivées.
  // Le vrai levier : le flux étant mondial trié par date, on ÉLARGIT LA FENÊTRE (rows) d'UNE requête et on
  // laisse geoFromCountry extraire les avis ouest-africains (UEMOA/CEDEAO) — plus d'AO en zone qu'avec 6
  // requêtes pays identiques. rows relevé à 200 sur la requête région (parseur plafonné à 40 après filtre géo).
  { name: "Banque Mondiale — Avis d'AO Bénin (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Benin", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Burkina Faso (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Burkina%20Faso", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Mali (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Mali", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Niger (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Niger", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Togo (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Togo", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Guinée-Bissau (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=15&order=desc&srt=noticedate&countryname_exact=Guinea-Bissau", axis: "clients_prospects", active: false },
  { name: "Banque Mondiale — Avis d'AO Afrique de l'Ouest (API)", kind: "wb-procnotices", url: "https://search.worldbank.org/api/v2/procnotices?format=json&apilang=en&rows=200&order=desc&srt=noticedate&regionname_exact=Western%20and%20Central%20Africa", axis: "clients_prospects", active: true },
  // UNGM — place de marché ONU. DOUBLON RETIRÉ (validation prod 2026-07-19) : une source UNGM (« UNGM —
  // avis de marchés (agences ONU) », même URL) existait DÉJÀ en base et remonte « ok » (donc UNGM n'est
  // PAS bloqué par WAF, contrairement à la BAD). Mais elle yield 0 avis : le rendu headless charge la SPA,
  // l'extraction générique (extractWebItems) n'attrape pas ses lignes d'avis. Pour la rendre productive il
  // faudrait un PARSEUR DÉDIÉ ciblant sa structure réelle (comme wb-procnotices) — non faisable à l'aveugle
  // (sa réponse 403 nos sondes de dev). Cette entrée est donc INACTIVE (le doublon actif suffit à surveiller
  // la joignabilité). Les agrégateurs commerciaux (AfricaTenders/dgMarket/GlobalTenders/DevelopmentAid) :
  // écartés (détail derrière login/abonnement + ToS + revendent ces mêmes primaires).
  { name: "UNGM — Avis d'achat ONU (agences UN, IT/équipement)", kind: "web-js", url: "https://www.ungm.org/Public/Notice", axis: "clients_prospects", active: false },
  // SangoBids — test empirique demandé (agrégateur CI/UEMOA francophone qui compile DGMP/WB/BAD/BCEAO/UNGM).
  // App mobile gratuite + listing web CI. On TESTE si le listing est consultable/rendu (web-js) ou 403/login :
  // la SANTÉ de la source en prod tranchera. Note ToS assumée (scraping d'un agrégateur tiers) — décision
  // métier de l'utilisateur. Si stérile/403 répété → auto-désactivation, aucune casse.
  { name: "SangoBids — appels d'offres CI (agrégateur)", kind: "web-js", url: "https://ci.sangobids.com/tenders", axis: "clients_prospects", active: true },
  // BAD (AfDB) — flux RSS procurement : URL correctes mais le WAF Cloudflare de la BAD renvoie 403,
  // Y COMPRIS via le rendu headless (défi anti-bot HTML servi à la place du flux, validation prod
  // 2026-07-18). Mur externe irrécupérable depuis nos IP cloud. Laissées INACTIVES et documentées :
  // la BAD reste couverte par « BAD — Corporate procurement », le moniteur « AO client — BAD »
  // (Google News) et la Banque Mondiale (cofinancements). `active: false` → le seed les désactive.
  { name: "BAD — Sollicitations en cours (RSS procurement)", kind: "rss", url: "https://www.afdb.org/en/about-us/corporate-procurement/procurement-notices/current-solicitations/rss", axis: "clients_prospects", active: false },
  { name: "BAD — Avis d'appel d'offres projets (RSS)", kind: "rss", url: "https://www.afdb.org/en/documents/project-related-procurement/procurement-notices/invitation-for-bids/rss", axis: "clients_prospects", active: false },
  // (Doublon retiré — audit 2026-07 : marchespublics.sn est déjà couvert par « Sénégal — Marchés
  // publics (DCMP/SYGMAP) » en kind web-js plus haut. Deux entrées même URL = double fetch/IA.)
  { name: "Sénégal — Sika Finance / actu UEMOA", kind: "rss", url: "https://www.sikafinance.com/rss/actualites_bourse_brvm", axis: "clients_prospects", active: true },
  // Menace de désintermédiation par les hyperscalers (M11 audit) : implantations directes en zone.
  { name: "AWS — What's New / Africa (RSS)", kind: "rss", url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/", axis: "concurrents", active: true },
  { name: "Google Cloud — Blog (RSS)", kind: "rss", url: "https://cloudblog.withgoogle.com/rss/", axis: "concurrents", active: true },
  { name: "Microsoft Azure — Blog announcements (RSS)", kind: "rss", url: "https://azure.microsoft.com/en-us/blog/feed/", axis: "concurrents", active: true },
];

/**
 * Note de crédibilité (code de l'amirauté "A1".."F5") par défaut d'une source (M7 audit 2026-07).
 * Sans ça, toutes les sources tombaient à "C3" en dur → crédibilité aplatie dans le scoring
 * (la BCEAO notée comme un blog obscur). Heuristique par nature de la source :
 *   - Institutions/régulateurs officiels : A2 (fiable, généralement confirmé).
 *   - Éditeurs/constructeurs/distributeurs officiels (newsroom/blog) : B2.
 *   - Flux cyber mondiaux reconnus : B3 (fiable mais non local/business).
 *   - Presse économique/tech régionale établie : C2.
 *   - Sites corporate de concurrents (auto-promotionnels) : C3.
 *   - Reste : C3 (neutre prudent).
 */
function ratingForSource(entry) {
  const n = (entry.name || "").toLowerCase();
  const url = (entry.url || "").toLowerCase();
  const official = ["artci", "bceao", "anssi", "amf-umoa", "amf umoa", "ministère", "ministere", "douanes", "guce", "commerce.gouv", "dgi", "trésor", "tresor", "dgmp", "marchespublics", "sigomap", "arcop", "cepici", "banque mondiale", "world bank", "worldbank", "bad", "afdb", "uemoa", "boad", "ungm", "united nations", "onu", "autorité de protection", "autorite de protection"];
  if (official.some((k) => n.includes(k) || url.includes(k.replace(/\s/g, "")))) return "A2";
  const vendors = ["cisco", "fortinet", "palo alto", "paloalto", "hpe", "wallix", "microsoft", "azure", "huawei", "broadcom", "vmware", "westcon", "exclusive", "nutanix", "veeam", "ingram", "tdsynnex", "td synnex", "aws", "amazon", "google cloud"];
  if (vendors.some((k) => n.includes(k) || url.includes(k.replace(/\s/g, "")))) return "B2";
  const globalCyber = ["hacker news", "hackernews", "bleepingcomputer", "bleeping", "check point", "checkpoint"];
  if (globalCyber.some((k) => n.includes(k) || url.includes(k.replace(/\s/g, "")))) return "B3";
  const press = ["jeune afrique", "financial afrik", "agence ecofin", "ecofin", "cio mag", "cio-mag", "afrique it news", "afriqueitnews", "sika finance", "sikafinance", "fraternité", "fratmat", "we are tech", "wearetech", "apa news", "apanews", "abidjan.net", "cybersecurity"];
  if (press.some((k) => n.includes(k) || url.includes(k.replace(/\s/g, "")))) return "C2";
  const competitors = ["talentys", "sndi", "orange business", "cbi", "inovatec", "oc2s"];
  if (competitors.some((k) => n.includes(k) || url.includes(k.replace(/\s/g, "")))) return "C3";
  return "C3";
}

async function seed() {
  initializeApp();
  // FIRESTORE_DATABASE_ID: set this when this project is shared with other apps, to seed the
  // dedicated named database (e.g. "strategic360") instead of "(default)" — see index.js's
  // matching comment and functions/.env.example. Falls back to "(default)" when unset.
  const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
  const db = databaseId === "(default)" ? getFirestore() : getFirestore(databaseId);

  await db.doc("config/permissions").set({ matrix: DEFAULT_PERMISSIONS_MATRIX });
  console.log("Seeded config/permissions with default RBAC matrix.");

  const watchlistCol = db.collection("intelWatchlist");
  for (const entry of WATCHLIST_SEED) {
    const existing = await watchlistCol.where("name", "==", entry.name).limit(1).get();
    if (existing.empty) {
      await watchlistCol.add(entry);
    }
  }
  console.log(`Seeded intelWatchlist (${WATCHLIST_SEED.length} entries, idempotent by name).`);

  const sourcesCol = db.collection("intelSources");
  let kindMigrated = 0;
  let reactivated = 0;
  let deactivated = 0;
  let urlFixed = 0;
  // Garde anti-doublon (audit 2026-07) : la dédup persistée se fait par NOM, donc deux entrées de
  // même URL mais nom différent créeraient deux sources fetchées/classées en double. On le signale
  // au seed pour l'attraper en revue plutôt qu'en prod.
  const seenUrls = new Map();
  for (const s of SOURCES_SEED) {
    const u = String(s.url || "").trim().replace(/\/+$/, "").toLowerCase();
    if (!u) continue;
    if (seenUrls.has(u)) console.warn(`⚠︎ SOURCES_SEED : URL en double (${s.url}) — « ${seenUrls.get(u)} » et « ${s.name} ». Fusionnez-les.`);
    else seenUrls.set(u, s.name);
  }
  for (const entry of SOURCES_SEED) {
    const existing = await sourcesCol.where("name", "==", entry.name).limit(1).get();
    const sourceRating = entry.sourceRating || ratingForSource(entry);
    if (existing.empty) {
      await sourcesCol.add({ ...entry, sourceRating, lastFetch: null });
    } else {
      const doc = existing.docs[0];
      const cur = doc.data();
      const patch = {};
      // Rétro-remplissage (M7 audit) : note de crédibilité si absente.
      if (!cur.sourceRating) patch.sourceRating = sourceRating;
      // Migration du `kind` défini au seed (ex. passage web → web-js pour les portails anti-bot/JS).
      if (entry.kind && cur.kind !== entry.kind) { patch.kind = entry.kind; kindMigrated += 1; }
      // Config d'extraction portail (kind portal-ao) : le motif de lien de détail doit être écrit sur
      // le doc existant (sinon l'extracteur retombe sur le chemin de la page liste et ne capte rien).
      if (entry.detailPrefix && cur.detailPrefix !== entry.detailPrefix) { patch.detailPrefix = entry.detailPrefix; }
      // Correction d'URL (ex. endpoint API World Bank v3→v2) : le seed est la source de vérité de
      // l'URL canonique — si elle change, on met à jour + on remet les compteurs de santé à zéro
      // (l'ancienne URL avait pu accumuler des échecs/désactiver la source).
      if (entry.url && cur.url !== entry.url) { patch.url = entry.url; patch.consecutiveFailures = 0; patch.consecutiveEmpty = 0; if (cur.active === false && entry.active) patch.active = true; urlFixed += 1; }
      // Réactive une source que l'auto-curation a désactivée mais que le seed veut active : on lui
      // redonne sa chance avec le nouveau moteur (fetch durci / rendu headless) et un compteur remis à 0.
      if (entry.active && cur.active === false) { patch.active = true; patch.consecutiveFailures = 0; patch.consecutiveEmpty = 0; reactivated += 1; }
      // Désactivation pilotée par le seed (symétrique) : une source explicitement `active: false` dans
      // le seed (ex. flux BAD bloqués en 403 par le WAF, canal irrécupérable) est désactivée en base
      // au lieu de laisser l'auto-curation accumuler 5 échecs avant de la couper.
      else if (entry.active === false && cur.active !== false) { patch.active = false; deactivated += 1; }
      if (Object.keys(patch).length) await doc.ref.update(patch);
    }
  }
  console.log(`Seeded intelSources (${SOURCES_SEED.length} entries; ${kindMigrated} kind migré(s) web→web-js, ${reactivated} réactivée(s), ${deactivated} désactivée(s), ${urlFixed} URL corrigée(s)).`);

  // Contexte entreprise DYNAMIQUE (frameworks/companyContext) — seedé depuis le fichier statique
  // uniquement s'il n'existe pas encore. updatedBy "ai:seed" (préfixe "ai:") laisse
  // l'enrichissement hebdo le rafraîchir ; dès qu'un humain l'édite (Cadres > Contexte), la garde
  // writeFrameworkDoc le protège de toute réécriture IA.
  const { COMPANY_CONTEXT } = require("./domain/companyContext");
  const contextRef = db.doc("frameworks/companyContext");
  const contextSnap = await contextRef.get();
  if (!contextSnap.exists) {
    await contextRef.set({
      key: "companyContext",
      content: { text: COMPANY_CONTEXT, changes: [] },
      version: 1,
      updatedBy: "ai:seed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log("Seeded frameworks/companyContext (contexte entreprise dynamique).");
  } else {
    // Rebasage de la ligne de base IA : si le contexte live est encore maintenu par l'IA
    // (updatedBy commence par "ai:") ET que la base statique est plus riche (plus longue), on
    // pousse le nouveau socle enrichi (partenaires/clients/concurrents étendus). Un contexte
    // édité par la Direction (updatedBy sans préfixe "ai:") n'est JAMAIS touché.
    const data = contextSnap.data() || {};
    const liveText = data?.content?.text || "";
    const isAiMaintained = typeof data.updatedBy === "string" && data.updatedBy.startsWith("ai:");
    if (isAiMaintained && COMPANY_CONTEXT.length > liveText.length) {
      await contextRef.set(
        {
          content: { text: COMPANY_CONTEXT, changes: ["Socle enrichi : partenaires technologiques (30), clients/cibles (top 50), concurrents (top 20)."] },
          version: (typeof data.version === "number" ? data.version : 1) + 1,
          updatedBy: "ai:seed",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log("Rebased frameworks/companyContext sur le socle statique enrichi (AI-maintained, plus riche).");
    } else {
      console.log("frameworks/companyContext conservé (édité par un humain ou déjà à jour).");
    }
  }

  // Bootstrap marker consumed by setUserRole (functions/index.js): stays `false` until the
  // first `direction` account is provisioned via setUserRole, at which point the function
  // flips it to `true` itself. We only ensure the doc exists here so it doesn't 404 on first read.
  const bootstrapRef = db.doc("config/bootstrap");
  const bootstrapSnap = await bootstrapRef.get();
  if (!bootstrapSnap.exists) {
    await bootstrapRef.set({ done: false, ts: FieldValue.serverTimestamp() });
    console.log("Initialized config/bootstrap { done: false }.");
  }

  console.log("Seed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
