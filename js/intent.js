// Lightweight intent parser: maps plain-English input to a query builder name.
// Pure (no DOM) so the eval harness can exercise it directly in Node.
//
// Returns null when nothing matches, so callers can show "did you mean" cards.
// Shape: { builder, params, year, matchedOn }
//   builder  – key into queries.js
//   params   – extra args for the builder (e.g. { council })
//   year     – { min, max } override from the text, or null
//   matchedOn– short reason string (used by eval + debugging)

// 32 LGAs present in the data. Matching is on these council names only;
// the dataset has no suburb column, so "Brunswick" maps to its council.
export const COUNCILS = [
  "MELBOURNE", "YARRA", "PORT PHILLIP", "MORELAND", "STONNINGTON", "DAREBIN",
  "BAYSIDE", "BOROONDARA", "GLEN EIRA", "KINGSTON", "MOONEE VALLEY",
  "MORNINGTON PENINSULA", "MONASH", "HOBSONS BAY", "MARIBYRNONG", "BANYULE",
  "WHITEHORSE", "DANDENONG", "WYNDHAM", "FRANKSTON", "BRIMBANK", "WHITTLESEA",
  "CASEY", "KNOX", "YARRA RANGES", "MAROONDAH", "HUME", "MANNINGHAM",
  "NILLUMBIK", "MELTON", "MERRI-BEK", "CARDINIA",
];

// A few well-known suburb -> council aliases so common searches resolve.
const SUBURB_ALIASES = {
  brunswick: "MERRI-BEK",
  coburg: "MERRI-BEK",
  fitzroy: "YARRA",
  richmond: "YARRA",
  collingwood: "YARRA",
  "st kilda": "PORT PHILLIP",
  prahran: "STONNINGTON",
  "south yarra": "STONNINGTON",
  carlton: "MELBOURNE",
  docklands: "MELBOURNE",
  northcote: "DAREBIN",
  brighton: "BAYSIDE",
};

function extractYear(text) {
  const ys = [...text.matchAll(/\b(20\d{2})\b/g)]
    .map((m) => +m[1])
    .filter((y) => y >= 2012 && y <= 2025);
  if (!ys.length) return null;
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

function findCouncil(text) {
  const t = text.toLowerCase();
  for (const [sub, lga] of Object.entries(SUBURB_ALIASES)) {
    if (t.includes(sub)) return lga;
  }
  // Longest council names first so "PORT PHILLIP" wins over "PORT".
  const byLen = [...COUNCILS].sort((a, b) => b.length - a.length);
  for (const c of byLen) {
    if (t.includes(c.toLowerCase())) return c;
  }
  return null;
}

const has = (t, ...words) => words.some((w) => t.includes(w));

export function parseIntent(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  const year = extractYear(text);

  // Order matters: most specific intents first.
  if (has(text, "fatal", "death", "killed", "died"))
    return { builder: "fatalCount", params: {}, year, matchedOn: "fatal" };

  if (has(text, "serious", "severity", "how serious", "injur"))
    return { builder: "bySeverity", params: {}, year, matchedOn: "severity" };

  if (has(text, "intersection", "road", "junction", "roundabout"))
    return { builder: "byRoadGeometry", params: {}, year, matchedOn: "road" };

  if (has(text, "trend", "over time", "safer", "getting", "by year", "each year", "yearly"))
    return { builder: "yearlyTrend", params: {}, year, matchedOn: "trend" };

  if (has(text, "rush hour", "morning", "evening", "commute", "what time",
                "time of day", "hour", "when do", "when are", "weekend"))
    return { builder: "byHour", params: {}, year, matchedOn: "time" };

  if (has(text, "day of week", "which day", "what day", "weekday"))
    return { builder: "byDayOfWeek", params: {}, year, matchedOn: "day" };

  if (has(text, "worst", "most dangerous", "dangerous", "most crashes",
                "top", "council", "suburb", "area"))
    return { builder: "worstCouncils", params: {}, year, matchedOn: "worst" };

  // Bare place name, e.g. "Brunswick" or "Port Phillip".
  const council = findCouncil(text);
  if (council)
    return { builder: "council", params: { council }, year, matchedOn: "council" };

  // A year range with no other signal -> show the trend over that range.
  if (year) return { builder: "yearlyTrend", params: {}, year, matchedOn: "year-only" };

  return null;
}
