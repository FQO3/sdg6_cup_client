import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { nowIso } from '../utils/common.js';
import { ApiError } from '../utils/response.js';
import { gradeColor } from '../utils/constants.js';
import { reverseGeocode } from './amapClient.js';

const GEO_FIELDS = ['lat', 'lng'];
const WATER_FIELDS = ['tds', 'ec', 'turbidity', 'ph'];
const CLUSTER_COLORS = ['#68e1d0', '#ffb74a', '#ff5d3d', '#9b8cff', '#4ade80', '#38bdf8', '#f472b6', '#facc15'];
const GRADE_LABELS = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类'];
const GRADE_COLORS = ['#38bdf8', '#68e1d0', '#4ade80', '#facc15', '#ffb74a', '#ff5d3d'];
const POLYGON_PADDING_RATIO = 0.10;
const DEFAULT_GEO_MAX_RADIUS_M = 1000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function haversineMeters(a, b) {
  const toRad = (degree) => degree * Math.PI / 180;
  const radius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function normalizeGradeIndex(row) {
  const index = Number.parseInt(row.grade_index, 10);
  if (Number.isFinite(index)) return Math.max(1, Math.min(index, 6));
  const text = String(row.grade || '');
  if (text.includes('劣')) return 6;
  if (text.includes('Ⅴ') || text.includes('V')) return 5;
  if (text.includes('Ⅳ') || text.includes('IV')) return 4;
  if (text.includes('Ⅲ') || text.includes('III')) return 3;
  if (text.includes('Ⅱ') || text.includes('II')) return 2;
  return 1;
}

function buildReportQuery({ city, district, realOnly, limit }) {
  const conditions = [];
  const params = { limit };
  if (city) { conditions.push('city = @city'); params.city = city; }
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (realOnly) conditions.push('authenticity_confirmed = 1 AND is_seed = 0');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT report_id, lat, lng, city, district, address, water_type,
      tds, ph, temperature, turbidity, ec, grade, grade_index, measured_at
    FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC
    LIMIT @limit
  `).all(params).map((row) => ({
    ...row,
    lat: finiteNumber(row.lat),
    lng: finiteNumber(row.lng),
    tds: finiteNumber(row.tds),
    ph: finiteNumber(row.ph),
    turbidity: finiteNumber(row.turbidity),
    ec: finiteNumber(row.ec),
    grade_index: finiteNumber(row.grade_index)
  }));
}

function vectorize(rows, fields) {
  const usable = rows.filter((row) => fields.every((field) => Number.isFinite(row[field])));
  if (!usable.length) return { items: [], means: [], scales: [] };
  const means = fields.map((field) => average(usable.map((row) => row[field])) ?? 0);
  const scales = fields.map((field, index) => {
    const variance = average(usable.map((row) => (row[field] - means[index]) ** 2)) ?? 0;
    const std = Math.sqrt(variance);
    return std > 0 ? std : 1;
  });
  return {
    means,
    scales,
    items: usable.map((row) => ({
      row,
      vector: fields.map((field, index) => (row[field] - means[index]) / scales[index])
    }))
  };
}

function squaredDistance(a, b) {
  return a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0);
}

function chooseInitialCenters(items, k) {
  if (items.length <= k) return items.map((item) => [...item.vector]);
  const centers = [[...items[0].vector]];
  while (centers.length < k) {
    let candidate = items[0];
    let candidateDistance = -1;
    for (const item of items) {
      const nearestDistance = Math.min(...centers.map((center) => squaredDistance(item.vector, center)));
      if (nearestDistance > candidateDistance) {
        candidate = item;
        candidateDistance = nearestDistance;
      }
    }
    centers.push([...candidate.vector]);
  }
  return centers;
}

function runKMeans(items, requestedK, { maxIterations = 80 } = {}) {
  if (!items.length) return { assignments: [], centers: [] };
  const k = Math.max(1, Math.min(requestedK, items.length));
  let centers = chooseInitialCenters(items, k);
  let assignments = new Array(items.length).fill(-1);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    const buckets = Array.from({ length: k }, () => []);
    items.forEach((item, itemIndex) => {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centers.forEach((center, centerIndex) => {
        const distance = squaredDistance(item.vector, center);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = centerIndex;
        }
      });
      if (assignments[itemIndex] !== bestCluster) changed = true;
      assignments[itemIndex] = bestCluster;
      buckets[bestCluster].push(item.vector);
    });

    centers = centers.map((center, centerIndex) => {
      const bucket = buckets[centerIndex];
      if (!bucket.length) return center;
      return center.map((_, dimension) => average(bucket.map((vector) => vector[dimension])) ?? 0);
    });
    if (!changed) break;
  }

  return { assignments, centers };
}

function dynamicSpatialK(rows, maxK = 18) {
  if (rows.length <= 8) return 1;
  const center = {
    lat: average(rows.map((row) => row.lat)) ?? 0,
    lng: average(rows.map((row) => row.lng)) ?? 0
  };
  const distances = rows.map((row) => haversineMeters(center, row)).sort((a, b) => a - b);
  const p80 = distances[Math.floor(distances.length * 0.8)] || 0;
  const bySize = Math.ceil(rows.length / 10);
  const bySpread = Math.ceil(p80 / 900);
  return Math.max(1, Math.min(maxK, Math.max(bySize, bySpread)));
}

function clusterTightness(rows) {
  if (rows.length <= 1) return { max_pairwise_m: 0, radius_m: 0 };
  const center = {
    lat: average(rows.map((row) => row.lat)) ?? 0,
    lng: average(rows.map((row) => row.lng)) ?? 0
  };
  let maxPairwise = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      maxPairwise = Math.max(maxPairwise, haversineMeters(rows[left], rows[right]));
    }
  }
  return {
    max_pairwise_m: maxPairwise,
    radius_m: Math.max(...rows.map((row) => haversineMeters(center, row)))
  };
}

function runConstrainedGeoKMeans(items, { requestedK, maxK, maxRadiusM }) {
  const itemCount = items.length;
  if (!itemCount) return { assignments: [], k: 0, diagnostics: [] };
  const hardMaxK = Math.max(1, Math.min(maxK || itemCount, itemCount));
  const startK = Math.max(1, Math.min(requestedK || dynamicSpatialK(items.map((item) => item.row), hardMaxK), hardMaxK));
  let best = null;

  for (let k = startK; k <= hardMaxK; k += 1) {
    const result = runKMeans(items, k);
    const diagnostics = Array.from({ length: Math.max(...result.assignments) + 1 }, (_, clusterIndex) => {
      const rows = clusterRows(items, result.assignments, clusterIndex);
      return { clusterIndex, count: rows.length, ...clusterTightness(rows) };
    });
    best = { ...result, k, diagnostics };
    if (diagnostics.every((item) => item.radius_m <= maxRadiusM)) return best;
  }

  return best;
}

function cross(origin, a, b) {
  return (a.lng - origin.lng) * (b.lat - origin.lat) - (a.lat - origin.lat) * (b.lng - origin.lng);
}

function convexHull(points) {
  const unique = Array.from(new Map(points.map((point) => [`${point.lng},${point.lat}`, point])).values())
    .sort((a, b) => a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng);
  if (unique.length <= 1) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function buildSmallPolygon(rows, center) {
  const count = rows.length;
  const maxDistance = Math.max(90, ...rows.map((row) => haversineMeters(center, row)));
  const radiusMeters = Math.min(900, Math.max(140, maxDistance * 1.28));
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  const sides = count === 1 ? 6 : 8;
  return Array.from({ length: sides }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sides + Math.PI / sides;
    return [round(center.lng + Math.cos(angle) * lngDelta), round(center.lat + Math.sin(angle) * latDelta)];
  });
}

function paddedHullPolygon(rows, center) {
  const points = rows.map((row) => ({ lng: row.lng, lat: row.lat }));
  const hull = convexHull(points);
  if (hull.length < 3) return buildSmallPolygon(rows, center);
  return hull.map((point) => {
    const lng = point.lng + (point.lng - center.lng) * POLYGON_PADDING_RATIO;
    const lat = point.lat + (point.lat - center.lat) * POLYGON_PADDING_RATIO;
    return [round(lng), round(lat)];
  });
}

function dominantGradeIndex(rows) {
  const counts = rows.reduce((acc, row) => {
    const gradeIndex = normalizeGradeIndex(row);
    acc[gradeIndex] = (acc[gradeIndex] || 0) + 1;
    return acc;
  }, {});
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 1);
}

function summarizeRows(rows) {
  const avgGrade = average(rows.map((row) => row.grade_index));
  return {
    avg_grade_index: avgGrade === null ? null : round(avgGrade, 2),
    avg_tds: round(average(rows.map((row) => row.tds)), 2),
    avg_ec: round(average(rows.map((row) => row.ec)), 2),
    avg_turbidity: round(average(rows.map((row) => row.turbidity)), 2),
    avg_ph: round(average(rows.map((row) => row.ph)), 2),
    grade_distribution: rows.reduce((acc, row) => {
      const key = row.grade || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };
}

function clusterRows(items, assignments, clusterIndex) {
  return items.filter((_, itemIndex) => assignments[itemIndex] === clusterIndex).map((item) => item.row);
}

function createClusterRecord({ runUuid, type, index, rows, createdAt, location, label, color, gradeIndex = null, shape = 'polygon' }) {
  const centerLat = average(rows.map((row) => row.lat));
  const centerLng = average(rows.map((row) => row.lng));
  const center = { lat: centerLat ?? 0, lng: centerLng ?? 0 };
  const distances = rows.map((row) => haversineMeters(center, row));
  const radiusM = distances.length ? Math.max(...distances) : 0;
  const minLat = Math.min(...rows.map((row) => row.lat));
  const maxLat = Math.max(...rows.map((row) => row.lat));
  const minLng = Math.min(...rows.map((row) => row.lng));
  const maxLng = Math.max(...rows.map((row) => row.lng));
  const summary = summarizeRows(rows);
  const polygon = paddedHullPolygon(rows, center);
  return {
    cluster_uuid: randomUUID(),
    run_uuid: runUuid,
    cluster_type: type,
    cluster_index: index,
    label: label || `${type === 'geo' ? '地理位置' : '水质信息'}聚类 ${index + 1}`,
    center_lat: round(centerLat),
    center_lng: round(centerLng),
    radius_m: round(radiusM, 2),
    min_lat: round(minLat),
    max_lat: round(maxLat),
    min_lng: round(minLng),
    max_lng: round(maxLng),
    center_tds: round(average(rows.map((row) => row.tds)), 2),
    center_ph: round(average(rows.map((row) => row.ph)), 2),
    center_turbidity: round(average(rows.map((row) => row.turbidity)), 2),
    center_ec: round(average(rows.map((row) => row.ec)), 2),
    count: rows.length,
    color: color || CLUSTER_COLORS[index % CLUSTER_COLORS.length],
    location,
    summary: { ...summary, grade_index: gradeIndex, polygon, shape },
    created_at: createdAt,
    members: rows.map((row) => ({
      member_uuid: randomUUID(),
      run_uuid: runUuid,
      report_id: row.report_id,
      cluster_type: type,
      distance: type === 'geo' ? round(haversineMeters(center, row), 2) : null,
      report: reportForResponse(row)
    }))
  };
}

function reportForResponse(row) {
  return {
    report_id: row.report_id,
    position: [row.lng, row.lat],
    lat: row.lat,
    lng: row.lng,
    city: row.city,
    district: row.district,
    address: row.address,
    water_type: row.water_type,
    grade: row.grade,
    grade_index: row.grade_index,
    color: gradeColor(row.grade_index),
    metrics: { tds: row.tds, ec: row.ec, turbidity: row.turbidity, ph: row.ph, temperature: row.temperature },
    measured_at: row.measured_at
  };
}

async function enrichGeoLocations(clusters, enabled) {
  if (!enabled) return clusters;
  for (const cluster of clusters) {
    try {
      cluster.location = await reverseGeocode(cluster.center_lat, cluster.center_lng);
    } catch (error) {
      cluster.location = {
        formatted_address: cluster.members[0]?.report?.address || '',
        city: cluster.members[0]?.report?.city || null,
        district: cluster.members[0]?.report?.district || null,
        error: error.message
      };
    }
  }
  return clusters;
}

function insertRun({ runUuid, createdAt, options, inputCount, geoK, waterK }) {
  db.prepare(`
    INSERT INTO water_quality_cluster_runs (
      run_uuid, algorithm, scope_city, scope_district, real_only, input_count,
      geo_k, water_k, request_json, created_at
    ) VALUES (
      @run_uuid, 'k-means', @scope_city, @scope_district, @real_only, @input_count,
      @geo_k, @water_k, @request_json, @created_at
    )
  `).run({
    run_uuid: runUuid,
    scope_city: options.city || null,
    scope_district: options.district || null,
    real_only: options.realOnly ? 1 : 0,
    input_count: inputCount,
    geo_k: geoK,
    water_k: waterK,
    request_json: JSON.stringify(options),
    created_at: createdAt
  });
}

function clearClusterCache() {
  db.prepare('DELETE FROM water_quality_cluster_members').run();
  db.prepare('DELETE FROM water_quality_clusters').run();
  db.prepare('DELETE FROM water_quality_cluster_runs').run();
}

function insertClusters(clusters) {
  const insertCluster = db.prepare(`
    INSERT INTO water_quality_clusters (
      cluster_uuid, run_uuid, cluster_type, cluster_index, label,
      center_lat, center_lng, radius_m, min_lat, max_lat, min_lng, max_lng,
      center_tds, center_ph, center_turbidity, center_ec, count,
      location_json, summary_json, created_at
    ) VALUES (
      @cluster_uuid, @run_uuid, @cluster_type, @cluster_index, @label,
      @center_lat, @center_lng, @radius_m, @min_lat, @max_lat, @min_lng, @max_lng,
      @center_tds, @center_ph, @center_turbidity, @center_ec, @count,
      @location_json, @summary_json, @created_at
    )
  `);
  const insertMember = db.prepare(`
    INSERT INTO water_quality_cluster_members (
      member_uuid, run_uuid, cluster_uuid, report_id, cluster_type, distance, created_at
    ) VALUES (
      @member_uuid, @run_uuid, @cluster_uuid, @report_id, @cluster_type, @distance, @created_at
    )
  `);
  const transaction = db.transaction((records) => {
    for (const cluster of records) {
      insertCluster.run({
        ...cluster,
        location_json: JSON.stringify(cluster.location || null),
        summary_json: JSON.stringify({ ...cluster.summary, color: cluster.color })
      });
      for (const member of cluster.members) {
        insertMember.run({ ...member, cluster_uuid: cluster.cluster_uuid, created_at: cluster.created_at });
      }
    }
  });
  transaction(clusters);
}

function buildClusters({ items, assignments, type, runUuid, createdAt }) {
  const clusterCount = Math.max(...assignments) + 1;
  return Array.from({ length: clusterCount }, (_, index) => clusterRows(items, assignments, index))
    .filter((rows) => rows.length)
    .map((rows, index) => createClusterRecord({ runUuid, type, index, rows, createdAt, location: null }));
}

async function buildGeoClusters({ reports, normalized, runUuid, createdAt }) {
  const geoData = vectorize(reports, GEO_FIELDS);
  if (!geoData.items.length) return [];
  const result = runConstrainedGeoKMeans(geoData.items, {
    requestedK: normalized.geoK,
    maxK: normalized.maxSpatialK,
    maxRadiusM: normalized.geoMaxRadiusM
  });
  const clusters = buildClusters({ items: geoData.items, assignments: result.assignments, type: 'geo', runUuid, createdAt })
    .map((cluster, index) => ({
      ...cluster,
      label: `地理位置聚类 ${index + 1}`,
      color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
      summary: {
        ...cluster.summary,
        feature_fields: GEO_FIELDS,
        geo_max_radius_m: normalized.geoMaxRadiusM,
        max_pairwise_m: round(clusterTightness(cluster.members.map((member) => member.report)).max_pairwise_m, 2)
      }
    }));
  return enrichGeoLocations(clusters, normalized.geocode);
}

async function buildWaterQualityClusters({ reports, normalized, runUuid, createdAt }) {
  const waterData = vectorize(reports, WATER_FIELDS);
  if (!waterData.items.length) return [];
  const result = runKMeans(waterData.items, normalized.waterK);
  const clusters = buildClusters({ items: waterData.items, assignments: result.assignments, type: 'water_quality', runUuid, createdAt })
    .map((cluster, index) => {
      const gradeIndex = dominantGradeIndex(cluster.members.map((member) => member.report));
      const gradeLabel = GRADE_LABELS[gradeIndex - 1] || `${gradeIndex}类`;
      return {
        ...cluster,
        label: `水质信息聚类 ${index + 1} · 主要${gradeLabel}`,
        color: GRADE_COLORS[gradeIndex - 1] || CLUSTER_COLORS[index % CLUSTER_COLORS.length],
        summary: { ...cluster.summary, dominant_grade_index: gradeIndex, feature_fields: WATER_FIELDS }
      };
    });
  return enrichGeoLocations(clusters, normalized.geocode);
}

export async function runWaterQualityKMeans(options = {}) {
  const normalizedLimit = Math.max(2, Math.min(Number.parseInt(options.limit, 10) || 800, 5000));
  const normalized = {
    city: options.city || config.defaultCity,
    district: options.district || null,
    realOnly: Boolean(options.realOnly),
    limit: normalizedLimit,
    geoK: Math.max(0, Math.min(Number.parseInt(options.geoK, 10) || 0, 36)),
    waterK: Math.max(1, Math.min(Number.parseInt(options.waterK, 10) || 6, 36)),
    maxSpatialK: Math.max(1, Math.min(Number.parseInt(options.maxSpatialK, 10) || normalizedLimit, 5000)),
    geoMaxRadiusM: Math.max(100, Math.min(Number.parseFloat(options.geoMaxRadiusM ?? options.geoMaxDiameterM) || DEFAULT_GEO_MAX_RADIUS_M, 10000)),
    geocode: options.geocode !== false
  };

  const reports = buildReportQuery(normalized);
  if (reports.length < 1) throw new ApiError(1004, '至少需要 1 条报告才能执行地理/水质 K-Means 聚类', 400, { count: reports.length });

  const runUuid = randomUUID();
  const createdAt = nowIso();
  const geoClusters = await buildGeoClusters({ reports, normalized, runUuid, createdAt });
  const enrichedWaterClusters = await buildWaterQualityClusters({ reports, normalized, runUuid, createdAt });
  const allClusters = [...geoClusters, ...enrichedWaterClusters];
  const transaction = db.transaction(() => {
    clearClusterCache();
    insertRun({ runUuid, createdAt, options: normalized, inputCount: reports.length, geoK: geoClusters.length, waterK: enrichedWaterClusters.length });
    insertClusters(allClusters);
  });
  transaction();

  return formatRunResponse({
    run: {
      run_uuid: runUuid,
      algorithm: 'k-means',
      scope_city: normalized.city,
      scope_district: normalized.district,
      real_only: normalized.realOnly ? 1 : 0,
      input_count: reports.length,
      geo_k: geoClusters.length,
      water_k: enrichedWaterClusters.length,
      request_json: JSON.stringify(normalized),
      created_at: createdAt
    },
    clusters: allClusters
  });
}

export function getClusterRun(runUuid = null) {
  const run = runUuid
    ? db.prepare('SELECT * FROM water_quality_cluster_runs WHERE run_uuid = ?').get(runUuid)
    : db.prepare('SELECT * FROM water_quality_cluster_runs ORDER BY datetime(created_at) DESC, id DESC LIMIT 1').get();
  if (!run) return null;
  const clusters = db.prepare(`
    SELECT * FROM water_quality_clusters
    WHERE run_uuid = ?
    ORDER BY cluster_type ASC, cluster_index ASC
  `).all(run.run_uuid).map((row) => {
    const members = db.prepare(`
      SELECT m.*, r.lat, r.lng, r.city, r.district, r.address, r.water_type,
        r.tds, r.ph, r.temperature, r.turbidity, r.ec, r.grade, r.grade_index, r.measured_at
      FROM water_quality_cluster_members m
      JOIN reports r ON r.report_id = m.report_id
      WHERE m.cluster_uuid = ?
      ORDER BY m.distance ASC, r.measured_at DESC
    `).all(row.cluster_uuid).map((member) => ({
      member_uuid: member.member_uuid,
      report_id: member.report_id,
      cluster_type: member.cluster_type,
      distance: member.distance,
      report: reportForResponse(member)
    }));
    const summary = JSON.parse(row.summary_json || '{}');
    return {
      ...row,
      color: summary.color || CLUSTER_COLORS[row.cluster_index % CLUSTER_COLORS.length],
      location: JSON.parse(row.location_json || 'null'),
      summary,
      members
    };
  });
  return formatRunResponse({ run, clusters });
}

function formatCluster(cluster) {
  return {
    cluster_uuid: cluster.cluster_uuid,
    cluster_type: cluster.cluster_type,
    cluster_index: cluster.cluster_index,
    label: cluster.label,
    color: cluster.color,
    count: cluster.count,
    center: {
      lat: cluster.center_lat,
      lng: cluster.center_lng,
      tds: cluster.center_tds,
      ph: cluster.center_ph,
      turbidity: cluster.center_turbidity,
      ec: cluster.center_ec
    },
    bounds: {
      min_lat: cluster.min_lat,
      max_lat: cluster.max_lat,
      min_lng: cluster.min_lng,
      max_lng: cluster.max_lng,
      radius_m: cluster.radius_m
    },
    polygon: cluster.summary?.polygon || [],
    location: cluster.location,
    summary: cluster.summary,
    members: cluster.members
  };
}

function formatRunResponse({ run, clusters }) {
  return {
    run: {
      run_uuid: run.run_uuid,
      algorithm: run.algorithm,
      scope: {
        city: run.scope_city,
        district: run.scope_district,
        real_only: Boolean(run.real_only)
      },
      input_count: run.input_count,
      geo_k: run.geo_k,
      water_k: run.water_k,
      request: JSON.parse(run.request_json || '{}'),
      created_at: run.created_at
    },
    geo_clusters: clusters.filter((cluster) => cluster.cluster_type === 'geo').map(formatCluster),
    water_quality_clusters: clusters.filter((cluster) => cluster.cluster_type === 'water_quality').map(formatCluster)
  };
}