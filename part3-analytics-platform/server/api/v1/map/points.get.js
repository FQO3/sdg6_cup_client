import { db } from '~~/src/db.js';
import { toBool, toInt } from '~~/src/utils/common.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../utils/api.js';
import { markerFromRow } from '../../../utils/mappers.js';

export default defineApiHandler((event) => {
  const query = getApiQuery(event);
  const city = query.city || undefined;
  const district = query.district || undefined;
  const gradeMax = query.grade_max === undefined ? undefined : Number.parseInt(query.grade_max, 10);
  const realOnly = toBool(query.real_only, false);
  const limit = toInt(query.limit, 500, { min: 1, max: 2000 });

  const conditions = [];
  const params = { limit };
  if (city) { conditions.push('city = @city'); params.city = city; }
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (Number.isInteger(gradeMax)) { conditions.push('grade_index <= @gradeMax'); params.gradeMax = gradeMax; }
  if (realOnly) conditions.push('authenticity_confirmed = 1 AND is_seed = 0');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC
    LIMIT @limit
  `).all(params);

  return sendOk(event, { markers: rows.map(markerFromRow), count: rows.length });
});
