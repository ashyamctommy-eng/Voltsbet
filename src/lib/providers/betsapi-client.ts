/**
 * BetsApiClient — modular API adapter for the RapidAPI BetsAPI package.
 *
 * One centralized HTTP request function (`request`) powers every endpoint.
 * Credentials come from the DB (Admin → API Settings) with sane defaults.
 *
 * Endpoints (verified working on betsapi2.p.rapidapi.com):
 *   1. getInplayFilter()    → /v1/bet365/inplay_filter?sport_id=
 *   2. getInplay()          → /v1/bet365/inplay
 *   3. getInplayEvent(id)   → /v1/bet365/event?stats=1&lineup=1&FI=
 *   4. getUpcomingEvents()  → /v1/bet365/upcoming?sport_id=
 *   5. getUpcomingLeagues() → /v1/bet365/league?sport_id=   (singular "league")
 *   6. getPrematchOdds(fi)  → /v3/bet365/prematch?FI=
 *   7. getResults(id)       → /v1/bet365/result?event_id=
 */
import { getSettings } from "@/lib/settings";

const DEFAULT_HOST = "betsapi2.p.rapidapi.com";
const DEFAULT_BASE = "https://betsapi2.p.rapidapi.com";

/** BetsAPI response envelope — `results` holds the payload. */
export type BetsApiResponse<T = unknown> = {
  success: number;
  pager?: { page: number; per_page: number; total: number };
  results: T;
  error?: string;
  error_detail?: string;
  message?: string;
};

/** HTTP-level failure (non-2xx) — carries the status code for diagnostics. */
export class BetsApiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "BetsApiHttpError";
  }
}

export type BetsApiCreds = { key: string; host: string; base: string };
export type BetsApiRequestOptions = { timeoutMs?: number };

export class BetsApiClient {
  private readonly key: string;
  private readonly host: string;
  private readonly base: string;

  constructor(creds?: Partial<BetsApiCreds>) {
    this.key = creds?.key ?? "";
    this.host = creds?.host || DEFAULT_HOST;
    this.base = creds?.base || DEFAULT_BASE;
  }

  /** Build a client from the admin-stored global credentials. */
  static async fromSettings(): Promise<BetsApiClient> {
    const s = await getSettings();
    return new BetsApiClient({
      key: s.apiRapidKey,
      host: s.apiRapidHost,
      base: s.apiRapidBase,
    });
  }

  hasCredentials(): boolean {
    return !!this.key;
  }

  /**
   * Centralized GET — builds the URL, attaches the shared headers, enforces a
   * timeout, throws BetsApiHttpError on non-2xx and a regular Error when the
   * API reports success !== 1.
   */
  private async request<T = unknown>(
    path: string,
    params: Record<string, string | number> = {},
    opts: BetsApiRequestOptions = {},
  ): Promise<BetsApiResponse<T>> {
    if (!this.key) throw new Error("RapidAPI key not configured — set it in Admin → API Settings");

    const url = new URL(`${this.base}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-rapidapi-host": this.host,
        "x-rapidapi-key": this.key,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });

    if (!res.ok) {
      throw new BetsApiHttpError(res.status, `BetsAPI HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const json = (await res.json()) as BetsApiResponse<T>;
    if (json.success !== 1) {
      throw new Error(`BetsAPI error: ${json.error_detail ?? json.error ?? json.message ?? JSON.stringify(json)}`);
    }
    return json;
  }

  // ── 1. In-Play Filter ────────────────────────────────────────────────
  getInplayFilter(sportId = 1): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/inplay_filter", { sport_id: sportId });
  }

  // ── 2. In-Play ───────────────────────────────────────────────────────
  getInplay(): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/inplay");
  }

  // ── 3. In-Play Event (deep live markets + lineup/stats) ──────────────
  getInplayEvent(eventId: string | number): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/event", { stats: 1, lineup: 1, FI: eventId });
  }

  // ── 4. Upcoming Events ───────────────────────────────────────────────
  getUpcomingEvents(sportId = 1): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/upcoming", { sport_id: sportId });
  }

  // ── 5. Upcoming Leagues (note: singular "league" per the API) ────────
  getUpcomingLeagues(sportId = 1): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/league", { sport_id: sportId });
  }

  // ── 6. Pre-Match Odds (per event) ────────────────────────────────────
  getPrematchOdds(fiId: string | number = "0"): Promise<BetsApiResponse<unknown>> {
    return this.request("/v3/bet365/prematch", { FI: fiId });
  }

  // ── 7. Results (settlement) ──────────────────────────────────────────
  getResults(eventId: string | number): Promise<BetsApiResponse<unknown>> {
    return this.request("/v1/bet365/result", { event_id: eventId });
  }
}

/** Narrow a raw `results` payload to the first usable `id` (object form only). */
export function firstId(results: unknown): string | null {
  if (!Array.isArray(results) || !results.length) return null;
  const first = results[0] as { id?: string | number } | null;
  if (first && typeof first === "object" && "id" in first && first.id != null) {
    return String(first.id);
  }
  return null;
}
