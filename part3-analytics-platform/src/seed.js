import { db, initDb } from './db.js';
import { nowIso } from './utils/common.js';
import { GB_GRADES, WATER_TYPES } from './utils/constants.js';

initDb();

const districts = [
  { name: '东城区', lat: 39.9288, lng: 116.4164, bias: 0.5 },
  { name: '西城区', lat: 39.9123, lng: 116.3659, bias: 0.7 },
  { name: '朝阳区', lat: 39.9219, lng: 116.4431, bias: 1.1 },
  { name: '海淀区', lat: 39.9593, lng: 116.2977, bias: 0.8 },
  { name: '丰台区', lat: 39.8584, lng: 116.2869, bias: 1.4 },
  { name: '石景山区', lat: 39.9056, lng: 116.2229, bias: 1.2 },
  { name: '通州区', lat: 39.9027, lng: 116.6564, bias: 1.5 },
  { name: '昌平区', lat: 40.2207, lng: 116.2312, bias: 0.9 },
  { name: '大兴区', lat: 39.7269, lng: 116.3414, bias: 1.6 },
  { name: '顺义区', lat: 40.1289, lng: 116.6546, bias: 0.8 },
  { name: '房山区', lat: 39.7479, lng: 116.1433, bias: 1.7 },
  { name: '密云区', lat: 40.3774, lng: 116.8432, bias: 0.4 }
];

function pseudoRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gradeFromMetrics({ ph, tds, turbidity, ec }, bias) {
  let score = bias;
  if (ph < 6.5 || ph > 8.5) score += 1.2;
  if (tds > 600) score += 1.0;
  if (tds > 1000) score += 1.2;
  if (turbidity > 1) score += 1.0;
  if (turbidity > 5) score += 1.4;
  if (ec > 1200) score += 0.8;
  if (ec > 2000) score += 1.2;
  const gradeIndex = clamp(Math.round(score), 0, 5);
  return { gradeIndex, grade: GB_GRADES[gradeIndex] };
}

function sampleFor(base, i) {
  return {
    seq: i + 1,
    temperature: Number((base.temperature + (pseudoRandom(i * 11) - 0.5) * 0.8).toFixed(2)),
    ph: Number((base.ph + (pseudoRandom(i * 13) - 0.5) * 0.12).toFixed(2)),
    tds: Number((base.tds + (pseudoRandom(i * 17) - 0.5) * 18).toFixed(2)),
    turbidity: Number((base.turbidity + (pseudoRandom(i * 19) - 0.5) * 0.16).toFixed(2)),
    ec: Number((base.ec + (pseudoRandom(i * 23) - 0.5) * 28).toFixed(2))
  };
}

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

const seed = db.transaction(() => {
  let count = 0;
  for (let d = 0; d < districts.length; d += 1) {
    const district = districts[d];
    for (let i = 0; i < 4; i += 1) {
      const index = d * 4 + i + 1;
      const waterType = WATER_TYPES[(d + i) % (WATER_TYPES.length - 1)];
      const lat = Number((district.lat + (pseudoRandom(index * 3) - 0.5) * 0.06).toFixed(6));
      const lng = Number((district.lng + (pseudoRandom(index * 5) - 0.5) * 0.06).toFixed(6));
      const base = {
        temperature: 18 + pseudoRandom(index * 7) * 12,
        ph: clamp(7.1 + (pseudoRandom(index * 9) - 0.5) * 1.7 + (district.bias - 1) * 0.18, 5.8, 9.2),
        tds: clamp(140 + pseudoRandom(index * 10) * 820 + district.bias * 120, 45, 1500),
        turbidity: clamp(0.2 + pseudoRandom(index * 12) * 3.2 + district.bias * 0.35, 0.05, 8.5),
        ec: clamp(220 + pseudoRandom(index * 14) * 1400 + district.bias * 160, 80, 2600)
      };
      const samples = Array.from({ length: 20 }, (_, n) => sampleFor(base, index * 100 + n));
      const avg = samples.reduce((acc, item) => {
        acc.temperature += item.temperature;
        acc.ph += item.ph;
        acc.tds += item.tds;
        acc.turbidity += item.turbidity;
        acc.ec += item.ec;
        return acc;
      }, { temperature: 0, ph: 0, tds: 0, turbidity: 0, ec: 0 });
      for (const key of Object.keys(avg)) avg[key] = Number((avg[key] / samples.length).toFixed(2));
      const grade = gradeFromMetrics(avg, district.bias);
      const measuredAt = new Date(Date.now() - index * 18 * 3600 * 1000).toISOString();
      const createdAt = nowIso();
      const result = insert.run({
        report_id: `seed_bj_${String(index).padStart(3, '0')}`,
        device_id: `seed-cup-${String((d % 4) + 1).padStart(2, '0')}`,
        lat,
        lng,
        city: 'beijing',
        district: district.name,
        address: `北京市${district.name}演示采样点 ${i + 1}`,
        water_type: waterType,
        tds: avg.tds,
        ph: avg.ph,
        temperature: avg.temperature,
        turbidity: avg.turbidity,
        ec: avg.ec,
        grade: grade.grade,
        grade_index: grade.gradeIndex,
        authenticity_confirmed: 0,
        user_note: 'Hackathon 演示种子数据，不代表真实水质结论。',
        raw_samples_json: JSON.stringify(samples),
        capture_json: JSON.stringify({ stable_samples: 20, discarded_samples: 0, stability_note: 'seed data generated with low variance' }),
        is_seed: 1,
        measured_at: measuredAt,
        created_at: createdAt
      });
      count += result.changes;
    }
  }
  return count;
});

const inserted = seed();
const total = db.prepare('SELECT COUNT(*) AS n FROM reports').get().n;
console.log(`Seed complete. Inserted ${inserted} new rows. Total reports: ${total}`);
