import { describe, it, expect } from "vitest";
import { MAX_SKEW_SECONDS, signSettlementBody, verifySettlementSignature } from "@/lib/settlement/signature";
import { settlementPayloadSchema, toStatContext } from "@/lib/settlement/payload";

const SECRET = "a".repeat(48);
const BODY = JSON.stringify({ eventId: "sofa-123-abc", hello: "world" });
const NOW = 1_800_000_000;
const TS = String(NOW);

describe("verifySettlementSignature", () => {
  it("accepts a correctly signed request", () => {
    const sig = signSettlementBody(SECRET, TS, BODY);
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: BODY, now: NOW }),
    ).toEqual({ ok: true });
  });

  it("accepts the sha256= prefixed form", () => {
    const sig = `sha256=${signSettlementBody(SECRET, TS, BODY)}`;
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: BODY, now: NOW }).ok,
    ).toBe(true);
  });

  it("rejects a tampered body — this is the whole point of HMAC over a static header", () => {
    const sig = signSettlementBody(SECRET, TS, BODY);
    const tampered = BODY.replace("world", "worldX");
    const r = verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: tampered, now: NOW });
    expect(r).toEqual({ ok: false, status: 401, reason: "signature mismatch" });
  });

  it("rejects the wrong secret", () => {
    const sig = signSettlementBody("b".repeat(48), TS, BODY);
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: BODY, now: NOW }).ok,
    ).toBe(false);
  });

  it("rejects a replay outside the window (and accepts just inside it)", () => {
    const sig = signSettlementBody(SECRET, TS, BODY);
    const stale = NOW + MAX_SKEW_SECONDS + 1;
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: BODY, now: stale }),
    ).toEqual({ ok: false, status: 401, reason: "timestamp outside replay window" });
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: sig, rawBody: BODY, now: NOW - 60 }).ok,
    ).toBe(true);
  });

  it("rejects missing headers, a non-numeric timestamp and a malformed signature", () => {
    for (const bad of [
      { secret: SECRET, timestamp: null, signature: null, rawBody: BODY, now: NOW },
      { secret: SECRET, timestamp: "nope", signature: "x", rawBody: BODY, now: NOW },
    ]) {
      const r = verifySettlementSignature(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
    expect(
      verifySettlementSignature({ secret: SECRET, timestamp: TS, signature: "deadbeef", rawBody: BODY, now: NOW }).ok,
    ).toBe(false);
  });

  it("fails closed when the secret is unset or too short to be safe", () => {
    for (const secret of [null, undefined, "", "short"]) {
      const r = verifySettlementSignature({ secret, timestamp: TS, signature: "x", rawBody: BODY, now: NOW });
      expect(r).toEqual({ ok: false, status: 503, reason: "settlement webhook secret not configured" });
    }
  });
});

describe("settlementPayloadSchema", () => {
  const valid = {
    eventId: "sofa-999-abcdef123456",
    source: "settle-worker",
    match: {
      kickoff: "2026-09-11T18:00:00Z",
      homeName: "Racing Santander",
      awayName: "Deportivo Alaves",
      status: "FINISHED",
    },
    stats: {
      corners: { ht: { home: 2, away: 3 }, ft: { home: 6, away: 4 } },
      goals: { ht: { home: 1, away: 0 }, ft: { home: 2, away: 1 } },
      cards: {
        ht: { homeYellows: 1, awayYellows: 2, homeReds: 0, awayReds: 0 },
        ft: { homeYellows: 3, awayYellows: 2, homeReds: 1, awayReds: 0 },
      },
    },
  };

  it("accepts a well-formed payload and builds the resolver context", () => {
    const parsed = settlementPayloadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const ctx = toStatContext(parsed.data);
    expect(ctx.homeName).toBe("Racing Santander");
    expect(ctx.corners.ft).toEqual({ home: 6, away: 4 });
    expect(ctx.cards.ft.homeReds).toBe(1);
  });

  it("accepts explicit nulls (a scraper that could not read a stat)", () => {
    const withNulls = structuredClone(valid);
    withNulls.stats.corners.ht = { home: null, away: null } as never;
    expect(settlementPayloadSchema.safeParse(withNulls).success).toBe(true);
  });

  it("rejects a missing eventId, a short eventId and negative counts", () => {
    const noId = structuredClone(valid) as Record<string, unknown>;
    delete noId.eventId;
    expect(settlementPayloadSchema.safeParse(noId).success).toBe(false);

    const shortId = { ...valid, eventId: "abc" };
    expect(settlementPayloadSchema.safeParse(shortId).success).toBe(false);

    const negative = structuredClone(valid);
    negative.stats.corners.ft.home = -1;
    expect(settlementPayloadSchema.safeParse(negative).success).toBe(false);
  });

  it("rejects a payload with no match identity at all", () => {
    expect(settlementPayloadSchema.safeParse({ eventId: "x".repeat(20) }).success).toBe(false);
  });
});
