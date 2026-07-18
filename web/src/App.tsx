import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import VeilleApp from "./modules/veille/App";
import Login from "./modules/auth/Login";
import { AuthProvider, RequireAuth, RequireCan, useAuthClaims } from "./lib/AuthProvider";
import { ToastProvider, ConfirmProvider } from "./design/overlay";

/** Role-aware landing: commercial roles work from the Copilote first; everyone else from the radar.
 * Waits for claims to resolve so the redirect targets the right home instead of flashing the radar. */
function Landing() {
  const { role, loading } = useAuthClaims();
  if (loading) return null;
  const commercial = role === "commercial" || role === "commercial_dir";
  return <Navigate to={commercial ? "/veille/copilote" : "/veille/radar"} replace />;
}

/** Top-level app router. V0: single module (Sentinel — veille & copilote) mounted at /veille/:view.
 * Default route redirects to the executive radar view.
 * V1: /login is public; everything else requires auth, and /veille/* additionally requires
 * at least read access to the "veille" module (per config/permissions, mirroring firestore.rules).
 */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <ConfirmProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Landing />} />
        <Route
          path="/veille/:view"
          element={
            <RequireAuth>
              <RequireCan module="veille" level="read">
                <VeilleApp />
              </RequireCan>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/veille/radar" replace />} />
      </Routes>
      </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
