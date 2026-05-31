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

function whereWith(f, condition) {
  const yc = yearClause(f);
  return yc ? `${yc} AND ${condition}` : `WHERE ${condition}`;
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function councilCondition(council) {
  return council ? `council_area = ${sqlString(council)}` : null;
}

function joinConditions(f, conditions) {
  return conditions.filter(Boolean).reduce((sql, condition) => whereWithSql(sql, condition), yearClause(f));
}

function whereWithSql(sql, condition) {
  return sql ? `${sql} AND ${condition}` : `WHERE ${condition}`;
}

function rangeLabel(f) {
  const lo = f?.yearMin ?? 2012;
  const hi = f?.yearMax ?? 2025;
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

function partialYearNote(f) {
  return (f?.yearMax ?? 2025) >= 2025 ? " 2025 is partial, so treat that year with caution." : "";
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function top(rows, key = "value") {
  return [...rows].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0];
}

export const queries = {
  worstCouncils: (f = {}) => ({
    title: "Worst council areas for cyclists",
    caption: `Council areas with the most cyclist crashes (${rangeLabel(f)}).`,
    render: "bar",
    answer: (rows) => {
      const r = rows[0];
      return r ? `${titleCase(r.label)} had the most recorded cyclist crashes: ${fmt(r.value)} in ${rangeLabel(f)}.` : "";
    },
    sql: `SELECT council_area AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY council_area ORDER BY value DESC LIMIT 10`,
  }),

  safestCouncils: (f = {}) => ({
    title: "Safest council areas for cyclists",
    caption: `Council areas with the fewest recorded cyclist crashes (${rangeLabel(f)}). The dataset is council-level, not suburb-level.`,
    render: "bar",
    answer: (rows) => {
      const r = rows[0];
      return r ? `${titleCase(r.label)} had the fewest recorded cyclist crashes: ${fmt(r.value)} in ${rangeLabel(f)}. This is a council-area answer because the dataset has no suburb column.` : "";
    },
    sql: `SELECT council_area AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY council_area ORDER BY value ASC LIMIT 10`,
  }),

  yearlyTrend: (f = {}) => ({
    title: "Crashes over time",
    caption: `Total cyclist crashes per year (${rangeLabel(f)}).${partialYearNote(f)}`,
    render: "line",
    answer: (rows) => {
      if (rows.length < 2) return rows[0] ? `${rows[0].label} had ${fmt(rows[0].value)} recorded crashes.` : "";
      const first = rows[0], last = rows[rows.length - 1];
      const delta = Number(last.value) - Number(first.value);
      const direction = delta > 0 ? "up" : "down";
      return `Recorded crashes are ${direction} from ${fmt(first.value)} in ${first.label} to ${fmt(last.value)} in ${last.label}.${partialYearNote(f)}`;
    },
    sql: `SELECT CAST(year AS VARCHAR) AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY year ORDER BY year`,
  }),

  dangerousYears: (f = {}) => ({
    title: "Most dangerous year",
    caption: `Recorded cyclist crashes in the highest-crash year (${rangeLabel(f)}).${partialYearNote(f)}`,
    render: "stat",
    unit: "crashes",
    answer: (rows) => {
      const r = rows[0];
      return r ? `${r.label} had the most recorded cyclist crashes: ${fmt(r.value)} in ${rangeLabel(f)}.${partialYearNote(f)}` : "";
    },
    sql: `SELECT CAST(year AS VARCHAR) AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY year ORDER BY value DESC, year DESC LIMIT 1`,
  }),

  byHour: (f = {}) => ({
    title: `When crashes happen${f.council ? ` in ${titleCase(f.council)}` : ""}`,
    caption: `Crashes by hour of day, weekday vs weekend${f.council ? ` in ${titleCase(f.council)}` : ""} (${rangeLabel(f)}).`,
    render: "bar",
    answer: (rows) => {
      const weekday = top(rows, "weekday");
      const weekend = top(rows, "weekend");
      if (!weekday || !weekend) return "";
      const place = f.council ? ` in ${titleCase(f.council)}` : "";
      return `Weekday crashes${place} peak at ${weekday.label}:00 (${fmt(weekday.weekday)} crashes); weekend crashes${place} peak at ${weekend.label}:00 (${fmt(weekend.weekend)} crashes).`;
    },
    sql: `SELECT crash_hour AS label,
                 SUM(CASE WHEN day_of_week IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekend,
                 SUM(CASE WHEN day_of_week NOT IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekday
          FROM ${T} ${joinConditions(f, [councilCondition(f.council)])}
          GROUP BY crash_hour ORDER BY crash_hour`,
  }),

  safestTime: (f = {}) => {
    const periods = {
      weekend: {
        label: "weekend",
        condition: "day_of_week IN ('Saturday','Sunday')",
      },
      weekday: {
        label: "weekday",
        condition: "day_of_week NOT IN ('Saturday','Sunday')",
      },
      all: {
        label: "all days",
        condition: null,
      },
    };
    const period = periods[f.period] || periods.all;
    return {
      title: `Safest cycling times (${titleCase(period.label)})`,
      caption: `Hours with the fewest recorded cyclist crashes for ${period.label} (${rangeLabel(f)}). This uses raw crash counts, not cycling exposure.`,
      render: "bar",
      series: "hour",
      answer: (rows) => {
        const r = rows[0];
        return r ? `${r.label}:00 had the fewest recorded cyclist crashes for ${period.label}: ${fmt(r.value)} in ${rangeLabel(f)}. Treat this as a crash-count signal, not a true risk rate.` : "";
      },
      sql: `SELECT crash_hour AS label, COUNT(*) AS value
            FROM ${T} ${joinConditions(f, [period.condition])}
            GROUP BY crash_hour ORDER BY value ASC, crash_hour ASC LIMIT 10`,
    };
  },

  rushHour: (f = {}) => {
    const periods = {
      morning: { label: "morning rush hour", condition: "crash_hour BETWEEN 7 AND 9" },
      evening: { label: "evening rush hour", condition: "crash_hour BETWEEN 16 AND 18" },
      commute: { label: "commute hours", condition: "crash_hour IN (7, 8, 9, 16, 17, 18)" },
    };
    const period = periods[f.period] || periods.commute;
    return {
      title: `${titleCase(period.label)} crashes`,
      caption: `Cyclist crashes during ${period.label} (${rangeLabel(f)}).`,
      render: "bar",
      series: "hour",
      answer: (rows) => {
        const total = rows.reduce((sum, r) => sum + Number(r.value || 0), 0);
        const peak = top(rows);
        return peak ? `${fmt(total)} crashes happened during ${period.label}; the busiest hour was ${peak.label}:00 with ${fmt(peak.value)} crashes.` : "";
      },
      sql: `SELECT crash_hour AS label, COUNT(*) AS value
            FROM ${T} ${whereWith(f, period.condition)}
            GROUP BY crash_hour ORDER BY crash_hour`,
    };
  },

  bySeverity: (f = {}) => ({
    title: "How serious are crashes",
    caption: `Crashes by injury severity and share of total crashes (${rangeLabel(f)}).`,
    render: "bar",
    answer: (rows) => {
      const serious = rows.find((r) => r.label === "Serious Injury");
      const fatal = rows.find((r) => r.label === "Fatal");
      const share = Number(serious?.pct || 0) + Number(fatal?.pct || 0);
      return `Serious or fatal crashes make up ${pct(share)} of recorded cyclist crashes in ${rangeLabel(f)}.`;
    },
    sql: `SELECT severity AS label,
                 COUNT(*) AS value,
                 100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS pct
          FROM ${T} ${yearClause(f)}
          GROUP BY severity ORDER BY value DESC`,
  }),

  byDayOfWeek: (f = {}) => ({
    title: "Crashes by day of week",
    caption: `Which days see the most cyclist crashes (${rangeLabel(f)}).`,
    render: "bar",
    answer: (rows) => {
      const r = top(rows);
      return r ? `${r.label} has the most recorded cyclist crashes: ${fmt(r.value)} in ${rangeLabel(f)}.` : "";
    },
    sql: `SELECT day_of_week AS label, COUNT(*) AS value
          FROM ${T} ${yearClause(f)}
          GROUP BY day_of_week
          ORDER BY array_position(
            ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
            day_of_week)`,
  }),

  byRoadGeometry: (f = {}) => ({
    title: "Where intersection crashes happen",
    caption: `Cyclist crashes by intersection type${f.council ? ` in ${titleCase(f.council)}` : ""} (${rangeLabel(f)}). Excludes the broad "not at intersection" bucket because it mostly reflects how many non-intersection roads there are.`,
    render: "bar",
    answer: (rows) => {
      const r = rows[0];
      const place = f.council ? ` in ${titleCase(f.council)}` : "";
      return r ? `${titleCase(r.label)} had the most recorded cyclist crashes${place}, with ${fmt(r.value)} crashes.` : "";
    },
    sql: `SELECT road_geometry AS label, COUNT(*) AS value
          FROM ${T} ${joinConditions(f, [
            councilCondition(f.council),
            "road_geometry LIKE '%intersection%'",
            "road_geometry <> 'Not at intersection'",
          ])}
          GROUP BY road_geometry ORDER BY value DESC LIMIT 10`,
  }),

  filteredCount: (f = {}) => {
    const conditions = [councilCondition(f.council)];
    if (f.severity) conditions.push(`severity = ${sqlString(f.severity)}`);
    if (f.notSeverity) conditions.push(`severity <> ${sqlString(f.notSeverity)}`);
    if (f.day) conditions.push(`day_of_week = ${sqlString(f.day)}`);
    if (f.hour != null) conditions.push(`crash_hour = ${Number(f.hour)}`);
    if (f.hourMin != null && f.hourMax != null)
      conditions.push(`crash_hour BETWEEN ${Number(f.hourMin)} AND ${Number(f.hourMax)}`);

    const place = f.council ? ` in ${titleCase(f.council)}` : "";
    const label = f.label || "matching cyclist crashes";
    return {
      title: titleCase(`${label}${place}`),
      caption: `Recorded ${label}${place} (${rangeLabel(f)}).`,
      render: "stat",
      unit: label,
      answer: (rows) => `${fmt(rows[0]?.value)} recorded ${label}${place} in ${rangeLabel(f)}.`,
      sql: `SELECT COUNT(*) AS value FROM ${T} ${joinConditions(f, conditions)}`,
    };
  },

  fatalCount: (f = {}) => {
    const yc = yearClause(f);
    const sev = "severity = 'Fatal'";
    return {
      title: "Fatal crashes",
      caption: `Cyclist crashes that were fatal (${rangeLabel(f)}).`,
      render: "stat",
      unit: "fatal crashes",
      answer: (rows) => `${fmt(rows[0]?.value)} recorded cyclist crashes were fatal in ${rangeLabel(f)}.`,
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
      title: `${titleCase(council)} vs Melbourne`,
      caption: `Cyclist crashes in ${titleCase(council)} compared with the average council area (${rangeLabel(f)}).`,
      render: "line",
      answer: (rows) => {
        const r = rows[0];
        if (!r) return "";
        const diff = Number(r.total) - Number(r.melbourne_avg_total);
        const relation = diff >= 0 ? "above" : "below";
        return `${titleCase(council)} had ${fmt(r.total)} crashes in ${rangeLabel(f)}, ranking ${r.rank} of ${r.councils} councils and sitting ${relation} the Melbourne council average of ${fmt(Math.round(r.melbourne_avg_total))}.`;
      },
      sql: `WITH filtered AS (
              SELECT * FROM ${T} ${yc}
            ),
            yearly AS (
              SELECT year,
                     SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS value,
                     COUNT(*) AS total_crashes,
                     COUNT(DISTINCT council_area) AS councils
              FROM filtered GROUP BY year
            ),
            totals AS (
              SELECT council_area, COUNT(*) AS total
              FROM filtered GROUP BY council_area
            ),
            ranked AS (
              SELECT council_area,
                     total,
                     RANK() OVER (ORDER BY total DESC) AS rank,
                     COUNT(*) OVER () AS councils,
                     AVG(total) OVER () AS melbourne_avg_total
              FROM totals
            )
            SELECT CAST(yearly.year AS VARCHAR) AS label,
                   yearly.value,
                   ROUND(yearly.total_crashes * 1.0 / yearly.councils, 1) AS melbourne_avg,
                   ranked.total,
                   ranked.rank,
                   ranked.councils,
                   ranked.melbourne_avg_total
            FROM yearly CROSS JOIN ranked
            WHERE ranked.${cond}
            ORDER BY yearly.year`,
    };
  },
};

export function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
