import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import VeilleApp from "./modules/veille/App";

/** Top-level app router. V0: single module (Veille Stratégique) mounted at /veille/:view.
 * Default route redirects to the executive radar view.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/veille/radar" replace />} />
      <Route path="/veille/:view" element={<VeilleApp />} />
      <Route path="*" element={<Navigate to="/veille/radar" replace />} />
    </Routes>
  );
}
