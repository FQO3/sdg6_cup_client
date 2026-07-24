import { db } from '~~/src/db.js';
import { clearLlmRecords } from '~~/src/services/llmClient.js';
import { defineApiHandler, sendOk } from '../../../utils/api.js';

export default defineApiHandler(async (event) => {
  const llmResult = await clearLlmRecords();
  const localInfo = db.prepare('DELETE FROM analysis_results').run();
  return sendOk(event, {
    llm_status: llmResult?.status || 'ok',
    llm_deleted: llmResult?.deleted ?? null,
    local_deleted: localInfo.changes || 0
  }, 'llm database cleared');
});