import { d as defineApiHandler, a as db, A as ApiError, s as sendOk } from '../../../../../_/api.mjs';
import { a as analysisRow } from '../../../../../_/snapshots.mjs';
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
import '../../../../../_/common.mjs';
import '../../../../../_/mappers.mjs';
import '../../../../../_/constants.mjs';

const _id__get = defineApiHandler((event) => {
  const row = db.prepare("SELECT * FROM analysis_results WHERE id = ?").get(event.context.params.id);
  if (!row) throw new ApiError(1003, "analysis result not found", 404);
  return sendOk(event, analysisRow(row));
});

export { _id__get as default };
//# sourceMappingURL=_id_.get.mjs.map
