import React, { createContext, useContext } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { T } from "../design/tokens";
import { useClaims, useCan, useIsExec, type Claims } from "./rbac";
import { MfaBanner } from "../modules/auth/MfaEnrollment";

/** Shares a single `useClaims()` subscription across the app instead of re-subscribing per hook call. */
const ClaimsContext = createContext<Claims | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const claims = useClaims();
  return <ClaimsContext.Provider value={claims}>{children}</ClaimsContext.Provider>;
}

export function useAuthClaims(): Claims {
  const ctx = useContext(ClaimsContext);
  if (!ctx) throw new Error("useAuthClaims must be used within <AuthProvider>");
  return ctx;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: T.bg,
        minHeight: "100vh",
        color: T.dim,
        fontFamily: "'Inter',system-ui,sans-serif",
        display: "grid",
        placeItems: "center",
        fontSize: 13.5,
      }}
    >
      {children}
    </div>
  );
}

/** Redirects to /login when unauthenticated; shows a loading state while auth resolves. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const claims = useAuthClaims();
  const { user, loading } = claims;
  const location = useLocation();
  const isExec = useIsExec(claims);

  if (loading) return <CenteredMessage>Chargement…</CenteredMessage>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return (
    <>
      {/* MFA nudge for exec roles (V8 Durcissement, BUILD_KIT.md §7/§13) — non-blocking, shown
          above the app shell regardless of active view. See modules/auth/MfaEnrollment.tsx. */}
      {isExec && (
        <div style={{ padding: "14px 24px 0", background: T.bg }}>
          <MfaBanner user={user} />
        </div>
      )}
      {children}
    </>
  );
}

/** Route/section-level gating on top of RequireAuth: requires at least `level` on `module`. */
export function RequireCan({
  module: moduleName,
  level,
  children,
}: {
  module: string;
  level: "read" | "write";
  children: React.ReactNode;
}) {
  const claims = useAuthClaims();
  const { canRead, canWrite, loading } = useCan(moduleName, claims);

  if (claims.loading || loading) return <CenteredMessage>Chargement…</CenteredMessage>;
  const allowed = level === "write" ? canWrite : canRead;
  if (!allowed) {
    return (
      <CenteredMessage>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.clay, fontWeight: 700, marginBottom: 6 }}>Accès refusé</div>
          <div>Votre profil ({claims.role ?? "sans rôle"}) n'a pas les droits sur « {moduleName} ».</div>
        </div>
      </CenteredMessage>
    );
  }
  return <>{children}</>;
}
