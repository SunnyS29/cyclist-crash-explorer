# Melbourne Cyclist Crash Explorer

Melbourne Cyclist Crash Explorer is a static browser app for exploring cyclist crash data from VicRoads records.

The app runs DuckDB WASM in the browser, queries a local Parquet file, and returns plain-English answers with charts and raw table output.

Live demo:
https://sunnys29.github.io/cyclist-crash-explorer/

## The Problem

Cyclist crash data is useful, but it is not always easy to explore without a dashboard or SQL knowledge.

This project was built to let a non-technical user ask questions like:

- `fatal crashes in Yarra 2023`
- `serious injuries in Merri-bek`
- `safest suburb`
- `morning rush hour`
- `intersections in Port Phillip`
- `8am crashes since 2020`

The app gives a direct answer first, then shows the supporting chart and data table.

## The Workflow

### 1. Data Export

`export_parquet.py` converts the source CSV into `data/crashes.parquet`.

During export:
- raw column names are mapped to simpler names
- `crash_hour` is derived from the accident time
- Moreland is normalised to Merri-bek

### 2. Browser Query Engine

DuckDB WASM loads in the browser and queries the Parquet file directly.

The Parquet file is fetched as bytes and registered with DuckDB using `registerFileBuffer`, which avoids static-hosting issues with HTTP range requests.

### 3. Plain-English Search

`js/intent.js` maps common phrases into query parameters.

It supports:
- council and common suburb aliases
- years and year ranges
- `since`, `before`, and `after` year phrases
- fatal, non-fatal, and serious injury questions
- rush hour, weekday, weekend, day, and hour questions
- intersection geometry questions
- safest and worst council-area rankings by crash count

Unsupported questions return a clear fallback instead of pretending the data can answer them.

### 4. SQL Query Builders

`js/queries.js` builds the SQL and formats the direct answer shown above the chart.

The parser and query builders are kept separate from the DOM so they can be tested from Node.

## Data Notes

- Source: VicRoads cyclist crash records
- Coverage: 2012 to 2025
- Records: 16,056
- Geography: Local Government Area / council area
- Dataset is static, not live

The dataset does not include a suburb column. Searches such as `Brunswick` are resolved through a small suburb-to-council alias table and return the relevant council area, not true suburb-level counts.

The app shows raw crash counts. It does not calculate true risk rates because the dataset does not include population, cycling volume, road length, or exposure data.

## File Setup

```text
index.html
js/app.js
js/queries.js
js/intent.js
data/crashes.parquet
data/melbourne_cyclist_crashes.csv
export_parquet.py
eval/
```

## Run Locally

Serve the folder over HTTP:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/
```

Do not open `index.html` with `file://`. ES modules and data loading need HTTP.

## Regenerate Data

```bash
python export_parquet.py
```

## Evaluation

Run the labelled intent parser eval:

```bash
node eval/run.mjs
```

The eval checks that natural-language prompts map to the expected query builder, council, and year range.

Add a new case to `eval/cases.js` whenever the parser learns a new phrase.

## Deployment

The app is deployed with GitHub Pages from the `main` branch and repository root.

No backend, build step, database server, or environment variables are required.

## License

Copyright 2026 Sunny Sangar. All rights reserved.

This repository is public for portfolio review. Reuse, redistribution, modification, or commercial use is not permitted without written permission.

The underlying public crash data remains subject to its original source terms.
