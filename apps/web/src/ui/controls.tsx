import { rnd } from "./util";
import {
  useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// ------------------------------------------------------------------ данные тултипа
export interface TipData {
  title: string;
  value?: string;
  lines?: { label: string; value: string }[];
  note?: string;
  consequence?: string;
}

// ------------------------------------------------------------------ кнопка
export interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  className?: string;
  active?: boolean;
  ariaLabel?: string;
  testId?: string;
}

export function Btn({
  children, onClick, variant = "default", size = "md", disabled, title, className, active, ariaLabel, testId,
}: BtnProps) {
  const cls = [
    "sf-btn",
    variant !== "default" ? "sf-btn--" + variant : "",
    size === "sm" ? "sf-btn--sm" : "",
    active ? "sf-btn--on" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ панель
export function Panel({
  title, right, children, className, tall, flat, testId, style,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  tall?: boolean;
  flat?: boolean;
  testId?: string;
  style?: CSSProperties;
}) {
  const cls = ["sf-panel", tall ? "sf-panel-tall" : "", flat ? "sf-panel--flat" : "", className ?? ""]
    .filter(Boolean).join(" ");
  return (
    <section className={cls} data-testid={testId} style={style} aria-label={typeof title === "string" ? title : undefined}>
      {title !== undefined && (
        <header className="sf-panel-head">
          <span className="sf-nowrap">{title}</span>
          <span className="sf-spacer" />
          {right}
        </header>
      )}
      <div className="sf-panel-body">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ полоса
export function Bar({
  v01, tone, thin, testId,
}: { v01: number; tone?: "" | "sf-bar--ok" | "sf-bar--warn" | "sf-bar--bad" | "sf-bar--gold"; thin?: boolean; testId?: string }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(v01) ? v01 : 0));
  return (
    <div className={"sf-bar" + (thin ? " sf-bar--thin" : "") + (tone ? " " + tone : "")} data-testid={testId}>
      <i style={{ width: (clamped * 100).toFixed(1) + "%" }} />
    </div>
  );
}

// ------------------------------------------------------------------ строки
export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className="sf-kv">
      <span className="sf-dim">{k}</span>
      <b className={className}>{v}</b>
    </div>
  );
}

export function Sep() {
  return <div className="sf-sep" role="separator" />;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "good" | "warn" | "bad" | "info" }) {
  return <span className={"sf-badge" + (tone ? " sf-badge--" + tone : "")}>{children}</span>;
}

export function Key({ children }: { children: ReactNode }) {
  return <kbd className="sf-key">{children}</kbd>;
}

export function TabBar({
  items, value, onChange, testId,
}: {
  items: { id: string; label: ReactNode; testId?: string }[];
  value: string;
  onChange: (id: string) => void;
  testId?: string;
}) {
  return (
    <div className="sf-station-tabs" role="tablist" data-testid={testId}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          className={"sf-tab" + (value === it.id ? " sf-tab--on" : "")}
          onClick={() => onChange(it.id)}
          data-testid={it.testId}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ поля форм
export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="sf-field">
      <span className="sf-meta">{label}</span>
      {children}
      {hint && <span className="sf-meta">{hint}</span>}
    </label>
  );
}

export function Check({
  label, checked, onChange, disabled, testId,
}: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="sf-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------ тултип (авто-флип по 4 квадрантам)
export function Tip({
  data, children, focusable, className,
}: { data: TipData | (() => TipData); children: ReactNode; focusable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // data может меняться каждый рендер — измеряем только по факту открытия.
    const measure = () => {
      const a = triggerRef.current?.getBoundingClientRect();
      const b = tipRef.current?.getBoundingClientRect();
      if (!a || !b) return;
      const pad = 8;
      let left = a.left;
      if (left + b.width > window.innerWidth - pad) left = window.innerWidth - pad - b.width;
      if (left < pad) left = pad;
      let top = a.bottom + 6;
      if (top + b.height > window.innerHeight - pad) {
        const above = a.top - b.height - 6;
        top = above >= pad ? above : Math.max(pad, window.innerHeight - pad - b.height);
      }
      setPos({ left: rnd(left), top: rnd(top) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const resolved = open ? (typeof data === "function" ? data() : data) : null;
  const tip = resolved
    ? createPortal(
        <div
          ref={tipRef}
          className="sf-tip"
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: "hidden" }}
        >
          <div className="sf-tip-title">{resolved.title}</div>
          {resolved.value !== undefined && <div className="sf-tip-value">{resolved.value}</div>}
          {resolved.lines && resolved.lines.length > 0 && (
            <>
              <div className="sf-tip-hr" />
              {resolved.lines.map((l, i) => (
                <div key={i} className="sf-tip-line">
                  <span>{l.label}</span>
                  <span>{l.value}</span>
                </div>
              ))}
            </>
          )}
          {resolved.note && <div className="sf-tip-note">{resolved.note}</div>}
          {resolved.consequence && <div className="sf-tip-consequence">{resolved.consequence}</div>}
        </div>,
        document.body,
      )
    : null;

  return (
    <span
      ref={triggerRef}
      className={"sf-tip-trigger" + (className ? " " + className : "")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
      {tip}
    </span>
  );
}

// ------------------------------------------------------------------ модальное окно
export function Modal({
  title, children, footer, onClose, wide, small, testId, overlayTestId, closeTestId,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  small?: boolean;
  testId?: string;
  overlayTestId?: string;
  closeTestId?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cls = "sf-modal" + (wide ? " sf-modal--wide" : "") + (small ? " sf-modal--sm" : "");
  return createPortal(
    <div
      className="sf-backdrop"
      data-testid={overlayTestId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className={cls} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} data-testid={testId}>
        <div className="sf-modal-head">
          <span className="sf-nowrap">{title}</span>
          <span className="sf-spacer" />
          {onClose && (
            <Btn size="sm" onClick={onClose} ariaLabel="Закрыть" testId={closeTestId}>✕</Btn>
          )}
        </div>
        <div className="sf-modal-body">{children}</div>
        {footer && <div className="sf-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}