// Pure SQL builders shared by the browser and regression tests.
import { COUNCILS } from "./intent.js";
const T = "crashes";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;
const fmt = (n) => Number(n || 0).toLocaleString();
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
export const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const top = (rows, key = "value") => [...rows].sort((a, b) => Number(b[key]) - Number(a[key]))[0];
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error("Invalid numeric filter");
  return value;
}
function range(f) {
  const min = integer(f.yearMin ?? 2012, 2012, 2025), max = integer(f.yearMax ?? 2025, 2012, 2025);
  if (min > max) throw new Error("Invalid year range");
  return { min, max };
}
function rangeLabel(f) { const { min, max } = range(f); return min === max ? `${min}` : `${min}–${max}`; }
const partialNote = (f) => range(f).max === 2025 ? " 2025 covers January–July only." : "";
function filterLabels(f) {
  return [f.council && `Council: ${titleCase(f.council)}`,
    f.severity && `Severity: ${f.severity}`, f.notSeverity && `Excluding: ${f.notSeverity}`,
    f.day, f.dayPeriod, f.hour != null && `${f.hour}:00–${f.hour}:59`,
    f.hourMin != null && `${f.hourMin}:00–${f.hourMax}:59`,
    f.period && `${f.period} hours`].filter(Boolean);
}
function where(f = {}, extra = []) {
  const { min, max } = range(f);
  const conditions = [`year BETWEEN ${min} AND ${max}`];
  if (f.council) conditions.push(`council_area = ${sqlString(f.council)}`);
  if (f.severity) conditions.push(`severity = ${sqlString(f.severity)}`);
  if (f.notSeverity) conditions.push(`severity <> ${sqlString(f.notSeverity)}`);
  if (f.day) conditions.push(`day_of_week = ${sqlString(f.day)}`);
  if (f.dayPeriod === "weekend") conditions.push("day_of_week IN ('Saturday','Sunday')");
  if (f.dayPeriod === "weekday") conditions.push("day_of_week NOT IN ('Saturday','Sunday')");
  if (f.hour != null) conditions.push(`crash_hour = ${integer(f.hour, 0, 23)}`);
  if (f.hourMin != null || f.hourMax != null) {
    const lo = integer(f.hourMin, 0, 23), hi = integer(f.hourMax, 0, 23);
    if (lo > hi) throw new Error("Invalid hour range");
    conditions.push(`crash_hour BETWEEN ${lo} AND ${hi}`);
  }
  if (f.period === "morning") conditions.push("crash_hour BETWEEN 7 AND 9");
  if (f.period === "evening") conditions.push("crash_hour BETWEEN 16 AND 18");
  if (f.period === "commute") conditions.push("crash_hour IN (7,8,9,16,17,18)");
  return `WHERE ${[...conditions, ...extra].join(" AND ")}`;
}
const councilDimension = `SELECT unnest([${COUNCILS.map(sqlString).join(",")}]) AS council_area`;
function councilTotals(f) {
  return `WITH councils AS (${councilDimension}), filtered AS (SELECT * FROM ${T} ${where(f)}),
    totals AS (SELECT c.council_area, COUNT(f.crash_id) AS value FROM councils c
      LEFT JOIN filtered f USING (council_area) GROUP BY c.council_area)`;
}
function yearlyCounts(f) {
  const { min, max } = range(f);
  return `WITH years AS (SELECT range AS year FROM range(${min}, ${max + 1})),
    counts AS (SELECT year, COUNT(*) AS value FROM ${T} ${where(f)} GROUP BY year)
    SELECT CAST(y.year AS VARCHAR) AS label, COALESCE(c.value, 0) AS value
    FROM years y LEFT JOIN counts c USING (year)`;
}
function hourlyCounts(f) {
  // Build the hour dimension using the same time constraints; retain zero hours.
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) =>
    (f.hour == null || h === f.hour) && (f.hourMin == null || h >= f.hourMin && h <= f.hourMax) &&
    (!f.period || (f.period === "morning" ? h >= 7 && h <= 9 :
      f.period === "evening" ? h >= 16 && h <= 18 : [7,8,9,16,17,18].includes(h))));
  return `WITH hours AS (SELECT unnest([${hours.join(",")}]) AS crash_hour),
    counts AS (SELECT crash_hour, COUNT(*) AS value FROM ${T} ${where(f)} GROUP BY crash_hour)
    SELECT h.crash_hour AS label, COALESCE(c.value, 0) AS value
    FROM hours h LEFT JOIN counts c USING (crash_hour)`;
}
const noData = "No recorded crashes match these filters.";
const builders = {
  worstCouncils: (f) => ({
    title: "Councils with the most recorded crashes", render: "bar",
    caption: "Raw counts by council area; these are not cycling risk rates.",
    sql: `${councilTotals(f)} SELECT council_area AS label, value FROM totals ORDER BY value DESC, label LIMIT 10`,
    answer: (rows) => rows[0] ? `${titleCase(rows[0].label)} had ${fmt(rows[0].value)} recorded crashes, the highest count (ties may occur).` : noData,
  }),
  safestCouncils: (f) => ({
    title: "Councils with the fewest recorded crashes", render: "bar",
    caption: "Includes councils with zero records. Council-level counts are not suburb-level risk rates.",
    sql: `${councilTotals(f)} SELECT council_area AS label, value FROM totals ORDER BY value, label LIMIT 10`,
    answer: (rows) => rows[0] ? `${titleCase(rows[0].label)} had ${fmt(rows[0].value)} recorded crashes, the lowest count (ties may occur). Zero records do not establish that no crashes occurred.` : noData,
  }),
  yearlyTrend: (f) => ({
    title: "Recorded crashes over time", render: "line",
    caption: `Crashes per year.${partialNote(f)}`,
    sql: `${yearlyCounts(f)} ORDER BY label`,
    answer: (rows) => {
      // Never compare a partial year against a full year to infer a trend.
      const complete = rows.filter((r) => Number(r.label) < 2025);
      if (complete.length < 2) return rows.map((r) => `${r.label}: ${fmt(r.value)} recorded crashes`).join("; ") + `.${partialNote(f)}`;
      const first = complete[0], last = complete[complete.length - 1];
      const delta = Number(last.value) - Number(first.value);
      const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "were unchanged";
      return `Across complete years, recorded crashes ${direction}: ${fmt(first.value)} in ${first.label} and ${fmt(last.value)} in ${last.label}.${partialNote(f)}`;
    },
  }),
  dangerousYears: (f) => ({
    title: "Year with the most recorded crashes", render: "stat", unit: "crashes",
    caption: `Highest annual count.${partialNote(f)}`,
    sql: `${yearlyCounts(f)} ORDER BY value DESC, label DESC LIMIT 1`,
    answer: (rows) => rows[0] ? `${rows[0].label} had the highest count: ${fmt(rows[0].value)} recorded crashes.${partialNote(f)}` : noData,
  }),
  byHour: (f) => ({
    title: "When recorded crashes happen", render: "bar",
    caption: "Crashes by hour, split into weekdays and weekends.",
    sql: `SELECT crash_hour AS label,
      SUM(CASE WHEN day_of_week IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekend,
      SUM(CASE WHEN day_of_week NOT IN ('Saturday','Sunday') THEN 1 ELSE 0 END) AS weekday
      FROM ${T} ${where(f)} GROUP BY crash_hour ORDER BY crash_hour`,
    answer: (rows) => ["weekday", "weekend"].map((key) => {
      const peak = top(rows, key);
      return peak && Number(peak[key]) > 0 ? `${titleCase(key)} crashes peak at ${peak.label}:00 (${fmt(peak[key])} crashes).` : `No ${key} crashes match these filters.`;
    }).join(" "),
  }),
  safestTime: (f) => ({
    title: "Hours with the fewest recorded crashes", render: "bar", series: "hour",
    caption: "Includes hours with zero records. Raw counts do not measure cycling risk.",
    sql: `${hourlyCounts(f)} ORDER BY value, label LIMIT 10`,
    answer: (rows) => rows[0] ? `${rows[0].label}:00 had ${fmt(rows[0].value)} recorded crashes, the lowest hourly count (ties may occur).` : noData,
  }),
  rushHour: (f) => {
    const filter = { ...f, period: f.period || "commute" };
    return {
      title: `${titleCase(filter.period)} hours`, render: "bar", series: "hour",
      caption: "Morning: 07:00–09:59; evening: 16:00–18:59. Includes weekends unless filtered.",
      sql: `${hourlyCounts(filter)} ORDER BY label`,
      answer: (rows) => {
        const peak = top(rows), total = rows.reduce((n, r) => n + Number(r.value), 0);
        return total ? `${fmt(total)} recorded crashes during these hours; the highest hourly count was ${fmt(peak.value)} at ${peak.label}:00.` : noData;
      },
    };
  },
  bySeverity: (f) => ({
    title: "Crash severity", render: "bar",
    caption: "Crash severity and percentage of matching crashes; these are not casualty counts.",
    sql: `SELECT severity AS label, COUNT(*) AS value, 100.0 * COUNT(*) / SUM(COUNT(*)) OVER () AS pct
      FROM ${T} ${where(f)} GROUP BY severity ORDER BY value DESC`,
    answer: (rows) => rows.length ? `Serious or fatal crashes make up ${pct(rows.filter((r) => ["Serious Injury", "Fatal"].includes(r.label)).reduce((n, r) => n + Number(r.pct), 0))} of matching recorded crashes.` : noData,
  }),
  byDayOfWeek: (f) => ({
    title: "Crashes by day of week", render: "bar", caption: "Recorded crashes by weekday.",
    sql: `SELECT day_of_week AS label, COUNT(*) AS value FROM ${T} ${where(f)} GROUP BY day_of_week
      ORDER BY array_position([${DAYS.map(sqlString).join(",")}], day_of_week)`,
    answer: (rows) => { const peak = top(rows); return peak ? `${peak.label} had the highest count: ${fmt(peak.value)} recorded crashes.` : noData; },
  }),
  byRoadGeometry: (f) => ({
    title: "Recorded crashes by intersection type", render: "bar",
    caption: 'Intersection geometry only; excludes "Not at intersection". These are counts, not risk rates.',
    sql: `SELECT road_geometry AS label, COUNT(*) AS value FROM ${T}
      ${where(f, ["road_geometry LIKE '%intersection%'", "road_geometry <> 'Not at intersection'"])}
      GROUP BY road_geometry ORDER BY value DESC, label`,
    answer: (rows) => rows[0] ? `${titleCase(rows[0].label)} had the highest count: ${fmt(rows[0].value)} recorded crashes.` : noData,
  }),
  filteredCount: (f) => ({
    title: "Matching recorded crashes", render: "stat", unit: "crashes",
    caption: "Distinct crashes matching all selected filters.",
    sql: `SELECT COUNT(*) AS value FROM ${T} ${where(f)}`,
    answer: (rows) => `${fmt(rows[0]?.value)} recorded crashes match these filters.`,
  }),
  fatalCount: (f) => ({
    title: "Fatal crashes", render: "stat", unit: "fatal crashes",
    caption: "Distinct crashes classified as fatal; this is not a count of people killed.",
    sql: `SELECT COUNT(*) AS value FROM ${T} ${where({ ...f, severity: "Fatal" })}`,
    answer: (rows) => `${fmt(rows[0]?.value)} recorded crashes were classified as fatal.`,
  }),
  council: ({ council, ...f }) => {
    const { min, max } = range(f), cond = `council_area = ${sqlString(council)}`;
    return {
      title: `${titleCase(council)} vs average council`, render: "line",
      caption: `Recorded crashes compared with the same ${COUNCILS.length} councils in each year.${partialNote(f)}`,
      sql: `WITH councils AS (${councilDimension}),
        years AS (SELECT range AS year FROM range(${min}, ${max + 1})),
        filtered AS (SELECT * FROM ${T} ${where(f)}),
        counts AS (SELECT council_area, year, COUNT(*) AS value FROM filtered GROUP BY council_area, year),
        annual AS (SELECT c.council_area, y.year, COALESCE(n.value, 0) AS value
          FROM councils c CROSS JOIN years y LEFT JOIN counts n USING (council_area, year)),
        totals AS (SELECT council_area, SUM(value) AS total FROM annual GROUP BY council_area),
        ranked AS (SELECT *, RANK() OVER (ORDER BY total DESC) AS rank,
          COUNT(*) OVER () AS councils, AVG(total) OVER () AS melbourne_avg_total FROM totals),
        comparisons AS (SELECT *, AVG(value) OVER (PARTITION BY year) AS melbourne_avg FROM annual)
        SELECT CAST(a.year AS VARCHAR) AS label, a.value, ROUND(a.melbourne_avg, 1) AS melbourne_avg,
          r.total, r.rank, r.councils, r.melbourne_avg_total
        FROM comparisons a JOIN ranked r USING (council_area) WHERE a.${cond} ORDER BY a.year`,
      answer: (rows) => { const r = rows[0]; return r ? `${titleCase(council)} had ${fmt(r.total)} recorded crashes, ranking ${r.rank} of ${r.councils} councils by count. The council average was ${fmt(Math.round(r.melbourne_avg_total))}.` : noData; },
    };
  },
};
// Always display the complete effective scope beside the answer.
export const queries = Object.fromEntries(Object.entries(builders).map(([name, build]) => [name, (f = {}) => {
  const spec = build(f);
  const scope = [`Years: ${rangeLabel(f)}`, ...filterLabels(f)].join(" · ");
  return { ...spec, caption: `${scope}. ${spec.caption}` };
}]));
