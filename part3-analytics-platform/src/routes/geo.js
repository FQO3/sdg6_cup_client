import { Router } from 'express';
import { ok, asyncHandler } from '../utils/response.js';
import { reverseGeocode } from '../services/amapClient.js';

export const geoRouter = Router();

geoRouter.get('/reverse', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ code: 1001, message: 'lat and lng are required numbers', data: null });
  }
  const result = await reverseGeocode(lat, lng);
  res.json(ok(result));
}));
