import type { RobinhoodAssetsResponse } from "../sources/robinhoodRegistry.js";
import type { RegistrySnapshotRecord } from "./types.js";

/**
 * Archive the raw registry response verbatim, once per run. No comparison,
 * diffing, or authenticity analysis happens here — that is explicitly out
 * of scope for this slice. This exists purely so that future work (if and
 * when authorized) has a real historical record to look back at, captured
 * at zero marginal network cost since the registry is already being
 * fetched once per run for the per-ticker status lookups.
 */
export function captureRegistrySnapshot(registry: RobinhoodAssetsResponse, runId: string): RegistrySnapshotRecord {
  return {
    recordType: "registry_snapshot",
    runId,
    capturedAt: new Date().toISOString(),
    assetCount: registry.assets.length,
    assets: registry.assets,
  };
}
