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
            <span v-for="m in markers.slice(0, 24)" :key="m.report_id" class="fallback-dot" :style="dotStyle(m)"></span>
          </div>
        </div>
        <div class="map-legend">
          <span v-for="g in gradeDistribution" :key="g.grade" :style="{ '--c': g.color }"><i></i>{{ g.grade }} · {{ g.count }}</span>
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
        <div class="panel-head compact"><div><p class="eyebrow">LLM + LSTM Orchestration</p><h2>外部模型回传</h2></div></div>
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
const insightLoading = ref(false);
const lstmLoading = ref(false);
const amapReady = ref(false);
let map;
let mapMarkers = [];
let pollTimer;

const waterNames = { tap: '自来水', river: '河水', lake: '湖水', well: '井水/地下水', purified: '纯净水/过滤水', mineral: '矿泉水', boiled: '煮沸后的水', other: '其他' };
const waterLabel = (type) => waterNames[type] || type;
const percent = (v) => typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
const fixed = (v) => typeof v === 'number' ? v.toFixed(2) : '—';
const shortTime = (t) => t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

function dotStyle(m) {
  const lng = Number(m.lng || 116.4);
  const lat = Number(m.lat || 39.9);
  return {
    left: `${Math.max(8, Math.min(92, ((lng - 115.6) / 1.7) * 100))}%`,
    top: `${Math.max(8, Math.min(92, (1 - ((lat - 39.45) / 1.25)) * 100))}%`,
    background: m.color
  };
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
  renderAmapMarkers();
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
  map.remove(mapMarkers);
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
  mapMarkers.forEach((mk) => mk.on('click', () => createPointInsight(mk.getExtData().report_id)));
  map.add(mapMarkers);
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
.ghost-btn.hot { border-color: rgba(255,183,74,.34); color: #ffd797; }
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
.fallback-dot { position: absolute; width: 15px; height: 15px; border-radius: 50%; box-shadow: 0 0 0 6px rgba(255,255,255,.08), 0 0 28px currentColor; transform: translate(-50%, -50%); }
.map-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 13px; color: #cfc7ad; font-size: 13px; }
.map-legend span { display: inline-flex; align-items: center; gap: 6px; }
.map-legend i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
.district-list, .report-feed { display: grid; gap: 10px; }
.district-row, .report-item, .job-card { border: 1px solid rgba(245,239,217,.11); border-radius: 18px; background: rgba(3,8,7,.32); padding: 13px; }
.district-row { display: grid; grid-template-columns: 1fr 90px 42px; align-items: center; gap: 12px; }
.district-row b, .report-item b { display: block; color: var(--ink); }
.district-row span { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
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
