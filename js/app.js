// App entry: boots DuckDB WASM over the Parquet file, wires the search box,
// guided cards and year filter, and renders results with Chart.js.
//
// Architecture:
//   intent.js   text  -> { builder, params, year }   (pure, eval-tested)
//   queries.js  builder(filter) -> { sql, render, ... } (pure)
//   app.js      runs SQL in DuckDB WASM, renders via Chart.js (this file)

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";
import { queries, titleCase } from "./queries.js";
import { parseIntent } from "./intent.js";

const state = { yearMin: 2012, yearMax: 2025 };
let conn = null;
let chart = null;
let activeQuery = null;

// ---- DuckDB init ----------------------------------------------------------
async function initDuckDB() {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  conn = await db.connect();
  const url = new URL("data/crashes.parquet", location.href).href;
  await db.registerFileURL("crashes.parquet", url, duckdb.DuckDBDataProtocol.HTTP, false);
  await conn.query(`CREATE VIEW crashes AS SELECT * FROM 'crashes.parquet'`);
}

// Arrow rows contain BigInt for COUNT(*); coerce to plain JS values.
async function runSql(sql) {
  const res = await conn.query(sql);
  return res.toArray().map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row.toJSON()))
      o[k] = typeof v === "bigint" ? Number(v) : v;
    return o;
  });
}

// ---- Rendering ------------------------------------------------------------
const AMBER = "#ffb000";
const AMBER_DIM = "rgba(255,176,0,0.45)";

function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
}

function renderResult(spec, rows) {
  destroyChart();
  document.getElementById("result-title").textContent = spec.title;
  document.getElementById("result-answer").textContent =
    typeof spec.answer === "function" ? spec.answer(rows) : "";
  document.getElementById("result-caption").textContent = caption(spec, rows);
  renderTable(rows);

  const canvas = document.getElementById("chart");
  const stat = document.getElementById("stat");
  if (spec.render === "stat") {
    canvas.style.display = "none";
    stat.style.display = "block";
    stat.textContent = `${(rows[0]?.value ?? 0).toLocaleString()}`;
    return;
  }
  stat.style.display = "none";
  canvas.style.display = "block";

  if (spec.render === "line") return drawLine(rows, spec);
  if (spec.render === "bar" && spec.series === "hour") return drawBar(rows, "label");
  if (spec.render === "bar" && "weekday" in (rows[0] || {})) return drawGroupedBar(rows);
  return drawBar(rows);
}

function drawBar(rows, labelKey = "label") {
  chart = new Chart(ctx(), {
    type: "bar",
    data: {
      labels: rows.map((r) => titleCase(String(r[labelKey]))),
      datasets: [{ data: rows.map((r) => r.value), backgroundColor: AMBER }],
    },
    options: baseOpts(),
  });
}

function drawGroupedBar(rows) {
  chart = new Chart(ctx(), {
    type: "bar",
    data: {
      labels: rows.map((r) => `${r.label}:00`),
      datasets: [
        { label: "Weekday", data: rows.map((r) => r.weekday), backgroundColor: AMBER },
        { label: "Weekend", data: rows.map((r) => r.weekend), backgroundColor: AMBER_DIM },
      ],
    },
    options: baseOpts(true),
  });
}

function drawLine(rows, spec) {
  const datasets = [{
    label: spec.seriesLabel || "Crashes",
    data: rows.map((r) => r.value),
    borderColor: AMBER, backgroundColor: AMBER_DIM, tension: 0.25, fill: true,
  }];

  if ("melbourne_avg" in (rows[0] || {})) {
    datasets[0].label = spec.seriesLabel || "Selected area";
    datasets[0].fill = false;
    datasets.push({
      label: "Average council area",
      data: rows.map((r) => r.melbourne_avg),
      borderColor: "rgba(255,255,255,0.75)",
      backgroundColor: "rgba(255,255,255,0.12)",
      borderDash: [6, 4],
      tension: 0.25,
      fill: false,
    });
  }

  chart = new Chart(ctx(), {
    type: "line",
    data: {
      labels: rows.map((r) => String(r.label)),
      datasets,
    },
    options: baseOpts(datasets.length > 1),
  });
}

function ctx() { return document.getElementById("chart").getContext("2d"); }

function baseOpts(legend = false) {
  const grid = { color: "rgba(255,255,255,0.06)" };
  const ticks = { color: "#aaa" };
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: legend, labels: { color: "#ccc" } } },
    scales: { x: { grid, ticks }, y: { grid, ticks, beginAtZero: true } },
  };
}

function caption(spec, rows) {
  if (spec.render === "stat")
    return `${(rows[0]?.value ?? 0).toLocaleString()} ${spec.unit}. ${spec.caption}`;
  return spec.caption;
}

function renderTable(rows) {
  const wrap = document.getElementById("table-wrap");
  if (!rows.length) { wrap.innerHTML = "<p>No data.</p>"; return; }
  const cols = Object.keys(rows[0]);
  wrap.innerHTML = `<table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c]}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// ---- Dispatch -------------------------------------------------------------
async function run(builderName, params = {}, yearOverride = null, remember = true) {
  if (remember) activeQuery = { builderName, params, yearOverride };
  const filter = yearOverride
    ? { yearMin: yearOverride.min, yearMax: yearOverride.max }
    : { yearMin: state.yearMin, yearMax: state.yearMax };
  const spec = queries[builderName]({ ...filter, ...params });
  setStatus("Running…");
  try {
    const rows = await runSql(spec.sql);
    renderResult(spec, rows);
    setStatus("");
  } catch (e) {
    setStatus(`Query error: ${e.message}`);
    console.error(e);
  }
}

function handleSearch(text) {
  const intent = parseIntent(text);
  if (!intent) {
    setStatus(`Couldn't parse "${text}". Try a quick question below.`);
    return;
  }
  run(intent.builder, intent.params, intent.year);
}

function rerunActiveWithGlobalYears() {
  if (!activeQuery || !conn) return;
  run(activeQuery.builderName, activeQuery.params, null, true);
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

// ---- Wiring ---------------------------------------------------------------
function wireUI() {
  document.querySelectorAll("[data-card]").forEach((btn) =>
    btn.addEventListener("click", () => run(btn.dataset.card)));

  const search = document.getElementById("search");
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch(search.value);
  });
  document.getElementById("search-btn")
    .addEventListener("click", () => handleSearch(search.value));

  const min = document.getElementById("year-min");
  const max = document.getElementById("year-max");
  const label = document.getElementById("year-label");
  // Force sliders to canonical state on load (browsers restore stale values via bfcache).
  min.value = state.yearMin;
  max.value = state.yearMax;
  label.textContent = `${state.yearMin}–${state.yearMax}`;
  const onYear = () => {
    let lo = +min.value, hi = +max.value;
    if (lo > hi) [lo, hi] = [hi, lo];
    state.yearMin = lo; state.yearMax = hi;
    label.textContent = lo === hi ? `${lo}` : `${lo}–${hi}`;
    rerunActiveWithGlobalYears();
  };
  min.addEventListener("input", onYear);
  max.addEventListener("input", onYear);

  document.getElementById("toggle-data").addEventListener("click", () => {
    const w = document.getElementById("table-wrap");
    w.style.display = w.style.display === "none" ? "block" : "none";
  });
}

(async function main() {
  wireUI();
  try {
    await initDuckDB();
    document.getElementById("loading").style.display = "none";
    document.getElementById("app").style.display = "block";
    run("worstCouncils"); // sensible default view
  } catch (e) {
    document.getElementById("loading").textContent = `Failed to load engine: ${e.message}`;
    console.error(e);
  }
})();
