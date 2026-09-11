/**
 * Pure robust-statistics primitives. No I/O, no ticker/snapshot knowledge —
 * these operate on plain number arrays only, fully unit-testable in
 * isolation from the rest of the intelligence pipeline.
 */

/** Standard median: sorted middle value, or the average of the two middle values for an even-length array. Throws on an empty array rather than returning a fabricated 0. */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Refusing to compute median of an empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Median Absolute Deviation (MAD): median(|x_i - median(x)|). The
 * standard robust dispersion measure — resistant to a minority of extreme
 * observations in a way standard deviation is not, which matters here
 * specifically because a past genuine dislocation event must not be
 * allowed to inflate the very yardstick used to detect the next one
 * (standard deviation is quadratically sensitive to exactly such points;
 * MAD is not). This is the Iglewicz & Hoberty "modified Z-score" building
 * block, a standard, citable choice for point-wise robust outlier scoring
 * on a small, possibly-skewed sample.
 */
export function medianAbsoluteDeviation(values: number[], centerOverride?: number): number {
  if (values.length === 0) {
    throw new Error("Refusing to compute MAD of an empty array");
  }
  const center = centerOverride ?? median(values);
  const absoluteDeviations = values.map((v) => Math.abs(v - center));
  return median(absoluteDeviations);
}

/** median(|x_i|) — how far from TRUE ZERO (parity) a typical observation sits. Deliberately distinct from MAD (which measures spread around the series' OWN median, not around zero) — see src/intelligence/baseline.ts for why both are reported. */
export function medianAbsoluteFromZero(values: number[]): number {
  if (values.length === 0) {
    throw new Error("Refusing to compute median-from-zero of an empty array");
  }
  return median(values.map((v) => Math.abs(v)));
}

/**
 * Robust relative-deviation multiple: how many "typical deviations" away
 * from the series' median is `currentValue`, using a floored MAD as the
 * denominator to avoid division by zero on a degenerate (numerically
 * flat) series. `effectiveMad = max(mad, madFloor)`.
 */
export function relativeDeviationMultiple(currentValue: number, medianValue: number, mad: number, madFloor: number): number {
  const effectiveMad = Math.max(mad, madFloor);
  return Math.abs(currentValue - medianValue) / effectiveMad;
}
