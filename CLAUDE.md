# Cyclist Crash Explorer

Static, browser-only analytics tool for Melbourne cyclist crash data (DuckDB WASM + Chart.js, no backend/build step).

## Conventions
- Don't over-comment. Comment only complicated/non-obvious code.
- Keep chat messages short and to the point.

## Product direction
- This project should complement the existing Metabase cyclist safety dashboard, not duplicate it. Metabase is the dense analyst view; this static explorer is the plain-English question-answer layer for non-technical users.
- Prior review found the explorer was chart-first and missed parts of the original vision: year sliders changed labels without refreshing results, local-area searches did not compare against the rest of Melbourne, rush-hour searches returned the full 24-hour chart, and Moreland/Merri-bek was split. Preserve fixes for those behaviors.
- Query specs in `js/queries.js` can include an `answer(rows)` function. Use that for direct plain-English summaries before the chart so answers feel like "Brunswick had X crashes..." rather than just raw visuals.
- Moreland records are normalised to Merri-bek in `export_parquet.py`. Do not reintroduce `MORELAND` as a separate council bucket unless the product direction changes.
- In `intent.js`, council/place matching should run before broad keyword matching. Otherwise real places such as Mornington Peninsula can be misread as rush-hour queries because they contain words like "morning".
