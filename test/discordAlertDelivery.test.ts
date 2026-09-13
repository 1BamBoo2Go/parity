import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonLine } from "../src/snapshot/jsonlStore.js";
import { processCaptureRunForAlerts } from "../src/alerts/processCaptureRunForAlerts.js";
import {
  buildDiscordPayload,
  createDiscordAlertDelivery,
  selectAlertDeliveryFromEnv,
  DiscordDeliveryError,
  type FetchLike,
} from "../src/alerts/discordAlertDelivery.js";
import type { AlertEvent } from "../src/alerts/types.js";
import type { TickerSnapshotRecord } from "../src/snapshot/types.js";
import type { CaptureRunResult } from "../src/snapshot/captureRun.js";

let dataDir: string;
let alertStatePath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-discord-test-"));
  alertStatePath = join(dataDir, "alert-state.json");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function opts() {
  return { readerOptions: { dataDir }, alertStateOptions: { filePath: alertStatePath } };
}

function seedRecord(overrides: Partial<TickerSnapshotRecord> = {}): TickerSnapshotRecord {
  return {
    recordType: "ticker_snapshot",
    runId: "test-run",
    capturedAt: "2026-09-13T00:00:00.000Z",
    ticker: "AAPL",
    canonicalTokenAddress: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    configuredPoolAddress: "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed",
    robinhoodAssetStatus: { status: "ok", value: "ACTIVE", asOf: "x", source: "s" },
    robinhoodPrice: { status: "ok", value: { bid: "213.4", ask: "213.5", mid: 213.45, isTradingHalt: false, generatedAt: "x" }, asOf: "x", source: "s" },
    chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: "x" }, asOf: "x", source: "s" },
    oraclePaused: { status: "ok", value: false, asOf: "x", source: "s" },
    secondaryPrice: { status: "ok", value: 214.0, asOf: "x", source: "s" },
    premiumDiscountPct: { status: "ok", value: 0.26, asOf: "x", source: "s" },
    holderConcentration: { status: "ok", value: { holderRows: 10, top1Pct: 40, top5Pct: 68, top10Pct: 79 }, asOf: "x", source: "s" },
    ...overrides,
  };
}

function seedMatureHistory(symbol: string, pct: number, capturedAt: string) {
  const endMs = Date.parse(capturedAt);
  for (let i = 0; i < 250; i++) {
    const t = new Date(endMs - (249 - i) * 60 * 60000).toISOString();
    appendJsonLine(
      join(dataDir, "ticker-snapshots.jsonl"),
      seedRecord({
        ticker: symbol,
        capturedAt: t,
        chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t }, asOf: t, source: "s" },
        premiumDiscountPct: { status: "ok", value: i === 249 ? pct : 0.1, asOf: t, source: "s" },
      }),
    );
  }
}

function syntheticCaptureResult(records: TickerSnapshotRecord[]): CaptureRunResult {
  return { runId: "synthetic-run", tickerRecords: records, registryCaptured: true, gasCaptured: true, tickerErrors: [] };
}

// ---- fixture AlertEvent builder, for direct payload-level tests ----
function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    eventType: "new_risk",
    symbol: "AAPL",
    occurredAt: "2026-09-13T00:15:00.000Z",
    previousClassification: "NORMAL",
    currentClassification: "ELEVATED",
    deviationPct: 0.2,
    absDeviationPct: 0.2,
    madMultiple: 20,
    episode: { startedAt: "2026-09-13T00:15:00.000Z", durationMinutes: 0, consecutiveObservations: 1, peakAbsDeviationPct: 0.2 },
    ...overrides,
  };
}

describe("buildDiscordPayload — pure payload construction", () => {
  it("1. produces the expected Discord payload shape from a canonical AlertEvent", () => {
    const event = makeEvent();
    const payload = buildDiscordPayload(event);
    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds[0]!;
    expect(embed.title).toBe("AAPL \u2014 New Risk Condition");
    expect(embed.description).toBe("NORMAL \u2192 ELEVATED");
    expect(embed.timestamp).toBe("2026-09-13T00:15:00.000Z");
    expect(embed.fields.map((f) => f.name)).toEqual(["Deviation", "MAD Multiple", "Episode"]);
    expect(embed.color).toBe(9133311); // Parity violet, ELEVATED
  });

  it("2. new_risk formatting", () => {
    const embed = buildDiscordPayload(makeEvent({ eventType: "new_risk", previousClassification: "NORMAL", currentClassification: "SEVERE" })).embeds[0]!;
    expect(embed.title).toContain("New Risk Condition");
    expect(embed.color).toBe(16727988); // Parity magenta, SEVERE
  });

  it("3. escalation formatting", () => {
    const embed = buildDiscordPayload(makeEvent({ eventType: "escalation", previousClassification: "ELEVATED", currentClassification: "DISLOCATED" })).embeds[0]!;
    expect(embed.title).toContain("Risk Escalation");
    expect(embed.description).toBe("ELEVATED \u2192 DISLOCATED");
    expect(embed.color).toBe(16727988); // Parity magenta, DISLOCATED
  });

  it("4. recovery formatting uses the neutral cyan Parity color, never green", () => {
    const embed = buildDiscordPayload(
      makeEvent({ eventType: "recovery", previousClassification: "SEVERE", currentClassification: "NORMAL", deviationPct: 0.1, absDeviationPct: 0.1, madMultiple: null, episode: { startedAt: null, durationMinutes: null, consecutiveObservations: null, peakAbsDeviationPct: null } }),
    ).embeds[0]!;
    expect(embed.title).toContain("Recovery to Normal");
    expect(embed.color).toBe(2285823); // Parity cyan — recovery
    // No green anywhere in the whole payload's colors.
    const g = (embed.color >> 8) & 0xff, r = (embed.color >> 16) & 0xff, b = embed.color & 0xff;
    expect(g > r + 28 && g > b + 28).toBe(false);
  });

  it("5. null deviation/MAD/episode fields are represented truthfully, never coerced to zero", () => {
    const event = makeEvent({ deviationPct: null, absDeviationPct: null, madMultiple: null, episode: null });
    const embed = buildDiscordPayload(event).embeds[0]!;
    const byName = (n: string) => embed.fields.find((f) => f.name === n)!.value;
    expect(byName("Deviation")).toBe("Unavailable");
    expect(byName("MAD Multiple")).toBe("Unavailable");
    expect(byName("Episode")).toBe("No active episode");
    expect(byName("Deviation")).not.toContain("0.00");
  });

  it("5b. an episode with no active state (recovery) reads 'No active episode', not fabricated zeros", () => {
    const event = makeEvent({ eventType: "recovery", episode: { startedAt: null, durationMinutes: null, consecutiveObservations: null, peakAbsDeviationPct: null } });
    const embed = buildDiscordPayload(event).embeds[0]!;
    expect(embed.fields.find((f) => f.name === "Episode")!.value).toBe("No active episode");
  });

  it("6a. positive deviationPct renders as premium, derived only from canonical sign", () => {
    const embed = buildDiscordPayload(makeEvent({ deviationPct: 0.35, absDeviationPct: 0.35 })).embeds[0]!;
    expect(embed.fields.find((f) => f.name === "Deviation")!.value).toBe("+0.3500% (premium)");
  });

  it("6b. negative deviationPct renders as discount", () => {
    const embed = buildDiscordPayload(makeEvent({ deviationPct: -0.35, absDeviationPct: 0.35 })).embeds[0]!;
    expect(embed.fields.find((f) => f.name === "Deviation")!.value).toBe("-0.3500% (discount)");
  });

  it("6c. exact zero deviationPct renders as flat, not omitted or treated as unavailable", () => {
    const embed = buildDiscordPayload(makeEvent({ deviationPct: 0, absDeviationPct: 0 })).embeds[0]!;
    expect(embed.fields.find((f) => f.name === "Deviation")!.value).toBe("0.0000% (flat)");
  });

  it("7. buildDiscordPayload does not mutate the canonical event", () => {
    const event = Object.freeze(makeEvent());
    expect(() => buildDiscordPayload(event)).not.toThrow();
    // Frozen input surviving unharmed is itself proof: any attempted
    // mutation would have thrown in this strict-mode ESM context.
    expect(event.symbol).toBe("AAPL");
  });
});

describe("createDiscordAlertDelivery — HTTP behavior", () => {
  function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Partial<Response>>): FetchLike {
    return (async (url: string, init: RequestInit) => impl(url, init)) as unknown as FetchLike;
  }

  it("8. exactly one POST per delivery call", async () => {
    let callCount = 0;
    const fetchImpl = fakeFetch(async () => {
      callCount++;
      return { ok: true, status: 204, text: async () => "" };
    });
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/faketoken", fetchImpl });
    await deliver(makeEvent());
    expect(callCount).toBe(1);
  });

  it("9. POSTs with correct method and Content-Type, and a JSON-parseable body matching buildDiscordPayload", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = fakeFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 204, text: async () => "" };
    });
    const event = makeEvent();
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/faketoken", fetchImpl });
    await deliver(event);

    expect(capturedUrl).toBe("https://discord.com/api/webhooks/1/faketoken");
    expect(capturedInit!.method).toBe("POST");
    expect((capturedInit!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(capturedInit!.body as string)).toEqual(buildDiscordPayload(event));
  });

  it("10. a 2xx Discord response resolves successfully", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: true, status: 204, text: async () => "" }));
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/faketoken", fetchImpl });
    await expect(deliver(makeEvent())).resolves.toBeUndefined();
  });

  it("11. a non-2xx Discord response surfaces as DiscordDeliveryError", async () => {
    const fetchImpl = fakeFetch(async () => ({ ok: false, status: 404, text: async () => '{"message":"Unknown Webhook","code":10015}' }));
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/faketoken", fetchImpl });
    await expect(deliver(makeEvent())).rejects.toBeInstanceOf(DiscordDeliveryError);
    await expect(deliver(makeEvent())).rejects.toThrow(/HTTP 404/);
  });

  it("12. a network-level failure surfaces as DiscordDeliveryError", async () => {
    const fetchImpl: FetchLike = (async () => {
      throw new Error("getaddrinfo ENOTFOUND discord.com");
    }) as unknown as FetchLike;
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/faketoken", fetchImpl });
    await expect(deliver(makeEvent())).rejects.toBeInstanceOf(DiscordDeliveryError);
  });

  it("13. the webhook URL never appears in a surfaced error, for either failure mode", async () => {
    const secretUrl = "https://discord.com/api/webhooks/999999/SUPER_SECRET_TOKEN_VALUE";

    const failing404 = fakeFetch(async () => ({ ok: false, status: 404, text: async () => "not found" }));
    const deliver1 = createDiscordAlertDelivery({ webhookUrl: secretUrl, fetchImpl: failing404 });
    try {
      await deliver1(makeEvent());
      throw new Error("expected rejection");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SUPER_SECRET_TOKEN_VALUE");
      expect(String((err as Error).stack)).not.toContain("SUPER_SECRET_TOKEN_VALUE");
    }

    const failingNetwork: FetchLike = (async () => {
      throw new Error("network down");
    }) as unknown as FetchLike;
    const deliver2 = createDiscordAlertDelivery({ webhookUrl: secretUrl, fetchImpl: failingNetwork });
    try {
      await deliver2(makeEvent());
      throw new Error("expected rejection");
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SUPER_SECRET_TOKEN_VALUE");
    }
  });
});

describe("selectAlertDeliveryFromEnv — composition-layer configuration", () => {
  it("14. missing Discord configuration returns undefined, preserving processCaptureRunForAlerts' own default delivery", () => {
    const result = selectAlertDeliveryFromEnv({});
    expect(result).toBeUndefined();
  });

  it("returns a real AlertDelivery function when DISCORD_ALERT_WEBHOOK_URL is set", () => {
    const result = selectAlertDeliveryFromEnv({ DISCORD_ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token" });
    expect(typeof result).toBe("function");
  });

  it("never surfaces the webhook URL through its own return value's shape (a plain function, no leaking property)", () => {
    const result = selectAlertDeliveryFromEnv({ DISCORD_ALERT_WEBHOOK_URL: "https://discord.com/api/webhooks/1/SECRET" });
    expect(JSON.stringify(Object.keys(result as unknown as Record<string, unknown>))).not.toContain("SECRET");
  });
});

describe("Discord delivery integrated through the real pipeline", () => {
  it("15. no alert means no Discord request", async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = (async () => {
      callCount++;
      return { ok: true, status: 204, text: async () => "" } as Response;
    }) as unknown as FetchLike;
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/token", fetchImpl });

    const capturedAt = "2026-09-13T00:00:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]), { ...opts(), deliver });
    expect(callCount).toBe(0); // first observation: seeded, no event
  });

  it("16. replay/dedup remains upstream — a replayed capturedAt produces no second Discord request", async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = (async () => {
      callCount++;
      return { ok: true, status: 204, text: async () => "" } as Response;
    }) as unknown as FetchLike;
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/token", fetchImpl });

    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), { ...opts(), deliver });

    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    const record = seedRecord({ ticker: "AAPL", capturedAt: t1 });

    await processCaptureRunForAlerts(syntheticCaptureResult([record]), { ...opts(), deliver });
    expect(callCount).toBe(1);

    await processCaptureRunForAlerts(syntheticCaptureResult([record]), { ...opts(), deliver }); // replay
    expect(callCount).toBe(1); // still one — dedup happened upstream in P5-B2, before Discord was ever reached
  });

  it("17. the very first observation ever produces no Discord request", async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = (async () => {
      callCount++;
      return { ok: true, status: 204, text: async () => "" } as Response;
    }) as unknown as FetchLike;
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/token", fetchImpl });
    const capturedAt = "2026-09-13T00:00:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt }));
    const result = await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt })]), { ...opts(), deliver });
    expect(result.processed[0]!.event).toBeNull();
    expect(callCount).toBe(0);
  });

  it("a genuine transition through the real pipeline delivers exactly one real-shaped Discord payload", async () => {
    let capturedBody: string | undefined;
    const fetchImpl: FetchLike = (async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return { ok: true, status: 204, text: async () => "" } as Response;
    }) as unknown as FetchLike;
    const deliver = createDiscordAlertDelivery({ webhookUrl: "https://discord.com/api/webhooks/1/token", fetchImpl });

    seedMatureHistory("AAPL", 0.1, "2026-09-13T00:00:00.000Z");
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: "2026-09-13T00:00:00.000Z", premiumDiscountPct: { status: "ok", value: 0.1, asOf: "x", source: "s" } })]), { ...opts(), deliver });
    const t1 = "2026-09-13T00:15:00.000Z";
    appendJsonLine(join(dataDir, "ticker-snapshots.jsonl"), seedRecord({ ticker: "AAPL", capturedAt: t1, premiumDiscountPct: { status: "ok", value: 3.0, asOf: "x", source: "s" }, chainlinkReference: { status: "ok", value: { normalizedPrice: 213.45, decimals: 8, updatedAt: t1 }, asOf: t1, source: "s" } }));
    await processCaptureRunForAlerts(syntheticCaptureResult([seedRecord({ ticker: "AAPL", capturedAt: t1 })]), { ...opts(), deliver });

    const payload = JSON.parse(capturedBody!);
    expect(payload.embeds[0].title).toBe("AAPL \u2014 New Risk Condition");
    expect(payload.embeds[0].description).toBe("NORMAL \u2192 SEVERE");
  });
});
