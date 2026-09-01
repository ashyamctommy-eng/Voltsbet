import {
  Activity,
  BicepsFlexed,
  Bike,
  Car,
  CircleDot,
  CircleDotDashed,
  Crosshair,
  Flag,
  Gamepad2,
  Goal,
  Grid3x3,
  Hand,
  Medal,
  MountainSnow,
  PersonStanding,
  Snowflake,
  Trophy,
  Volleyball,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Vector sport icons — crisp Lucide SVGs keyed by sport slug.
 *
 * Replaces the legacy emoji icons (⚽🏀🎾…). The DB still stores an `icon`
 * string for backwards compatibility and custom sports: when a slug is not
 * in the map, the raw string is rendered as a fallback (legacy emoji for
 * exotic/custom sports), and unknown slugs with no string get a generic
 * Activity glyph. All icons inherit `currentColor` and size via className.
 */
const SPORT_ICONS: Record<string, LucideIcon> = {
  // Football (soccer) first — the platform's core sport.
  football: Trophy,
  soccer: Trophy,
  "football-england": Trophy,
  "football-germany": Trophy,
  "football-france": Trophy,
  "football-italy": Trophy,
  "football-spain": Trophy,
  "football-uefa": Trophy,
  // Basketball
  basketball: CircleDot,
  nba: CircleDot,
  // Tennis
  tennis: Activity,
  "table-tennis": Goal,
  // Baseball / American football
  baseball: CircleDotDashed,
  "american-football": Grid3x3,
  "australian-rules": Zap,
  // Ice hockey & winter
  "ice-hockey": Snowflake,
  skiing: MountainSnow,
  // Cricket / darts / golf (precision sports)
  cricket: Medal,
  darts: Crosshair,
  golf: Flag,
  // Combat sports
  boxing: BicepsFlexed,
  mma: BicepsFlexed,
  ufc: BicepsFlexed,
  // Racquet & court
  volleyball: Volleyball,
  handball: Hand,
  badminton: Goal,
  // Motorsport / cycling
  "formula-1": Car,
  motorsport: Car,
  cycling: Bike,
  "horse-racing": Flag,
  // Swimming & athletics
  swimming: Waves,
  athletics: PersonStanding,
  // Legacy (kept for old rows — no longer synced)
  esports: Gamepad2,
};

/** Fallback glyph for sports without a dedicated icon. */
const GENERIC = Activity;

export function SportIcon({
  slug,
  icon,
  className = "h-4 w-4",
}: {
  slug?: string | null;
  icon?: string | null;
  className?: string;
}) {
  const Icon = (slug && SPORT_ICONS[slug]) || GENERIC;
  // Legacy custom sports (no vector map entry, admin-entered emoji) keep
  // their raw string so the UI never shows a blank.
  if (!slug || (!SPORT_ICONS[slug] && icon)) {
    return <span className={className}>{icon}</span>;
  }
  return <Icon className={className} aria-hidden />;
}
