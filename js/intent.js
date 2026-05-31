// Lightweight intent parser: maps plain-English input to a query builder name.
// Pure (no DOM) so the eval harness can exercise it directly in Node.
//
// Returns null when nothing matches, so callers can show "did you mean" cards.
// Shape: { builder, params, year, matchedOn }
//   builder  – key into queries.js
//   params   – extra args for the builder (e.g. { council })
//   year     – { min, max } override from the text, or null
//   matchedOn– short reason string (used by eval + debugging)

// 31 LGAs present in the normalised data. Matching is on these council names only;
// the dataset has no suburb column, so "Brunswick" maps to its council.
export const COUNCILS = [
  "MELBOURNE", "YARRA", "PORT PHILLIP", "STONNINGTON", "DAREBIN",
  "BAYSIDE", "BOROONDARA", "GLEN EIRA", "KINGSTON", "MOONEE VALLEY",
  "MORNINGTON PENINSULA", "MONASH", "HOBSONS BAY", "MARIBYRNONG", "BANYULE",
  "WHITEHORSE", "DANDENONG", "WYNDHAM", "FRANKSTON", "BRIMBANK", "WHITTLESEA",
  "CASEY", "KNOX", "YARRA RANGES", "MAROONDAH", "HUME", "MANNINGHAM",
  "NILLUMBIK", "MELTON", "MERRI-BEK", "CARDINIA",
];

// A few well-known suburb -> council aliases so common searches resolve.
const SUBURB_ALIASES = {
  moreland: "MERRI-BEK",
  "merri bek": "MERRI-BEK",
  "merri-bek": "MERRI-BEK",
  brunswick: "MERRI-BEK",
  coburg: "MERRI-BEK",
  fitzroy: "YARRA",
  richmond: "YARRA",
  collingwood: "YARRA",
  "st kilda": "PORT PHILLIP",
  prahran: "STONNINGTON",
  "south yarra": "STONNINGTON",
  cbd: "MELBOURNE",
  "melb city": "MELBOURNE",
  "city of melbourne": "MELBOURNE",
  carlton: "MELBOURNE",
  docklands: "MELBOURNE",
  footscray: "MARIBYRNONG",
  northcote: "DAREBIN",
  preston: "DAREBIN",
  hawthorn: "BOROONDARA",
  brighton: "BAYSIDE",
};

function extractYear(text) {
  const since = text.match(/\bsince\s+(20\d{2})\b/);
  if (since) {
    const y = +since[1];
    if (y >= 2012 && y <= 2025) return { min: y, max: 2025 };
  }

  const after = text.match(/\bafter\s+(20\d{2})\b/);
  if (after) {
    const y = +after[1] + 1;
    if (y >= 2012 && y <= 2025) return { min: y, max: 2025 };
  }

  const before = text.match(/\bbefore\s+(20\d{2})\b/);
  if (before) {
    const y = +before[1] - 1;
    if (y >= 2012 && y <= 2025) return { min: 2012, max: y };
  }

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
const hasWord = (t, word) => new RegExp(`\\b${word}\\b`).test(t);

function findDay(text) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const day = days.find((d) => text.includes(d));
  return day ? day[0].toUpperCase() + day.slice(1) : null;
}

function findHour(text) {
  const m = text.match(/\b([01]?\d|2[0-3])\s*(am|pm)?\b/);
  if (!m) return null;
  let hour = +m[1];
  if (m[2] === "pm" && hour < 12) hour += 12;
  if (m[2] === "am" && hour === 12) hour = 0;
  return hour;
}

function unsupportedMessage(text) {
  if (has(text, "near me", "nearby", "near ")) {
    return "I can't answer live nearby searches from this static dataset. Try a council or suburb alias, like \"Yarra\" or \"Brunswick\".";
  }
  if (has(text, "station", "street", "road name", "sydney road")) {
    return "I can't search exact stations or street names because this dataset is summarised by council area, not address or road name.";
  }
  if (has(text, "per capita", "per cyclist", "per km", "rate", "population")) {
    return "I can show raw crash counts, but not true risk rates because this dataset has no population, cycling-volume, or road-length denominator.";
  }
  if (has(text, "helmet", "bike lane", "school zone")) {
    return "I can't answer that from the available columns. This explorer supports council, year, severity, time, weekday, and intersection-geometry questions.";
  }
  return null;
}

export function parseIntent(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  const year = extractYear(text);
  const council = findCouncil(text);

  // Order matters: most specific intents first.
  if (has(text, "non-fatal", "non fatal", "not fatal"))
    return {
      builder: "filteredCount",
      params: { council, notSeverity: "Fatal", label: "non-fatal crashes" },
      year,
      matchedOn: "non-fatal",
    };

  if (has(text, "fatal", "death", "killed", "died")) {
    if (council)
      return {
        builder: "filteredCount",
        params: { council, severity: "Fatal", label: "fatal crashes" },
        year,
        matchedOn: "fatal-council",
      };
    return { builder: "fatalCount", params: {}, year, matchedOn: "fatal" };
  }

  if (has(text, "serious", "injur") && council)
    return {
      builder: "filteredCount",
      params: { council, severity: "Serious Injury", label: "serious injury crashes" },
      year,
      matchedOn: "serious-council",
    };

  if (has(text, "serious", "severity", "how serious", "injur"))
    return { builder: "bySeverity", params: {}, year, matchedOn: "severity" };

  if (has(text, "intersection", "road", "junction", "roundabout"))
    return { builder: "byRoadGeometry", params: { council }, year, matchedOn: "road" };

  if (has(text, "trend", "over time", "safer", "getting", "by year", "each year", "yearly"))
    return { builder: "yearlyTrend", params: {}, year, matchedOn: "trend" };

  if (has(text, "safest time", "safest hour", "safe time", "least dangerous time")) {
    const period = has(text, "weekend", "saturday", "sunday") ? "weekend" :
      has(text, "weekday", "monday", "tuesday", "wednesday", "thursday", "friday") ? "weekday" : "all";
    return { builder: "safestTime", params: { period }, year, matchedOn: "safest-time" };
  }

  if (has(text, "rush hour", "commute") || hasWord(text, "morning") || hasWord(text, "evening")) {
    const period = hasWord(text, "morning") ? "morning" :
      hasWord(text, "evening") ? "evening" : "commute";
    return { builder: "rushHour", params: { period }, year, matchedOn: "rush-hour" };
  }

  if ((has(text, "what time", "time of day", "hour", "when do", "when are", "weekend") ||
       (has(text, "most dangerous", "dangerous", "worst") && has(text, "time", "times", "hour", "hours"))) &&
      !has(text, "intersection", "road", "junction", "roundabout"))
    return { builder: "byHour", params: { council }, year, matchedOn: "time" };

  const day = findDay(text);
  if (day && !has(text, "day of week", "which day", "what day"))
    return {
      builder: "filteredCount",
      params: { council, day, label: `${day} crashes` },
      year,
      matchedOn: "specific-day",
    };

  const hour = findHour(text);
  if (hour != null && has(text, "crash", "crashes"))
    return {
      builder: "filteredCount",
      params: { council, hour, label: `${hour}:00 crashes` },
      year,
      matchedOn: "specific-hour",
    };

  if (has(text, "day of week", "which day", "what day", "weekday"))
    return { builder: "byDayOfWeek", params: {}, year, matchedOn: "day" };

  if (has(text, "safest", "safe", "least dangerous", "fewest crashes", "lowest crashes"))
    return { builder: "safestCouncils", params: {}, year, matchedOn: "safest" };

  if (has(text, "worst", "most dangerous", "dangerous", "most crashes",
                "top", "council", "suburb", "area"))
    return { builder: "worstCouncils", params: {}, year, matchedOn: "worst" };

  if (council)
    return { builder: "council", params: { council }, year, matchedOn: "council" };

  // A year range with no other signal -> show the trend over that range.
  if (year) return { builder: "yearlyTrend", params: {}, year, matchedOn: "year-only" };

  const message = unsupportedMessage(text);
  if (message) return { unsupported: true, message, matchedOn: "unsupported" };

  return null;
}
