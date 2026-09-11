/**
 * Centralized thresholds for Slice P3 (Historical Baseline + Dislocation
 * Intelligence).
 *
 * IMPORTANT — READ BEFORE CHANGING ANY NUMBER IN THIS FILE:
 * Every threshold below is an INITIAL OPERATING HYPOTHESIS, not an
 * empirically validated risk boundary. The production collector
 * (/root/parity-live) only recently began accumulating 15-minute
 * observations, so none of these numbers were derived by fitting real
 * historical dislocation data — there isn't enough of it yet. They were
 * chosen to be internally consistent, individually justified (see the
 * comment on each constant), and consistent with the two worked examples
 * in the original P3 brief. They should be revisited once the production
 * collector has accumulated genuinely mature, multi-week history across
 * all six supported tickers. Centralizing them here — instead of scattering
 * magic numbers through src/intelligence/ — is specifically so that
 * recalibration is a one-file exercise, not a codebase hunt.
 */

// ---------------------------------------------------------------------
// Baseline maturity
// ---------------------------------------------------------------------

/**
 * Below this observation count OR below this elapsed-hours span, a ticker
 * is INSUFFICIENT_DATA — not enough history exists to say anything at all
 * about "typical" behavior. 20 observations at the nominal 15-minute
 * cadence is only ~5 hours of continuous capture; the 24-hour floor
 * additionally guards against a short burst of valid readings (e.g. one
 * active session) being mistaken for "some history."
 */
export const MIN_OBSERVATIONS_FOR_ANY_BASELINE = 20;
export const MIN_ELAPSED_HOURS_FOR_ANY_BASELINE = 24;

/**
 * At or above BOTH of these, a ticker is MATURE. Calibrated against the
 * REALISTIC density of eligible observations, not the raw 15-minute
 * capture cadence: eligible observations require P2's healthy_current
 * AND P3's <=360-minute reference-freshness rule (see
 * INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES below), and Chainlink's
 * tokenized-equity feeds only update on price movement during active
 * market hours with no off-hours heartbeat. Realistic density is
 * therefore roughly 24-26 eligible observations per trading day (~6.5
 * active hours x ~4/hour), so 200 observations represents roughly 8
 * trading days (~1.5-2 trading weeks) of genuine market-hours behavior —
 * a defensible minimum before treating a median/MAD as representative.
 * The 96-hour (4 calendar day) floor additionally guards against reaching
 * the observation count via an implausibly short, unrepresentative burst.
 *
 * NOTE: the P3 freshness rule (Revision 3) will likely make real-world
 * time-to-MATURE somewhat slower than this estimate implies, since it can
 * also exclude genuinely-quiet intraday stretches, not just weekends. This
 * is an accepted, documented risk (see the P3 design amendment), not
 * addressed by changing this threshold now.
 */
export const MATURE_MIN_OBSERVATIONS = 200;
export const MATURE_MIN_ELAPSED_HOURS = 96;

// ---------------------------------------------------------------------
// Dispersion floor
// ---------------------------------------------------------------------

/**
 * A floor applied to the median absolute deviation (MAD) before it is used
 * as a divisor for the relative-deviation multiple, purely to avoid
 * division by zero/near-zero on a degenerate (e.g. numerically flat)
 * history. 0.005 percentage points (0.5 basis points) is below normal
 * price-feed precision noise — an economically negligible dispersion, not
 * a claim about real market behavior. This is a defensive floor in the
 * same spirit as src/domain/calc.ts's assertPlausiblePremiumDiscountPct
 * circuit breaker, not a fabricated data value.
 */
export const MAD_FLOOR_PCT = 0.005;

// ---------------------------------------------------------------------
// Dislocation classification
// ---------------------------------------------------------------------

/**
 * Each tier requires BOTH the relative-multiple threshold AND the absolute
 * floor to be cleared — this is the direct implementation of "use both
 * deviation relative to historical behavior and sensible absolute floors,"
 * so a ticker with tiny normal variance cannot be dramatically flagged
 * over an economically insignificant move. Evaluated top-down (SEVERE
 * first); the reported classification is the highest tier for which BOTH
 * conditions hold, else NORMAL.
 *
 * Calibration check against the original brief's own worked examples:
 *   - "+0.25%, NORMAL, 0.8x typical deviation": 0.8x clears no tier -> NORMAL. Matches.
 *   - "+2.84%, SEVERE DISLOCATION, 5.2x typical deviation": 5.2x >= 5.0x
 *     AND 2.84% >= 0.50% -> SEVERE. Matches.
 */
export const CLASSIFICATION_THRESHOLDS = {
  SEVERE: { relativeMultiple: 5.0, absFloorPct: 0.5 },
  DISLOCATED: { relativeMultiple: 3.5, absFloorPct: 0.25 },
  ELEVATED: { relativeMultiple: 2.0, absFloorPct: 0.1 },
} as const;

// ---------------------------------------------------------------------
// Persistence / episode continuity (Revision 2)
// ---------------------------------------------------------------------

/**
 * Maximum allowed timestamp gap between two ADJACENT REAL records (in the
 * persisted file, regardless of their individual validity) for the
 * persistence walk to treat them as temporally continuous. The nominal
 * collector cadence is 15 minutes; 30 minutes is exactly 2x that —
 * generous enough to absorb a single delayed or retried run (P0's
 * existing 429 backoff adds at most a few seconds to a few minutes, not
 * tens of minutes) without falsely breaking continuity, while reliably
 * catching an actually-missed capture cycle (a genuine collector outage).
 * This is a principled default, not empirically derived — the collector
 * has no real outage history yet to calibrate against.
 *
 * Applies ONLY to persistence/episode-continuity, never to baseline
 * construction: the baseline is an unordered statistical sample where
 * temporal adjacency between points is irrelevant; only "has this ONE
 * condition been continuously present" requires it.
 */
export const MAX_OBSERVATION_GAP_MINUTES = 30;

// ---------------------------------------------------------------------
// Intelligence-specific reference freshness (Revision 3)
// ---------------------------------------------------------------------

/**
 * P2's classifyOverallStatus() === "healthy_current" is NECESSARY but not
 * SUFFICIENT for P3 eligibility. P0's own staleness threshold (48 hours,
 * unmodified, see src/domain/calc.ts's isStale) is loose enough that an
 * ordinary weekend market closure can still read as "healthy_current" for
 * a meaningful stretch before it fires — already observed and documented
 * during Slice P1.2b's external verification. Rather than touch P0's
 * protected behavior, P3 imposes its own, stricter, additive filter on
 * top, using ONLY already-persisted fields:
 *
 *   referenceAgeAtCaptureMinutes =
 *     (capturedAt - chainlinkReference.value.updatedAt) in minutes
 *
 * 360 minutes (6 hours) is comfortably longer than any plausible single
 * quiet stretch for the actively-traded, large-cap-or-major-ETF names
 * Parity actually tracks (AAPL, GOOGL, TSLA, NVDA, SPCX, USO), so it
 * should rarely exclude a genuinely-open-market observation, while being
 * drastically shorter than P0's 48-hour threshold — excluding weekend
 * contamination within hours of Friday's last real update rather than
 * waiting up to two days. This is a market-calendar-agnostic, purely
 * evidence-based rule: it never asks "is today a holiday," only "how old
 * was the reference at the moment this specific snapshot was captured,"
 * which is answerable entirely from already-persisted data.
 *
 * Applied uniformly to baseline observations, current classification, AND
 * persistence observations — using a looser standard for "today's
 * reading" than for the baseline it's compared against would itself be an
 * inconsistent yardstick (see the P3 design amendment, Section C).
 */
export const INTELLIGENCE_MAX_REFERENCE_AGE_MINUTES = 360;
