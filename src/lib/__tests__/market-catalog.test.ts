import { describe, it, expect } from "vitest";
import { MARKET_MAP, LIST_MARKETS } from "../providers/odds-api";
import {
  MARKET_GROUPS,
  RECOMMENDED_BULK_MARKETS,
  RECOMMENDED_DETAIL_MARKETS,
  SOCCER_MARKETS,
  marketsByKey,
} from "../market-catalog";

/**
 * A market the admin can select but the provider cannot map is a silent
 * no-op: the API call is paid for and the prices are thrown away. These tests
 * keep the picker and the mapping table in lockstep.
 */
describe("soccer market catalog integrity", () => {
  const catalog = marketsByKey();

  it("every selectable market has a provider mapping (else prices are dropped)", () => {
    const mapped = new Set(MARKET_MAP.map((m) => m.key));
    const unmapped = SOCCER_MARKETS.map((m) => m.key).filter((k) => !mapped.has(k));
    expect(unmapped).toEqual([]);
  });

  it("marks list-endpoint support exactly like the provider", () => {
    const list = new Set<string>(LIST_MARKETS as readonly string[]);
    for (const m of SOCCER_MARKETS) {
      expect(m.listSupported, `${m.key} listSupported`).toBe(list.has(m.key));
    }
  });

  it("has unique keys and a known group for every entry", () => {
    const keys = SOCCER_MARKETS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(MARKET_GROUPS.map((g) => g.id));
    for (const m of SOCCER_MARKETS) expect(groups.has(m.group), `${m.key} group`).toBe(true);
  });

  it("exposes the corners family the operator asked for", () => {
    const corners = SOCCER_MARKETS.filter((m) => m.group === "corners").map((m) => m.key);
    expect(corners).toEqual(
      expect.arrayContaining([
        "corners_1x2",
        "alternate_totals_corners",
        "alternate_spreads_corners",
        "alternate_team_totals_corners",
        "alternate_totals_cards",
        "alternate_spreads_cards",
      ]),
    );
    for (const key of corners) expect(catalog.get(key)?.settle).toBe("manual");
  });

  it("recommended presets are real, selectable markets", () => {
    for (const key of [...RECOMMENDED_BULK_MARKETS, ...RECOMMENDED_DETAIL_MARKETS]) {
      expect(catalog.has(key), `${key} in catalog`).toBe(true);
    }
    // Corners ship in the detail preset so they appear without extra setup.
    expect(RECOMMENDED_DETAIL_MARKETS).toContain("corners_1x2");
    expect(RECOMMENDED_DETAIL_MARKETS).toContain("alternate_totals_corners");
  });

  it("flags settlement exactly as the resolver behaves", () => {
    // Resolvable from the FINAL score in /scores.
    for (const key of [
      "h2h",
      "h2h_3_way",
      "totals",
      "alternate_totals",
      "btts",
      "draw_no_bet",
      "double_chance",
      "correct_score",
      "spreads",
      "alternate_spreads",
      "team_totals",
      "alternate_team_totals",
    ]) {
      expect(catalog.get(key)?.settle, key).toBe("auto");
    }
    // Resolver exists but needs the half-time score (not in the API feed).
    for (const key of ["totals_h1", "totals_h2", "btts_h1", "halftime_fulltime"]) {
      expect(catalog.get(key)?.settle, key).toBe("auto-ht");
    }
    // No resolver at all → admin review queue.
    for (const key of [
      "h2h_h1",
      "h2h_h2",
      "spreads_h1",
      "spreads_h2",
      "alternate_totals_h1",
      "correct_score_h1",
      "double_chance_h1",
      "team_totals_h1",
      "alternate_totals_corners",
      "corners_1x2",
      "to_qualify",
    ]) {
      expect(catalog.get(key)?.settle, key).toBe("manual");
    }
  });
});
