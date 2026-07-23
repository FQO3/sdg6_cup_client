import { db } from '../../../../../src/db.js';
import { config } from '../../../../../src/config.js';
import { makeId, nowIso, toBool, toInt } from '../../../../../src/utils/common.js';
import { defineApiHandler, sendOk } from '../../../../utils/api.js';
import { jobRow, runLstmJob } from '../../../../utils/snapshots.js';

export default defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
  const region = body.region || config.defaultCity;
  const limit = toInt(body.limit, 300, { min: 20, max: 5000 });
  const noCache = toBool(body.no_cache, false);
  const jobId = makeId('job_lstm');
  const createdAt = nowIso();
  const request = { region, limit, no_cache: noCache };

  db.prepare(`
    INSERT INTO analysis_jobs (
      job_id, job_type, scope_type, scope_id, status, progress, request_json, created_at
    ) VALUES (?, 'lstm_analysis', 'region', ?, 'pending', 0, ?, ?)
  `).run(jobId, region, JSON.stringify(request), createdAt);

  setImmediate(() => runLstmJob(jobId));

  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_id = ?').get(jobId);
  return sendOk(event, jobRow(row), 'accepted', 202);
});
