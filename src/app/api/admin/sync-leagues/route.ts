import { NextRequest } from "next/server";
import { handle, ok, ApiError, sharedAdminGuard } from "@/lib/api";
import { getSettings, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { TheOddsApi } from "@/lib/providers/odds-api";
import { isBettableSportKey } from "@/lib/sync";

/**
 * League sync whitelist (Admin → API Settings → League sync).
 *
 * The odds pass costs 1 request per league per run, so admins on paid plans
 * can restrict sync to the leagues they actually offer. Setting semantics:
 *   - configured = []            → sync every bettable league in catalog
 *     order (capped by ODDS_API_FEED_MAX_LEAGUES) — legacy behaviour.
 *   - configured = [keys…]       → sync ONLY those keys, in this order.
 *     Out-of-season / non-bettable keys are kept in the list but skipped
 *     until the API lists them again.
 *
 * GET  → { configured: string[], catalog: [{ key, name }] | null, note }
 *        catalog is fetched live from The Odds API /v4/sports (bettable
 *        keys only). null when ODDS_API_KEY isn't set (manual/seed mode).
 * PUT  → { leagues: string[] } (also accepts newline/comma-separated)
 */
function parseLeagueList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x && !x.startsWith("#")))];
  }
  if (typeof v === "string" && v.trim()) {
    // Newline or comma separated — also tolerate a JSON array string.
    const raw = v.trim();
    if (raw.startsWith("[")) {
      try {
        return parseLeagueList(JSON.parse(raw));
      } catch {
        /* fall through to plain-text split */
      }
    }
    return [...new Set(raw.split(/[\n,]+/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")))];
  }
  return [];
}

export const GET = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const key = process.env.ODDS_API_KEY ?? "";

  let catalog: { key: string; name: string }[] | null = null;
  let note = "";
  if (!key) {
    note = "ODDS_API_KEY is not set in the environment — live catalog unavailable (manual/seed mode).";
  } else {
    try {
      const apiSports = await new TheOddsApi().fetchSports();
      catalog = apiSports
        .filter((sp) => isBettableSportKey(sp.key))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((sp) => ({ key: sp.key, name: sp.name }));
      note = `${catalog.length} bettable leagues currently in season (futures/outrights/preseason filtered out).`;
    } catch (e) {
      note = `Could not fetch the catalog: ${e instanceof Error ? e.message : "unknown error"}. Check ODDS_API_KEY / network.`;
    }
  }

  const settings = await getSettings();
  return ok({ configured: settings.oddsSyncLeagues ?? [], catalog, note });
});

export const PUT = handle(async (req: NextRequest) => {
  await sharedAdminGuard(req, "settings");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "Send { leagues: string[] }.", "BAD_BODY");
  }
  const leagues = parseLeagueList((body as { leagues?: unknown }).leagues);
  if (leagues.length > 500) {
    throw new ApiError(400, "Too many leagues (max 500).", "TOO_MANY");
  }
  await setSetting("odds.syncLeagues", JSON.stringify(leagues));
  invalidateSettingsCache();
  // Sync reads settings per run — purge cached renders so the admin panel
  // and any settings consumers see the change immediately.
  revalidatePath("/", "layout");
  return ok({
    saved: leagues.length,
    mode: leagues.length ? "whitelist" : "catalog",
    message: leagues.length
      ? `Sync restricted to ${leagues.length} league(s) — only these are queried (1 request each per run).`
      : "Whitelist cleared — sync will query every bettable league again (catalog order, capped).",
  });
});
