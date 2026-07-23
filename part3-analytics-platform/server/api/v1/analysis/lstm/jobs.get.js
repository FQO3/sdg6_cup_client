import { db } from '../../../../../src/db.js';
import { toInt } from '../../../../../src/utils/common.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../../utils/api.js';
import { jobRow } from '../../../../utils/snapshots.js';

export default defineApiHandler((event) => {
  const query = getApiQuery(event);
  const limit = toInt(query.limit, 50, { min: 1, max: 200 });
  const status = query.status || undefined;
  const conditions = ["job_type = 'lstm_analysis'"];
  const params = { limit };
  if (status) { conditions.push('status = @status'); params.status = status; }
  const rows = db.prepare(`
    SELECT * FROM analysis_jobs
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit
  `).all(params);
  return sendOk(event, { jobs: rows.map(jobRow), limit });
});
