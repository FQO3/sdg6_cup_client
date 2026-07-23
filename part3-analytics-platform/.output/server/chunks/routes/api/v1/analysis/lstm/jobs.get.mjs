import { d as defineApiHandler, g as getApiQuery, a as db, s as sendOk } from '../../../../../_/api.mjs';
import { t as toInt } from '../../../../../_/common.mjs';
import { j as jobRow } from '../../../../../_/snapshots.mjs';
import '../../../../../nitro/nitro.mjs';
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
import '../../../../../_/mappers.mjs';
import '../../../../../_/constants.mjs';

const jobs_get = defineApiHandler((event) => {
  const query = getApiQuery(event);
  const limit = toInt(query.limit, 50, { min: 1, max: 200 });
  const status = query.status || void 0;
  const conditions = ["job_type = 'lstm_analysis'"];
  const params = { limit };
  if (status) {
    conditions.push("status = @status");
    params.status = status;
  }
  const rows = db.prepare(`
    SELECT * FROM analysis_jobs
    WHERE ${conditions.join(" AND ")}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit
  `).all(params);
  return sendOk(event, { jobs: rows.map(jobRow), limit });
});

export { jobs_get as default };
//# sourceMappingURL=jobs.get.mjs.map
