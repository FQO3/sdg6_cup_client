import { d as defineApiHandler, g as getApiQuery, a as db, s as sendOk } from '../../../../_/api.mjs';
import { t as toInt } from '../../../../_/common.mjs';
import { a as analysisRow } from '../../../../_/snapshots.mjs';
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
import '../../../../_/mappers.mjs';
import '../../../../_/constants.mjs';

const records_get = defineApiHandler((event) => {
  const query = getApiQuery(event);
  const limit = toInt(query.limit, 50, { min: 1, max: 500 });
  const offset = toInt(query.offset, 0, { min: 0 });
  const region = query.region || void 0;
  const conditions = [];
  const params = { limit, offset };
  if (region) {
    conditions.push("region = @region");
    params.region = region;
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT * FROM analysis_results
    ${where}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  return sendOk(event, { records: rows.map(analysisRow), limit, offset });
});

export { records_get as default };
//# sourceMappingURL=records.get.mjs.map
