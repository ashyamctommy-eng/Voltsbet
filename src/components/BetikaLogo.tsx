import type { SVGProps } from "react";

type BetikaLogoProps = SVGProps<SVGSVGElement> & {
  /** Brand wordmark rendered as the logo text. */
  label?: string;
  /** High-contrast yellow wordmark fill. */
  accent?: string;
  /** Signal-green accent dot. */
  dot?: string;
};

/**
 * Reusable brand SVG asset — Betika-style yellow/green high-contrast
 * wordmark. Mount anywhere a generic header/appbar logo placeholder would
 * go; size via `className` (default `h-8 w-auto`, scales with `viewBox`).
 *
 * <BetikaLogo />           → Betika! + green dot
 * <BetikaLogo label="VoltBet" className="h-10 w-auto" />
 */
export default function BetikaLogo({
  label = "Betika!",
  accent = "#FFD700",
  dot = "#00FF66",
  className = "h-8 w-auto",
  ...rest
}: BetikaLogoProps) {
  return (
    <svg
      viewBox="0 0 160 40"
      className={className}
      role="img"
      aria-label={label}
      focusable="false"
      {...rest}
    >
      <text
        x="0"
        y="28"
        fill={accent}
        fontFamily="sans-serif"
        fontWeight="900"
        fontSize="26"
      >
        {label}
      </text>
      <circle cx="118" cy="12" r="3" fill={dot} />
    </svg>
  );
}
