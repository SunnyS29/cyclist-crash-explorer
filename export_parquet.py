"""
export_parquet.py — Melbourne Cyclist Crash Explorer data pipeline.

Run once before deployment. Reads the raw VicRoads CSV and writes a compact
Parquet file (data/crashes.parquet) with normalised, query-friendly column
names that the in-browser DuckDB WASM engine reads directly.

The raw CSV column names differ from the original design assumptions, so this
script is the single place where that mapping is defined:

    accident_date  -> crash_date   (DATE)
    accident_time  -> crash_hour   (INT 0-23, derived)
    severity_desc  -> severity      (Fatal / Serious Injury / Other Injury)
    lga_name       -> council_area  (Local Government Area)

Usage:
    python export_parquet.py
"""

import os
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_IN = os.path.join(HERE, "data", "melbourne_cyclist_crashes.csv")
PARQUET_OUT = os.path.join(HERE, "data", "crashes.parquet")

# Single source of truth for the raw -> app schema mapping.
SELECT_SQL = f"""
SELECT
    accident_no                              AS crash_id,
    accident_date                            AS crash_date,
    accident_time                            AS crash_time,
    CAST(EXTRACT(hour FROM accident_time) AS INTEGER) AS crash_hour,
    day_week_desc                            AS day_of_week,
    accident_type_desc                       AS crash_type,
    severity_desc                            AS severity,
    speed_zone,
    road_geometry_desc                       AS road_geometry,
    lga_name                                 AS council_area,
    latitude,
    longitude,
    postcode_crash                           AS postcode,
    year,
    month
FROM read_csv_auto('{CSV_IN}')
"""


def main():
    if not os.path.exists(CSV_IN):
        raise SystemExit(f"Source CSV not found: {CSV_IN}")

    con = duckdb.connect()
    con.execute(f"CREATE VIEW crashes AS {SELECT_SQL}")

    # --- Sanity checks: confirm the data matches expectations -----------------
    (n_rows,) = con.execute("SELECT COUNT(*) FROM crashes").fetchone()
    y_min, y_max = con.execute("SELECT MIN(year), MAX(year) FROM crashes").fetchone()
    sev = con.execute(
        "SELECT severity, COUNT(*) FROM crashes GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall()
    (n_councils,) = con.execute(
        "SELECT COUNT(DISTINCT council_area) FROM crashes"
    ).fetchone()

    print(f"Rows:      {n_rows:,}")
    print(f"Years:     {y_min}-{y_max}")
    print(f"Councils:  {n_councils}")
    print("Severity:")
    for label, count in sev:
        print(f"   {label:<16} {count:,}")

    # --- Write Parquet --------------------------------------------------------
    con.execute(
        f"COPY (SELECT * FROM crashes) TO '{PARQUET_OUT}' "
        "(FORMAT PARQUET, COMPRESSION ZSTD)"
    )

    size_kb = os.path.getsize(PARQUET_OUT) / 1024
    print(f"\nWrote {PARQUET_OUT} ({size_kb:,.0f} KB)")


if __name__ == "__main__":
    main()
