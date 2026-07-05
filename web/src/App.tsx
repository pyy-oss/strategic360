import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import VeilleApp from "./modules/veille/App";
import Login from "./modules/auth/Login";
import { AuthProvider, RequireAuth, RequireCan } from "./lib/AuthProvider";
import { ToastProvider } from "./design/overlay";

/** Top-level app router. V0: single module (Veille Stratégique) mounted at /veille/:view.
 * Default route redirects to the executive radar view.
 * V1: /login is public; everything else requires auth, and /veille/* additionally requires
 * at least read access to the "veille" module (per config/permissions, mirroring firestore.rules).
 */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/veille/radar" replace />} />
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
      </ToastProvider>
    </AuthProvider>
  );
}
