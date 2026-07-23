import { r as readBody } from '../../../../../nitro/nitro.mjs';
import { d as defineApiHandler, c as config, a as db, s as sendOk } from '../../../../../_/api.mjs';
import { t as toInt, a as toBool, m as makeId, n as nowIso } from '../../../../../_/common.mjs';
import { r as runLstmJob, j as jobRow } from '../../../../../_/snapshots.mjs';
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

const jobs_post = defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
  const region = body.region || config.defaultCity;
  const limit = toInt(body.limit, 300, { min: 20, max: 5e3 });
  const noCache = toBool(body.no_cache, false);
  const jobId = makeId("job_lstm");
  const createdAt = nowIso();
  const request = { region, limit, no_cache: noCache };
  db.prepare(`
    INSERT INTO analysis_jobs (
      job_id, job_type, scope_type, scope_id, status, progress, request_json, created_at
    ) VALUES (?, 'lstm_analysis', 'region', ?, 'pending', 0, ?, ?)
  `).run(jobId, region, JSON.stringify(request), createdAt);
  setImmediate(() => runLstmJob(jobId));
  const row = db.prepare("SELECT * FROM analysis_jobs WHERE job_id = ?").get(jobId);
  return sendOk(event, jobRow(row), "accepted", 202);
});

export { jobs_post as default };
//# sourceMappingURL=jobs.post.mjs.map
