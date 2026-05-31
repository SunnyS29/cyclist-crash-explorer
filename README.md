# Melbourne Cyclist Crash Explorer

A static, browser-only analytics tool for exploring 13 years of VicRoads cyclist
crash data (2012–2025, 16,056 records). No backend, no build step — DuckDB WASM
runs SQL against a Parquet file entirely in the browser.

Live questions it answers: which councils are most dangerous, whether it's
getting safer over time, when crashes happen, how serious they are, and more.

## Run locally

```bash
python -m http.server 8000   # serve from this folder
# open http://localhost:8000/
```

ES modules and the Parquet fetch require HTTP — opening `index.html` via
`file://` will not work.

## Structure

```
index.html              UI + layout
js/app.js               DuckDB WASM init, UI wiring, Chart.js rendering
js/queries.js           pure SQL builders (Node-testable)
js/intent.js            plain-English -> query-builder parser (pure)
data/crashes.parquet    the dataset (generated, 333 KB)
export_parquet.py       CSV -> Parquet pipeline (run once)
eval/                   intent-accuracy evaluation harness
```

`intent.js` and `queries.js` are kept free of DOM/DuckDB dependencies so the
parsing logic can be evaluated in isolation.

## Data pipeline

```bash
python export_parquet.py   # data/melbourne_cyclist_crashes.csv -> data/crashes.parquet
```

The raw CSV column names are remapped to query-friendly names in this one script
(e.g. `accident_date` -> `crash_date`, `lga_name` -> `council_area`,
`accident_time` -> derived `crash_hour`).

## Evaluation

The natural-language layer is the easiest part to silently regress, so it has a
labelled eval (`eval/cases.js`) that asserts each prompt maps to the right query
builder, council, and year range. It gates at 90% accuracy (currently 100%).

- **Browser:** open `http://localhost:8000/eval/` — renders pass/fail per case.
- **Node** (if installed): `node eval/run.mjs` — exits non-zero below threshold.

Add a row to `eval/cases.js` whenever you teach the parser a new phrase, then
re-run to confirm nothing else regressed.

## Deploy (GitHub Pages)

Push the repo and enable Pages on `main` / root. No CI or env vars needed.

## Notes / caveats

- The dataset has no suburb column, only Local Government Area (council). A small
  suburb→council alias table in `intent.js` resolves common searches like
  "Brunswick" → Merri-bek. Moreland was renamed Merri-bek in 2022, so its records
  are split across both names in the data.
- Static dataset — not live. The date range is shown in the header.
