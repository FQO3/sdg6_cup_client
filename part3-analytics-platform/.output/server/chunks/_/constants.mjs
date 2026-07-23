const WATER_TYPES = [
  "tap",
  "river",
  "lake",
  "well",
  "purified",
  "mineral",
  "boiled",
  "other"
];
const GB_GRADES = ["\u2160\u7C7B", "\u2161\u7C7B", "\u2162\u7C7B", "\u2163\u7C7B", "\u2164\u7C7B", "\u52A3\u2165\u7C7B"];
function gradeColor(index) {
  return ["#1565c0", "#42a5f5", "#66bb6a", "#ffb300", "#ef6c00", "#c62828"][index] || "#9e9e9e";
}

export { GB_GRADES as G, WATER_TYPES as W, gradeColor as g };
//# sourceMappingURL=constants.mjs.map
