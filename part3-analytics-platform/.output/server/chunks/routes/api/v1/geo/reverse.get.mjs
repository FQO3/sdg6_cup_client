import { c as config, A as ApiError, d as defineApiHandler, g as getApiQuery, s as sendOk } from '../../../../_/api.mjs';
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

async function reverseGeocode(lat, lng) {
  var _a, _b;
  if (!config.amap.key) {
    throw new ApiError(1002, "AMAP_KEY is required for reverse geocoding", 400);
  }
  const url = new URL(config.amap.reverseUrl);
  url.searchParams.set("key", config.amap.key);
  url.searchParams.set("location", `${lng},${lat}`);
  url.searchParams.set("extensions", "base");
  url.searchParams.set("output", "json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.amap.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json();
    if (payload.status !== "1") {
      throw new ApiError(3001, `AMAP reverse geocode failed: ${payload.info || "unknown error"}`, 502, payload);
    }
    const component = ((_a = payload.regeocode) == null ? void 0 : _a.addressComponent) || {};
    return {
      formatted_address: ((_b = payload.regeocode) == null ? void 0 : _b.formatted_address) || "",
      country: component.country || null,
      province: component.province || null,
      city: Array.isArray(component.city) ? null : component.city,
      district: component.district || null,
      township: component.township || null,
      raw: payload
    };
  } catch (error) {
    if (error.name === "AbortError") throw new ApiError(3002, "AMAP reverse geocode timeout", 504);
    if (error instanceof ApiError) throw error;
    throw new ApiError(3001, `AMAP reverse geocode unavailable: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

const reverse_get = defineApiHandler(async (event) => {
  const query = getApiQuery(event);
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(1001, "lat and lng are required numbers", 400);
  }
  const result = await reverseGeocode(lat, lng);
  return sendOk(event, result);
});

export { reverse_get as default };
//# sourceMappingURL=reverse.get.mjs.map
