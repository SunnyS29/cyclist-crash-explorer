# Melbourne Cyclist Crash Explorer

A static browser app for exploring VicRoads cyclist crash data from January 2012 to July 2025: **15,485 distinct crashes**. Ask a supported plain-English question to see a count, chart, and underlying aggregated table.

**Live demo:** https://sunnys29.github.io/cyclist-crash-explorer/

Examples: `fatal crashes in Yarra 2023`, `serious crashes in Yarra by year`, `Sunday crashes at 8am`, `crashes between 8am and 10am`, `injuries in Merri-bek`, `fewest crashes by council 2025`.

## Run locally

```bash
python -m http.server 8000
# Open http://localhost:8000/
```

ES modules and data loading require HTTP; `file://` will not work. Chart.js and DuckDB WASM load from version-pinned CDN URLs, so an internet connection is required.

## Data pipeline

```bash
python -m pip install -r requirements.txt
python export_parquet.py
```

`export_parquet.py` reads the committed `data/melbourne_cyclist_crashes.csv`, selects crash-level fields, normalizes Moreland to Merri-bek, and writes `data/crashes.parquet`. The CSV has 16,056 rows with repeated crash IDs and person attributes. The export collapses identical crash details and fails if any ID still has conflicting details, is missing, or a required value is invalid. The output has 15,485 distinct crashes: 76 fatal, 4,871 serious injury, and 10,538 other injury crashes. These are crash counts, not numbers of people killed or injured.

The committed CSV is the reproducible input for this repository. The original upstream extraction query, retrieval date, and source dataset URL have not been recorded here; original source completeness and cyclist-selection criteria cannot be independently established from this repository alone. Underlying data remains subject to its source terms.

## Search behavior

- Council, year, severity, named weekday, weekday/weekend, and whole-hour filters are collected independently and applied together.
- Supported severity categories are Fatal, Serious Injury, and Other Injury, plus non-fatal. Generic injury questions show a breakdown. “Minor injury” is not assumed to mean Other Injury.
- Explicit years outside coverage, contradictory filters, multi-council searches, and unsupported questions get an explanatory response.
- Hour ranges such as `between 8am and 10am` include the complete 8, 9, and 10 o'clock hours. Overnight ranges and minute-specific queries are unsupported.
- The dataset has no suburb column. Known aliases such as Brunswick resolve to a council; the effective filters are displayed with every result.
- Council comparisons include all 31 councils, including zero-record councils. Raw counts do not measure cycling risk: population and cycling-exposure denominators are unavailable.
- 2025 ends on 31 July. Trend comparisons use complete years; partial-year values remain visible and labeled.

`js/intent.js` parses search intent; `js/queries.js` builds SQL and answer text; `js/app.js` runs DuckDB WASM and renders charts and tables.

## Verification

Node 20+ and the Python requirements above are needed:

```bash
node eval/run.mjs
python -m unittest discover -s eval -v
```

The intent regressions require all cases to pass and check complete filter objects for compound questions. The browser version at `/eval/` uses the same assertions. Data tests validate uniqueness, export parity, invalid/conflicting input, and SQL results against an independent reference built from the raw CSV. Set `NODE` to a Node executable path if it is not on PATH.

An optional browser smoke test uses Playwright:

```bash
npm install --no-save playwright
npx playwright install chromium
python -m http.server 8000
# In another terminal:
node eval/browser.mjs
```

Set `BASE_URL` to change the local URL, or `CHROME_PATH` to use an installed Chrome executable. The browser test only reads the app and interacts with local controls.

## License

Copyright 2026 Sunny Sangar. Public for portfolio review; reuse, redistribution, or modification not permitted without written permission. Underlying crash data remains subject to its original source terms.
