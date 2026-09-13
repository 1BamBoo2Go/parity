import type { AlertEvent, AlertEventType } from "./types.js";
import type { AlertDelivery } from "./processCaptureRunForAlerts.js";

/**
 * P5-B5 — Discord as the first real AlertDelivery implementation.
 *
 * AUDIT FINDINGS informing this design:
 *   - No HTTP dependency exists beyond express/viem (package.json checked
 *     directly) and Node 22 (confirmed via `node --version`) has fetch
 *     built in — a webhook POST does not justify adding a dependency.
 *   - src/sources/robinhoodRegistry.ts already establishes the exact
 *     injectable-fetch convention this file mirrors:
 *     `type FetchLike = typeof fetch`, a function parameter defaulting to
 *     the real `fetch`, a dedicated Error subclass, `!res.ok` treated as
 *     failure. ONE deliberate deviation from that mirrored pattern:
 *     UpstreamFetchError stores `url` as a public property because those
 *     source URLs are public API endpoints with no embedded secret. A
 *     Discord webhook URL embeds its own authentication token IN the URL
 *     path — this file's error type never stores or accepts the URL, by
 *     construction (see DiscordDeliveryError below), so there is no
 *     property for a caller to ever accidentally log or serialize.
 *   - process.env.BLOCKSCOUT_API_KEY (src/sources/blockscoutHolders.ts)
 *     already establishes "optional external credential, absent by
 *     default, feature degrades gracefully, no dotenv dependency" as this
 *     codebase's existing configuration convention — mirrored exactly by
 *     selectAlertDeliveryFromEnv below.
 *
 * LAYERING: this file contains no intelligence calculations, no
 * transition logic, and no persistence/dedup logic — it only knows how to
 * turn an already-decided, canonical AlertEvent into a Discord webhook
 * request. captureRun / buildTickerIntelligence / evaluateAlertTransition
 * / processRiskForAlerts remain completely unaware this file exists;
 * only scripts/captureSnapshot.ts (the composition layer) imports it.
 */

export type FetchLike = typeof fetch;

export class DiscordDeliveryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    /** HTTP status code, when the failure was a non-2xx response rather than a network-level error. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DiscordDeliveryError";
  }
}

// Exactly Parity's locked, approved visual palette (design/approved/final-neon-refined.html)
// — no new colors invented, no green anywhere. Converted from hex to the
// decimal integer Discord's embed `color` field requires.
const PARITY_CYAN = 2285823; // #22e0ff — used for recovery (neutral, "returned to baseline")
const PARITY_VIOLET = 9133311; // #8b5cff — used for ELEVATED
const PARITY_MAGENTA = 16727988; // #ff3fb4 — used for DISLOCATED and SEVERE

function colorForEvent(event: AlertEvent): number {
  if (event.eventType === "recovery") return PARITY_CYAN;
  if (event.currentClassification === "ELEVATED") return PARITY_VIOLET;
  return PARITY_MAGENTA; // DISLOCATED or SEVERE
}

const EVENT_TITLES: Record<AlertEventType, string> = {
  new_risk: "New Risk Condition",
  escalation: "Risk Escalation",
  recovery: "Recovery to Normal",
};

/**
 * Direction is derived from the SIGN of the already-canonical, signed
 * deviationPct — the same premium/discount/flat convention already
 * established in riskViewModel.ts's toDirection(). This is presentation
 * only: no recomputation of any intelligence value, just reading a sign
 * that is already present on the canonical event.
 */
function directionWord(deviationPct: number | null): string {
  if (deviationPct === null) return "unavailable";
  if (deviationPct > 0) return "premium";
  if (deviationPct < 0) return "discount";
  return "flat";
}

function formatDeviation(event: AlertEvent): string {
  if (event.deviationPct === null) return "Unavailable"; // never fabricated as 0
  const sign = event.deviationPct > 0 ? "+" : "";
  return `${sign}${event.deviationPct.toFixed(4)}% (${directionWord(event.deviationPct)})`;
}

function formatMadMultiple(event: AlertEvent): string {
  if (event.madMultiple === null) return "Unavailable";
  return `${event.madMultiple.toFixed(2)}\u00d7`; // "MAD multiple" terminology only — never "typical", never z-score
}

function formatEpisode(event: AlertEvent): string {
  const e = event.episode;
  if (!e || e.startedAt === null) return "No active episode";
  const parts: string[] = [`Started ${e.startedAt}`];
  if (e.durationMinutes !== null) parts.push(`${e.durationMinutes.toFixed(0)} min`);
  if (e.consecutiveObservations !== null) parts.push(`${e.consecutiveObservations} observations`);
  if (e.peakAbsDeviationPct !== null) parts.push(`peak ${e.peakAbsDeviationPct.toFixed(4)}%`);
  return parts.join(" \u00b7 ");
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: DiscordEmbedField[];
  timestamp: string;
}

export interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

/**
 * Pure, independently testable: builds the exact Discord webhook JSON
 * body for a canonical AlertEvent. Uses ONLY fields already present on
 * AlertEvent — no recomputation, no new thresholds, no fabricated values.
 * A null field is represented as the literal text "Unavailable", never
 * coerced to zero or omitted silently.
 */
export function buildDiscordPayload(event: Readonly<AlertEvent>): DiscordWebhookPayload {
  return {
    embeds: [
      {
        title: `${event.symbol} \u2014 ${EVENT_TITLES[event.eventType]}`,
        description: `${event.previousClassification} \u2192 ${event.currentClassification}`,
        color: colorForEvent(event),
        fields: [
          { name: "Deviation", value: formatDeviation(event), inline: true },
          { name: "MAD Multiple", value: formatMadMultiple(event), inline: true },
          { name: "Episode", value: formatEpisode(event), inline: false },
        ],
        timestamp: event.occurredAt,
      },
    ],
  };
}

export interface DiscordAlertDeliveryOptions {
  webhookUrl: string;
  fetchImpl?: FetchLike;
}

/**
 * Creates an AlertDelivery (P5-B4) that POSTs to a Discord webhook.
 * Never mutates the event (buildDiscordPayload only reads it); throws
 * DiscordDeliveryError on any network or non-2xx failure, exactly the
 * P5-B4 delivery-failure contract — the caller (processCaptureRunForAlerts)
 * already handles a rejected deliver() promise correctly and unchanged.
 */
export function createDiscordAlertDelivery(options: DiscordAlertDeliveryOptions): AlertDelivery {
  const { webhookUrl, fetchImpl = fetch } = options;

  return async (event) => {
    const payload = buildDiscordPayload(event as AlertEvent);
    let res: Response;
    try {
      res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Never include webhookUrl here — it embeds Discord's own auth
      // token in its path. err (a generic network error, e.g. DNS/TCP
      // failure) does not itself contain the URL either.
      throw new DiscordDeliveryError("Network error delivering alert to Discord", err);
    }
    if (!res.ok) {
      // Discord's failure response body (e.g. {"message":"...","code":...})
      // never echoes the webhook URL/token back — safe to include a short
      // excerpt for diagnostics. Best-effort: a malformed/absent body must
      // not itself crash the error path.
      let bodyExcerpt = "";
      try {
        bodyExcerpt = (await res.text()).slice(0, 200);
      } catch {
        // ignore — diagnostic detail only, not required for correctness
      }
      throw new DiscordDeliveryError(`Discord webhook responded with HTTP ${res.status}${bodyExcerpt ? `: ${bodyExcerpt}` : ""}`, undefined, res.status);
    }
  };
}

/**
 * The ONE composition decision this slice makes: Discord configured ->
 * Discord delivery; Discord absent -> undefined, which
 * processCaptureRunForAlerts already treats as "use defaultAlertDelivery"
 * (P5-B4, unchanged). Extracted as a small pure function specifically so
 * this decision is unit-testable without invoking the real collector
 * script. Never logs, throws, or returns the URL itself.
 */
export function selectAlertDeliveryFromEnv(env: NodeJS.ProcessEnv = process.env): AlertDelivery | undefined {
  const webhookUrl = env.DISCORD_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return undefined;
  return createDiscordAlertDelivery({ webhookUrl });
}
