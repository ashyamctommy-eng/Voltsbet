import { handle, ok } from "@/lib/api";
import { BetsApiClient } from "@/lib/providers/betsapi-client";
import { RawBetsApiMatch, transformBetsApiMatch, MatchView } from "@/lib/providers/betsapi-transformer";

/**
 * GET /api/betsapi/live — in-play matches transformed for the UI.
 *
 * RapidAPI may serve the RAW compressed bet365 format (array-of-arrays with
 * no team names) — in that case we return an empty list with a note instead
 * of a broken payload. Parsed feeds return MatchView objects (status "1").
 */
export const GET = handle(async () => {
  const client = await BetsApiClient.fromSettings();
  try {
    const res = await client.getInplay();
    const data = (res.results ?? []) as unknown[];
    if (!Array.isArray(data) || !data.length) {
      return ok({ count: 0, matches: [], note: "no in-play events right now" });
    }
    if (Array.isArray(data[0])) {
      return ok({
        count: 0,
        matches: [],
        note: "RapidAPI served the RAW bet365 inplay format (no team names) — parsed feed unavailable on this host",
      });
    }
    const matches: MatchView[] = (data as RawBetsApiMatch[])
      .filter((e) => String(e.time_status) === "1")
      .map(transformBetsApiMatch);
    return ok({ count: matches.length, matches });
  } catch (err) {
    return ok({
      count: 0,
      matches: [],
      error: err instanceof Error ? err.message : "In-play feed unavailable",
    });
  }
});
