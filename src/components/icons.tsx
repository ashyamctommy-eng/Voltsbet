// Inline SVG icon set (24×24, stroke style, inherits currentColor).
// Hand-authored, lucide-inspired shapes — no icon library dependency.
import type { ReactNode } from "react";

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      {children}
    </svg>
  );
}

export function IconHome({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 9.5 12 3l9 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20Z" />
      <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
    </Svg>
  );
}

export function IconSports({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2 14.6 9l-1 3.2h-3.2l-1-3.2Z" />
      <path d="M3.5 10.5c2.8.9 4.8 2.6 6 5.1" />
      <path d="M20.5 10.5c-2.8.9-4.8 2.6-6 5.1" />
      <path d="M9.5 15.6h5" />
    </Svg>
  );
}

export function IconLive({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8.2 8.2a5.4 5.4 0 0 1 7.6 0" />
      <path d="M5.5 5.5a9.5 9.5 0 0 1 13 0" />
      <path d="M15.8 15.8a5.4 5.4 0 0 1-7.6 0" />
      <path d="M18.5 18.5a9.5 9.5 0 0 1-13 0" />
    </Svg>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

export function IconTicket({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z" />
      <path d="M13 5v2" />
      <path d="M13 11v2" />
      <path d="M13 17v2" />
    </Svg>
  );
}

// ── Extra icons for header / drawer / nav / casino ──────────

export function IconMenu({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </Svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function IconMoon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
    </Svg>
  );
}

export function IconSun({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function IconLightning({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </Svg>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M17 12h2a1 1 0 0 1 0 2h-2a1 1 0 0 1 0-2Z" />
    </Svg>
  );
}

export function IconArrowDown({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 4v16" />
      <path d="m6 14 6 6 6-6" />
    </Svg>
  );
}

export function IconArrowUp({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 20V4" />
      <path d="m6 10 6-6 6 6" />
    </Svg>
  );
}

export function IconGift({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </Svg>
  );
}

export function IconHelp({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
      <path d="M12 17.2h.01" strokeWidth="2.4" />
    </Svg>
  );
}

export function IconPlane({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10.5 13.5 3 11l1.5-1.5L10 11l5-5a2.1 2.1 0 0 1 3 3l-5 5 1.5 5.5L13 21l-2.5-7.5Z" />
    </Svg>
  );
}

export function IconDice({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconController({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4l-2.5-2h-7L6 17a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4Z" />
      <path d="M7.5 10.5v3M6 12h3" />
      <circle cx="16" cy="11.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="13.5" r=".6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconFootball({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2 14.6 9l-1 3.2h-3.2l-1-3.2Z" />
      <path d="M3.5 10.5c2.8.9 4.8 2.6 6 5.1" />
      <path d="M20.5 10.5c-2.8.9-4.8 2.6-6 5.1" />
      <path d="M9.5 15.6h5" />
    </Svg>
  );
}

export function IconBasketball({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 8.5c2 1.7 4.6 2.6 8.5 2.6s6.5-.9 8.5-2.6" />
      <path d="M3.5 15.5c2-1.7 4.6-2.6 8.5-2.6s6.5.9 8.5 2.6" />
      <path d="M12 3v18" />
    </Svg>
  );
}

export function IconTennis({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="14.5" cy="9.5" r="6" />
      <path d="M9.5 14.5 4 20" />
      <path d="M10.5 18.5 18 6" opacity="0" />
      <path d="m6.5 17.5 2-2" />
      <path d="M11 21l1-1" />
    </Svg>
  );
}

export function IconTv({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="m8 2 4 4 4-4" />
    </Svg>
  );
}

export function IconFlag({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 21V4" />
      <path d="M5 5c2-1.5 4-1.5 6 0s4 1.5 6 0v8c-2 1.5-4 1.5-6 0s-4-1.5-6 0" />
    </Svg>
  );
}

export function IconChevronRight({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function IconCrown({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-1.5 11h-15L3 8Z" />
    </Svg>
  );
}
