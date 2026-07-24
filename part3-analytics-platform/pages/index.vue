<template>
  <main class="observatory">
    <div class="grain"></div>
    <a class="deerflow-mark" href="https://deerflow.tech" target="_blank" rel="noreferrer">Created By Deerflow</a>

    <section class="hero reveal" style="--delay: 0ms">
      <div>
        <p class="eyebrow">SDG6 · Civic Water Intelligence</p>
        <h1>Aqua Civic Observatory</h1>
        <p class="lede">把水杯端上传的 20 次稳定原始采样，转化为地图态势、NGO 行动提案与时序风险判断。</p>
      </div>
      <div class="hero-actions">
        <button class="ink-btn" @click="refreshAll">刷新态势</button>
        <button class="ghost-btn cluster" @click="runKMeansClustering" :disabled="clusterLoading">{{ clusterLoading ? 'K-Means 聚类中…' : '地理/水质 K-Means' }}</button>
        <button class="ghost-btn" @click="createRegionInsight" :disabled="insightLoading">{{ insightLoading ? 'LLM 生成中…' : '生成区域提案' }}</button>
        <button class="ghost-btn hot" @click="startLstmJob" :disabled="lstmLoading">{{ lstmLoading ? 'LSTM 排队中…' : '启动时序分析' }}</button>
      </div>
    </section>

    <section class="kpi-grid reveal" style="--delay: 120ms">
      <article class="kpi-card"><span>检测报告</span><strong>{{ kpis.total_reports ?? '—' }}</strong><em>reports</em></article>
      <article class="kpi-card"><span>真实水体</span><strong>{{ kpis.real_reports ?? '—' }}</strong><em>confirmed</em></article>
      <article class="kpi-card"><span>达标率</span><strong>{{ percent(kpis.pass_rate) }}</strong><em>GB grade ≤ Ⅲ</em></article>
      <article class="kpi-card danger"><span>污染警报</span><strong>{{ kpis.polluted_count ?? '—' }}</strong><em>grade ≥ Ⅳ</em></article>
    </section>

    <section class="command-grid">
      <div class="map-panel reveal" style="--delay: 220ms">
        <div class="panel-head">
          <div>
            <p class="eyebrow">AMAP Situation Layer</p>
            <h2>北京水质点位散点图</h2>
          </div>
          <span class="live-dot">{{ amapReady ? 'AMAP ONLINE' : 'FALLBACK VIEW' }}</span>
        </div>
        <div id="amap" class="amap-canvas">
          <div v-if="!amapReady" class="fallback-map">
            <svg class="fallback-polygons" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon v-for="c in clusterPolygons" :key="c.cluster_uuid" :points="fallbackPolygonPoints(c)" :fill="`${c.color}18`" :stroke="c.color" stroke-width="0.55" stroke-linejoin="round" />
            </svg>
            <button v-for="m in markers.slice(0, 24)" :key="m.report_id" class="fallback-dot" :style="dotStyle(m)" @click.stop="selectMapPoint(m)" :aria-label="`查看 ${pointPlaceLabel(m)} 点位信息`"></button>
          </div>
          <div v-if="selectedMapPoint" class="point-popover" :style="{ '--point-color': selectedMapPoint.color || '#68e1d0' }" @click.stop>
            <div class="point-popover-head">
              <div>
                <p class="eyebrow">Selected Sample Point</p>
                <h3>{{ pointPlaceLabel(selectedMapPoint) }}</h3>
              </div>
              <button class="popover-close" @click="selectedMapPoint = null" aria-label="关闭点位信息">×</button>
            </div>
            <dl class="point-detail-list">
              <div><dt>经纬度</dt><dd>{{ fixed(selectedMapPoint.lat) }}, {{ fixed(selectedMapPoint.lng) }}</dd></div>
              <div><dt>实际地点</dt><dd>{{ pointAddressLabel(selectedMapPoint) }}</dd></div>
            </dl>
            <div class="point-metrics">
              <span><b>TDS</b>{{ metricValue(selectedMapPoint, 'tds') }}</span>
              <span><b>EC</b>{{ metricValue(selectedMapPoint, 'ec') }}</span>
              <span><b>TBD</b>{{ metricValue(selectedMapPoint, 'turbidity') }}</span>
              <span><b>PH</b>{{ metricValue(selectedMapPoint, 'ph') }}</span>
            </div>
            <button class="ghost-btn point-report-btn" @click="createPointInsight(selectedMapPoint.report_id)" :disabled="insightLoading">
              {{ insightLoading ? 'LLM 报告生成中…' : '生成该点 LLM 报告' }}
            </button>
          </div>
        </div>
        <div class="map-legend">
          <span v-for="g in gradeDistribution" :key="g.grade" :style="{ '--c': g.color }"><i></i>{{ g.grade }} · {{ g.count }}</span>
        </div>
        <div v-if="clusterRun" class="cluster-strip">
          <span>Run: {{ clusterRun.run_uuid.slice(0, 8) }}</span>
          <span>地理聚类 {{ geoClusters.length }} 组</span>
          <span>TDS/EC/浊度/pH 聚类 {{ waterClusters.length }} 组</span>
          <span>地图仅圈地理聚类 · 半径≤1000m</span>
        </div>
      </div>

      <aside class="intel-panel reveal" style="--delay: 300ms">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">District Aggregation</p>
            <h2>区域基金优先级</h2>
          </div>
        </div>
        <div class="district-list">
          <article v-for="d in districts" :key="d.district" class="district-row">
            <div><b>{{ d.district }}</b><span>{{ d.count }} samples</span></div>
            <meter min="0" max="5" :value="d.avg_grade_index || 0"></meter>
            <strong>{{ fixed(d.avg_grade_index) }}</strong>
          </article>
        </div>
        <div v-if="geoClusters.length || waterClusters.length" class="cluster-list">
          <h3>地理 + 水质信息聚类结果</h3>
          <article v-for="c in [...geoClusters, ...waterClusters]" :key="c.cluster_uuid" class="cluster-row" :style="{ '--c': c.color }">
            <div>
              <b>{{ c.label }}</b>
              <span>{{ c.cluster_type === 'geo' ? '地图圈定地理相近点' : '按 TDS/EC/浊度/pH 相似分组' }} · {{ c.count }} samples</span>
              <small>{{ locationLabel(c) }}</small>
            </div>
            <strong>{{ fixed(c.summary?.avg_grade_index) }}</strong>
          </article>
        </div>
      </aside>
    </section>

    <section class="lower-grid">
      <article class="feed-panel reveal" style="--delay: 380ms">
        <div class="panel-head compact"><div><p class="eyebrow">Report Stream</p><h2>最新稳定采样报告</h2></div></div>
        <div class="report-feed">
          <button v-for="r in reports" :key="r.report_id" class="report-item" @click="createPointInsight(r.report_id)">
            <span class="grade-pill" :style="{ background: r.grade_color }">{{ r.grade }}</span>
            <div><b>{{ r.location.district || r.location.city || 'unknown' }}</b><small>{{ waterLabel(r.water_type) }} · pH {{ r.metrics.ph }} · TDS {{ r.metrics.tds ?? '—' }}</small></div>
            <time>{{ shortTime(r.measured_at) }}</time>
          </button>
        </div>
      </article>

      <article class="ai-panel reveal" style="--delay: 460ms">
        <div class="panel-head compact">
          <div><p class="eyebrow">LLM + LSTM Orchestration</p><h2>外部模型回传</h2></div>
          <button class="ghost-btn danger small" @click="clearLlmData" :disabled="llmClearLoading">
            {{ llmClearLoading ? '清空中…' : '清空 LLM 数据' }}
          </button>
        </div>
        <div class="status-strip">
          <span>LLM: {{ insightLoading ? 'running' : 'ready' }}</span>
          <span>LSTM: {{ latestJob?.status || 'idle' }}</span>
        </div>
        <div class="markdown-card">
          <p v-if="!latestInsight">点击“生成区域提案”后，我方 Nitro 会把聚合快照发给队友 LLM 服务，并缓存 Markdown 报告。</p>
          <pre v-else>{{ latestInsight.content }}</pre>
        </div>
        <div v-if="latestJob" class="job-card">
          <div><b>{{ latestJob.job_id }}</b><span>{{ latestJob.status }} · {{ latestJob.progress }}%</span></div>
          <pre>{{ latestJob.result ? JSON.stringify(latestJob.result, null, 2) : latestJob.error_message || '等待 LSTM 服务返回时序分析结果…' }}</pre>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup>
const config = useRuntimeConfig();
const markers = ref([]);
const districts = ref([]);
const reports = ref([]);
const gradeDistribution = ref([]);
const kpis = ref({});
const latestInsight = ref(null);
const latestJob = ref(null);
const clusterRun = ref(null);
const geoClusters = ref([]);
const waterClusters = ref([]);
const selectedMapPoint = ref(null);
const insightLoading = ref(false);
const lstmLoading = ref(false);
const clusterLoading = ref(false);
const llmClearLoading = ref(false);
const amapReady = ref(false);
let map;
let mapMarkers = [];
let mapClusterOverlays = [];
let pollTimer;
const clusterPolygons = computed(() => geoClusters.value.filter((cluster) => Array.isArray(cluster.polygon) && cluster.polygon.length >= 3));

const waterNames = { tap: '自来水', river: '河水', lake: '湖水', well: '井水/地下水', purified: '纯净水/过滤水', mineral: '矿泉水', boiled: '煮沸后的水', other: '其他' };
const waterLabel = (type) => waterNames[type] || type;
const percent = (v) => typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
const fixed = (v) => typeof v === 'number' ? v.toFixed(2) : '—';
const shortTime = (t) => t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function pointPlaceLabel(point) {
  return point?.district || point?.city || point?.address || '未知点位';
}

function pointAddressLabel(point) {
  return point?.address || [point?.city, point?.district].filter(Boolean).join(' · ') || '暂无地址信息';
}

function metricValue(point, field) {
  const value = point?.metrics?.[field];
  return typeof value === 'number' ? value.toFixed(field === 'ph' ? 2 : 1) : '—';
}

function selectMapPoint(point) {
  selectedMapPoint.value = point;
}

function dotStyle(m) {
  const lng = Number(m.lng || 116.4);
  const lat = Number(m.lat || 39.9);
  return {
    left: `${Math.max(8, Math.min(92, ((lng - 115.6) / 1.7) * 100))}%`,
    top: `${Math.max(8, Math.min(92, (1 - ((lat - 39.45) / 1.25)) * 100))}%`,
    background: m.color
  };
}

function fallbackClusterStyle(cluster, shape) {
  const minLng = Number(cluster.bounds?.min_lng || cluster.center?.lng || 116.4);
  const maxLng = Number(cluster.bounds?.max_lng || cluster.center?.lng || 116.4);
  const minLat = Number(cluster.bounds?.min_lat || cluster.center?.lat || 39.9);
  const maxLat = Number(cluster.bounds?.max_lat || cluster.center?.lat || 39.9);
  const left = Math.max(4, Math.min(94, ((minLng - 115.6) / 1.7) * 100));
  const right = Math.max(6, Math.min(96, ((maxLng - 115.6) / 1.7) * 100));
  const top = Math.max(4, Math.min(94, (1 - ((maxLat - 39.45) / 1.25)) * 100));
  const bottom = Math.max(6, Math.min(96, (1 - ((minLat - 39.45) / 1.25)) * 100));
  const pad = shape === 'circle' ? 5 : 2;
  return {
    left: `${Math.max(2, left - pad)}%`,
    top: `${Math.max(2, top - pad)}%`,
    width: `${Math.max(9, right - left + pad * 2)}%`,
    height: `${Math.max(9, bottom - top + pad * 2)}%`,
    borderColor: cluster.color,
    boxShadow: `0 0 24px ${cluster.color}55`
  };
}

function fallbackPoint(position) {
  const lng = Number(position?.[0] || 116.4);
  const lat = Number(position?.[1] || 39.9);
  const x = Math.max(3, Math.min(97, ((lng - 115.6) / 1.7) * 100));
  const y = Math.max(3, Math.min(97, (1 - ((lat - 39.45) / 1.25)) * 100));
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function fallbackPolygonPoints(cluster) {
  return (cluster.polygon || []).map(fallbackPoint).join(' ');
}

function polygonPath(cluster) {
  if (Array.isArray(cluster.polygon) && cluster.polygon.length >= 3) return cluster.polygon;
  const bounds = cluster.bounds || {};
  const minLng = Number(bounds.min_lng || cluster.center?.lng || 116.4);
  const maxLng = Number(bounds.max_lng || cluster.center?.lng || 116.4);
  const minLat = Number(bounds.min_lat || cluster.center?.lat || 39.9);
  const maxLat = Number(bounds.max_lat || cluster.center?.lat || 39.9);
  return [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat]];
}

function locationLabel(cluster) {
  const location = cluster.location || {};
  const address = location.formatted_address || [location.city, location.district].filter(Boolean).join('');
  const metrics = cluster.center || {};
  if (cluster.cluster_type === 'geo') return address || `中心 ${fixed(cluster.center?.lat)}, ${fixed(cluster.center?.lng)}`;
  return `TDS ${fixed(metrics.tds)} · EC ${fixed(metrics.ec)} · 浊度 ${fixed(metrics.turbidity)} · pH ${fixed(metrics.ph)}`;
}

async function refreshAll() {
  const [overviewRes, mapRes, districtRes, reportsRes] = await Promise.all([
    $fetch('/api/v1/dashboard/overview?city=beijing'),
    $fetch('/api/v1/map/points?city=beijing&limit=800'),
    $fetch('/api/v1/map/districts?city=beijing'),
    $fetch('/api/v1/reports?city=beijing&limit=12')
  ]);
  kpis.value = overviewRes.data.kpis;
  markers.value = mapRes.data.markers;
  districts.value = districtRes.data.districts;
  gradeDistribution.value = districtRes.data.grade_distribution;
  reports.value = reportsRes.data.items;
  await loadLatestClusters();
  renderAmapMarkers();
}

async function loadLatestClusters() {
  try {
    const res = await $fetch('/api/v1/analysis/clusters');
    clusterRun.value = res.data.run;
    geoClusters.value = res.data.geo_clusters || [];
    waterClusters.value = res.data.water_quality_clusters || [];
  } catch {
    clusterRun.value = null;
    geoClusters.value = [];
    waterClusters.value = [];
  }
}

async function runKMeansClustering() {
  clusterLoading.value = true;
  try {
    const res = await $fetch('/api/v1/analysis/clusters/kmeans', {
      method: 'POST',
      body: { city: 'beijing', limit: 800, geo_k: 0, water_k: 6, max_spatial_k: 800, geo_max_radius_m: 1000, geocode: true }
    });
    clusterRun.value = res.data.run;
    geoClusters.value = res.data.geo_clusters || [];
    waterClusters.value = res.data.water_quality_clusters || [];
    renderAmapMarkers();
  } finally {
    clusterLoading.value = false;
  }
}

function loadAmapScript() {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve();
    const key = config.public.amapWebKey;
    if (!key) return reject(new Error('AMAP web key missing'));
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initAmap() {
  try {
    await loadAmapScript();
    map = new window.AMap.Map('amap', { zoom: 10.2, center: [116.4074, 39.9042], viewMode: '2D', mapStyle: 'amap://styles/darkblue' });
    amapReady.value = true;
    renderAmapMarkers();
  } catch {
    amapReady.value = false;
  }
}

function renderAmapMarkers() {
  if (!map || !window.AMap) return;
  map.remove([...mapMarkers, ...mapClusterOverlays]);
  mapMarkers = markers.value.map((m) => new window.AMap.CircleMarker({
    center: [m.lng, m.lat],
    radius: 9 + Math.max(0, m.grade_index || 0),
    fillColor: m.color,
    fillOpacity: 0.82,
    strokeColor: '#f8f1d8',
    strokeOpacity: 0.55,
    strokeWeight: 1,
    cursor: 'pointer',
    extData: m
  }));
  mapMarkers.forEach((mk) => mk.on('click', () => selectMapPoint(mk.getExtData())));
  mapClusterOverlays = geoClusters.value
    .map((cluster) => new window.AMap.Polygon({
      path: polygonPath(cluster),
      strokeColor: cluster.color,
      strokeOpacity: 0.9,
      strokeWeight: 2,
      strokeStyle: 'solid',
      fillColor: cluster.color,
      fillOpacity: 0.075,
      zIndex: 7,
      extData: cluster
    }));
  map.add([...mapClusterOverlays, ...mapMarkers]);
}

async function createRegionInsight() {
  insightLoading.value = true;
  try {
    const res = await $fetch('/api/v1/insights/generate', { method: 'POST', body: { scope: 'region', region: 'beijing', real_only: false } });
    latestInsight.value = res.data;
  } finally {
    insightLoading.value = false;
  }
}

async function createPointInsight(reportId) {
  insightLoading.value = true;
  try {
    const res = await $fetch('/api/v1/insights/generate', { method: 'POST', body: { scope: 'point', ref_report_id: reportId } });
    latestInsight.value = res.data;
  } finally {
    insightLoading.value = false;
  }
}

async function clearLlmData() {
  if (!window.confirm('确认清空所有 LLM 数据？')) return;
  llmClearLoading.value = true;
  try {
    await $fetch('/api/v1/insights/records', { method: 'DELETE' });
    latestInsight.value = null;
  } finally {
    llmClearLoading.value = false;
  }
}

async function startLstmJob() {
  lstmLoading.value = true;
  try {
    const res = await $fetch('/api/v1/analysis/lstm/jobs', { method: 'POST', body: { region: 'beijing', limit: 300 } });
    latestJob.value = res.data;
    pollJob(res.data.job_id);
  } finally {
    lstmLoading.value = false;
  }
}

function pollJob(jobId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const res = await $fetch(`/api/v1/analysis/lstm/jobs/${jobId}`);
    latestJob.value = res.data;
    if (['succeeded', 'failed'].includes(res.data.status)) clearInterval(pollTimer);
  }, 2500);
}

onMounted(async () => {
  await refreshAll();
  await initAmap();
});

onBeforeUnmount(() => clearInterval(pollTimer));
</script>

<style scoped>
:global(body) { margin: 0; background: #07110f; color: #f5efd9; font-family: 'Noto Serif SC', serif; }
.observatory { --ink: #f5efd9; --muted: #9da891; --cyan: #68e1d0; --amber: #ffb74a; --red: #ff5d3d; min-height: 100vh; padding: 34px; position: relative; overflow: hidden; background: radial-gradient(circle at 12% 8%, rgba(104,225,208,.20), transparent 28%), radial-gradient(circle at 82% 18%, rgba(255,183,74,.16), transparent 26%), linear-gradient(135deg, #081815, #040707 62%, #151006); }
.grain { position: fixed; inset: 0; pointer-events: none; opacity: .18; background-image: repeating-radial-gradient(circle at 20% 30%, rgba(255,255,255,.5) 0 1px, transparent 1px 4px); mix-blend-mode: overlay; }
.deerflow-mark { position: fixed; right: 22px; bottom: 18px; z-index: 20; color: rgba(245,239,217,.55); text-decoration: none; border: 1px solid rgba(245,239,217,.18); border-radius: 999px; padding: 8px 12px; backdrop-filter: blur(12px); font: 12px/1 'Noto Serif SC', serif; transition: .25s; }
.deerflow-mark:hover { color: var(--cyan); border-color: rgba(104,225,208,.5); transform: translateY(-2px); }
.hero { display: grid; grid-template-columns: 1.2fr auto; gap: 26px; align-items: end; margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--cyan); letter-spacing: .18em; text-transform: uppercase; font: 13px/1 'Bebas Neue', sans-serif; }
h1, h2 { margin: 0; font-family: 'Bebas Neue', sans-serif; letter-spacing: .035em; font-weight: 400; }
h1 { font-size: clamp(62px, 10vw, 148px); line-height: .82; max-width: 980px; text-shadow: 0 12px 50px rgba(104,225,208,.18); }
h2 { font-size: 34px; }
.lede { max-width: 690px; color: #c8c0a7; font-size: 17px; line-height: 1.7; }
.hero-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
button { font-family: inherit; cursor: pointer; }
.ink-btn, .ghost-btn { border: 0; border-radius: 999px; padding: 13px 18px; color: #08110f; background: var(--cyan); box-shadow: 0 16px 42px rgba(104,225,208,.18); }
.ghost-btn { color: var(--ink); background: rgba(245,239,217,.08); border: 1px solid rgba(245,239,217,.18); backdrop-filter: blur(10px); }
.ghost-btn.cluster { border-color: rgba(104,225,208,.45); color: var(--cyan); }
.ghost-btn.hot { border-color: rgba(255,183,74,.34); color: #ffd797; }
.ghost-btn.danger { border-color: rgba(255,93,61,.42); color: #ff9a82; }
.ghost-btn.small { padding: 9px 13px; font-size: 13px; }
button:disabled { opacity: .55; cursor: wait; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
.kpi-card, .map-panel, .intel-panel, .feed-panel, .ai-panel { border: 1px solid rgba(245,239,217,.14); background: linear-gradient(180deg, rgba(245,239,217,.09), rgba(245,239,217,.035)); box-shadow: 0 24px 80px rgba(0,0,0,.28); backdrop-filter: blur(18px); }
.kpi-card { padding: 20px; min-height: 112px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
.kpi-card::after { content: ''; position: absolute; right: -24px; top: -24px; width: 90px; height: 90px; border-radius: 50%; background: rgba(104,225,208,.13); }
.kpi-card.danger::after { background: rgba(255,93,61,.18); }
.kpi-card span, .kpi-card em, small, time { color: var(--muted); font-style: normal; }
.kpi-card strong { font: 56px/.9 'Bebas Neue', sans-serif; color: var(--ink); }
.command-grid { display: grid; grid-template-columns: 1.7fr .8fr; gap: 14px; margin-bottom: 14px; }
.lower-grid { display: grid; grid-template-columns: .95fr 1.25fr; gap: 14px; }
.map-panel, .intel-panel, .feed-panel, .ai-panel { border-radius: 30px; padding: 18px; }
.panel-head { display: flex; justify-content: space-between; gap: 20px; align-items: center; margin-bottom: 14px; }
.compact h2 { font-size: 29px; }
.live-dot { color: var(--cyan); font: 12px 'Bebas Neue', sans-serif; letter-spacing: .14em; }
.amap-canvas { height: 520px; border-radius: 24px; overflow: hidden; background: linear-gradient(145deg, #10221e, #030807); position: relative; border: 1px solid rgba(104,225,208,.16); }
.fallback-map { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(104,225,208,.08) 1px, transparent 1px), linear-gradient(rgba(104,225,208,.08) 1px, transparent 1px); background-size: 64px 64px; }
.fallback-polygons { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; filter: drop-shadow(0 0 14px rgba(104,225,208,.18)); }
.fallback-dot { position: absolute; width: 15px; height: 15px; border: 0; padding: 0; color: inherit; border-radius: 50%; box-shadow: 0 0 0 6px rgba(255,255,255,.08), 0 0 28px currentColor; transform: translate(-50%, -50%); }
.fallback-dot:hover { box-shadow: 0 0 0 8px rgba(104,225,208,.16), 0 0 34px currentColor; }
.point-popover { position: absolute; right: 18px; top: 18px; z-index: 30; width: min(360px, calc(100% - 36px)); border: 1px solid color-mix(in srgb, var(--point-color), transparent 38%); border-radius: 22px; padding: 16px; background: linear-gradient(180deg, rgba(4,10,9,.94), rgba(13,24,21,.88)); box-shadow: 0 22px 70px rgba(0,0,0,.46), 0 0 0 1px rgba(245,239,217,.08), inset 4px 0 0 var(--point-color); backdrop-filter: blur(18px); }
.point-popover-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.point-popover h3 { margin: 0; color: var(--ink); font: 28px/1 'Bebas Neue', sans-serif; letter-spacing: .04em; }
.popover-close { width: 30px; height: 30px; border: 1px solid rgba(245,239,217,.18); border-radius: 50%; color: var(--ink); background: rgba(245,239,217,.06); font-size: 20px; line-height: 1; }
.popover-close:hover { color: var(--cyan); border-color: rgba(104,225,208,.45); }
.point-detail-list { display: grid; gap: 9px; margin: 0 0 12px; }
.point-detail-list div { display: grid; grid-template-columns: 70px 1fr; gap: 10px; align-items: start; }
.point-detail-list dt { color: var(--muted); font-size: 12px; }
.point-detail-list dd { margin: 0; color: #e9e2c7; font-size: 13px; line-height: 1.45; }
.point-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 13px; }
.point-metrics span { border: 1px solid rgba(245,239,217,.11); border-radius: 14px; padding: 9px 7px; background: rgba(245,239,217,.05); color: var(--ink); text-align: center; font: 18px/.95 'Bebas Neue', sans-serif; letter-spacing: .03em; }
.point-metrics b { display: block; margin-bottom: 5px; color: var(--point-color); font: 10px/1 'Noto Serif SC', serif; letter-spacing: .12em; }
.point-report-btn { width: 100%; color: var(--point-color); border-color: color-mix(in srgb, var(--point-color), transparent 52%); }
.map-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 13px; color: #cfc7ad; font-size: 13px; }
.map-legend span { display: inline-flex; align-items: center; gap: 6px; }
.map-legend i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
.cluster-strip { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.cluster-strip span { border: 1px solid rgba(104,225,208,.20); border-radius: 999px; padding: 7px 10px; color: var(--cyan); font-size: 12px; background: rgba(104,225,208,.06); }
.district-list, .report-feed, .cluster-list { display: grid; gap: 10px; }
.cluster-list { margin-top: 14px; }
.cluster-list h3 { margin: 2px 0 0; color: var(--cyan); font: 20px 'Bebas Neue', sans-serif; letter-spacing: .06em; }
.district-row, .report-item, .job-card, .cluster-row { border: 1px solid rgba(245,239,217,.11); border-radius: 18px; background: rgba(3,8,7,.32); padding: 13px; }
.district-row { display: grid; grid-template-columns: 1fr 90px 42px; align-items: center; gap: 12px; }
.cluster-row { display: grid; grid-template-columns: 1fr 42px; align-items: center; gap: 12px; border-color: color-mix(in srgb, var(--c), transparent 68%); box-shadow: inset 4px 0 0 var(--c); }
.district-row b, .report-item b, .cluster-row b { display: block; color: var(--ink); }
.district-row span, .cluster-row span, .cluster-row small { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
.cluster-row strong { color: var(--c); }
meter { width: 100%; accent-color: var(--amber); }
.report-item { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; color: inherit; text-align: left; }
.grade-pill { color: white; padding: 6px 9px; border-radius: 999px; font: 13px 'Noto Serif SC', serif; min-width: 38px; text-align: center; }
.status-strip { display: flex; gap: 10px; margin-bottom: 12px; }
.status-strip span { border: 1px solid rgba(104,225,208,.20); border-radius: 999px; padding: 7px 10px; color: var(--cyan); font-size: 12px; background: rgba(104,225,208,.06); }
.markdown-card { min-height: 220px; border-radius: 20px; background: #f3ead0; color: #13211d; padding: 18px; overflow: auto; }
pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55; }
.job-card { margin-top: 12px; }
.job-card div { display: flex; justify-content: space-between; margin-bottom: 10px; color: var(--cyan); }
.reveal { opacity: 0; transform: translateY(18px); animation: reveal .7s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: var(--delay); }
@keyframes reveal { to { opacity: 1; transform: none; } }
@media (max-width: 1040px) { .hero, .command-grid, .lower-grid { grid-template-columns: 1fr; } .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .observatory { padding: 18px; } .kpi-grid { grid-template-columns: 1fr; } .amap-canvas { height: 380px; } }
</style>
