import { db } from '../../../../../../src/db.js';
import { ApiError } from '../../../../../../src/utils/response.js';
import { defineApiHandler, sendOk } from '../../../../../utils/api.js';
import { jobRow } from '../../../../../utils/snapshots.js';

export default defineApiHandler((event) => {
  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_id = ?').get(event.context.params.job_id);
  if (!row) throw new ApiError(1003, 'analysis job not found', 404);
  return sendOk(event, jobRow(row));
});
