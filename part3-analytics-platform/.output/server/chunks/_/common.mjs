function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function toBool(value, fallback = false) {
  if (value === void 0 || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
function toInt(value, fallback, { min = void 0, max = void 0 } = {}) {
  if (value === void 0 || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== void 0 && parsed < min) return min;
  if (max !== void 0 && parsed > max) return max;
  return parsed;
}
function safeJsonParse(value, fallback = null) {
  if (value === void 0 || value === null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function makeId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export { toBool as a, makeId as m, nowIso as n, safeJsonParse as s, toInt as t };
//# sourceMappingURL=common.mjs.map
