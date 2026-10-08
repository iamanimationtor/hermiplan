"use client";

import { useEffect } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-600 focus-visible:ring-brand-400 shadow-sm shadow-brand-900/20",
  accent: "bg-accent-500 text-ink-900 hover:bg-accent-400 focus-visible:ring-accent-300 shadow-sm",
  secondary:
    "bg-white text-brand-800 border border-brand-200 hover:border-brand-400 hover:bg-brand-50 focus-visible:ring-brand-300",
  ghost: "bg-transparent text-brand-700 hover:bg-brand-50 focus-visible:ring-brand-300",
  danger: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 focus-visible:ring-red-300",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-[13px] gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150 outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

/* -------------------------------- Card -------------------------------- */

export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgb(16_35_58_/_0.04),0_12px_28px_-18px_rgb(16_35_58_/_0.18)] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            {icon}
          </span>
        ) : null}
        <div>
          <h3 className="text-[15px] font-bold text-ink-900">{title}</h3>
          {subtitle ? <p className="mt-1 text-[12.5px] leading-6 text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------- Fields ------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-center gap-1 text-[12.5px] font-semibold text-slate-700">
        {label}
        {hint ? (
          <span className="font-normal text-slate-500" title={hint}>
            ⓘ
          </span>
        ) : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-[11.5px] text-red-600">{error}</span> : null}
    </label>
  );
}

const controlClasses =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-ink-900 outline-none transition placeholder:text-slate-500 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 disabled:bg-slate-50 disabled:text-slate-500";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClasses} ${className}`} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${controlClasses} min-h-[84px] resize-y leading-7 ${className}`} />;
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${controlClasses} appearance-none bg-[length:0] pl-3 ${className}`}>
      {children}
    </select>
  );
}

/* ------------------------------- Badges ------------------------------- */

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  info: "bg-brand-50 text-brand-700 border-brand-200",
  accent: "bg-accent-300/30 text-accent-600 border-accent-300",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------- Modal -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`animate-fade-up my-auto w-full ${wide ? "max-w-5xl" : "max-w-lg"} rounded-2xl border border-slate-200 bg-white shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-[15px] font-bold text-ink-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="thin-scroll max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------ Progress ------------------------------ */

export function ProgressBar({ value, tone = "info" }: { value: number; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "bad"
          ? "bg-red-500"
          : tone === "accent"
            ? "bg-accent-500"
            : "bg-brand-600";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/* -------------------------------- Misc -------------------------------- */

export function EmptyState({ icon, title, description, action }: { icon: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">{icon}</div>
      <h4 className="text-[15px] font-bold text-ink-900">{title}</h4>
      <p className="max-w-sm text-[12.5px] leading-6 text-slate-500">{description}</p>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  const ring =
    tone === "ok"
      ? "from-emerald-500/10 text-emerald-700"
      : tone === "warn"
        ? "from-amber-500/10 text-amber-700"
        : tone === "bad"
          ? "from-red-500/10 text-red-700"
          : tone === "accent"
            ? "from-accent-500/15 text-accent-600"
            : "from-brand-600/10 text-brand-700";
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-bl to-white p-4 ${ring}`}>
      <div className="text-[11.5px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1.5 text-xl font-extrabold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-5 text-slate-500">{hint}</div> : null}
    </div>
  );
}
