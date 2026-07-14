import React from "react";
import { T } from "./tokens";

/**
 * BrandMark — logo de Sentinel : un pictogramme RADAR (balayage + blip) dans une pastille dégradée
 * plum. Réutilisé dans le header de l'app et l'écran de connexion (source unique — plus de lettre
 * « S » dupliquée). Le radar évoque la veille/détection, cœur du produit. Rendu net à petite taille
 * (arcs ouverts + faisceau + point). Couleur du tracé = fond sombre (#0E1613) sur la pastille claire.
 */
export function BrandMark({ size = 36 }: { size?: number }) {
  const inner = Math.round(size * 0.6);
  return (
    <div
      aria-label="Sentinel"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: `linear-gradient(135deg,${T.plum},#6b4f86)`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none" stroke="#0E1613" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {/* Arcs de radar (ouverts, façon écran de veille) */}
        <path d="M21 12a9 9 0 1 1-3.4-7.05" />
        <path d="M16.5 12a4.5 4.5 0 1 0-1.7 3.52" />
        {/* Faisceau de balayage */}
        <line x1="12" y1="12" x2="20.4" y2="5.2" />
        {/* Centre + blip détecté */}
        <circle cx="12" cy="12" r="1.05" fill="#0E1613" stroke="none" />
        <circle cx="17" cy="8.4" r="1.35" fill="#0E1613" stroke="none" />
      </svg>
    </div>
  );
}
