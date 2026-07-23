import { reverseGeocode } from '~~/src/services/amapClient.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../utils/api.js';
import { ApiError } from '~~/src/utils/response.js';

export default defineApiHandler(async (event) => {
  const query = getApiQuery(event);
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(1001, 'lat and lng are required numbers', 400);
  }
  const result = await reverseGeocode(lat, lng);
  return sendOk(event, result);
});
