import { db, initDb } from './db.js';
import { nowIso } from './utils/common.js';
import { GB_GRADES, WATER_TYPES } from './utils/constants.js';

initDb();

// ═══════════════════════════════════════════════════════════════════════════
// 种子数据生成模型（分档聚类）
//   signal : 每个区域归入 1 个水质档次 tier，tier 决定 [ph/tds/turbidity/ec] 中心。
//   noise  : 采样点 = 区域中心 + 小高斯抖动；raw_samples = 采样点 + 微高斯。
//   目标   : 10 档水质从极优到很差逐步劣化，相邻档自然重叠，拟真分布。
//
//   water 聚类特征 = [tds, ec, turbidity, ph]（z-score 归一化），等权。
//   每区 18 采样点 × 12 区 = 216 条。
// ═══════════════════════════════════════════════════════════════════════════

// 10 档水质：从极优到很差逐步劣化，相邻档中心间距小、有自然重叠
// spread 随档次递增（水质越差波动越大，拟真）
const TIERS = [
  { key: 't0-pristine',  center: { ph: 7.08, tds: 110, turbidity: 0.28, ec: 190 },  spread: { ph: 0.06, tds: 10, turbidity: 0.05, ec: 15 } },
  { key: 't1-excellent', center: { ph: 7.15, tds: 160, turbidity: 0.48, ec: 270 },  spread: { ph: 0.06, tds: 12, turbidity: 0.06, ec: 18 } },
  { key: 't2-good',      center: { ph: 7.22, tds: 220, turbidity: 0.72, ec: 370 },  spread: { ph: 0.07, tds: 14, turbidity: 0.07, ec: 21 } },
  { key: 't3-fair',      center: { ph: 7.30, tds: 295, turbidity: 1.05, ec: 490 },  spread: { ph: 0.07, tds: 16, turbidity: 0.08, ec: 24 } },
  { key: 't4-average',   center: { ph: 7.38, tds: 375, turbidity: 1.45, ec: 625 },  spread: { ph: 0.08, tds: 18, turbidity: 0.09, ec: 28 } },
  { key: 't5-marginal',  center: { ph: 7.47, tds: 465, turbidity: 1.95, ec: 780 },  spread: { ph: 0.08, tds: 20, turbidity: 0.10, ec: 32 } },
  { key: 't6-below-avg', center: { ph: 7.58, tds: 570, turbidity: 2.55, ec: 960 },  spread: { ph: 0.09, tds: 24, turbidity: 0.12, ec: 38 } },
  { key: 't7-poor',      center: { ph: 7.72, tds: 700, turbidity: 3.30, ec: 1180 }, spread: { ph: 0.10, tds: 28, turbidity: 0.14, ec: 45 } },
  { key: 't8-bad',       center: { ph: 7.90, tds: 850, turbidity: 4.10, ec: 1450 }, spread: { ph: 0.11, tds: 32, turbidity: 0.17, ec: 52 } },
  { key: 't9-critical',  center: { ph: 8.15, tds: 1020, turbidity: 5.00, ec: 1750 }, spread: { ph: 0.12, tds: 38, turbidity: 0.20, ec: 60 } }
];

// 12 区分配至 10 档：密云最干净，房山/大兴最差
// 大部分档各 1 区，末两档各 2 区（水质差区域更密集，拟真）
const districts = [
  { name: '密云区',   lat: 40.3774, lng: 116.8432, tier: 0 },
  { name: '东城区',   lat: 39.9288, lng: 116.4164, tier: 1 },
  { name: '西城区',   lat: 39.9123, lng: 116.3659, tier: 2 },
  { name: '海淀区',   lat: 39.9593, lng: 116.2977, tier: 3 },
  { name: '顺义区',   lat: 40.1289, lng: 116.6546, tier: 4 },
  { name: '昌平区',   lat: 40.2207, lng: 116.2312, tier: 5 },
  { name: '朝阳区',   lat: 39.9219, lng: 116.4431, tier: 6 },
  { name: '石景山区', lat: 39.9056, lng: 116.2229, tier: 7 },
  { name: '丰台区',   lat: 39.8584, lng: 116.2869, tier: 8 },
  { name: '通州区',   lat: 39.9027, lng: 116.6564, tier: 8 },
  { name: '大兴区',   lat: 39.7269, lng: 116.3414, tier: 9 },
  { name: '房山区',   lat: 39.7479, lng: 116.1433, tier: 9 }
];

const POINTS_PER_DISTRICT = 18;
const RAW_SAMPLE_COUNT = 20;

// ---------------------------------------------------------------------------
// 可复现 PRNG：mulberry32 + Box–Muller 高斯
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rand) {
  return function gaussian() {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function gradeFromMetrics({ ph, tds, turbidity, ec }) {
  let score = 0;
  if (ph < 6.5 || ph > 8.5) score += 1.2;
  else if (ph > 8.0) score += 0.6;
  if (tds > 300) score += 0.8;
  if (tds > 600) score += 1.0;
  if (tds > 1000) score += 1.0;
  if (turbidity > 1) score += 0.8;
  if (turbidity > 3) score += 1.0;
  if (ec > 800) score += 0.6;
  if (ec > 1400) score += 1.0;
  const gradeIndex = clamp(Math.round(score), 0, 5);
  return { gradeIndex, grade: GB_GRADES[gradeIndex] };
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------
const insert = db.prepare(`
  INSERT OR IGNORE INTO reports (
    report_id, device_id, lat, lng, city, district, address, water_type,
    tds, ph, temperature, turbidity, ec, grade, grade_index,
    authenticity_confirmed, user_note, raw_samples_json, capture_json,
    is_seed, measured_at, created_at
  ) VALUES (
    @report_id, @device_id, @lat, @lng, @city, @district, @address, @water_type,
    @tds, @ph, @temperature, @turbidity, @ec, @grade, @grade_index,
    @authenticity_confirmed, @user_note, @raw_samples_json, @capture_json,
    @is_seed, @measured_at, @created_at
  )
`);

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const seed = db.transaction(() => {
  let count = 0;
  let globalIndex = 0;

  for (let d = 0; d < districts.length; d += 1) {
    const district = districts[d];
    const tier = TIERS[district.tier];

    // 区域级 RNG：每个区一个稳定中心（tier 中心 + 极小区域偏移）
    const districtRand = mulberry32(1000 + d * 97);
    const districtG = makeGaussian(districtRand);
    const districtCenter = {
      ph:        tier.center.ph        + districtG() * tier.spread.ph        * 0.4,
      tds:       tier.center.tds       + districtG() * tier.spread.tds       * 0.4,
      turbidity: tier.center.turbidity + districtG() * tier.spread.turbidity * 0.4,
      ec:        tier.center.ec        + districtG() * tier.spread.ec        * 0.4
    };

    for (let i = 0; i < POINTS_PER_DISTRICT; i += 1) {
      globalIndex += 1;
      const pointRand = mulberry32(500000 + d * 1000 + i);
      const pointG = makeGaussian(pointRand);

      // 采样点位置：区域中心附近散布（供 geo 聚类使用）
      const lat = round(district.lat + pointG() * 0.02, 6);
      const lng = round(district.lng + pointG() * 0.02, 6);

      // 采样点水质 = 区域中心 + 小高斯抖动（区域内方差 ≪ 档间方差）
      const base = {
        temperature: 16 + pointRand() * 12,
        ph:        clamp(districtCenter.ph        + pointG() * tier.spread.ph,        5.8, 9.2),
        tds:       clamp(districtCenter.tds       + pointG() * tier.spread.tds,       40, 1500),
        turbidity: clamp(districtCenter.turbidity + pointG() * tier.spread.turbidity, 0.05, 8.5),
        ec:        clamp(districtCenter.ec        + pointG() * tier.spread.ec,        80, 2600)
      };

      // 20 条 raw_samples：采样点中心 + 微高斯（模拟传感器读数噪声）
      const samples = Array.from({ length: RAW_SAMPLE_COUNT }, (_, n) => {
        const g = makeGaussian(mulberry32(9000000 + globalIndex * 100 + n));
        return {
          seq:         n + 1,
          temperature: round(base.temperature + g() * 0.15),
          ph:          round(base.ph          + g() * 0.02),
          tds:         round(base.tds         + g() * 3),
          turbidity:   round(base.turbidity   + g() * 0.03),
          ec:          round(base.ec          + g() * 4),
          wet:         true
        };
      });

      // 平均值
      const avg = samples.reduce((acc, item) => {
        acc.temperature += item.temperature;
        acc.ph          += item.ph;
        acc.tds         += item.tds;
        acc.turbidity   += item.turbidity;
        acc.ec          += item.ec;
        return acc;
      }, { temperature: 0, ph: 0, tds: 0, turbidity: 0, ec: 0 });
      for (const key of Object.keys(avg)) avg[key] = round(avg[key] / samples.length);

      const grade     = gradeFromMetrics(avg);
      const waterType = WATER_TYPES[(d + i) % (WATER_TYPES.length - 1)];
      const measuredAt = new Date(Date.now() - globalIndex * 6 * 3600 * 1000).toISOString();

      const result = insert.run({
        report_id:             `seed_bj_${String(globalIndex).padStart(3, '0')}`,
        device_id:             `seed-cup-${String((d % 4) + 1).padStart(2, '0')}`,
        lat,
        lng,
        city:                  'beijing',
        district:              district.name,
        address:               `北京市${district.name}演示采样点 ${i + 1}`,
        water_type:            waterType,
        tds:                   avg.tds,
        ph:                    avg.ph,
        temperature:           avg.temperature,
        turbidity:             avg.turbidity,
        ec:                    avg.ec,
        grade:                 grade.grade,
        grade_index:           grade.gradeIndex,
        authenticity_confirmed: 0,
        user_note:             'Hackathon 演示种子数据，不代表真实水质结论。',
        raw_samples_json:      JSON.stringify(samples),
        capture_json:          JSON.stringify({
          tier: tier.key,
          stable_samples:    RAW_SAMPLE_COUNT,
          discarded_samples: 0,
          stability_note:    'seed data: regional profile + low-variance Gaussian jitter'
        }),
        is_seed:               1,
        measured_at:           measuredAt,
        created_at:            nowIso()
      });
      count += result.changes;
    }
  }
  return count;
});

const inserted = seed();
const total = db.prepare('SELECT COUNT(*) AS n FROM reports').get().n;
console.log(`Seed complete. Inserted ${inserted} new rows. Total reports: ${total}`);
