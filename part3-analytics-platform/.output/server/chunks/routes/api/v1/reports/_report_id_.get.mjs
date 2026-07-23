import { d as defineApiHandler, A as ApiError, s as sendOk } from '../../../../_/api.mjs';
import { g as getReportById } from '../../../../_/mappers.mjs';
import '../../../../nitro/nitro.mjs';
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
import '../../../../_/common.mjs';
import '../../../../_/constants.mjs';

const _report_id__get = defineApiHandler((event) => {
  const reportId = event.context.params.report_id;
  const report = getReportById(reportId);
  if (!report) throw new ApiError(1003, "report not found", 404);
  return sendOk(event, report);
});

export { _report_id__get as default };
//# sourceMappingURL=_report_id_.get.mjs.map
