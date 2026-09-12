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
  } catch {
    setText("dm", "FIELD UNAVAILABLE");
    setText("deck-state", "SIGNAL UNAVAILABLE \u2014 RETRY");
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

/**
 * Token / pool identity.
 *
 * The truncated form is DISPLAY ONLY. The full exact address is always
 * present in the DOM (selectable, user-select:all), in the title
 * attribute, and is what the copy affordance writes to the clipboard.
 * No explorer links are invented — Parity does not know the correct
 * explorer for this chain from the contract.
 */
function renderIdentity(shortId, fullId, copyId, value) {
  const shortEl = document.getElementById(shortId);
  const fullEl = document.getElementById(fullId);
  const btn = document.getElementById(copyId);
  if (!shortEl) return;

  if (!value) {
    shortEl.className = "idaddr na";
    shortEl.textContent = "unavailable";
    shortEl.removeAttribute("title");
    if (fullEl) fullEl.textContent = "";
    if (btn) btn.hidden = true;
    return;
  }

  shortEl.className = "idaddr";
  shortEl.textContent = value.length > 22 ? `${value.slice(0, 12)}\u2026${value.slice(-10)}` : value;
  shortEl.title = value;
  if (fullEl) fullEl.textContent = value;

  if (!btn) return;
  btn.hidden = false;
  const label = btn.querySelector(".idcopy-t");
  btn.onclick = async () => {
    const reset = () => {
      btn.className = "idcopy";
      if (label) label.textContent = "COPY";
    };
    try {
      // Clipboard API requires a secure context. localhost counts as
      // secure, so the SSH-tunnelled review works; plain-HTTP non-local
      // origins do not, hence the explicit fallback below.
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value); // full exact value, never the truncation
      btn.className = "idcopy done";
      if (label) label.textContent = "COPIED";
      setTimeout(reset, 1600);
    } catch {
      // Graceful degradation: select the full value so the user can copy
      // it manually. The address is never made inaccessible.
      btn.className = "idcopy fail";
      if (label) label.textContent = "SELECT";
      if (fullEl && window.getSelection && document.createRange) {
        const range = document.createRange();
        range.selectNodeContents(fullEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setTimeout(reset, 2400);
    }
  };
}

/**
 * Holder concentration.
 *
 * Available  -> three truthful tier readings (Top 1 / 5 / 10), unchanged.
 * Unavailable -> ONE consolidated state. Deliberately not three dashes,
 *                which would read as three separate absent measurements.
 *                Explicitly states it is not zero.
 */
function renderHolderConcentration(hc) {
  const tiers = document.getElementById("hold-tiers");
  const na = document.getElementById("hold-na");
  const state = document.getElementById("hold-state");
  const has = (v) => typeof v === "number" && Number.isFinite(v);

  const available = hc && (has(hc.top1Pct) || has(hc.top5Pct) || has(hc.top10Pct));

  if (tiers) tiers.hidden = !available;
  if (na) na.hidden = !!available;
  if (state) {
    state.className = available ? "hold-state ok" : "hold-state";
    state.textContent = available ? "REPORTING" : "UNAVAILABLE";
  }

  const tier = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    // A real 0 is a legitimate reading and must render as 0.00%.
    el.textContent = has(v) ? `${v.toFixed(2)}%` : "\u2014";
  };
  tier("detail-top1", hc && hc.top1Pct);
  tier("detail-top5", hc && hc.top5Pct);
  tier("detail-top10", hc && hc.top10Pct);
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
      oracleEl.className = oracle.value ? "lrow-v alert" : "lrow-v";
      oracleEl.textContent = oracle.value ? "PAUSED" : "ACTIVE";
    } else {
      oracleEl.className = "lrow-v na";
      oracleEl.textContent = "unavailable";
    }

    const asEl = document.getElementById("detail-asset-status");
    const asVal = detail.robinhoodAssetStatus && detail.robinhoodAssetStatus.value;
    if (asVal) {
      // Long composite status string: leading token displayed, full value
      // preserved verbatim in the title attribute.
      asEl.className = "lrow-v";
      asEl.textContent = String(asVal).split(" ")[0];
      asEl.title = String(asVal);
    } else {
      asEl.className = "lrow-v na";
      asEl.textContent = "unavailable";
      asEl.removeAttribute("title");
    }

    renderIdentity("detail-token-address", "detail-token-full", "copy-token", detail.canonicalTokenAddress);
    renderIdentity("detail-pool-address", "detail-pool-full", "copy-pool", detail.configuredPoolAddress);

    renderHolderConcentration(detail.holderConcentration);

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
/**
 * Source health (D1.1). An instrument health readout, not a status table.
 *
 * Truthfulness rules — unchanged from D1:
 *   · All provenance entries are represented, none collapsed or omitted.
 *   · No backend diagnostic is reworded into a claim the contract does not
 *     support. The state label says only that the field is unavailable.
 *   · The raw diagnostic is preserved VERBATIM behind a collapsed
 *     disclosure, set via textContent so it is never interpreted.
 *   · No green. Reporting = cyan, unavailable = violet/neutral. Direction
 *     colours (premium/discount) are never reused as health indicators.
 */
function renderProvenanceTable(rows) {
  const host = document.getElementById("provenance-table-body");
  if (!host) return;
  host.textContent = "";

  let healthy = 0;

  for (const row of rows) {
    const ok = row.status === "ok";
    if (ok) healthy++;

    // One coherent channel unit per source.
    const ch = document.createElement("div");
    ch.className = "hch";

    const main = document.createElement("div");
    main.className = "hch-main";

    const dot = document.createElement("span");
    dot.className = "hdot " + (ok ? "ok" : "out");
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "hch-name";
    name.textContent = row.field;

    const state = document.createElement("span");
    state.className = "hch-state " + (ok ? "ok" : "out");
    // States only what the contract supports — never "unreachable".
    state.textContent = ok ? "REPORTING" : "UNAVAILABLE";

    main.append(dot, name, state);
    ch.appendChild(main);

    if (row.source) {
      const src = document.createElement("span");
      src.className = "hch-src";
      src.textContent = row.source;
      ch.appendChild(src);
    }

    if (!ok && row.detail) {
      const det = document.createElement("details");
      det.className = "hdiag";

      const sum = document.createElement("summary");
      const sumLabel = document.createElement("span");
      sumLabel.textContent = "RAW DIAGNOSTIC";
      const sumN = document.createElement("span");
      sumN.className = "hdiag-n";
      // Character count is a measured fact about the string, not a summary
      // of its meaning.
      sumN.textContent = `${row.detail.length} CHARS`;
      sum.append(sumLabel, sumN);

      const pre = document.createElement("pre");
      pre.textContent = row.detail; // verbatim, never parsed

      det.append(sum, pre);
      ch.appendChild(det);
    }

    host.appendChild(ch);
  }

  // Summary readout + gauge, both derived from the same real counts.
  setText("health-summary", `${healthy} OF ${rows.length} SOURCES REPORTING`);

  const gauge = document.getElementById("health-gauge");
  if (gauge) {
    gauge.textContent = "";
    for (const row of rows) {
      const seg = document.createElement("i");
      seg.className = row.status === "ok" ? "on" : "off";
      gauge.appendChild(seg);
    }
  }
}

const SVGNS = "http://www.w3.org/2000/svg";

function svgNode(name, attrs) {
  const el = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

function chartMessage(svg, message) {
  const t = svgNode("text", { x: 450, y: 128, "text-anchor": "middle", class: "hc-msg" });
  t.textContent = message;
  svg.appendChild(t);
}

/** Short axis-time label. Falls back to the raw string if unparseable. */
function fmtAxisTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "");
  return d.toISOString().slice(5, 16).replace("T", " ") + "Z";
}

/** Human label for a series key, used in the chart's aria-label. */
function seriesLabel(seriesKey) {
  if (seriesKey === "premiumDiscountPct") return "premium/discount deviation";
  if (seriesKey === "secondaryPrice") return "on-chain price";
  return "reference price";
}

// Deterministic clip-path id per series — stable across rerenders of the
// same chart, never Math.random(). Two charts on the same page (should
// that ever happen) would still collide, which is an acceptable, documented
// constraint for a single-chart detail view.
function clipIdFor(seriesKey) {
  return `hc-clip-${seriesKey}`;
}

/**
 * Historical signal instrument (P4-D2).
 *
 * TRUTHFULNESS — unchanged from D1/D1.1, restated because this is the
 * function that actually enforces it:
 *   · Segments break at EVERY null/undefined value. A gap is never bridged,
 *     interpolated, smoothed, or zero-filled.
 *   · An isolated sample surrounded by gaps renders as a dot, never a line.
 *   · Pointer AND keyboard inspection report "UNAVAILABLE" for a null
 *     sample rather than snapping to a neighbouring real value — a gap
 *     must be discoverable by inspecting it, not hidden by interpolation.
 *   · The deviation series' domain always includes 0.00% so the parity
 *     line is genuinely positioned, never assumed or drawn at an edge.
 *   · Direction colour (cyan/magenta) is applied ONLY to the deviation
 *     series. Reference/on-chain price series use neutral/violet
 *     instrument styling — they carry no premium/discount meaning, so
 *     they must not borrow that colour language.
 */
function renderChart(history, seriesKey) {
  const svg = document.getElementById("history-chart");
  if (!svg) return;
  svg.innerHTML = "";
  svg.setAttribute("role", "img");
  svg.setAttribute("tabindex", "0");

  const points = (history && history.points) || [];
  if (points.length === 0) {
    chartMessage(svg, "No history captured yet for this ticker.");
    svg.setAttribute("aria-label", `${seriesLabel(seriesKey)}: no history captured yet.`);
    return;
  }

  const width = 900;
  const height = 260;
  const padding = { top: 22, right: 22, bottom: 36, left: 66 };
  const plotBottom = height - padding.bottom;

  const values = points.map((p) => p[seriesKey]).filter((v) => v !== null && v !== undefined);
  if (values.length === 0) {
    chartMessage(svg, "No available values for this series in the captured history (all gaps).");
    svg.setAttribute("aria-label", `${seriesLabel(seriesKey)}: every captured observation is unavailable.`);
    return;
  }

  const isDeviation = seriesKey === "premiumDiscountPct";

  let min = Math.min(...values);
  let max = Math.max(...values);
  // A deviation chart is meaningless without parity in view. Reference and
  // on-chain series are NOT forced to include 0 — a $0 price has no
  // relevance to those series and forcing it would distort the domain.
  if (isDeviation) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) {
    min -= Math.abs(min) * 0.01 || 1;
    max += Math.abs(max) * 0.01 || 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const yRange = max - min;

  const xFor = (i) => padding.left + (i / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const yFor = (v) => padding.top + (1 - (v - min) / yRange) * (height - padding.top - padding.bottom);

  // ── Segment construction — breaks at every null. Each point carries its
  // pixel position AND its real value; the value is needed downstream to
  // colour the deviation trace by true sign, not just to plot position. ──
  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    const v = p[seriesKey];
    if (v === null || v === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push([xFor(i), yFor(v), v]);
  });
  if (current.length > 0) segments.push(current);

  const fmtVal = (v) => (isDeviation ? fmtSignedPct(v, 4) : v.toFixed(2));

  // ── graduations ──
  const grid = svgNode("g", {});
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + (yRange * i) / ticks;
    const y = yFor(v);
    grid.appendChild(svgNode("line", { class: "hc-grid", x1: padding.left, y1: y, x2: width - padding.right, y2: y }));
    const lab = svgNode("text", { class: "hc-ylab", x: padding.left - 10, y: y + 3.5, "text-anchor": "end" });
    lab.textContent = fmtVal(v);
    grid.appendChild(lab);
  }
  svg.appendChild(grid);

  // registration ticks along the left edge — measurement feel, not data
  for (let i = 0; i <= ticks * 2; i++) {
    const y = padding.top + ((height - padding.top - padding.bottom) * i) / (ticks * 2);
    grid.appendChild(svgNode("line", { class: "hc-reg", x1: padding.left - 4, y1: y, x2: padding.left, y2: y }));
  }

  // ── parity reference line — deviation series only ──
  const zeroY = yFor(0);
  if (isDeviation && zeroY >= padding.top && zeroY <= plotBottom) {
    svg.appendChild(svgNode("line", { class: "hc-zero-halo", x1: padding.left, y1: zeroY, x2: width - padding.right, y2: zeroY }));
    svg.appendChild(svgNode("line", { class: "hc-zero", x1: padding.left, y1: zeroY, x2: width - padding.right, y2: zeroY }));
    const zl = svgNode("text", { class: "hc-zlab", x: width - padding.right, y: zeroY - 8, "text-anchor": "end" });
    zl.textContent = "0.00% PARITY";
    svg.appendChild(zl);
  }

  // ── directional area fill — deviation series only. Cyan above parity
  // (premium), magenta below (discount). Geometry-derived: the fill is
  // built from the SAME segment paths used to draw the line, clipped
  // against the real zero-Y, so a zero crossing can never be misrepresented
  // by a guessed classification. Reference/on-chain never reach this
  // branch — they carry no premium/discount meaning. ──
  if (isDeviation) {
    const clipId = clipIdFor(seriesKey);
    const clip = svgNode("clipPath", { id: clipId });
    for (const seg of segments) {
      if (seg.length < 2) continue;
      const d =
        seg.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ") +
        ` L${seg[seg.length - 1][0].toFixed(2)},${zeroY.toFixed(2)} L${seg[0][0].toFixed(2)},${zeroY.toFixed(2)} Z`;
      clip.appendChild(svgNode("path", { d }));
    }
    svg.appendChild(clip);
    const g = svgNode("g", { "clip-path": `url(#${clipId})` });
    g.appendChild(svgNode("rect", { class: "hc-fill-p", x: padding.left, y: padding.top, width: width - padding.left - padding.right, height: Math.max(0, zeroY - padding.top) }));
    g.appendChild(svgNode("rect", { class: "hc-fill-d", x: padding.left, y: zeroY, width: width - padding.left - padding.right, height: Math.max(0, plotBottom - zeroY) }));
    svg.appendChild(g);
  }

  // ── signal — direction-tinted by true value, deviation mode only.
  // Reference/on-chain stay neutral. A run of the line is coloured cyan
  // (premium) or magenta (discount) based on the REAL sign of each point,
  // never by a segment's starting or ending value alone. Where a segment
  // crosses zero, it is split into two runs at the exact geometric
  // crossing — found by linear interpolation IN VALUE-SPACE between the
  // two bracketing points. This is exact, not approximate: yFor() is
  // affine in v, so the fraction of the way from one point's value to the
  // other's zero-crossing is identical to the fraction of the way along
  // the straight pixel segment between them. The same principle the
  // directional fill already uses for its clip-path, applied to the line. ──
  for (const seg of segments) {
    if (seg.length === 1) {
      const [x, y, v] = seg[0];
      const dotClass = isDeviation ? `hc-dot${v >= 0 ? "" : " d"}` : "hc-dot hc-dot-neutral";
      svg.appendChild(svgNode("circle", { class: dotClass, cx: x, cy: y, r: 2.6 }));
      continue;
    }

    if (!isDeviation) {
      const d = seg.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      svg.appendChild(svgNode("path", { class: "hc-line hc-line-neutral", d }));
      continue;
    }

    let run = [seg[0]];
    let currentSign = seg[0][2] >= 0;
    const flush = () => {
      if (run.length < 2) return;
      const cls = currentSign ? "hc-line" : "hc-line d";
      const d = run.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      svg.appendChild(svgNode("path", { class: cls, d }));
    };
    for (let k = 1; k < seg.length; k++) {
      const [xa, , va] = seg[k - 1];
      const [xb, , vb] = seg[k];
      const signB = vb >= 0;
      if (signB === currentSign) {
        run.push(seg[k]);
        continue;
      }
      // True zero crossing between two real, opposite-sign observations —
      // never invented, never guessed: exact linear interpolation between
      // the two actual sampled values.
      const t = Math.abs(va) / (Math.abs(va) + Math.abs(vb));
      const xc = xa + t * (xb - xa);
      run.push([xc, zeroY, 0]);
      flush();
      currentSign = signB;
      run = [[xc, zeroY, 0], seg[k]];
    }
    flush();
  }

  // ── axes ──
  svg.appendChild(svgNode("line", { class: "hc-axis", x1: padding.left, y1: plotBottom, x2: width - padding.right, y2: plotBottom }));
  const first = points[0], last = points[points.length - 1];
  const t0 = svgNode("text", { class: "hc-xlab", x: padding.left, y: height - 12, "text-anchor": "start" });
  t0.textContent = fmtAxisTime(first && first.timestamp);
  const t1 = svgNode("text", { class: "hc-xlab", x: width - padding.right, y: height - 12, "text-anchor": "end" });
  t1.textContent = fmtAxisTime(last && last.timestamp);
  svg.append(t0, t1);
  const nCap = svgNode("text", { class: "hc-xlab", x: (padding.left + width - padding.right) / 2, y: height - 12, "text-anchor": "middle" });
  nCap.textContent = `${points.length} OBSERVATIONS`;
  svg.appendChild(nCap);

  // ── accessible summary (role=img requires a real description) ──
  const availableCount = values.length;
  const rangeLabel = isDeviation
    ? `ranging ${fmtVal(min + pad)} to ${fmtVal(max - pad)}`
    : `ranging ${fmtVal(min + pad)} to ${fmtVal(max - pad)}`;
  svg.setAttribute(
    "aria-label",
    `${seriesLabel(seriesKey)} over ${points.length} observations, ${availableCount} available, ${rangeLabel}. ` +
      `Use arrow keys or pointer to inspect individual observations.`,
  );

  // ── inspection layer (pointer AND keyboard share this exact function —
  // there is only one truth-reporting code path, not two that could drift). ──
  const insp = svgNode("g", { class: "hc-insp", opacity: 0 });
  const cross = svgNode("line", { class: "hc-cross", x1: 0, y1: padding.top, x2: 0, y2: plotBottom });
  const focus = svgNode("circle", { class: "hc-focus", cx: 0, cy: 0, r: 4 });
  const tipBg = svgNode("rect", { class: "hc-tip", x: 0, y: 0, width: 166, height: 40, rx: 7 });
  const tipT = svgNode("text", { class: "hc-tipt", x: 0, y: 0 });
  const tipV = svgNode("text", { class: "hc-tipv", x: 0, y: 0 });
  insp.append(cross, focus, tipBg, tipT, tipV);
  svg.appendChild(insp);

  // Live region for screen readers — updated on every inspected index so
  // keyboard users hear the same fact a sighted pointer user sees. This
  // lives OUTSIDE the SVG deliberately: role="img" flattens all SVG
  // children out of the accessibility tree, so an in-SVG <title> would
  // set the graphic's accessible name once but would NOT reliably
  // re-announce on update. #chart-live is a real aria-live region in the
  // surrounding HTML (see index.html) for exactly that reason.
  const live = document.getElementById("chart-live");

  const hit = svgNode("rect", {
    x: padding.left, y: padding.top,
    width: width - padding.left - padding.right,
    height: plotBottom - padding.top,
    fill: "transparent", style: "cursor:crosshair",
  });
  svg.appendChild(hit);

  let focusedIndex = points.length - 1;

  const inspect = (i) => {
    i = Math.max(0, Math.min(points.length - 1, i));
    focusedIndex = i;
    const p = points[i];
    const v = p[seriesKey];
    const x = xFor(i);
    const available = v !== null && v !== undefined;

    cross.setAttribute("x1", x); cross.setAttribute("x2", x);
    if (available) {
      focus.setAttribute("cx", x);
      focus.setAttribute("cy", yFor(v));
      focus.setAttribute("opacity", "1");
      focus.setAttribute("class", isDeviation ? `hc-focus ${v >= 0 ? "p" : "d"}` : "hc-focus hc-focus-neutral");
    } else {
      focus.setAttribute("opacity", "0");
    }

    const tw = 166;
    const tx = Math.min(Math.max(x - tw / 2, padding.left), width - padding.right - tw);
    const ty = padding.top + 4;
    tipBg.setAttribute("x", tx); tipBg.setAttribute("y", ty);
    tipBg.setAttribute("width", tw);
    tipT.setAttribute("x", tx + 11); tipT.setAttribute("y", ty + 16);
    tipV.setAttribute("x", tx + 11); tipV.setAttribute("y", ty + 32);
    tipT.textContent = fmtAxisTime(p.timestamp);
    // A null sample says so. It never borrows a neighbour's value — that
    // would hide the exact thing this instrument exists to show honestly.
    tipV.textContent = available ? fmtVal(v) : "UNAVAILABLE";
    tipV.setAttribute("class", available ? "hc-tipv" : "hc-tipv na");
    insp.setAttribute("opacity", "1");

    // Same fact, announced to assistive tech. Guarded: #chart-live may be
    // absent if index.html predates this element (defensive, not expected).
    if (live) live.textContent = `${fmtAxisTime(p.timestamp)}: ${available ? fmtVal(v) : "unavailable"}`;
  };
  const hide = () => insp.setAttribute("opacity", "0");

  const indexFromClientX = (clientX) => {
    const box = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if (!box || !box.width) return null;
    const localX = ((clientX - box.left) / box.width) * width;
    const step = (width - padding.left - padding.right) / Math.max(points.length - 1, 1);
    return Math.round((localX - padding.left) / step);
  };

  if (hit.addEventListener) {
    hit.addEventListener("pointermove", (e) => {
      const i = indexFromClientX(e.clientX);
      if (i !== null) inspect(i);
    });
    hit.addEventListener("pointerdown", (e) => {
      const i = indexFromClientX(e.clientX);
      if (i !== null) inspect(i);
    });
    hit.addEventListener("pointerleave", hide);
  }

  // Keyboard inspection: same inspect() function, same truth semantics.
  // ArrowLeft/ArrowRight step one observation at a time; Home/End jump to
  // the ends. Unavailable samples are reported exactly as pointer
  // inspection reports them — nothing is skipped or bridged.
  if (svg.addEventListener) {
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); inspect(focusedIndex - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); inspect(focusedIndex + 1); }
      else if (e.key === "Home") { e.preventDefault(); inspect(0); }
      else if (e.key === "End") { e.preventDefault(); inspect(points.length - 1); }
      else return;
    });
    svg.addEventListener("focus", () => inspect(focusedIndex));
    svg.addEventListener("blur", hide);
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
