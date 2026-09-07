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

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const has = (text, ...phrases) => phrases.some((phrase) =>
  new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
const unsupported = (message) => ({ unsupported: true, message, matchedOn: "unsupported" });

function extractYear(text) {
  const years = [...text.matchAll(/\b((?:19|20|21)\d{2})\b/g)].map((m) => +m[1]);
  if (!years.length) return null;
  if (years.length > 2 || years.some((y) => y < 2012 || y > 2025))
    return unsupported("The available data covers 2012 to 31 July 2025. Please choose years within that coverage.");
  const comparisons = [...text.matchAll(/\b(since|after|before)\s+((?:19|20|21)\d{2})\b/g)];
  if (comparisons.length && years.length !== 1)
    return unsupported("Please specify one year comparison or a single range, such as 2018–2020.");
  let min = Math.min(...years), max = Math.max(...years);
  if (comparisons.length) {
    const [, op, value] = comparisons[0], year = +value;
    min = op === "before" ? 2012 : year + (op === "after" ? 1 : 0);
    max = op === "before" ? year - 1 : 2025;
  }
  if (min > max) return unsupported("There are no covered years in that interval. Data covers 2012 to 31 July 2025.");
  return { min, max };
}

function findCouncils(text) {
  // Match the longest phrases first, removing matched text so South Yarra
  // doesn't also match Yarra. Word boundaries avoid accidental substrings.
  const names = [...Object.entries(SUBURB_ALIASES), ...COUNCILS.map((c) => [c.toLowerCase(), c])]
    .sort((a, b) => b[0].length - a[0].length);
  const found = new Set();
  let remaining = text;
  for (const [name, council] of names) {
    const pattern = new RegExp(`\\b${name}\\b`, "g");
    if (pattern.test(remaining)) {
      found.add(council);
      remaining = remaining.replace(pattern, " ");
    }
  }
  return [...found];
}

function unsupportedMessage(text) {
  if (has(text, "near me", "nearby", "near"))
    return "Nearby searches aren't supported. Try a council or a supported suburb alias, such as Yarra or Brunswick.";
  if (has(text, "station", "stations", "street", "streets", "road name", "sydney road"))
    return "Exact streets and stations aren't searchable. Try a council or an intersection-geometry question.";
  if (has(text, "per capita", "per cyclist", "per km", "rate", "rates", "population"))
    return "Only raw crash counts are available. Risk rates need population or cycling-exposure data that this extract does not contain.";
  if (has(text, "helmet", "helmets", "bike lane", "bike lanes", "school zone", "school zones"))
    return "That detail isn't available. Try council, year, severity, hour, weekday, or intersection geometry.";
  if (has(text, "minor", "slight"))
    return 'There is no minor-injury category in this extract. Try "other injury", "serious injury", or "injury severity".';
  return null;
}

function extractHours(text) {
  if (/\b\d{1,2}:(?!00)\d{2}/.test(text))
    return unsupported("This explorer groups time by whole hours. Try 8am or between 8am and 10am.");
  text = text.replace(/\b(\d{1,2}):00\s*/g, "$1");
  const matches = [...text.matchAll(/\b(\d{1,2})\s*(am|pm)\b/g)];
  const at = text.match(/\bat\s+(\d{1,2})\b(?!\s*(?:am|pm))/);
  if (/\b(?:between|from)\s+\d{1,2}\b/.test(text) && matches.length !== 2 ||
      /\b\d{1,2}\s*(?:am|pm)?\s*[-–]\s*\d{1,2}\s*(?:am|pm)\b/.test(text))
    return unsupported("Please write both hours explicitly, such as between 8am and 10am.");
  if (!matches.length && at) matches.push([at[0], at[1], null]);
  if (!matches.length) return {};
  const hours = matches.map(([, value, suffix]) => {
    const hour = +value;
    if (suffix && (hour < 1 || hour > 12) || !suffix && hour > 23) return null;
    return suffix ? hour % 12 + (suffix === "pm" ? 12 : 0) : hour;
  });
  if (hours.some((h) => h == null)) return unsupported("Please use valid hours, such as 8am or 16:00.");
  if (hours.length === 1) return { hour: hours[0] };
  if (hours.length !== 2 || !/\b(?:between|from)\b/.test(text) || hours[0] > hours[1])
    return unsupported("Please use one hour or an ascending range, such as between 8am and 10am. Overnight ranges aren't supported.");
  return { hourMin: hours[0], hourMax: hours[1] };
}

export function parseIntent(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  const message = unsupportedMessage(text);
  if (message) return unsupported(message);
  const year = extractYear(text);
  if (year?.unsupported) return year;
  const councils = findCouncils(text);
  if (councils.length > 1) return unsupported("Please search one council at a time; council-to-council comparisons aren't supported.");
  const params = {};
  if (councils.length) params.council = councils[0];
  const days = DAYS.filter((day) => has(text, day));
  if (days.length > 1) return unsupported("Please choose one named weekday, or use weekdays or weekends.");
  if (days.length) params.day = days[0];
  if (has(text, "weekend", "weekends")) params.dayPeriod = "weekend";
  if (has(text, "weekday", "weekdays")) {
    if (params.dayPeriod) return unsupported("Please choose weekdays or weekends separately.");
    params.dayPeriod = "weekday";
  }
  if (params.day && params.dayPeriod &&
      (DAYS.indexOf(params.day) >= 5) !== (params.dayPeriod === "weekend"))
    return unsupported("The named day conflicts with the requested weekday/weekend filter.");
  const hours = extractHours(text);
  if (hours.unsupported) return hours;
  Object.assign(params, hours);

  const nonFatal = has(text, "non-fatal", "non fatal", "not fatal");
  const fatal = !nonFatal && has(text, "fatal", "fatality", "fatalities", "death", "deaths", "killed", "died");
  const serious = has(text, "serious") && !has(text, "how serious");
  const other = /\bother injur(?:y|ies)\b/.test(text);
  if ([nonFatal || fatal, serious, other].filter(Boolean).length > 1 ||
      /\b(?:not|non)[ -](?:serious|other)\b/.test(text))
    return unsupported("Please choose one severity category, or ask for an injury-severity breakdown.");
  if (nonFatal) params.notSeverity = "Fatal";
  if (fatal) params.severity = "Fatal";
  if (serious) params.severity = "Serious Injury";
  if (other) params.severity = "Other Injury";

  // Aggregation is chosen only after all supported dimensions are collected.
  const result = (builder, matchedOn) => ({ builder, params, year, matchedOn });
  if (has(text, "most dangerous year", "worst year", "most crashes year", "year had the most"))
    return result("dangerousYears", "dangerous-year");
  if (has(text, "trend", "over time", "safer", "getting", "by year", "each year", "yearly"))
    return result("yearlyTrend", "trend");
  if (has(text, "intersection", "intersections", "road", "roads", "junction", "roundabout"))
    return result("byRoadGeometry", "road");
  if (has(text, "safest time", "safest times", "safest hour", "safe time", "least dangerous time"))
    return result("safestTime", "safest-time");
  if (has(text, "rush hour", "commute", "morning", "evening")) {
    params.period = has(text, "morning") ? "morning" : has(text, "evening") ? "evening" : "commute";
    return result("rushHour", "rush-hour");
  }
  if (has(text, "day of week", "which day", "what day")) return result("byDayOfWeek", "day");
  if (has(text, "what time", "time of day", "hour", "hours", "when do", "when are", "dangerous times", "dangerous time"))
    return result("byHour", "time");
  if (!params.council && has(text, "safest", "safe", "least dangerous", "fewest crashes", "lowest crashes"))
    return result("safestCouncils", "safest");
  if (!params.council && has(text, "worst", "most dangerous", "dangerous", "most crashes", "top", "council", "councils", "suburb", "suburbs", "area", "areas"))
    return result("worstCouncils", "worst");
  if (params.severity === "Fatal" && Object.keys(params).length === 1) return result("fatalCount", "fatal");
  if (params.severity || params.notSeverity || params.day || params.hour != null || params.hourMin != null)
    return result("filteredCount", "filtered-count");
  if (has(text, "severity", "how serious", "injury", "injuries")) return result("bySeverity", "severity");
  if (params.dayPeriod) return result(params.dayPeriod === "weekend" ? "byHour" : "byDayOfWeek", "day-period");
  if (params.council) return result("council", "council");
  if (year) return result("yearlyTrend", "year-only");
  return null;
}
