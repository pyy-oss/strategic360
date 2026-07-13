/**
 * signalMessage.ts — MESSAGE PRÊT-À-ENVOYER (levier « waouh » n°4). À partir d'un signal de veille,
 * compose de façon DÉTERMINISTE (aucun appel IA, instantané, gratuit) une prise de contact
 * commerciale : QUI (l'entité citée), POURQUOI MAINTENANT (le so-what / l'échéance), un corps rédigé
 * prêt à copier/coller ou envoyer en WhatsApp. Le commercial édite s'il veut, mais part d'un vrai
 * brouillon — plus de « page blanche » sur chaque signal chaud. PUR.
 */
import type { IntelItem } from "./intel";

const AXIS_THEME: Record<string, string> = {
  reglementaire: "la mise en conformité et la sécurisation de vos systèmes",
  tech: "votre transformation technologique (cloud, cybersécurité, data/IA)",
  concurrents: "votre positionnement face aux mouvements du marché",
  clients_prospects: "vos projets d'infrastructure et de services managés",
  partenaires: "vos partenariats technologiques et écosystème",
};

const PROX_URGENCE: Record<string, string> = {
  imminent: "Le calendrier est court",
  court: "La fenêtre est proche",
};

function firstSentence(s: string, max = 180): string {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const cut = t.slice(0, max);
  const dot = cut.search(/[.!?](\s|$)/);
  return (dot > 20 ? cut.slice(0, dot + 1) : cut).trim();
}

export interface SignalMessage { objet: string; corps: string }

/** buildSignalMessage(item) → { objet, corps } prêt à envoyer. PUR, déterministe. */
export function buildSignalMessage(item: Partial<IntelItem>): SignalMessage {
  const ent = (item.ent || "").trim();
  const cible = ent || "votre organisation";
  const theme = AXIS_THEME[item.axis || ""] || "vos enjeux IT et cybersécurité";
  const pourquoi = firstSentence(item.soWhat || item.summary || item.title || "");
  const urgence = PROX_URGENCE[item.prox || ""] || "";
  const dueLine = item.dueDate ? ` (échéance annoncée : ${item.dueDate})` : "";
  const action = firstSentence(item.recommendedAction || "", 160);

  const objet = ent ? `Neurones Technologies — au sujet de ${ent}` : `Neurones Technologies — ${firstSentence(item.title || "", 60) || "opportunité"}`;

  const corps = [
    "Bonjour,",
    "",
    `Je me permets de vous contacter au sujet de ${cible}.`,
    pourquoi ? `${pourquoi}${dueLine}.${urgence ? " " + urgence + "." : ""}` : "",
    `Chez Neurones Technologies, nous accompagnons les organisations comme la vôtre sur ${theme}.`,
    action ? `Concrètement : ${action.replace(/\.$/, "")}.` : "",
    "",
    "Seriez-vous disponible pour un court échange cette semaine ?",
    "",
    "Bien à vous,",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  return { objet, corps };
}

/** Lien WhatsApp « clic pour envoyer » (texte pré-rempli). */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Lien mailto (objet + corps pré-remplis) — ouvre le client e-mail (audit v2). */
export function mailtoHref(objet: string, corps: string): string {
  return `mailto:?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
}
