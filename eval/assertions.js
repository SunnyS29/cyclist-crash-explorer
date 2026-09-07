// The browser and Node harnesses use the same checks.
function equal(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
export function matches(c, got) {
  if (c.expectNull) return got === null;
  if (c.expectUnsupported) return got?.unsupported === true && typeof got.message === "string" && got.message.length > 0;
  return Boolean(got && !got.unsupported && got.builder === c.builder &&
    (!Object.hasOwn(c, "council") || got.params?.council === c.council) &&
    (!Object.hasOwn(c, "params") || equal(got.params, c.params)) &&
    (!Object.hasOwn(c, "year") || equal(got.year, c.year)));
}
