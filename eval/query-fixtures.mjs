import { queries } from "../js/queries.js";
const fixtures = [];
for (const [name, build] of Object.entries(queries)) {
  for (const filters of [
    { yearMin: 2012, yearMax: 2025 },
    { yearMin: 2020, yearMax: 2024, council: "YARRA", severity: "Serious Injury", day: "Sunday", hourMin: 7, hourMax: 10 },
  ]) {
    const f = name === "council" ? { ...filters, council: filters.council || "YARRA" } : filters;
    fixtures.push({ name, f, sql: build(f).sql });
  }
}
for (const [name, f] of [
  ["safestCouncils", { yearMin: 2025, yearMax: 2025 }],
  ["council", { yearMin: 2025, yearMax: 2025, council: "CARDINIA" }],
  ["safestTime", { yearMin: 2025, yearMax: 2025, council: "CARDINIA" }],
  ["filteredCount", { yearMin: 2020, yearMax: 2025, council: "YARRA", notSeverity: "Fatal", hour: 8, dayPeriod: "weekend" }],
  ["rushHour", { yearMin: 2012, yearMax: 2025, council: "YARRA", day: "Sunday", period: "morning" }],
]) fixtures.push({ name, f, sql: queries[name](f).sql });
console.log(JSON.stringify(fixtures));
