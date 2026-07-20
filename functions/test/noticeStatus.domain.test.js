"use strict";

/** Tests de la distinction AVIS OUVERT vs RÉSULTAT/ATTRIBUTION (audit final). PUR. */

import { describe, it, expect } from "vitest";
import { deriveNoticeKind, isOpenNotice } from "../domain/noticeStatus.js";

describe("noticeStatus — deriveNoticeKind", () => {
  it("avis ouvert par défaut", () => {
    expect(deriveNoticeKind({ title: "Acquisition d'équipements réseau pour le datacenter" })).toBe("notice");
    expect(deriveNoticeKind({ title: "Appel d'offres international — fourniture de licences" })).toBe("notice");
    expect(isOpenNotice({ title: "Consultation pour la maintenance du SI" })).toBe(true);
  });

  it("détecte les résultats/attributions par le titre (UEMOA & co.)", () => {
    expect(deriveNoticeKind({ title: "Attribution provisoire d'un marché de licences Microsoft 365" })).toBe("award");
    expect(deriveNoticeKind({ title: "Infructuosité de l'appel d'offres DAOI-349" })).toBe("award");
    expect(deriveNoticeKind({ title: "Décision d'attribution — travaux de voirie" })).toBe("award");
    expect(isOpenNotice({ title: "Procès-verbal d'attribution" })).toBe(false);
  });

  it("détecte les résultats par le nom de fichier PDF (portail Drupal UEMOA)", () => {
    const base = "https://www.uemoa.int/sites/default/files/opportunite_affaire/";
    expect(deriveNoticeKind({ url: `${base}PV_attribution_provisoire_DAOI_acquisition_licence_MICROSOFT_365.pdf` })).toBe("award");
    expect(deriveNoticeKind({ url: `${base}Decision_infructuosite_DAOI_349.pdf` })).toBe("award");
    expect(deriveNoticeKind({ url: `${base}Synthese_depouillement_AO_012-2026.pdf` })).toBe("award");
    // Un vrai avis ouvert (fichier « AVIS_… » / « AOI_… ») reste "notice".
    expect(deriveNoticeKind({ url: `${base}AOI_equipement_datacenter_reseau_local_CAM.pdf` })).toBe("notice");
    expect(deriveNoticeKind({ url: `${base}Avis_consultation_semences.PDF` })).toBe("notice");
  });

  it("détecte l'attribution via le notice_type de l'API bailleur", () => {
    expect(deriveNoticeKind({ noticeType: "Contract Award", title: "Fourniture" })).toBe("award");
    expect(deriveNoticeKind({ noticeType: "Request for Bids", title: "Fourniture" })).toBe("notice");
  });

  it("robuste aux entrées vides/invalides", () => {
    expect(deriveNoticeKind({})).toBe("notice");
    expect(deriveNoticeKind({ url: "pas une url" })).toBe("notice");
    expect(deriveNoticeKind()).toBe("notice");
  });
});
