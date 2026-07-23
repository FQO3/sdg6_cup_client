import { ApiError } from '../../../../src/utils/response.js';
import { defineApiHandler, sendOk } from '../../../utils/api.js';
import { getReportById } from '../../../utils/mappers.js';

export default defineApiHandler((event) => {
  const reportId = event.context.params.report_id;
  const report = getReportById(reportId);
  if (!report) throw new ApiError(1003, 'report not found', 404);
  return sendOk(event, report);
});
