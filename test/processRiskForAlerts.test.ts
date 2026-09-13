import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processRiskForAlerts } from "../src/alerts/processRiskForAlerts.js";
import { readAlertState, AlertStateCorruptionError } from "../src/alerts/alertStateStore.js";
import type { DislocationClassification } from "../src/intelligence/types.js";
import type { RiskViewModel } from "../src/readmodel/riskViewModel.js";

let dataDir: string;
let filePath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "parity-alertstate-test-"));
  filePath = join(dataDir, "alert-state.json");
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function makeRisk(symbol: string, classification: DislocationClassification | null, capturedAt: string): RiskViewModel {
  const isKnown = classification !== null;
  return {
    symbol,
    apiVersion: "v1",
    capturedAt,
    referenceStatus: "healthy_current",
    deviation: { currentPct: isKnown ? 0.5 : null, direction: isKnown ? "premium" : null, absDeviationPct: isKnown ? 0.5 : null },
    eligibility: { eligible: isKnown },
    intelligence: {
      maturity: isKnown ? "MATURE" : "DEVELOPING",
      observationCount: isKnown ? 250 : 10,
      baselinePeriodHours: isKnown ? 200 : null,
      baselineMedianPct: isKnown ? 0.1 : null,
      baselineDispersionMad: isKnown ? 0.05 : null,
      madMultiple: isKnown ? 2.5 : null,
      classification,
      episode: isKnown
        ? { state: classification === "NORMAL" ? "no_active_episode" : "active", startedAt: classification === "NORMAL" ? null : capturedAt, durationMinutes: classification === "NORMAL" ? null : 60, consecutiveObservations: classification === "NORMAL" ? null : 4, peakAbsDeviationPct: classification === "NORMAL" ? null : 0.5 }
        : null,
    },
  };
}

describe("processRiskForAlerts — first observation", () => {
  it("seeds state and emits no alert", () => {
    const result = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:00:00.000Z"), { filePath });
    expect(result.event).toBeNull();
    expect(result.stateUpdated).toBe(true);
    expect(result.reason).toBe("seeded_first_observation");

    const state = readAlertState({ filePath });
    expect(state.AAPL).toEqual({ lastEvaluatedCapturedAt: "2026-09-13T00:00:00.000Z", lastClassification: "ELEVATED" });
  });
});

describe("processRiskForAlerts — transitions across separate calls (simulating separate process runs)", () => {
  it("NORMAL -> ELEVATED emits exactly once", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event).not.toBeNull();
    expect(result.event!.eventType).toBe("new_risk");
    expect(result.reason).toBe("transition_evaluated");
  });

  it("ELEVATED -> DISLOCATED emits exactly once", () => {
    processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", "DISLOCATED", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event!.eventType).toBe("escalation");
  });

  it("DISLOCATED -> NORMAL emits exactly once", () => {
    processRiskForAlerts(makeRisk("AAPL", "DISLOCATED", "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event!.eventType).toBe("recovery");
  });
});

describe("processRiskForAlerts — dedup / replay", () => {
  it("re-evaluating the exact same capturedAt emits nothing and does not touch state", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    const first = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(first.event!.eventType).toBe("new_risk");
    const stateAfterFirst = readAlertState({ filePath });

    // Replay the EXACT same snapshot (same capturedAt) again.
    const replay = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(replay.event).toBeNull();
    expect(replay.stateUpdated).toBe(false);
    expect(replay.reason).toBe("stale_or_replayed_capture");
    expect(readAlertState({ filePath })).toEqual(stateAfterFirst); // completely untouched
  });

  it("ELEVATED -> ELEVATED (same classification, newer capturedAt) emits nothing", () => {
    processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event).toBeNull();
    expect(result.stateUpdated).toBe(true); // still a genuinely newer capture, state legitimately advances
    expect(result.reason).toBe("transition_evaluated");
  });

  it("restart then replay: a fresh readAlertState()/processRiskForAlerts() call sequence after 'restart' still cannot re-fire an already-emitted transition", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:15:00.000Z"), { filePath });
    // Nothing in-memory carries over between these calls except the file
    // on disk — this already IS the "restart" scenario, since
    // processRiskForAlerts holds no module-level state of its own. Prove
    // it explicitly by re-reading state fresh and replaying the same
    // capturedAt as if a new process had just started up.
    const stateOnDisk = readAlertState({ filePath });
    expect(stateOnDisk.AAPL!.lastEvaluatedCapturedAt).toBe("2026-09-13T00:15:00.000Z");

    const replayAfterRestart = processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(replayAfterRestart.event).toBeNull();
    expect(replayAfterRestart.reason).toBe("stale_or_replayed_capture");
  });
});

describe("processRiskForAlerts — null / ineligible semantics propagate truthfully across persisted state", () => {
  it("abnormal -> null emits nothing but truthfully advances stored state to null", () => {
    processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", null, "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event).toBeNull();
    expect(result.stateUpdated).toBe(true);
    expect(readAlertState({ filePath }).AAPL!.lastClassification).toBeNull();
  });

  it("null -> abnormal emits nothing (cannot distinguish true transition from resumed visibility), even across persisted runs", () => {
    processRiskForAlerts(makeRisk("AAPL", null, "2026-09-13T00:00:00.000Z"), { filePath });
    const result = processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(result.event).toBeNull();
    expect(result.stateUpdated).toBe(true);
    expect(readAlertState({ filePath }).AAPL!.lastClassification).toBe("SEVERE");
  });

  it("a full null -> SEVERE -> null -> SEVERE cycle never alerts on the null-adjacent hops", () => {
    processRiskForAlerts(makeRisk("AAPL", null, "2026-09-13T00:00:00.000Z"), { filePath });
    const r1 = processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(r1.event).toBeNull(); // null -> SEVERE
    const r2 = processRiskForAlerts(makeRisk("AAPL", null, "2026-09-13T00:30:00.000Z"), { filePath });
    expect(r2.event).toBeNull(); // SEVERE -> null
    const r3 = processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:45:00.000Z"), { filePath });
    expect(r3.event).toBeNull(); // null -> SEVERE again — correctly NOT a false new_risk
  });
});

describe("processRiskForAlerts — stale/out-of-order safety", () => {
  it("a stale, earlier capturedAt cannot regress already-advanced state", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:30:00.000Z"), { filePath });
    const stateBeforeStaleCall = readAlertState({ filePath });

    // An out-of-order, EARLIER capture arrives (e.g. a replayed/delayed message).
    const stale = processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:15:00.000Z"), { filePath });
    expect(stale.event).toBeNull();
    expect(stale.stateUpdated).toBe(false);
    expect(readAlertState({ filePath })).toEqual(stateBeforeStaleCall); // unchanged, not regressed
  });
});

describe("processRiskForAlerts — symbol independence", () => {
  it("separate symbols maintain completely independent state and transitions", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    processRiskForAlerts(makeRisk("GOOGL", "SEVERE", "2026-09-13T00:00:00.000Z"), { filePath });

    const aaplResult = processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:15:00.000Z"), { filePath });
    const googlResult = processRiskForAlerts(makeRisk("GOOGL", "NORMAL", "2026-09-13T00:15:00.000Z"), { filePath });

    expect(aaplResult.event!.eventType).toBe("new_risk");
    expect(googlResult.event!.eventType).toBe("recovery");

    const state = readAlertState({ filePath });
    expect(state.AAPL!.lastClassification).toBe("ELEVATED");
    expect(state.GOOGL!.lastClassification).toBe("NORMAL");
  });
});

describe("processRiskForAlerts / alertStateStore — corruption and missing-file behavior", () => {
  it("a missing state file is valid empty state, not an error", () => {
    expect(existsSync(filePath)).toBe(false);
    expect(readAlertState({ filePath })).toEqual({});
  });

  it("malformed JSON throws AlertStateCorruptionError (fail closed) rather than silently resetting", () => {
    writeFileSync(filePath, "{ this is not valid JSON ][");
    expect(() => readAlertState({ filePath })).toThrow(AlertStateCorruptionError);
  });

  it("valid JSON with the wrong shape (an array) throws AlertStateCorruptionError", () => {
    writeFileSync(filePath, JSON.stringify(["not", "an", "object"]));
    expect(() => readAlertState({ filePath })).toThrow(AlertStateCorruptionError);
  });

  it("valid JSON with an invalid classification value throws AlertStateCorruptionError", () => {
    writeFileSync(filePath, JSON.stringify({ AAPL: { lastEvaluatedCapturedAt: "2026-09-13T00:00:00.000Z", lastClassification: "TOTALLY_MADE_UP" } }));
    expect(() => readAlertState({ filePath })).toThrow(AlertStateCorruptionError);
  });

  it("valid JSON with a non-ISO-8601 capturedAt throws AlertStateCorruptionError", () => {
    writeFileSync(filePath, JSON.stringify({ AAPL: { lastEvaluatedCapturedAt: "not-a-date", lastClassification: null } }));
    expect(() => readAlertState({ filePath })).toThrow(AlertStateCorruptionError);
  });

  it("processRiskForAlerts propagates corruption rather than silently proceeding as if state were empty", () => {
    writeFileSync(filePath, "not json at all");
    expect(() => processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:00:00.000Z"), { filePath })).toThrow(AlertStateCorruptionError);
  });
});

describe("alertStateStore — atomic write path", () => {
  it("leaves no leftover temp files after a successful write", () => {
    processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:00:00.000Z"), { filePath });
    const entries = readdirSync(dataDir);
    const tempFiles = entries.filter((f) => f.includes(".tmp-"));
    expect(tempFiles).toEqual([]);
    expect(entries).toContain("alert-state.json");
  });

  it("the persisted file is valid, well-formed JSON matching exactly what was written", () => {
    processRiskForAlerts(makeRisk("AAPL", "ELEVATED", "2026-09-13T00:00:00.000Z"), { filePath });
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ AAPL: { lastEvaluatedCapturedAt: "2026-09-13T00:00:00.000Z", lastClassification: "ELEVATED" } });
  });

  it("multiple sequential writes each fully replace the file with no accumulation of stale keys removed elsewhere", () => {
    processRiskForAlerts(makeRisk("AAPL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    processRiskForAlerts(makeRisk("GOOGL", "NORMAL", "2026-09-13T00:00:00.000Z"), { filePath });
    processRiskForAlerts(makeRisk("AAPL", "SEVERE", "2026-09-13T00:15:00.000Z"), { filePath });
    const state = readAlertState({ filePath });
    expect(Object.keys(state).sort()).toEqual(["AAPL", "GOOGL"]);
    expect(state.AAPL!.lastClassification).toBe("SEVERE");
    expect(state.GOOGL!.lastClassification).toBe("NORMAL");
  });
});
