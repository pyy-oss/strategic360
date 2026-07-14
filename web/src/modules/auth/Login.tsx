import React, { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { T } from "../../design/tokens";
import { Card, Eyebrow, Badge } from "../../design/ui";
import { auth, isFirebaseConfigured } from "../../lib/firebase";
import { useAuthClaims } from "../../lib/AuthProvider";

/**
 * Login screen — Forest & Gold, reusing Card/Eyebrow/Badge from design/ui.tsx.
 * Email/password only; there is no public signup (accounts are provisioned by an admin via
 * the `setUserRole` Cloud Function, which also grants the role custom claim).
 */
export default function Login() {
  const { user } = useAuthClaims();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: Location })?.from;
    return <Navigate to={from?.pathname ?? "/veille/radar"} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isFirebaseConfigured) {
      setError("Firebase n'est pas configuré (VITE_FIREBASE_* manquants) — voir web/.env.example.");
      return;
    }
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la connexion.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: T.panel2,
    border: `1px solid ${T.line}`,
    borderRadius: 10,
    padding: "10px 12px",
    color: T.ink,
    fontSize: 13.5,
    fontFamily: "'Inter',system-ui,sans-serif",
    outline: "none",
  };

  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        color: T.ink,
        fontFamily: "'Inter',system-ui,sans-serif",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg,${T.plum},#6b4f86)`,
              display: "grid",
              placeItems: "center",
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 700,
              color: "#0E1613",
              fontSize: 18,
            }}
          >
            S
          </div>
          <div>
            <div style={{ fontFamily: "'Bricolage Grotesque'", fontSize: 19, fontWeight: 700 }}>Sentinel</div>
            <div style={{ fontSize: 11.5, color: T.dim }}>Neurones Technologies CI</div>
          </div>
        </div>

        <Card>
          <Eyebrow>Connexion</Eyebrow>
          <form onSubmit={onSubmit} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>Email</div>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                placeholder="prenom.nom@neurones-ci.com"
              />
            </div>
            <div>
              <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>Mot de passe</div>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
            {error && (
              <div style={{ fontSize: 12, color: T.clay }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 4,
                cursor: submitting ? "default" : "pointer",
                border: "none",
                borderRadius: 10,
                padding: "10px 14px",
                background: T.gold,
                color: "#0E1613",
                fontWeight: 700,
                fontSize: 13.5,
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Connexion…" : "Se connecter"}
            </button>
          </form>
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Badge c={T.faint}>Accès sur invitation</Badge>
            <span style={{ fontSize: 11, color: T.faint }}>
              La création de compte est réservée à la Direction (aucune inscription publique).
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
