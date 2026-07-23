import { d as defineApiHandler, g as getApiQuery, a as db, s as sendOk } from '../../../../_/api.mjs';
import { a as toBool, t as toInt } from '../../../../_/common.mjs';
import { m as markerFromRow } from '../../../../_/mappers.mjs';
import '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'better-sqlite3';
import 'dotenv';
import '../../../../_/constants.mjs';

const points_get = defineApiHandler((event) => {
  const query = getApiQuery(event);
  const city = query.city || void 0;
  const district = query.district || void 0;
  const gradeMax = query.grade_max === void 0 ? void 0 : Number.parseInt(query.grade_max, 10);
  const realOnly = toBool(query.real_only, false);
  const limit = toInt(query.limit, 500, { min: 1, max: 2e3 });
  const conditions = [];
  const params = { limit };
  if (city) {
    conditions.push("city = @city");
    params.city = city;
  }
  if (district) {
    conditions.push("district = @district");
    params.district = district;
  }
  if (Number.isInteger(gradeMax)) {
    conditions.push("grade_index <= @gradeMax");
    params.gradeMax = gradeMax;
  }
  if (realOnly) conditions.push("authenticity_confirmed = 1 AND is_seed = 0");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC
    LIMIT @limit
  `).all(params);
  return sendOk(event, { markers: rows.map(markerFromRow), count: rows.length });
});

export { points_get as default };
//# sourceMappingURL=points.get.mjs.map
