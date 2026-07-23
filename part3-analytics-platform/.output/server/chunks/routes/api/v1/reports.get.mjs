import { d as defineApiHandler, g as getApiQuery, a as db, s as sendOk } from '../../../_/api.mjs';
import { a as toBool, t as toInt } from '../../../_/common.mjs';
import { r as rowToReport } from '../../../_/mappers.mjs';
import '../../../nitro/nitro.mjs';
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
import '../../../_/constants.mjs';

const reports_get = defineApiHandler((event) => {
  const query = getApiQuery(event);
  const city = query.city || void 0;
  const district = query.district || void 0;
  const waterType = query.water_type || void 0;
  const realOnly = toBool(query.real_only, false);
  const limit = toInt(query.limit, 20, { min: 1, max: 200 });
  const offset = toInt(query.offset, 0, { min: 0 });
  const conditions = [];
  const params = { limit, offset };
  if (city) {
    conditions.push("city = @city");
    params.city = city;
  }
  if (district) {
    conditions.push("district = @district");
    params.district = district;
  }
  if (waterType) {
    conditions.push("water_type = @waterType");
    params.waterType = waterType;
  }
  if (realOnly) conditions.push("authenticity_confirmed = 1 AND is_seed = 0");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(params).n;
  const rows = db.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  return sendOk(event, {
    items: rows.map(rowToReport),
    total,
    limit,
    offset,
    filters: { city: city || null, district: district || null, water_type: waterType || null, real_only: realOnly }
  });
});

export { reports_get as default };
//# sourceMappingURL=reports.get.mjs.map
