import { db } from '~~/src/db.js';
import { toInt } from '~~/src/utils/common.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../utils/api.js';
import { analysisRow } from '../../../utils/snapshots.js';

export default defineApiHandler((event) => {
  const query = getApiQuery(event);
  const limit = toInt(query.limit, 50, { min: 1, max: 500 });
  const offset = toInt(query.offset, 0, { min: 0 });
  const region = query.region || undefined;
  const conditions = [];
  const params = { limit, offset };
  if (region) { conditions.push('region = @region'); params.region = region; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM analysis_results
    ${where}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  return sendOk(event, { records: rows.map(analysisRow), limit, offset });
});
