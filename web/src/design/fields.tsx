import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { T } from "./tokens";

/**
 * Champs de formulaire « premium » — remplacent les contrôles natifs (`<select>`, `<input type="date">`)
 * par des composants entièrement stylés, cohérents avec le thème « Forest & Gold », accessibles au
 * clavier et corrects sur mobile. Aucune dépendance externe (CSP stricte : pas de CDN).
 *
 * - `Select`  : liste déroulante custom (popover, navigation clavier, fermeture au clic extérieur / Échap).
 * - `DateField`: sélecteur de date custom (calendrier mensuel en français, raccourcis Aujourd'hui / Effacer).
 *
 * API volontairement proche des natifs (`value` / `onChange(valeur)`) pour un remplacement sans friction.
 */

const triggerBase: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: T.panel2,
  border: `1px solid ${T.line}`,
  borderRadius: 8,
  padding: "7px 10px",
  color: T.ink,
  fontSize: 12.5,
  fontFamily: "inherit",
  cursor: "pointer",
  minHeight: 36,
  textAlign: "left",
};

const popover: React.CSSProperties = {
  position: "absolute",
  zIndex: 40,
  top: "calc(100% + 6px)",
  left: 0,
  minWidth: "100%",
  background: T.panel,
  border: `1px solid ${T.line}`,
  borderRadius: 12,
  boxShadow: "0 16px 40px -12px rgba(0,0,0,.55)",
  padding: 6,
  maxHeight: 288,
  overflowY: "auto",
};

/** Chevron ▾ (SVG inline, hérite de currentColor). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}>
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Ferme au clic hors de `ref` et à la touche Échap. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

/* ----------------------------------- Input / Textarea ----------------------------------- */

const fieldBase: React.CSSProperties = {
  width: "100%",
  background: T.panel2,
  border: `1px solid ${T.line}`,
  borderRadius: 8,
  padding: "8px 11px",
  color: T.ink,
  fontSize: 12.5,
  fontFamily: "inherit",
  transition: "border-color .15s, box-shadow .15s",
  outline: "none",
};

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onChange?: (value: string) => void;
  invalid?: boolean;
}
/** Champ texte premium — `onChange` reçoit directement la valeur. Focus doré via le CSS global. */
export function Input({ onChange, invalid, style, onFocus, onBlur, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...rest}
      onChange={(e) => onChange?.(e.target.value)}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={{
        ...fieldBase,
        borderColor: focus ? T.gold : invalid ? T.clay : T.line,
        boxShadow: focus ? `0 0 0 3px ${T.gold}22` : "none",
        ...style,
      }}
    />
  );
}

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  onChange?: (value: string) => void;
}
/** Zone de texte premium (redimensionnable verticalement). */
export function Textarea({ onChange, style, onFocus, onBlur, ...rest }: TextareaProps) {
  const [focus, setFocus] = useState(false);
  return (
    <textarea
      {...rest}
      onChange={(e) => onChange?.(e.target.value)}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={{
        ...fieldBase,
        minHeight: 72,
        resize: "vertical",
        lineHeight: 1.45,
        borderColor: focus ? T.gold : T.line,
        boxShadow: focus ? `0 0 0 3px ${T.gold}22` : "none",
        ...style,
      }}
    />
  );
}

/* --------------------------------------- Toggle --------------------------------------- */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  color?: string;
  id?: string;
}
/** Interrupteur premium (on/off) — accessible (role switch), remplace une case à cocher. */
export function Toggle({ checked, onChange, label, disabled, color = T.emerald, id }: ToggleProps) {
  return (
    <label htmlFor={id} style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, userSelect: "none" }}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          position: "relative",
          width: 38,
          height: 22,
          borderRadius: 999,
          border: "none",
          flexShrink: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          background: checked ? color : T.line,
          transition: "background .18s",
          padding: 0,
        }}
      >
        <span style={{ position: "absolute", top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: checked ? "#0E1613" : T.dim, transition: "left .18s, background .18s" }} />
      </button>
      {label != null && <span style={{ fontSize: 12.5, color: T.dim }}>{label}</span>}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}
export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

/** Liste déroulante premium. Remplace `<select>` — `onChange` reçoit directement la valeur. */
export function Select({ value, onChange, options, placeholder = "Sélectionner…", disabled, style, ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useDismiss(open, () => setOpen(false), wrapRef);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Garde l'option active visible pendant la navigation clavier.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKey}
        style={{ ...triggerBase, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer", borderColor: open ? T.gold : T.line }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? T.ink : T.faint }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: T.dim, display: "inline-flex" }}><Chevron open={open} /></span>
      </button>
      {open && (
        <div ref={listRef} role="listbox" id={listId} style={popover}>
          {options.map((o, i) => {
            const isSel = o.value === value;
            const isActive = i === active;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: isSel ? "#0E1613" : T.ink,
                  background: isSel ? T.gold : isActive ? T.panel2 : "transparent",
                  fontWeight: isSel ? 600 : 500,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {isSel && (
                  <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden><path d="M2.5 7 5 9.5 10.5 3.5" fill="none" stroke="#0E1613" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- DateField --------------------------------- */

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DOW = ["L", "M", "M", "J", "V", "S", "D"]; // semaine commençant lundi

/** Parse "yyyy-mm-dd" en {y,m,d} (m: 0-11) sans dérive de fuseau. Renvoie null si invalide. */
function parseISO(v: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}
const toISO = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const fmtHuman = (p: { y: number; m: number; d: number }) => `${p.d} ${MONTHS_SHORT[p.m]} ${p.y}`;
// Jour de semaine (0=lundi) du 1er du mois, via l'algorithme de Zeller — pas de dépendance au fuseau.
function firstDowMonday(y: number, m: number): number {
  const d = new Date(y, m, 1).getDay(); // 0=dimanche..6=samedi (heure locale, jour civil correct)
  return (d + 6) % 7; // -> 0=lundi..6=dimanche
}
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export interface DateFieldProps {
  value: string; // ISO yyyy-mm-dd ou ""
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

/** Sélecteur de date premium (calendrier mensuel FR). Remplace `<input type="date">`. */
export function DateField({ value, onChange, placeholder = "jj mois aaaa", disabled, required, style, ariaLabel }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrapRef);

  const parsed = parseISO(value);
  const today = useMemo(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; }, []);
  const [view, setView] = useState(() => (parsed ? { y: parsed.y, m: parsed.m } : { y: today.y, m: today.m }));

  // Rouvre le calendrier sur le mois de la valeur courante.
  useEffect(() => {
    if (open) setView(parsed ? { y: parsed.y, m: parsed.m } : { y: today.y, m: today.m });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const shiftMonth = (delta: number) => setView((v) => {
    const idx = v.y * 12 + v.m + delta;
    return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
  });

  const pick = (d: number) => { onChange(toISO(view.y, view.m, d)); setOpen(false); };

  const lead = firstDowMonday(view.y, view.m);
  const dim = daysInMonth(view.y, view.m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];

  const navBtn: React.CSSProperties = { background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, width: 30, height: 30, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); } }}
        style={{ ...triggerBase, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer", borderColor: open ? T.gold : required && !parsed ? T.clay : T.line }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ flexShrink: 0, color: T.dim }}>
          <rect x="1.5" y="2.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.5 5.5h11M4.5 1.2v2.4M9.5 1.2v2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: parsed ? T.ink : T.faint }}>
          {parsed ? fmtHuman(parsed) : placeholder}
        </span>
        <span style={{ color: T.dim, display: "inline-flex" }}><Chevron open={open} /></span>
      </button>
      {open && (
        <div role="dialog" style={{ ...popover, padding: 12, width: 268, maxHeight: "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <button type="button" style={navBtn} onClick={() => shiftMonth(-1)} aria-label="Mois précédent">‹</button>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, textTransform: "capitalize", textAlign: "center", flex: 1 }}>
              {MONTHS[view.m]} {view.y}
            </div>
            <button type="button" style={navBtn} onClick={() => shiftMonth(1)} aria-label="Mois suivant">›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
            {DOW.map((d, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10, color: T.faint, fontWeight: 600, padding: "2px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const isSel = !!parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === d;
              const isToday = today.y === view.y && today.m === view.m && today.d === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pick(d)}
                  style={{
                    height: 30,
                    borderRadius: 8,
                    border: isToday && !isSel ? `1px solid ${T.gold}` : "1px solid transparent",
                    background: isSel ? T.gold : "transparent",
                    color: isSel ? "#0E1613" : T.ink,
                    fontWeight: isSel ? 700 : 500,
                    fontSize: 12.5,
                    cursor: "pointer",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
            <button type="button" className="pill" onClick={() => { onChange(toISO(today.y, today.m, today.d)); setOpen(false); }}>Aujourd'hui</button>
            {value && <button type="button" className="pill" onClick={() => { onChange(""); setOpen(false); }}>Effacer</button>}
          </div>
        </div>
      )}
    </div>
  );
}
