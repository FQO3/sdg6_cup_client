import { runWaterQualityKMeans } from '~~/src/services/kmeansCluster.js';
import { toBool, toInt } from '~~/src/utils/common.js';
import { defineApiHandler, sendOk } from '../../../../utils/api.js';

export default defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
  const result = await runWaterQualityKMeans({
    city: body.city || undefined,
    district: body.district || undefined,
    realOnly: toBool(body.real_only, false),
    limit: toInt(body.limit, 800, { min: 2, max: 5000 }),
    geoK: toInt(body.geo_k, 0, { min: 0, max: 36 }),
    waterK: toInt(body.water_k, 4, { min: 1, max: 12 }),
    maxSpatialK: toInt(body.max_spatial_k, 800, { min: 1, max: 5000 }),
    geoMaxRadiusM: toInt(body.geo_max_radius_m ?? body.geo_max_diameter_m, 1000, { min: 100, max: 10000 }),
    geocode: toBool(body.geocode, true)
  });
  return sendOk(event, result, 'clustered', 201);
});