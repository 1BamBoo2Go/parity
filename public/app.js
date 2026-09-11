// Parity dashboard frontend. Plain JS, no build step, no framework.
// This file only ever fetches from same-origin /api/* endpoints — no
// third-party keys or secrets are ever needed or present here.

const STATUS_PRESENTATION = {
  healthy_current: { label: "Healthy / current", tone: "green" },
  stale_reference: { label: "Stale reference", tone: "amber" },
  oracle_paused: { label: "Oracle paused", tone: "amber" },
  trading_halt: { label: "Trading halt", tone: "amber" },
  upstream_unavailable: { label: "Upstream unavailable", tone: "red" },
  no_data_yet: { label: "No data yet", tone: "gray" },
};

function badge(status) {
  const p = STATUS_PRESENTATION[status] || { label: status, tone: "gray" };
  const span = document.createElement("span");
  span.className = `badge tone-${p.tone}`;
  span.textContent = p.label;
  return span;
}

function fmtPrice(value) {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function fmtPct(value) {
  if (value === null || value === undefined) return "—";
  const cls = value >= 0 ? "pct-positive" : "pct-negative";
  const sign = value >= 0 ? "+" : "";
  return `<span class="${cls}">${sign}${value.toFixed(4)}%</span>`;
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fieldOrDash(field, formatter) {
  if (!field || field.value === null || field.value === undefined) return "—";
  return formatter ? formatter(field.value) : String(field.value);
}

// ---------------------------------------------------------------------
// Grid view
// ---------------------------------------------------------------------

async function loadGrid() {
  const tbody = document.getElementById("grid-table-body");
  try {
    const res = await fetch("/api/tickers");
    const data = await res.json();
    tbody.innerHTML = "";
    for (const row of data.tickers) {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.addEventListener("click", () => navigateTo(row.symbol));

      const tdSymbol = document.createElement("td");
      const symSpan = document.createElement("span");
      symSpan.className = "ticker-symbol";
      symSpan.textContent = row.symbol;
      tdSymbol.appendChild(symSpan);

      const tdStatus = document.createElement("td");
      tdStatus.appendChild(badge(row.overallStatus));

      const tdRef = document.createElement("td");
      tdRef.textContent = fieldOrDash(row.referencePrice, fmtPrice);

      const tdSec = document.createElement("td");
      tdSec.textContent = fieldOrDash(row.secondaryPrice, fmtPrice);

      const tdPct = document.createElement("td");
      tdPct.innerHTML = row.premiumDiscountPct && row.premiumDiscountPct.value !== null ? fmtPct(row.premiumDiscountPct.value) : "—";

      const tdIntelligence = document.createElement("td");
      tdIntelligence.textContent = row.intelligence ? row.intelligence.label : "—";

      const tdHolders = document.createElement("td");
      tdHolders.textContent = row.holderConcentration && row.holderConcentration.top10Pct !== null
        ? `${row.holderConcentration.top10Pct.toFixed(2)}%`
        : "unavailable";

      const tdUpdated = document.createElement("td");
      tdUpdated.textContent = fmtTimestamp(row.lastUpdateTimestamp);

      tr.append(tdSymbol, tdStatus, tdRef, tdSec, tdPct, tdIntelligence, tdHolders, tdUpdated);
      tbody.appendChild(tr);
    }
    document.getElementById("global-refresh-note").textContent =
      `${data.tickers.length} supported ticker(s) — showing latest captured snapshot per ticker`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">Could not load snapshot data: ${escapeHtml(String(err))}</td></tr>`;
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------

let currentHistory = null;
let currentSeries = "referencePrice";

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
    document.getElementById("detail-reference").textContent = fieldOrDash(detail.referencePrice, fmtPrice);
    document.getElementById("detail-secondary").textContent = fieldOrDash(detail.secondaryPrice, fmtPrice);
    document.getElementById("detail-premium").innerHTML = detail.premiumDiscountPct && detail.premiumDiscountPct.value !== null ? fmtPct(detail.premiumDiscountPct.value) : "—";
    document.getElementById("detail-intelligence").textContent = detail.intelligence ? detail.intelligence.label : "—";

    const rhPrice = detail.robinhoodPrice && detail.robinhoodPrice.value;
    document.getElementById("detail-rh-price").textContent = rhPrice
      ? `bid ${rhPrice.bid} / ask ${rhPrice.ask}${rhPrice.isTradingHalt ? " (TRADING HALT)" : ""}`
      : "unavailable";

    const oracle = detail.oraclePausedField;
    document.getElementById("detail-oracle").textContent = oracle && oracle.value !== null
      ? (oracle.value ? "PAUSED" : "active")
      : "unavailable";

    document.getElementById("detail-asset-status").textContent = fieldOrDash(detail.robinhoodAssetStatus);
    document.getElementById("detail-token-address").textContent = detail.canonicalTokenAddress || "—";
    document.getElementById("detail-pool-address").textContent = detail.configuredPoolAddress || "—";

    const hc = detail.holderConcentration || {};
    document.getElementById("detail-top1").textContent = hc.top1Pct !== null && hc.top1Pct !== undefined ? `${hc.top1Pct.toFixed(2)}%` : "unavailable";
    document.getElementById("detail-top5").textContent = hc.top5Pct !== null && hc.top5Pct !== undefined ? `${hc.top5Pct.toFixed(2)}%` : "unavailable";
    document.getElementById("detail-top10").textContent = hc.top10Pct !== null && hc.top10Pct !== undefined ? `${hc.top10Pct.toFixed(2)}%` : "unavailable";

    document.getElementById("detail-last-update").textContent = fmtTimestamp(detail.lastUpdateTimestamp);

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

function renderProvenanceTable(rows) {
  const tbody = document.getElementById("provenance-table-body");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const tdField = document.createElement("td");
    tdField.textContent = row.field;
    tdField.style.fontFamily = "var(--sans)";
    const tdStatus = document.createElement("td");
    tdStatus.appendChild(badge(row.status === "ok" ? "healthy_current" : row.status));
    const tdSource = document.createElement("td");
    tdSource.textContent = row.source || "—";
    const tdDetail = document.createElement("td");
    tdDetail.textContent = row.detail || "—";
    tdDetail.className = "small muted";
    tr.append(tdField, tdStatus, tdSource, tdDetail);
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------
// History chart — hand-rolled SVG, gap-preserving (no interpolation,
// no fabricated zeros; a null value breaks the line into a new segment).
// ---------------------------------------------------------------------

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

  const gridView = document.getElementById("grid-view");
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
