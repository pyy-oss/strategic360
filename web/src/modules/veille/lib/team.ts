/**
 * team.ts — COCKPIT « MON ÉQUIPE » (levier « waouh » n°7). Le trou pointé par l'audit : toute
 * l'intelligence (réserve captée/disponible, deals chauds, veille, win-rate) est calculée au niveau
 * PORTEFEUILLE, jamais agrégée par COMMERCIAL. Ici on regroupe les comptes du Copilote par owner
 * (e-mail) pour donner au Directeur Commercial une vue forecast + couverture + prochaine action par
 * tête — sans nouveau moteur, pure agrégation. PUR.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import type { CopiloteAccount } from "./copilote";

/* --------------------------------------------------------------------------------------------- *
 * Cibles commerciales (waouh v2) — objectif de forecast pondéré par commercial (owner e-mail),
 * stocké dans strategic360 (salesTargets/current) car nt360 est en lecture seule. Éditable par les
 * managers ; sert à afficher la COUVERTURE (forecast vs target) dans le cockpit équipe.
 * ------------------------------------------------------------------------------------------- */
const TARGETS_DOC = doc(db, "salesTargets", "current");

export function useSalesTargets(): { targets: Record<string, number>; loading: boolean } {
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      TARGETS_DOC,
      (snap) => { setTargets((snap.exists() ? (snap.data().targets as Record<string, number>) : {}) || {}); setLoading(false); },
      () => { setTargets({}); setLoading(false); }
    );
    return unsub;
  }, []);
  return { targets, loading };
}

/** Définit (ou efface si ≤0) la cible d'un commercial. Réservé managers (garde serveur). */
export async function setSalesTarget(owner: string, value: number): Promise<void> {
  await setDoc(TARGETS_DOC, { targets: { [owner]: value > 0 ? Math.round(value) : 0 } }, { merge: true });
}

export interface OwnerNextAction {
  account: string;
  action: string; // prochaine meilleure action (déclencheur veille / signal / reco)
  why: string;    // pourquoi maintenant
  montant: number; // valeur associée (XOF) si connue
}

export interface OwnerCockpit {
  owner: string;
  comptes: number;
  pipelinePondere: number;   // forecast pondéré (somme)
  reserveDisponible: number; // whitespace + upsell non capté (somme)
  wins: number;
  dealsChauds: number;       // comptes avec un signal de veille chaud
  veilleTriggers: number;    // nombre de déclencheurs de veille rattachés
  topComptes: { nom: string; pipelinePondere: number; score: number }[];
  prochainesActions: OwnerNextAction[];
}

function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** aggregateTeam(accounts) → un cockpit par owner (trié par pipeline pondéré décroissant). PUR. */
export function aggregateTeam(accounts: CopiloteAccount[]): OwnerCockpit[] {
  const byOwner = new Map<string, CopiloteAccount[]>();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const owners = Array.isArray(a.owners) && a.owners.length ? a.owners : ["(non attribué)"];
    for (const o of owners) {
      const key = String(o || "(non attribué)").trim().toLowerCase() || "(non attribué)";
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(a);
    }
  }

  const cockpits: OwnerCockpit[] = [];
  for (const [owner, accs] of byOwner) {
    let pipe = 0, reserve = 0, wins = 0, chauds = 0, triggers = 0;
    // Chaque action porte une PRIORITÉ (type de déclencheur) et la VALEUR du compte, pour un classement
    // pertinent — sinon (bug constaté 2026-07) les centaines de replis génériques « Cross-sell ICT » au
    // même montant plat ne se départageaient plus et l'ordre alphabétique faisait remonter des comptes
    // minuscules devant les gros. On classe : priorité (vrai déclencheur d'abord) > montant > valeur compte.
    const ranked: { action: OwnerNextAction; prio: number; accountValue: number }[] = [];
    const topComptes: { nom: string; pipelinePondere: number; score: number }[] = [];
    for (const a of accs) {
      const nt = a.nt360 || {};
      const p = num(nt.pipelinePondere);
      pipe += p;
      reserve += num(nt.whitespacePotential) + num(nt.upsellHeadroom);
      wins += num(nt.wins);
      const veille = nt.veille;
      if (veille?.hot) chauds += 1;
      triggers += num(veille?.count);
      topComptes.push({ nom: a.nom, pipelinePondere: p, score: num(nt.scorePotentiel) });
      // Valeur du compte = pipeline pondéré + CA réalisé (proxy d'importance), repli sur le score potentiel.
      const accountValue = p + num(nt.casTotal) || num(nt.scorePotentiel);
      // Prochaine meilleure action : déclencheur veille chaud > veille > offre événementielle > reco whitespace.
      const topVeille = veille?.top?.[0];
      const eventOffer = nt.eventOffers?.[0];
      if (topVeille) {
        // Un déclencheur veille (veille.top) ne porte pas de montant propre : ne PAS emprunter le
        // montant d'un eventOffer sans rapport (chiffrage trompeur, audit v2) → 0 = « à chiffrer ».
        ranked.push({ action: { account: a.nom, action: topVeille.soWhat || topVeille.title, why: `Veille : ${topVeille.title}`, montant: 0 }, prio: veille?.hot ? 4 : 3, accountValue });
      } else if (eventOffer) {
        ranked.push({ action: { account: a.nom, action: `Proposer ${eventOffer.offre}`, why: eventOffer.event || "opportunité offre", montant: num(eventOffer.montant) }, prio: 2, accountValue });
      } else if (nt.whitespaceValue?.[0]) {
        ranked.push({ action: { account: a.nom, action: `Cross-sell ${nt.whitespaceValue[0].offre}`, why: "réserve de valeur non captée", montant: num(nt.whitespaceValue[0].montant) }, prio: 1, accountValue });
      }
    }
    topComptes.sort((x, y) => y.pipelinePondere - x.pipelinePondere || y.score - x.score);
    // Priorité d'abord (vrai déclencheur avant repli générique), puis montant, puis valeur du compte,
    // puis nom (ordre stable) — les actions montrées sont celles des comptes qui COMPTENT.
    ranked.sort((x, y) => y.prio - x.prio || y.action.montant - x.action.montant || y.accountValue - x.accountValue || x.action.account.localeCompare(y.action.account));
    const actions = ranked.map((r) => r.action);
    cockpits.push({
      owner,
      comptes: accs.length,
      pipelinePondere: Math.round(pipe),
      reserveDisponible: Math.round(reserve),
      wins,
      dealsChauds: chauds,
      veilleTriggers: triggers,
      topComptes: topComptes.slice(0, 4),
      prochainesActions: actions.slice(0, 4),
    });
  }
  cockpits.sort((a, b) => b.pipelinePondere - a.pipelinePondere);
  return cockpits;
}
