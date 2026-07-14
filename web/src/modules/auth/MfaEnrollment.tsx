import React, { useState } from "react";
import {
  multiFactor,
  TotpMultiFactorGenerator,
  type TotpSecret,
  type User,
} from "firebase/auth";
import { T } from "../../design/tokens";
import { Card, Badge, Eyebrow } from "../../design/ui";

/**
 * MFA enrollment for executive roles (V8 Durcissement, BUILD_KIT.md §7 "MFA pour profils
 * exécutifs" / §13 "MFA exécutifs").
 *
 * Firebase Auth multi-factor (TOTP) must first be ENABLED for the project in Firebase Console
 * (Authentication > Sign-in method > Advanced > Multi-factor authentication) — that console
 * toggle is out of code's reach and cannot be exercised in this sandbox (no real Auth tenant).
 * What follows IS in code's reach: a correctly-wired TOTP enrollment flow using the Firebase Auth
 * SDK's `multiFactor()`/`TotpMultiFactorGenerator` APIs (docs:
 * https://firebase.google.com/docs/auth/web/totp-mfa), so that once MFA is turned on for the
 * project, executive users can actually enroll from within the app. UNVERIFIED end-to-end (no
 * live Auth tenant here) — the SDK calls below are exercised only up to what TypeScript/the SDK's
 * own client-side validation can catch; there is no emulator support for TOTP MFA to test against.
 */

export interface MfaBannerProps {
  user: User;
}

/**
 * Non-blocking banner shown to exec-role users (direction/strategie/innovation) who have zero
 * enrolled second factors. "Non-blocking" per the task brief: it nudges, it does not lock the
 * user out of the app (Security Rules/claims remain the actual authority on access).
 */
/** Mise en veille du rappel MFA : 30 jours (c'est un nudge de sécurité, pas un message jetable — on
 * le ré-affiche après ce délai plutôt que de le supprimer définitivement). Persisté par utilisateur. */
const MFA_SNOOZE_DAYS = 30;
const mfaSnoozeKey = (uid: string) => `mfaNudgeSnoozeUntil:${uid}`;
function readMfaSnoozeUntil(uid: string): number {
  try {
    const v = Number(localStorage.getItem(mfaSnoozeKey(uid)));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function MfaBanner({ user }: MfaBannerProps) {
  const [open, setOpen] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<number>(() => readMfaSnoozeUntil(user.uid));
  const enrolledFactors = multiFactor(user).enrolledFactors;

  if (enrolledFactors.length > 0) return null;
  // Masqué par l'utilisateur et pas encore expiré → on n'affiche pas (ré-apparaît après MFA_SNOOZE_DAYS).
  if (snoozedUntil > Date.now()) return null;

  const masquer = () => {
    const until = Date.now() + MFA_SNOOZE_DAYS * 864e5;
    try {
      localStorage.setItem(mfaSnoozeKey(user.uid), String(until));
    } catch {
      /* stockage indisponible : on masque au moins pour la session */
    }
    setSnoozedUntil(until);
  };

  return (
    <Card style={{ marginBottom: 14, borderColor: T.gold }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Eyebrow color={T.gold}>Sécurité</Eyebrow>
          <div style={{ fontWeight: 700, marginTop: 4 }}>
            Authentification multifacteur requise pour les rôles exécutifs
            <Badge c={T.gold}> recommandé</Badge>
          </div>
          <div style={{ fontSize: 12.5, color: T.dim, marginTop: 4, maxWidth: 640 }}>
            Votre profil (direction/stratégie/innovation) donne accès à des données sensibles
            (cadres, décisions, briefings). Configurez la double authentification (TOTP —
            Google Authenticator, Authy, etc.) pour protéger votre compte.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {!open && (
            <button className="pill" onClick={masquer} title={`Masquer ce rappel pendant ${MFA_SNOOZE_DAYS} jours`}>
              Masquer
            </button>
          )}
          <button
            className="pill"
            style={{ background: T.gold, borderColor: T.gold, color: "#0E1613" }}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Fermer" : "Configurer la MFA"}
          </button>
        </div>
      </div>
      {open && <TotpEnrollmentForm user={user} onDone={() => setOpen(false)} />}
    </Card>
  );
}

/**
 * The actual TOTP enrollment flow: getSession() → generateSecret(session) → show QR/secret →
 * user enters the 6-digit code from their authenticator app → assertionForEnrollment(secret, code)
 * → multiFactor(user).enroll(assertion, displayName).
 * Mirrors https://firebase.google.com/docs/auth/web/totp-mfa#enroll step by step.
 */
function TotpEnrollmentForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const session = await multiFactor(user).getSession();
      const generatedSecret = await TotpMultiFactorGenerator.generateSecret(session);
      setSecret(generatedSecret);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Impossible de démarrer l'enrôlement MFA : ${err.message}`
          : "Impossible de démarrer l'enrôlement MFA."
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment() {
    if (!secret || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
      await multiFactor(user).enroll(assertion, "TOTP — application d'authentification");
      setSuccess(true);
      setTimeout(onDone, 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Code invalide ou enrôlement refusé : ${err.message}`
          : "Code invalide ou enrôlement refusé."
      );
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div style={{ marginTop: 12, color: T.emerald, fontSize: 13, fontWeight: 600 }}>
        MFA activée avec succès.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
      {!secret && (
        <button className="pill" disabled={busy} onClick={startEnrollment}>
          {busy ? "Génération…" : "Générer un code secret TOTP"}
        </button>
      )}
      {secret && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <div style={{ fontSize: 12, color: T.dim }}>
            Scannez ce QR code avec votre application d'authentification, ou saisissez la clé
            manuellement, puis entrez le code à 6 chiffres généré.
          </div>
          <img
            alt="QR code TOTP"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
              secret.generateQrCodeUrl(user.email ?? undefined, "Sentinel NT-CI")
            )}`}
            style={{ width: 180, maxWidth: "100%", height: 180, borderRadius: 8, background: "#fff", padding: 8 }}
          />
          <div style={{ fontSize: 11, color: T.faint, wordBreak: "break-all" }}>
            Clé secrète : {secret.secretKey}
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code à 6 chiffres"
            maxLength={6}
            style={{
              background: T.panel2,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              padding: "8px 10px",
              color: T.ink,
              fontSize: 14,
              fontVariantNumeric: "tabular-nums",
            }}
          />
          <button
            className="pill"
            style={{ background: T.emerald, borderColor: T.emerald, color: "#0E1613" }}
            disabled={busy || code.trim().length !== 6}
            onClick={confirmEnrollment}
          >
            {busy ? "Vérification…" : "Valider et activer la MFA"}
          </button>
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: T.clay, fontSize: 12 }}>{error}</div>}
    </div>
  );
}
