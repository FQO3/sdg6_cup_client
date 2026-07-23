import { config } from '../config.js';
import { ApiError } from '../utils/response.js';

export async function reverseGeocode(lat, lng) {
  if (!config.amap.key) {
    throw new ApiError(1002, 'AMAP_KEY is required for reverse geocoding', 400);
  }

  const url = new URL(config.amap.reverseUrl);
  url.searchParams.set('key', config.amap.key);
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('extensions', 'base');
  url.searchParams.set('output', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.amap.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (payload.status !== '1') {
      throw new ApiError(3001, `AMAP reverse geocode failed: ${payload.info || 'unknown error'}`, 502, payload);
    }
    const component = payload.regeocode?.addressComponent || {};
    return {
      formatted_address: payload.regeocode?.formatted_address || '',
      country: component.country || null,
      province: component.province || null,
      city: Array.isArray(component.city) ? null : component.city,
      district: component.district || null,
      township: component.township || null,
      raw: payload
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(3002, 'AMAP reverse geocode timeout', 504);
    if (error instanceof ApiError) throw error;
    throw new ApiError(3001, `AMAP reverse geocode unavailable: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
