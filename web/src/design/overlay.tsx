import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { T } from "./tokens";

/**
 * Surcouches premium — `Modal` (boîte de dialogue centrée avec fond assombri) et système de `Toast`
 * (notifications éphémères en bas d'écran). Aucune dépendance externe (CSP stricte).
 *
 * Usage Toast : envelopper l'app dans <ToastProvider>, puis `const toast = useToast()` →
 * `toast.success("Signal enregistré")`, `toast.error("…")`, `toast.info("…")`.
 */

/* ---------------------------------------- Modal ---------------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}
export function Modal({ open, onClose, title, children, width = 560, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    // Empêche le défilement de l'arrière-plan pendant que la modale est ouverte.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(6,10,8,.62)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "6vh 16px 24px",
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          background: T.panel,
          border: `1px solid ${T.line}`,
          borderRadius: 16,
          boxShadow: "0 28px 70px -20px rgba(0,0,0,.7)",
          animation: "modal-in .16s ease-out",
        }}
      >
        <style>{`@keyframes modal-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}`}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 15.5, fontWeight: 700, color: T.ink }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4, borderRadius: 8 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.line}`, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------- Toast ---------------------------------------- */

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: React.ReactNode }
interface ToastApi {
  success: (m: React.ReactNode) => void;
  error: (m: React.ReactNode) => void;
  info: (m: React.ReactNode) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const KIND_META: Record<ToastKind, { c: string; icon: string }> = {
  success: { c: T.emerald, icon: "✓" },
  error: { c: T.clay, icon: "!" },
  info: { c: T.steel, icon: "i" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: ToastKind, message: React.ReactNode) => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => remove(id), 3800);
  }, [remove]);

  const api = useRef<ToastApi>({
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  }).current;

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 16, pointerEvents: "none" }}>
        <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
        {items.map((t) => {
          const m = KIND_META[t.kind];
          return (
            <div
              key={t.id}
              onClick={() => remove(t.id)}
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                maxWidth: "min(440px,92vw)",
                background: T.panel,
                border: `1px solid ${T.line}`,
                borderLeft: `3px solid ${m.c}`,
                borderRadius: 12,
                boxShadow: "0 16px 40px -14px rgba(0,0,0,.6)",
                padding: "11px 14px",
                animation: "toast-in .2s ease-out",
              }}
            >
              <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", background: m.c, color: "#0E1613", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{m.icon}</span>
              <span style={{ fontSize: 12.5, color: T.ink }}>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Accès à l'API toast. En dehors d'un ToastProvider, renvoie un no-op (ne casse jamais le rendu). */
export function useToast(): ToastApi {
  return useContext(ToastCtx) ?? { success: () => {}, error: () => {}, info: () => {} };
}
