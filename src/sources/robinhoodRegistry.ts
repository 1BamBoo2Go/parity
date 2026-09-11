import { ROBINHOOD_STOCK_TOKEN_API_BASE } from "../config/chain.js";

/**
 * Client for Robinhood's official, read-only Stock Token registry API.
 * Source: docs.robinhood.com/chain/stock-token-apis
 *
 * Endpoint: GET https://api.robinhood.com/rhj/assets
 *
 * NOTE ON LIVE VERIFICATION STATUS (read this before trusting output):
 * This client is implemented against the exact schema documented by
 * Robinhood. It has NOT been executed against the live endpoint from within
 * this development sandbox — the sandbox's network egress policy returns
 * `403 host_not_allowed` for api.robinhood.com (captured verbatim in
 * evidence/P0-EVIDENCE-REPORT.md). Run `npm run prove:p0` from an
 * environment with normal internet access to perform the actual live call.
 */

export interface RobinhoodAssetDeployment {
  contractAddress: string;
  chainId: number;
}

export interface RobinhoodAsset {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  deployments: RobinhoodAssetDeployment[];
  currentMultiplier: string;
  pendingMultiplier: string;
  pendingMultiplierEffectiveTime?: string;
  logoUrl?: string;
  status: "ASSET_STATUS_UNSPECIFIED" | "ASSET_STATUS_ACTIVE" | "ASSET_STATUS_INACTIVE";
}

export interface RobinhoodAssetsResponse {
  assets: RobinhoodAsset[];
}

export type FetchLike = typeof fetch;

export class UpstreamFetchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: unknown,
    /** HTTP status code, when the failure was a non-2xx response rather than a network-level error. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamFetchError";
  }
}

/**
 * Fetch the full Stock Token registry. Throws UpstreamFetchError on any
 * network or non-2xx failure — callers must handle this explicitly and
 * surface it as `unavailable` data, never silently substitute an empty list.
 */
export async function fetchRobinhoodAssets(fetchImpl: FetchLike = fetch): Promise<RobinhoodAssetsResponse> {
  const url = `${ROBINHOOD_STOCK_TOKEN_API_BASE}/assets`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new UpstreamFetchError(`Network error calling Robinhood registry API`, url, err);
  }
  if (!res.ok) {
    throw new UpstreamFetchError(`Robinhood registry API returned HTTP ${res.status}`, url);
  }
  const body = (await res.json()) as RobinhoodAssetsResponse;
  if (!body || !Array.isArray(body.assets)) {
    throw new UpstreamFetchError(`Robinhood registry API returned a malformed body (no assets array)`, url);
  }
  return body;
}

/** Find a specific ticker's deployment on a given chain ID, or null if not deployed there. */
export function findDeploymentOnChain(
  asset: RobinhoodAsset,
  chainId: number,
): RobinhoodAssetDeployment | null {
  return asset.deployments.find((d) => d.chainId === chainId) ?? null;
}
