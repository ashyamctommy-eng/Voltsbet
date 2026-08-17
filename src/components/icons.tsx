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
