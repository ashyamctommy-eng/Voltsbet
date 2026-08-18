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

// ── Brand + admin icons ──────────────────────────────────────

export function IconWhatsApp({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path d="M16 3C9.4 3 4 8.4 4 15c0 2.6.8 5 2.2 7L4 29l7.2-2.1c1.9 1 4 1.6 6.3 1.6 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-2.2 0-4.3-.6-6.1-1.8l-.4-.3-4.2 1.2 1.2-4.1-.3-.4C5.1 17.8 4.5 15.9 4.5 14 4.5 8.7 9.3 3.9 16 3.9S27.5 8.7 27.5 14 22.7 24.8 16 24.8zm5.8-7.3c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.5-.1-.2-.7-1.8-1-2.4-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.1 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.4z" />
    </svg>
  );
}

export function IconTelegram({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

export function IconDashboard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </Svg>
  );
}

export function IconCalendar({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  );
}

export function IconUsers({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M16 14.5a5 5 0 0 1 5.5 5" />
    </Svg>
  );
}

export function IconDownload({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3v12" />
      <path d="m6 11 6 6 6-6" />
      <path d="M4 21h16" />
    </Svg>
  );
}

export function IconUpload({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 16V4" />
      <path d="m6 8 6-6 6 6" />
      <path d="M4 21h16" />
    </Svg>
  );
}

export function IconCoins({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9" cy="9" r="6" />
      <path d="M9 5.5a5 5 0 0 1 5 5" />
      <circle cx="16.5" cy="15.5" r="5" />
      <path d="M16.5 12.5a3.8 3.8 0 0 1 3.8 3.8" />
    </Svg>
  );
}

export function IconGlobe({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </Svg>
  );
}

export function IconGift2({ className }: IconProps) {
  return <IconGift className={className} />;
}

export function IconStar({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3Z" />
    </Svg>
  );
}

export function IconImage({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </Svg>
  );
}

export function IconBell({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

export function IconGear({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function IconScroll({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 3h9a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h9" />
      <path d="M9 6V5a2 2 0 0 1 4 0v1" />
      <path d="M9 12h6M9 16h4" />
    </Svg>
  );
}

export function IconPencil({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
    </Svg>
  );
}

export function IconTrash({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Svg>
  );
}

export function IconSmartphone({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M11 18h2" />
    </Svg>
  );
}

// ── Support / wallet icons ───────────────────────────────────

export function IconWallet2({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 7H5a2 2 0 0 1 0-4h13v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1" />
      <path d="M16 13h.01" strokeWidth="2.6" />
    </Svg>
  );
}

export function IconPhone({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" />
    </Svg>
  );
}

export function IconChat({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth="2.6" />
    </Svg>
  );
}

export function IconSend({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Svg>
  );
}

export function IconFlame({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 2c.5 3-1.5 4.5-3 6.5C7.2 10.7 6 12.6 6 15a6 6 0 0 0 12 0c0-1.8-.8-3.4-1.9-4.8-.3 1-.9 1.7-1.7 2.2.4-2.4-.5-6.4-2.4-10.4Z" />
    </Svg>
  );
}

export function IconClock({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}
