import { d as defineApiHandler, a as db, A as ApiError, s as sendOk } from '../../../../../../_/api.mjs';
import { j as jobRow } from '../../../../../../_/snapshots.mjs';
import '../../../../../../nitro/nitro.mjs';
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
import '../../../../../../_/common.mjs';
import '../../../../../../_/mappers.mjs';
import '../../../../../../_/constants.mjs';

const _job_id__get = defineApiHandler((event) => {
  const row = db.prepare("SELECT * FROM analysis_jobs WHERE job_id = ?").get(event.context.params.job_id);
  if (!row) throw new ApiError(1003, "analysis job not found", 404);
  return sendOk(event, jobRow(row));
});

export { _job_id__get as default };
//# sourceMappingURL=_job_id_.get.mjs.map
