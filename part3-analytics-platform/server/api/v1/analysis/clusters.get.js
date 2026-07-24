import { getClusterRun } from '~~/src/services/kmeansCluster.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../utils/api.js';
import { ApiError } from '~~/src/utils/response.js';

export default defineApiHandler((event) => {
  const query = getApiQuery(event);
  const result = getClusterRun(query.run_uuid || null);
  if (!result) throw new ApiError(1004, 'cluster run not found; execute POST /api/v1/analysis/clusters/kmeans first', 404);
  return sendOk(event, result);
});