# Melbourne Cyclist Crash Explorer

A static browser app for exploring VicRoads cyclist crash data (2012–2025, 16,056 records). Ask a plain-English question and get a direct answer, a chart, and the raw table — no backend, no SQL knowledge needed.

**Live demo:** https://sunnys29.github.io/cyclist-crash-explorer/

Example searches: `fatal crashes in Yarra 2023`, `serious injuries in Merri-bek`, `morning rush hour`, `safest suburb`, `8am crashes since 2020`.

## How it works

DuckDB WASM runs entirely in the browser and queries a local Parquet file.

- `export_parquet.py` — converts the source CSV to `data/crashes.parquet` (renames columns, derives `crash_hour`, normalises Moreland → Merri-bek).
- `js/intent.js` — maps phrases to query parameters (councils, year ranges, severity, time-of-day, etc.). Unsupported questions get a clear fallback.
- `js/queries.js` — builds the SQL and the plain-English answer.

The parser and query builders are DOM-free so they can be tested from Node.

## Run locally

```bash
python -m http.server 8000   # then open http://localhost:8000/
```

`file://` won't work — ES modules and data loading need HTTP. Regenerate data with `python export_parquet.py`; run the intent eval with `node eval/run.mjs`.

## Data notes

VicRoads cyclist crash records, 2012–2025, by council area (LGA). Static, not live. The dataset has no suburb column, so searches like `Brunswick` resolve to the relevant council via an alias table. Counts are raw — not risk rates, since there's no population or cycling-exposure data.

## License

Copyright 2026 Sunny Sangar. Public for portfolio review; reuse, redistribution, or modification not permitted without written permission. Underlying crash data remains subject to its original source terms.
