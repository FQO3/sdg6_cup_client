import { db } from '~~/src/db.js';
import { ApiError } from '~~/src/utils/response.js';
import { defineApiHandler, sendOk } from '../../../../utils/api.js';
import { analysisRow } from '../../../../utils/snapshots.js';

export default defineApiHandler((event) => {
  const row = db.prepare('SELECT * FROM analysis_results WHERE id = ?').get(event.context.params.id);
  if (!row) throw new ApiError(1003, 'analysis result not found', 404);
  return sendOk(event, analysisRow(row));
});
