import { describe, it, expect } from "vitest";
import { evaluateAlertTransition } from "../src/alerts/evaluateAlertTransition.js";
import type { DislocationClassification } from "../src/intelligence/types.js";
import type { RiskViewModel } from "../src/readmodel/riskViewModel.js";

function makeRisk(opts: {
  symbol?: string;
  classification: DislocationClassification | null;
  currentPct?: number | null;
  capturedAt?: string;
  madMultiple?: number | null;
}): RiskViewModel {
  const classification = opts.classification;
  const isKnown = classification !== null;
  const currentPct = opts.currentPct !== undefined ? opts.currentPct : isKnown ? 0.5 : null;
  const isEpisodeActive = isKnown && classification !== "NORMAL";

  return {
    symbol: opts.symbol ?? "AAPL",
    apiVersion: "v1",
    capturedAt: opts.capturedAt ?? "2026-09-13T00:00:00.000Z",
    referenceStatus: "healthy_current",
    deviation: {
      currentPct,
      direction: currentPct === null ? null : currentPct > 0 ? "premium" : currentPct < 0 ? "discount" : "flat",
      absDeviationPct: currentPct === null ? null : Math.abs(currentPct),
    },
    eligibility: { eligible: currentPct !== null },
    intelligence: {
      maturity: isKnown ? "MATURE" : "DEVELOPING",
      observationCount: isKnown ? 250 : 10,
      baselinePeriodHours: isKnown ? 200 : null,
      baselineMedianPct: isKnown ? 0.1 : null,
      baselineDispersionMad: isKnown ? 0.05 : null,
      madMultiple: opts.madMultiple !== undefined ? opts.madMultiple : isKnown ? 2.5 : null,
      classification,
      episode: isKnown
        ? {
            state: isEpisodeActive ? "active" : "no_active_episode",
            startedAt: isEpisodeActive ? "2026-09-12T22:00:00.000Z" : null,
            durationMinutes: isEpisodeActive ? 120 : null,
            consecutiveObservations: isEpisodeActive ? 8 : null,
            peakAbsDeviationPct: isEpisodeActive ? 0.5 : null,
          }
        : null,
    },
  };
}

describe("evaluateAlertTransition — new_risk (NORMAL -> abnormal)", () => {
  it.each<DislocationClassification>(["ELEVATED", "DISLOCATED", "SEVERE"])("NORMAL -> %s produces new_risk", (curr) => {
    const prev = makeRisk({ classification: "NORMAL" });
    const now = makeRisk({ classification: curr });
    const event = evaluateAlertTransition(prev, now);
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("new_risk");
    expect(event!.previousClassification).toBe("NORMAL");
    expect(event!.currentClassification).toBe(curr);
  });
});

describe("evaluateAlertTransition — escalation", () => {
  it.each<[DislocationClassification, DislocationClassification]>([
    ["ELEVATED", "DISLOCATED"],
    ["ELEVATED", "SEVERE"],
    ["DISLOCATED", "SEVERE"],
  ])("%s -> %s produces escalation", (prevC, currC) => {
    const prev = makeRisk({ classification: prevC });
    const now = makeRisk({ classification: currC });
    const event = evaluateAlertTransition(prev, now);
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("escalation");
    expect(event!.previousClassification).toBe(prevC);
    expect(event!.currentClassification).toBe(currC);
  });
});

describe("evaluateAlertTransition — recovery (abnormal -> NORMAL)", () => {
  it.each<DislocationClassification>(["ELEVATED", "DISLOCATED", "SEVERE"])("%s -> NORMAL produces recovery", (prevC) => {
    const prev = makeRisk({ classification: prevC });
    const now = makeRisk({ classification: "NORMAL" });
    const event = evaluateAlertTransition(prev, now);
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("recovery");
    expect(event!.previousClassification).toBe(prevC);
    expect(event!.currentClassification).toBe("NORMAL");
  });
});

describe("evaluateAlertTransition — no alert: identical classification repeated", () => {
  it.each<DislocationClassification>(["NORMAL", "ELEVATED", "DISLOCATED", "SEVERE"])("%s -> %s produces no alert", (c) => {
    const prev = makeRisk({ classification: c });
    const now = makeRisk({ classification: c });
    expect(evaluateAlertTransition(prev, now)).toBeNull();
  });
});

describe("evaluateAlertTransition — no alert: downgrade between abnormal tiers", () => {
  it.each<[DislocationClassification, DislocationClassification]>([
    ["SEVERE", "DISLOCATED"],
    ["SEVERE", "ELEVATED"],
    ["DISLOCATED", "ELEVATED"],
  ])("%s -> %s produces no alert (prefer silence over inventing a downgrade event)", (prevC, currC) => {
    const prev = makeRisk({ classification: prevC });
    const now = makeRisk({ classification: currC });
    expect(evaluateAlertTransition(prev, now)).toBeNull();
  });
});

describe("evaluateAlertTransition — null / missing-visibility semantics", () => {
  it("null -> ELEVATED produces no alert (cannot distinguish true transition from resumed visibility)", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: null }), makeRisk({ classification: "ELEVATED" }))).toBeNull();
  });
  it("null -> SEVERE produces no alert", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: null }), makeRisk({ classification: "SEVERE" }))).toBeNull();
  });
  it("ELEVATED -> null produces no alert (missing data is not recovery)", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: "ELEVATED" }), makeRisk({ classification: null }))).toBeNull();
  });
  it("SEVERE -> null produces no alert", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: "SEVERE" }), makeRisk({ classification: null }))).toBeNull();
  });
  it("null -> NORMAL produces no alert", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: null }), makeRisk({ classification: "NORMAL" }))).toBeNull();
  });
  it("NORMAL -> null produces no alert", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: "NORMAL" }), makeRisk({ classification: null }))).toBeNull();
  });
  it("null -> null produces no alert", () => {
    expect(evaluateAlertTransition(makeRisk({ classification: null }), makeRisk({ classification: null }))).toBeNull();
  });
  it("a genuinely absent previous state (previous === null, the very first evaluation ever) produces no alert even when current is abnormal", () => {
    expect(evaluateAlertTransition(null, makeRisk({ classification: "SEVERE" }))).toBeNull();
  });
  it("a genuinely absent previous state does not alert even when current is NORMAL", () => {
    expect(evaluateAlertTransition(null, makeRisk({ classification: "NORMAL" }))).toBeNull();
  });
});

describe("evaluateAlertTransition — data honesty", () => {
  it("preserves an exact zero deviation as 0, not null and not dropped", () => {
    const prev = makeRisk({ classification: "NORMAL", currentPct: 0 });
    const now = makeRisk({ classification: "ELEVATED", currentPct: 0 });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.deviationPct).toBe(0);
    expect(event!.absDeviationPct).toBe(0);
  });

  it("preserves null deviation/madMultiple as null when the current record itself carries them as null", () => {
    // Note: classification is non-null (MATURE) but this fixture still
    // proves the evaluator copies whatever value is present without
    // coercion — it does not invent or substitute a fallback.
    const prev = makeRisk({ classification: "NORMAL" });
    const now = makeRisk({ classification: "SEVERE", madMultiple: null });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.madMultiple).toBeNull();
  });

  it("normalizes symbol to canonical uppercase", () => {
    const prev = makeRisk({ classification: "NORMAL", symbol: "aapl" });
    const now = makeRisk({ classification: "SEVERE", symbol: "aapl" });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.symbol).toBe("AAPL");
  });

  it("occurredAt comes from the current RiskViewModel's real capturedAt, never a synthesized value", () => {
    const prev = makeRisk({ classification: "NORMAL", capturedAt: "2026-09-01T00:00:00.000Z" });
    const now = makeRisk({ classification: "SEVERE", capturedAt: "2026-09-13T08:15:30.500Z" });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.occurredAt).toBe("2026-09-13T08:15:30.500Z");
  });

  it("does not mutate either input object", () => {
    const prev = makeRisk({ classification: "NORMAL" });
    const now = makeRisk({ classification: "SEVERE" });
    const prevSnapshot = JSON.parse(JSON.stringify(prev));
    const nowSnapshot = JSON.parse(JSON.stringify(now));
    evaluateAlertTransition(prev, now);
    expect(prev).toEqual(prevSnapshot);
    expect(now).toEqual(nowSnapshot);
  });

  it("copies episode context verbatim from the current RiskViewModel", () => {
    const prev = makeRisk({ classification: "NORMAL" });
    const now = makeRisk({ classification: "SEVERE" });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.episode).toEqual({
      startedAt: "2026-09-12T22:00:00.000Z",
      durationMinutes: 120,
      consecutiveObservations: 8,
      peakAbsDeviationPct: 0.5,
    });
  });

  it("recovery's episode reflects the current (NORMAL, no_active_episode) state, not the previous abnormal episode", () => {
    const prev = makeRisk({ classification: "SEVERE" });
    const now = makeRisk({ classification: "NORMAL" });
    const event = evaluateAlertTransition(prev, now);
    expect(event!.episode).toEqual({
      startedAt: null,
      durationMinutes: null,
      consecutiveObservations: null,
      peakAbsDeviationPct: null,
    });
  });

  it("event object contains no UI-label wording, no z-score wording, and no investment-safety language", () => {
    const prev = makeRisk({ classification: "NORMAL" });
    const now = makeRisk({ classification: "SEVERE" });
    const event = evaluateAlertTransition(prev, now);
    const json = JSON.stringify(event);
    expect(json).not.toMatch(/typical/i);
    expect(json).not.toMatch(/z-score/i);
    expect(json).not.toMatch(/buy|sell|safe|guarantee/i);
    expect(event).not.toHaveProperty("label");
  });

  it("evaluator performs no intelligence recomputation — verified structurally: the module imports no src/intelligence computation modules", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/alerts/evaluateAlertTransition.ts", import.meta.url), "utf8"),
    );
    // Check actual import specifiers, not the whole file text — this
    // module's own documentation comments correctly NAME the forbidden
    // functions to explain why they are absent, which would otherwise
    // false-positive a naive whole-file substring/regex search.
    const importLines = src.split("\n").filter((line) => line.trim().startsWith("import "));
    const importedFrom = importLines.join("\n");
    expect(importedFrom).not.toMatch(/intelligence\/(classification|eligibility|persistence|buildTickerIntelligence)\.js/);
    expect(importedFrom).not.toMatch(/readmodel\/fieldStatus\.js/);
    // The only intelligence-domain import permitted is the plain
    // DislocationClassification TYPE (no runtime computation), and the
    // only readmodel import permitted is the RiskViewModel TYPE.
    expect(importedFrom).toMatch(/import type \{ DislocationClassification \} from "\.\.\/intelligence\/types\.js"/);
  });
});
