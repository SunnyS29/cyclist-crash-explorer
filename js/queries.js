// Pure SQL builders. No DOM/DuckDB deps so they run in Node (eval) and browser.
// Each builder returns: { title, caption, render, sql }
//   render: 'bar' | 'line' | 'stat' | 'table'

const T = "crashes"; // registered view name over the parquet file

function yearClause({ yearMin, yearMax } = {}) {
  const parts = [];
  if (yearMin != null) parts.push(`year >= ${yearMin}`);
  if (yearMax != null) parts.push(`year <= ${yearMax}`);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

function rangeLabel(f) {
  const lo = f?.yearMin ?? 2012;
  const hi = f?.yearMax ?? 2025;
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

export const queries = {
  worstCouncils: (f = {}) => ({
    title: "Worst council areas for cyclists",
    caption: `Council areas with the most cyclist crashes (${rangeLabel(f)}).`,
    render: "bar",
    sql: `SELECT council_area AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY council_area ORDER BY value DESC LIMIT 10`,
  }),

  yearlyTrend: (f = {}) => ({
    title: "Crashes over time",
    caption: `Total cyclist crashes per year (${rangeLabel(f)}).`,
    render: "line",
    sql: `SELECT CAST(year AS VARCHAR) AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY year ORDER BY year`,
  }),

  byHour: (f = {}) => ({
    title: "When crashes happen",
    caption: `Crashes by hour of day, weekday vs weekend (${rangeLabel(f)}).`,
    render: "bar",
    sql: `SELECT crash_hour AS label,
                 SUM(CASE WHEN day_of_week IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekend,
                 SUM(CASE WHEN day_of_week NOT IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekday
          FROM ${T} ${yearClause(f)}
          GROUP BY crash_hour ORDER BY crash_hour`,
  }),

  bySeverity: (f = {}) => ({
    title: "How serious are crashes",
    caption: `Crashes by injury severity (${rangeLabel(f)}).`,
    render: "bar",
    sql: `SELECT severity AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY severity ORDER BY value DESC`,
  }),

  byDayOfWeek: (f = {}) => ({
    title: "Crashes by day of week",
    caption: `Which days see the most cyclist crashes (${rangeLabel(f)}).`,
    render: "bar",
    sql: `SELECT day_of_week AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY day_of_week
          ORDER BY array_position(
            ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
            day_of_week)`,
  }),

  byRoadGeometry: (f = {}) => ({
    title: "Most dangerous road types",
    caption: `Crashes by road geometry, e.g. intersections (${rangeLabel(f)}).`,
    render: "bar",
    sql: `SELECT road_geometry AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY road_geometry ORDER BY value DESC LIMIT 10`,
  }),

  fatalCount: (f = {}) => {
    const yc = yearClause(f);
    const sev = "severity = 'Fatal'";
    return {
      title: "Fatal crashes",
      caption: `Cyclist crashes that were fatal (${rangeLabel(f)}).`,
      render: "stat",
      unit: "fatal crashes",
      sql: `SELECT COUNT(*) AS value FROM ${T}
            ${yc ? yc + " AND " + sev : "WHERE " + sev}`,
    };
  },

  // Filter to a single council area (matched name passed in `council`).
  council: ({ council, ...f } = {}) => {
    const yc = yearClause(f);
    const safe = String(council).replace(/'/g, "''");
    const cond = `council_area = '${safe}'`;
    return {
      title: `${titleCase(council)} crash breakdown`,
      caption: `Cyclist crashes in ${titleCase(council)} by year (${rangeLabel(f)}).`,
      render: "line",
      sql: `SELECT CAST(year AS VARCHAR) AS label, COUNT(*) AS value
            FROM ${T} ${yc ? yc + " AND " + cond : "WHERE " + cond}
            GROUP BY year ORDER BY year`,
    };
  },
};

export function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
