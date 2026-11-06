/**
 * HERMIPLAN brand mark.
 *
 * Concept: a hexagonal "engineering plate" holding three ascending schedule
 * bars (the plan) crowned by a wing stroke — a nod to Hermes, the messenger
 * and patron of engineers — rendered in a navy → amber gradient.
 */

export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<LogoSize, { box: number; radius: number }> = {
  xs: { box: 28, radius: 9 },
  sm: { box: 36, radius: 11 },
  md: { box: 44, radius: 13 },
  lg: { box: 56, radius: 17 },
  xl: { box: 76, radius: 22 },
};

export function LogoMark({
  size = "md",
  tone = "light",
  className = "",
}: {
  size?: LogoSize;
  tone?: "light" | "dark" | "mono";
  className?: string;
}) {
  const { box } = SIZES[size];
  const id = `hp-logo-${tone}-${size}`;
  const plateFrom = tone === "dark" ? "#16385f" : "#0e2745";
  const plateTo = tone === "dark" ? "#0d2036" : "#123a66";

  return (
    <svg
      width={box}
      height={box}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="HERMIPLAN"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={plateFrom} />
          <stop offset="100%" stopColor={plateTo} />
        </linearGradient>
        <linearGradient id={`${id}-bar`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#8ab2e3" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id={`${id}-wing`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5d18a" />
          <stop offset="100%" stopColor="#e2a13a" />
        </linearGradient>
      </defs>

      {/* hexagonal plate */}
      <path
        d="M32 2.6 57.4 17.3v29.4L32 61.4 6.6 46.7V17.3z"
        fill={`url(#${id}-plate)`}
        stroke={tone === "mono" ? "#0e2745" : "rgb(255 255 255 / 0.18)"}
        strokeWidth="1.2"
      />

      {/* wing — Hermes */}
      <path
        d="M14.5 24.5c7.4-6.6 15.2-8.6 23.3-6"
        fill="none"
        stroke={`url(#${id}-wing)`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M18 30c6.2-4.8 12.4-6.2 18.6-4.2"
        fill="none"
        stroke={`url(#${id}-wing)`}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />

      {/* schedule bars */}
      <rect x="17" y="36" width="7.5" height="9" rx="1.8" fill={`url(#${id}-bar)`} opacity="0.55" />
      <rect x="27.5" y="31" width="7.5" height="14" rx="1.8" fill={`url(#${id}-bar)`} opacity="0.8" />
      <rect x="38" y="25.5" width="7.5" height="19.5" rx="1.8" fill="#eeb95c" />

      {/* baseline */}
      <rect x="17" y="47.5" width="28.5" height="2.4" rx="1.2" fill="rgb(255 255 255 / 0.35)" />
      <circle cx="49.5" cy="48.7" r="1.8" fill="#eeb95c" />

      <title>HERMIPLAN</title>
      <desc>Schedule bars and Hermes wing inside a hexagonal engineering plate</desc>
      <metadata>HERMIPLAN — Created by Mohammad Shirmardi</metadata>
    </svg>
  );
}

export function Logo({
  size = "md",
  tone = "light",
  showWordmark = true,
  tagline,
  className = "",
}: {
  size?: LogoSize;
  tone?: "light" | "dark";
  showWordmark?: boolean;
  tagline?: string;
  className?: string;
}) {
  const titleColor = tone === "dark" ? "text-white" : "text-ink-900";
  const subColor = tone === "dark" ? "text-brand-300" : "text-slate-400";

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} tone={tone} />
      {showWordmark ? (
        <span className="flex flex-col leading-none">
          <span className={`text-[15px] font-extrabold tracking-tight ${titleColor}`}>HERMIPLAN</span>
          {tagline ? <span className={`mt-1 text-[9.5px] font-semibold tracking-wide ${subColor}`}>{tagline}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

export const CREATOR_CREDIT = "Created by Mohammad Shirmardi";
export const CREATOR_CREDIT_FULL = "HERMIPLAN — Created by Mohammad Shirmardi";
