// PARITY — production frontend.
//
// Visual system ported from the locked specification
// (concepts/final-neon-refined.html, sha256 513cce6f…dc83).
//
// DATA RULES (non-negotiable):
//   · All values come from the existing /api/tickers contract.
//   · The frontend performs VISUAL POSITIONING only. It never recreates
//     P3 baseline / maturity / classification / freshness semantics.
//   · Unavailable is never rendered as zero, and a deviation that is
//     genuinely unknown never receives a position on the field.

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

const DASH = "\u2014";

function fmtSignedPct(v, digits) {
  const d = digits === undefined ? 2 : digits;
  const sign = v > 0 ? "+" : v < 0 ? "\u2212" : "";
  return `${sign}${Math.abs(v).toFixed(d)}%`;
}

function fmtPrice(value) {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtClock(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toISOString().slice(11, 19) + "Z";
}

function fmtTimestamp(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleString();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** A deviation is positionable only when the API says it is genuinely ok. */
function hasDeviation(t) {
  return t.premiumDiscountPct && t.premiumDiscountPct.status === "ok" && typeof t.premiumDiscountPct.value === "number";
}

/**
 * Baseline state copy, composed from STRUCTURED fields only.
 *
 * Deliberately does not use intelligence.label: that field can emit
 * "x typical" wording for a MAD-denominated value, which violates our
 * terminology requirement. Mature copy must say "MAD multiple" /
 * "baseline dispersion multiple" — never "typical", never "z-score".
 */
function baselineCopy(intel) {
  if (!intel) return { label: "INTELLIGENCE UNAVAILABLE", learning: false };
  if (intel.maturity === "MATURE") {
    if (intel.classification) {
      const mult = typeof intel.relativeDeviationMultiple === "number"
        ? ` \u00b7 ${intel.relativeDeviationMultiple.toFixed(2)}\u00d7 MAD MULTIPLE`
        : "";
      return { label: `${intel.classification}${mult}`, learning: false };
    }
    return { label: "BASELINE MATURE", learning: false };
  }
  if (intel.maturity === "DEVELOPING") return { label: "BASELINE LEARNING", learning: true };
  return { label: "INSUFFICIENT DATA", learning: false };
}

// ---------------------------------------------------------------------
// Truthful scale — ported verbatim from the locked specification.
//
// symmetric signed-log · zero exactly centred · domain floor · positions
// encode TRUE deviation. Collision handling may move a label's LANE only;
// it never alters horizontal measurement position.
// ---------------------------------------------------------------------

const K = 0.05;
const FLOOR = 0.5;
const SPAN = 42;      // field half-width, %
const CH_SPAN = 40;   // channel half-width, %

let domainMax = FLOOR;

function computeDomain(values) {
  const maxAbs = values.length ? Math.max(...values.map(Math.abs)) : 0;
  return Math.max(FLOOR, maxAbs * 1.15);
}
function tScale(v) {
  return Math.sign(v) * (Math.log10(1 + Math.abs(v) / K) / Math.log10(1 + domainMax / K));
}
const pct = (v) => 50 + tScale(v) * SPAN;
const chPct = (v) => 50 + tScale(v) * CH_SPAN;

/**
 * Make a rendered element navigate to the existing ticker-detail route.
 *
 * Reuses navigateTo()/renderRoute() already defined below — no routing
 * logic is duplicated here. Purely additive: no layout, style, spacing,
 * animation, colour or data rendering is affected.
 */
function makeInteractive(el, symbol, description) {
  el.classList.add("is-interactive");
  el.setAttribute("role", "link");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${symbol} \u2014 ${description}`);
  el.addEventListener("click", () => navigateTo(symbol));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      navigateTo(symbol);
    }
  });
}

// ---------------------------------------------------------------------
// Primary equilibrium field
// ---------------------------------------------------------------------

function renderField(tickers) {
  const rail = document.getElementById("rail");
  if (!rail) return;

  // Reset, preserving the static furniture defined in the markup.
  rail.querySelectorAll(".tick,.tkm,.tkl,.ast").forEach((n) => n.remove());

  const positioned = tickers.filter(hasDeviation);

  // Major graduations (labelled) + minor graduations.
  [0.05, 0.1, 0.25, 0.5, 1].filter((v) => v <= domainMax).forEach((v) =>
    [v, -v].forEach((sv) => {
      const x = pct(sv);
      rail.insertAdjacentHTML(
        "beforeend",
        `<div class="tick" style="left:${x}%"></div>` +
          `<div class="tkl" style="left:${x}%">${fmtSignedPct(sv, sv % 1 === 0 ? 0 : 2)}</div>`,
      );
    }),
  );
  [0.02, 0.07, 0.15, 0.35, 0.75].filter((v) => v <= domainMax).forEach((v) =>
    [v, -v].forEach((sv) => {
      rail.insertAdjacentHTML("beforeend", `<div class="tkm" style="left:${pct(sv)}%"></div>`);
    }),
  );

  const lanes = [[-1, 64], [1, 64], [-1, 118], [1, 118], [-1, 172]];
  const occ = new Map();

  [...positioned]
    .sort((a, b) => a.premiumDiscountPct.value - b.premiumDiscountPct.value)
    .forEach((t, i) => {
      const value = t.premiumDiscountPct.value;
      const x = pct(value);

      // Lane selection only — x is never adjusted.
      let pick = lanes[lanes.length - 1];
      for (const L of lanes) {
        const key = L.join(":");
        const used = occ.get(key) || [];
        if (used.every((u) => Math.abs(u - x) > 8.5)) { pick = L; break; }
      }
      const key = pick.join(":");
      occ.set(key, [...(occ.get(key) || []), x]);

      const up = pick[0] < 0;
      const off = pick[1];
      const lane = 128 + pick[0] * off;
      const dir = value >= 0 ? "p" : "d";

      const el = document.createElement("div");
      el.className = "ast";
      el.style.left = "50%";
      el.innerHTML =
        `<div class="halo ${dir}"></div><div class="mkr ${dir}"></div>` +
        `<div class="stem" style="top:${up ? lane : 128}px;height:${off - 18}px"></div>` +
        `<div class="card" style="${up ? `bottom:${262 - lane + 10}px` : `top:${lane + 12}px`}">` +
        `<div class="ct">${escapeHtml(t.symbol)}</div>` +
        `<div class="cv ${dir}">${fmtSignedPct(value, 4)}</div></div>`;
      makeInteractive(el, t.symbol, "open detail");
      rail.appendChild(el);

      // Markers settle outward from parity.
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          setTimeout(() => { el.style.left = `${x}%`; el.style.opacity = "1"; }, i * 85),
        ),
      );
    });

  setText("dm", `FIELD \u00b1${domainMax.toFixed(2)}%`);

  // Assets with no measurable deviation leave the field entirely — they are
  // never placed at 0.00% and never imply parity.
  const offWrap = document.getElementById("offfield");
  const chips = document.getElementById("offfield-chips");
  const off = tickers.filter((t) => !hasDeviation(t));
  if (offWrap && chips) {
    chips.textContent = "";
    offWrap.hidden = off.length === 0;
    for (const t of off) {
      const chip = document.createElement("span");
      chip.className = "offchip";
      const b = document.createElement("b");
      b.textContent = t.symbol;
      chip.append(b, document.createTextNode("DEVIATION UNAVAILABLE"));
      chips.appendChild(chip);
    }
  }
}

// ---------------------------------------------------------------------
// Channel deck — six readouts from the field above
// ---------------------------------------------------------------------

function renderDeck(tickers) {
  const bays = document.getElementById("bays");
  if (!bays) return;
  bays.textContent = "";

  const grads = [0.1, 0.25, 0.5]
    .filter((v) => v <= domainMax)
    .map((v) => [v, -v].map((sv) => `<span class="grad" style="left:${chPct(sv)}%"></span>`).join(""))
    .join("");

  bays.innerHTML = tickers
    .map((t) => {
      const ok = hasDeviation(t);
      const value = ok ? t.premiumDiscountPct.value : null;
      const dir = ok ? (value >= 0 ? "p" : "d") : "na";
      const intel = t.intelligence || {};
      const base = baselineCopy(intel);

      // Baseline segments are NON-QUANTITATIVE. Maturity requires both an
      // observation count AND elapsed hours, and elapsedHours is not on the
      // overview contract — so a proportional fill would be fabricated.
      const segClass = base.learning ? "on" : "";
      const segs = Array.from({ length: 10 }, () => `<i class="${segClass}"></i>`).join("");

      const reach = ok ? Math.abs(tScale(value)) * CH_SPAN : 0;
      const endX = ok ? chPct(value) : 50;

      return (
        `<div class="bay" data-symbol="${escapeHtml(t.symbol)}">` +
        `<div class="bhead">` +
        `<div class="bsym">${escapeHtml(t.symbol)}</div>` +
        `<div class="bval ${dir}">${ok ? fmtSignedPct(value, 4) : "UNAVAILABLE"}</div>` +
        `<div class="bdir ${dir}">${ok ? (value >= 0 ? "PREMIUM" : "DISCOUNT") : "NO MEASUREMENT"}</div>` +
        `</div>` +
        `<div class="chan${ok ? "" : " na"}"><span class="datum"></span>${grads}` +
        `<span class="origin"></span><span class="olabel">PARITY</span>` +
        (ok
          ? `<span class="beamx ${dir}" data-w="${reach}"></span>` +
            `<span class="brk ${dir}" data-x="${endX}"></span>` +
            `<span class="end ${dir}" data-x="${endX}"></span>`
          : "") +
        `</div>` +
        `<div class="tele">` +
        `<div class="brow"><span>REF</span><span>${fmtPrice(t.referencePrice && t.referencePrice.value)}</span></div>` +
        `<div class="brow"><span>CHAIN</span><span>${fmtPrice(t.secondaryPrice && t.secondaryPrice.value)}</span></div>` +
        `</div>` +
        `<div class="bbase"><div class="bbl">${escapeHtml(base.label)}</div>` +
        `<div class="segs">${segs}</div>` +
        `<div class="bobs">${typeof intel.observationCount === "number" ? intel.observationCount : 0} OBSERVATIONS</div>` +
        `</div></div>`
      );
    })
    .join("");

  // Channels power on; beams measure outward from origin; baseline segments
  // illuminate progressively.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bays.querySelectorAll(".bay").forEach((b, i) => {
        const sym = b.dataset.symbol;
        if (sym) makeInteractive(b, sym, "open detail");
        const at = 360 + i * 100;
        setTimeout(() => { b.style.opacity = "1"; b.style.transform = "translateY(0)"; }, at);
        setTimeout(() => {
          const bm = b.querySelector(".beamx");
          const e = b.querySelector(".end");
          const k = b.querySelector(".brk");
          if (bm) bm.style.width = `${bm.dataset.w}%`;
          if (e) e.style.left = `${e.dataset.x}%`;
          if (k) k.style.left = `${k.dataset.x}%`;
        }, at + 180);
        b.querySelectorAll(".segs i.on").forEach((s, j) => {
          s.classList.remove("on");
          setTimeout(() => s.classList.add("on"), at + 520 + j * 42);
        });
      });
    }),
  );
}

// ---------------------------------------------------------------------
// Overview load
// ---------------------------------------------------------------------

async function loadGrid() {
  try {
    const res = await fetch("/api/tickers");
    const data = await res.json();
    const tickers = data.tickers || [];

    domainMax = computeDomain(tickers.filter(hasDeviation).map((t) => t.premiumDiscountPct.value));

    renderField(tickers);
    renderDeck(tickers);

    setText("channel-count", `${tickers.length} CHANNEL${tickers.length === 1 ? "" : "S"}`);

    const latest = tickers.map((t) => t.lastUpdateTimestamp).filter(Boolean).sort().pop();
    setText("snapshot-time", fmtClock(latest));

    const learning = tickers.filter((t) => t.intelligence && t.intelligence.maturity !== "MATURE").length;
    setText("deck-state", learning > 0 ? "Baseline learning" : "Baselines mature");

    const dot = document.getElementById("live-dot");
    const label = document.getElementById("live-label");
    const ageMin = latest ? (Date.now() - new Date(latest).getTime()) / 60000 : Infinity;
    if (dot) dot.style.animationPlayState = ageMin <= 45 ? "running" : "paused";
    if (label) label.textContent = ageMin <= 45 ? "FIELD ACTIVE" : "FIELD STALE";
  } catch (err) {
    setText("dm", "FIELD UNAVAILABLE");
    setText("deck-state", `Could not load: ${String(err)}`);
  }
}

/**
 * P2 status badge. Restored: the P4 overview rewrite replaced the head of
 * this file and dropped STATUS_PRESENTATION + badge(), which the preserved
 * detail code still calls (badgeWithId, renderProvenanceTable). Uses the
 * existing .badge / .tone-* classes — no new styling introduced.
 */
const STATUS_PRESENTATION = {
  healthy_current: { label: "Healthy / current", tone: "green" },
  stale_reference: { label: "Stale reference", tone: "amber" },
  oracle_paused: { label: "Oracle paused", tone: "amber" },
  trading_halt: { label: "Trading halt", tone: "amber" },
  upstream_unavailable: { label: "Upstream unavailable", tone: "red" },
  no_data_yet: { label: "No data yet", tone: "gray" },
};

function badge(status) {
  const p = STATUS_PRESENTATION[status] || { label: String(status), tone: "gray" };
  const span = document.createElement("span");
  span.className = `badge tone-${p.tone}`;
  span.textContent = p.label;
  return span;
}

/** Detail-view helpers (used by the preserved detail/chart code below). */
function fmtPct(value) {
  if (value === null || value === undefined) return DASH;
  const cls = value >= 0 ? "pct-positive" : "pct-negative";
  return `<span class="${cls}">${fmtSignedPct(value, 4)}</span>`;
}

function fieldOrDash(field, formatter) {
  if (!field || field.value === null || field.value === undefined) return DASH;
  return formatter ? formatter(field.value) : String(field.value);
}

// ---------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------

let currentHistory = null;
let currentSeries = "referencePrice";

/**
 * Render the single-asset parity-origin rail in the diagnostic header.
 * Reuses tScale()/chPct() — the SAME truthful scale as the equilibrium
 * field. Position is never adjusted for any presentational reason, and an
 * unavailable deviation draws no beam and no endpoint (never implies zero).
 */
function renderDetailRail(value) {
  const rail = document.getElementById("detail-rail");
  const beam = document.getElementById("dx-beam");
  const brk = document.getElementById("dx-brk");
  const end = document.getElementById("dx-end");
  if (!rail || !beam || !brk || !end) return;

  rail.querySelectorAll(".dx-grad,.dx-gl").forEach((n) => n.remove());
  const dir = value === null ? "" : value >= 0 ? "p" : "d";
  beam.className = `dx-beam ${dir}`;
  brk.className = `dx-brk ${dir}`;
  end.className = `dx-end ${dir}`;

  if (value === null) {
    beam.style.width = "0%";
    brk.style.display = "none";
    end.style.display = "none";
    return;
  }
  brk.style.display = "";
  end.style.display = "";

  // graduations, drawn with the same scale as the field
  [0.1, 0.25, 0.5, 1].filter((v) => v <= domainMax).forEach((v) =>
    [v, -v].forEach((sv) => {
      const x = chPct(sv);
      rail.insertAdjacentHTML(
        "beforeend",
        `<span class="dx-grad" style="left:${x}%"></span>` +
          `<span class="dx-gl" style="left:${x}%">${fmtSignedPct(sv, sv % 1 === 0 ? 0 : 2)}</span>`,
      );
    }),
  );

  const reach = Math.abs(tScale(value)) * CH_SPAN;
  const endX = chPct(value);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      beam.style.width = `${reach}%`;
      brk.style.left = `${endX}%`;
      end.style.left = `${endX}%`;
    }),
  );
}

/**
 * Intelligence bay, built from intelligenceDetail (previously unused).
 *
 * Terminology is deliberate: "Baseline dispersion (MAD)" and "MAD multiple".
 * Never "typical deviation", never z-score. Nothing here is fabricated —
 * every cell is either a real contract value or an explicit unavailable.
 */
function renderIntelligenceBay(intelDetail) {
  const grid = document.getElementById("intel-grid");
  const epi = document.getElementById("intel-episode");
  if (!grid) return;

  if (!intelDetail) {
    grid.innerHTML = `<div class="ib"><span class="ib-l">Status</span><span class="ib-v na">Unavailable</span></div>`;
    if (epi) epi.hidden = true;
    setText("intel-maturity", "\u2014");
    return;
  }

  const b = intelDetail.baseline || {};
  // num() distinguishes a real 0 from null/undefined. dispersionMad === 0
  // is a legitimate measurement on flat history and must render as 0.
  const num = (v, digits, suffix) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${v.toFixed(digits)}${suffix || ""}`
      : null;

  const cell = (label, value, sub) =>
    `<div class="ib"><span class="ib-l">${label}</span>` +
    (value === null
      ? `<span class="ib-v na">Unavailable</span>`
      : `<span class="ib-v">${value}</span>`) +
    (sub ? `<span class="ib-s">${sub}</span>` : "") +
    `</div>`;

  const maturity = intelDetail.maturity || "\u2014";
  setText("intel-maturity", String(maturity).replace(/_/g, " "));

  const cells = [
    cell("Observations", num(b.observationCount, 0), "eligible"),
    cell("Baseline period", num(b.elapsedHours, 1, " h"), "observed span"),
    cell("Baseline median", num(b.medianPct, 4, "%"), "central tendency"),
    cell("Baseline dispersion", num(b.dispersionMad, 4, "%"), "MAD"),
    cell("MAD multiple", num(intelDetail.relativeDeviationMultiple, 2, "\u00d7"), "relative to dispersion"),
    cell(
      "Classification",
      intelDetail.classification ? String(intelDetail.classification) : null,
      intelDetail.classification ? "risk state" : "requires mature baseline",
    ),
  ];
  if (typeof b.excludedByFreshnessCount === "number" && b.excludedByFreshnessCount > 0) {
    cells.push(cell("Freshness exclusions", num(b.excludedByFreshnessCount, 0), "reference too old"));
  }
  grid.innerHTML = cells.join("");

  // Episode: only ever shown from real contract state.
  if (epi) {
    const e = intelDetail.episode;
    if (e && e.state === "active") {
      epi.hidden = false;
      epi.textContent =
        `ACTIVE EPISODE \u00b7 started ${fmtTimestamp(e.dislocationStartedAt)} \u00b7 ` +
        `${Math.round(e.durationMinutes)} min \u00b7 ${e.consecutiveAbnormalObservations} consecutive observations \u00b7 ` +
        `peak ${e.peakAbsoluteDeviationPct.toFixed(4)}%`;
    } else if (e && e.state === "current_observation_unavailable") {
      epi.hidden = false;
      epi.textContent = "Current observation unavailable \u00b7 episode state cannot be evaluated";
    } else {
      epi.hidden = true;
    }
  }
}

async function loadDetail(symbol) {
  document.getElementById("detail-symbol").textContent = symbol;
  try {
    const [detailRes, historyRes] = await Promise.all([
      fetch(`/api/tickers/${symbol}`),
      fetch(`/api/tickers/${symbol}/history`),
    ]);

    if (!detailRes.ok) {
      renderDetailNotFound(symbol);
      return;
    }
    const detail = await detailRes.json();
    const history = historyRes.ok ? await historyRes.json() : { points: [] };

    document.getElementById("detail-status-badge").replaceWith(badgeWithId("detail-status-badge", detail.overallStatus));

    // ── A. parity state ──
    const pd = detail.premiumDiscountPct;
    const dev = pd && pd.status === "ok" && typeof pd.value === "number" ? pd.value : null;
    const devEl = document.getElementById("detail-premium");
    const dirEl = document.getElementById("detail-direction");
    if (dev === null) {
      devEl.className = "dx-dev na";
      devEl.textContent = "UNAVAILABLE";
      if (dirEl) { dirEl.className = "dx-dir"; dirEl.textContent = "NO MEASUREMENT"; }
    } else {
      devEl.className = `dx-dev ${dev >= 0 ? "p" : "d"}`;
      devEl.textContent = fmtSignedPct(dev, 4);
      if (dirEl) {
        dirEl.className = `dx-dir ${dev >= 0 ? "p" : "d"}`;
        dirEl.textContent = dev >= 0 ? "PREMIUM TO REFERENCE" : "DISCOUNT TO REFERENCE";
      }
    }

    // The detail rail uses the same domain as the field; when the overview
    // has not been loaded this session, fall back to this asset alone.
    if (dev !== null && domainMax === FLOOR) domainMax = computeDomain([dev]);
    renderDetailRail(dev);

    document.getElementById("detail-reference").textContent = fieldOrDash(detail.referencePrice, fmtPrice);
    document.getElementById("detail-secondary").textContent = fieldOrDash(detail.secondaryPrice, fmtPrice);

    const rhPrice = detail.robinhoodPrice && detail.robinhoodPrice.value;
    document.getElementById("detail-rh-price").textContent = rhPrice
      ? `bid ${rhPrice.bid} / ask ${rhPrice.ask}${rhPrice.isTradingHalt ? " \u00b7 TRADING HALT" : ""}`
      : "unavailable";
    document.getElementById("detail-last-update").textContent = fmtTimestamp(detail.lastUpdateTimestamp);

    // ── B. intelligence ──
    renderIntelligenceBay(detail.intelligenceDetail);

    // ── D. diagnostics ──
    const oracle = detail.oraclePausedField;
    const oracleEl = document.getElementById("detail-oracle");
    if (oracle && oracle.value !== null && oracle.value !== undefined) {
      oracleEl.className = "diag-v";
      oracleEl.textContent = oracle.value ? "PAUSED" : "ACTIVE";
    } else {
      oracleEl.className = "diag-v na";
      oracleEl.textContent = "unavailable";
    }

    const asEl = document.getElementById("detail-asset-status");
    const asVal = detail.robinhoodAssetStatus && detail.robinhoodAssetStatus.value;
    if (asVal) {
      // Long composite status string: show the leading token, keep the full
      // value verbatim in the title attribute.
      asEl.className = "diag-v addr";
      asEl.textContent = String(asVal).split(" ")[0];
      asEl.title = String(asVal);
    } else {
      asEl.className = "diag-v na";
      asEl.textContent = "unavailable";
      asEl.removeAttribute("title");
    }

    const addr = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (value) {
        el.className = "diag-v addr";
        el.textContent = `${value.slice(0, 10)}\u2026${value.slice(-8)}`;
        el.title = value;
      } else {
        el.className = "diag-v na";
        el.textContent = "unavailable";
        el.removeAttribute("title");
      }
    };
    addr("detail-token-address", detail.canonicalTokenAddress);
    addr("detail-pool-address", detail.configuredPoolAddress);

    const hc = detail.holderConcentration || {};
    const holder = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (typeof v === "number" && Number.isFinite(v)) {
        el.className = "diag-v";
        el.textContent = `${v.toFixed(2)}%`;
      } else {
        el.className = "diag-v na";
        el.textContent = "unavailable";
      }
    };
    holder("detail-top1", hc.top1Pct);
    holder("detail-top5", hc.top5Pct);
    holder("detail-top10", hc.top10Pct);

    // ── E. source health ──
    renderProvenanceTable(detail.provenance || []);

    currentHistory = history;
    currentSeries = "referencePrice";
    setActiveTab("referencePrice");
    renderChart(history, "referencePrice");
  } catch (err) {
    renderDetailNotFound(symbol, err);
  }
}

function badgeWithId(id, status) {
  const el = badge(status);
  el.id = id;
  return el;
}

function renderDetailNotFound(symbol, err) {
  document.getElementById("detail-symbol").textContent = `${symbol} — not found`;
  const el = document.getElementById("detail-status-badge");
  el.className = "badge tone-red";
  el.textContent = "Unsupported ticker";
  if (err) console.error(err);
}

/**
 * Source health (E). Replaces the cramped provenance table.
 *
 * Truthfulness rules:
 *   · No backend diagnostic is reworded into a claim the contract does not
 *     support (e.g. never "source unreachable" — the backend does not say
 *     that). The summary states only what is certain: the field is
 *     unavailable.
 *   · The raw diagnostic string is preserved VERBATIM behind a <details>
 *     disclosure, selectable, never parsed or truncated in content.
 *   · No green. Healthy uses cyan; degraded uses violet; absent uses a
 *     dashed neutral marker.
 */
function renderProvenanceTable(rows) {
  const host = document.getElementById("provenance-table-body");
  if (!host) return;
  host.textContent = "";

  let healthy = 0;
  for (const row of rows) {
    const ok = row.status === "ok";
    if (ok) healthy++;

    const wrap = document.createElement("div");
    wrap.className = "hrow";

    const dot = document.createElement("span");
    dot.className = "hdot " + (ok ? "ok" : row.detail ? "out" : "warn");
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "hname";
    name.textContent = row.field;

    const src = document.createElement("span");
    src.className = "hsrc";
    src.textContent = row.source || "";
    src.title = row.source || "";

    wrap.append(dot, name, src);
    host.appendChild(wrap);

    if (!ok) {
      const state = document.createElement("div");
      state.className = "hrow";
      const spacer = document.createElement("span");
      const label = document.createElement("span");
      label.className = "hstate";
      // Summary states only what the contract supports.
      label.textContent = `${row.field.toUpperCase()} UNAVAILABLE`;
      state.append(spacer, label);
      host.appendChild(state);

      if (row.detail) {
        const det = document.createElement("details");
        det.className = "hdiag";
        const sum = document.createElement("summary");
        sum.textContent = "RAW DIAGNOSTIC";
        const pre = document.createElement("pre");
        // Verbatim. textContent, so the string is never interpreted.
        pre.textContent = row.detail;
        det.append(sum, pre);
        host.appendChild(det);
      }
    }
  }

  setText("health-summary", `${healthy} of ${rows.length} sources reporting`);
}

function renderChart(history, seriesKey) {
  const svg = document.getElementById("history-chart");
  svg.innerHTML = "";

  const points = (history && history.points) || [];
  if (points.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "450");
    text.setAttribute("y", "130");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#8b93a3");
    text.setAttribute("font-size", "13");
    text.textContent = "No history captured yet for this ticker.";
    svg.appendChild(text);
    return;
  }

  const width = 900;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 60 };

  const values = points.map((p) => p[seriesKey]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "450");
    text.setAttribute("y", "130");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#8b93a3");
    text.setAttribute("font-size", "13");
    text.textContent = "No available values for this series in the captured history (all gaps).";
    svg.appendChild(text);
    return;
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= Math.abs(min) * 0.01 || 1;
    max += Math.abs(max) * 0.01 || 1;
  }
  const yRange = max - min;

  const xFor = (i) => padding.left + (i / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const yFor = (v) => padding.top + (1 - (v - min) / yRange) * (height - padding.top - padding.bottom);

  // Build path segments, breaking at every null/undefined value — this is
  // the actual mechanism that prevents fabricated continuity across gaps.
  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    const v = p[seriesKey];
    if (v === null || v === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push([xFor(i), yFor(v)]);
  });
  if (current.length > 0) segments.push(current);

  const svgNS = "http://www.w3.org/2000/svg";

  // Axis line
  const axis = document.createElementNS(svgNS, "line");
  axis.setAttribute("x1", String(padding.left));
  axis.setAttribute("y1", String(height - padding.bottom));
  axis.setAttribute("x2", String(width - padding.right));
  axis.setAttribute("y2", String(height - padding.bottom));
  axis.setAttribute("stroke", "#232936");
  svg.appendChild(axis);

  // Y-axis labels (min/max only — kept simple, dense-but-readable)
  [min, max].forEach((v) => {
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", "4");
    label.setAttribute("y", String(yFor(v) + 4));
    label.setAttribute("fill", "#8b93a3");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "monospace");
    label.textContent = v.toFixed(seriesKey === "premiumDiscountPct" ? 3 : 2);
    svg.appendChild(label);
  });

  for (const seg of segments) {
    if (seg.length === 1) {
      // A single isolated point with gaps on both sides — draw a dot, not a line.
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(seg[0][0]));
      circle.setAttribute("cy", String(seg[0][1]));
      circle.setAttribute("r", "2.5");
      circle.setAttribute("fill", "#5fb0ff");
      svg.appendChild(circle);
      continue;
    }
    const d = seg.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#5fb0ff");
    path.setAttribute("stroke-width", "1.75");
    svg.appendChild(path);
  }
}

function setActiveTab(seriesKey) {
  document.querySelectorAll(".chart-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.series === seriesKey);
  });
}

document.querySelectorAll(".chart-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentSeries = btn.dataset.series;
    setActiveTab(currentSeries);
    if (currentHistory) renderChart(currentHistory, currentSeries);
  });
});

// ---------------------------------------------------------------------
// Simple hash-based navigation: "#/" = grid, "#/AAPL" = detail
// ---------------------------------------------------------------------

function navigateTo(symbol) {
  window.location.hash = symbol ? `/${symbol}` : "/";
}

function renderRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  const symbol = hash.replace(/^\//, "").trim().toUpperCase();

  const gridView = document.getElementById("overview-view");
  const detailView = document.getElementById("detail-view");

  if (symbol) {
    gridView.hidden = true;
    detailView.hidden = false;
    loadDetail(symbol);
  } else {
    detailView.hidden = true;
    gridView.hidden = false;
    loadGrid();
  }
}

document.getElementById("back-to-grid").addEventListener("click", () => navigateTo(null));
window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", renderRoute);
