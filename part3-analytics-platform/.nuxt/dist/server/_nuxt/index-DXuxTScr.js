import { ref, mergeProps, unref, useSSRContext } from "vue";
import { ssrRenderAttrs, ssrRenderStyle, ssrIncludeBooleanAttr, ssrInterpolate, ssrRenderList, ssrRenderAttr } from "vue/server-renderer";
import "hookable";
import { _ as _export_sfc } from "../server.mjs";
import "ofetch";
import "#internal/nuxt/paths";
import "unctx";
import "h3";
import "unhead";
import "@unhead/shared";
import "vue-router";
import "radix3";
import "defu";
import "ufo";
const _sfc_main = {
  __name: "index",
  __ssrInlineRender: true,
  setup(__props) {
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
    const waterNames = { tap: "自来水", river: "河水", lake: "湖水", well: "井水/地下水", purified: "纯净水/过滤水", mineral: "矿泉水", boiled: "煮沸后的水", other: "其他" };
    const waterLabel = (type) => waterNames[type] || type;
    const percent = (v) => typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
    const fixed = (v) => typeof v === "number" ? v.toFixed(2) : "—";
    const shortTime = (t) => t ? new Date(t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
    function dotStyle(m) {
      const lng = Number(m.lng || 116.4);
      const lat = Number(m.lat || 39.9);
      return {
        left: `${Math.max(8, Math.min(92, (lng - 115.6) / 1.7 * 100))}%`,
        top: `${Math.max(8, Math.min(92, (1 - (lat - 39.45) / 1.25) * 100))}%`,
        background: m.color
      };
    }
    return (_ctx, _push, _parent, _attrs) => {
      var _a;
      _push(`<main${ssrRenderAttrs(mergeProps({ class: "observatory" }, _attrs))} data-v-d58b2ce5><div class="grain" data-v-d58b2ce5></div><a class="deerflow-mark" href="https://deerflow.tech" target="_blank" rel="noreferrer" data-v-d58b2ce5>Created By Deerflow</a><section class="hero reveal" style="${ssrRenderStyle({ "--delay": "0ms" })}" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>SDG6 · Civic Water Intelligence</p><h1 data-v-d58b2ce5>Aqua Civic Observatory</h1><p class="lede" data-v-d58b2ce5>把水杯端上传的 20 次稳定原始采样，转化为地图态势、NGO 行动提案与时序风险判断。</p></div><div class="hero-actions" data-v-d58b2ce5><button class="ink-btn" data-v-d58b2ce5>刷新态势</button><button class="ghost-btn"${ssrIncludeBooleanAttr(unref(insightLoading)) ? " disabled" : ""} data-v-d58b2ce5>${ssrInterpolate(unref(insightLoading) ? "LLM 生成中…" : "生成区域提案")}</button><button class="ghost-btn hot"${ssrIncludeBooleanAttr(unref(lstmLoading)) ? " disabled" : ""} data-v-d58b2ce5>${ssrInterpolate(unref(lstmLoading) ? "LSTM 排队中…" : "启动时序分析")}</button></div></section><section class="kpi-grid reveal" style="${ssrRenderStyle({ "--delay": "120ms" })}" data-v-d58b2ce5><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>检测报告</span><strong data-v-d58b2ce5>${ssrInterpolate(unref(kpis).total_reports ?? "—")}</strong><em data-v-d58b2ce5>reports</em></article><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>真实水体</span><strong data-v-d58b2ce5>${ssrInterpolate(unref(kpis).real_reports ?? "—")}</strong><em data-v-d58b2ce5>confirmed</em></article><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>达标率</span><strong data-v-d58b2ce5>${ssrInterpolate(percent(unref(kpis).pass_rate))}</strong><em data-v-d58b2ce5>GB grade ≤ Ⅲ</em></article><article class="kpi-card danger" data-v-d58b2ce5><span data-v-d58b2ce5>污染警报</span><strong data-v-d58b2ce5>${ssrInterpolate(unref(kpis).polluted_count ?? "—")}</strong><em data-v-d58b2ce5>grade ≥ Ⅳ</em></article></section><section class="command-grid" data-v-d58b2ce5><div class="map-panel reveal" style="${ssrRenderStyle({ "--delay": "220ms" })}" data-v-d58b2ce5><div class="panel-head" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>AMAP Situation Layer</p><h2 data-v-d58b2ce5>北京水质点位散点图</h2></div><span class="live-dot" data-v-d58b2ce5>${ssrInterpolate(unref(amapReady) ? "AMAP ONLINE" : "FALLBACK VIEW")}</span></div><div id="amap" class="amap-canvas" data-v-d58b2ce5>`);
      if (!unref(amapReady)) {
        _push(`<div class="fallback-map" data-v-d58b2ce5><!--[-->`);
        ssrRenderList(unref(markers).slice(0, 24), (m) => {
          _push(`<span class="fallback-dot" style="${ssrRenderStyle(dotStyle(m))}" data-v-d58b2ce5></span>`);
        });
        _push(`<!--]--></div>`);
      } else {
        _push(`<!---->`);
      }
      _push(`</div><div class="map-legend" data-v-d58b2ce5><!--[-->`);
      ssrRenderList(unref(gradeDistribution), (g) => {
        _push(`<span style="${ssrRenderStyle({ "--c": g.color })}" data-v-d58b2ce5><i data-v-d58b2ce5></i>${ssrInterpolate(g.grade)} · ${ssrInterpolate(g.count)}</span>`);
      });
      _push(`<!--]--></div></div><aside class="intel-panel reveal" style="${ssrRenderStyle({ "--delay": "300ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>District Aggregation</p><h2 data-v-d58b2ce5>区域基金优先级</h2></div></div><div class="district-list" data-v-d58b2ce5><!--[-->`);
      ssrRenderList(unref(districts), (d) => {
        _push(`<article class="district-row" data-v-d58b2ce5><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(d.district)}</b><span data-v-d58b2ce5>${ssrInterpolate(d.count)} samples</span></div><meter min="0" max="5"${ssrRenderAttr("value", d.avg_grade_index || 0)} data-v-d58b2ce5></meter><strong data-v-d58b2ce5>${ssrInterpolate(fixed(d.avg_grade_index))}</strong></article>`);
      });
      _push(`<!--]--></div></aside></section><section class="lower-grid" data-v-d58b2ce5><article class="feed-panel reveal" style="${ssrRenderStyle({ "--delay": "380ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>Report Stream</p><h2 data-v-d58b2ce5>最新稳定采样报告</h2></div></div><div class="report-feed" data-v-d58b2ce5><!--[-->`);
      ssrRenderList(unref(reports), (r) => {
        _push(`<button class="report-item" data-v-d58b2ce5><span class="grade-pill" style="${ssrRenderStyle({ background: r.grade_color })}" data-v-d58b2ce5>${ssrInterpolate(r.grade)}</span><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(r.location.district || r.location.city || "unknown")}</b><small data-v-d58b2ce5>${ssrInterpolate(waterLabel(r.water_type))} · pH ${ssrInterpolate(r.metrics.ph)} · TDS ${ssrInterpolate(r.metrics.tds ?? "—")}</small></div><time data-v-d58b2ce5>${ssrInterpolate(shortTime(r.measured_at))}</time></button>`);
      });
      _push(`<!--]--></div></article><article class="ai-panel reveal" style="${ssrRenderStyle({ "--delay": "460ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>LLM + LSTM Orchestration</p><h2 data-v-d58b2ce5>外部模型回传</h2></div></div><div class="status-strip" data-v-d58b2ce5><span data-v-d58b2ce5>LLM: ${ssrInterpolate(unref(insightLoading) ? "running" : "ready")}</span><span data-v-d58b2ce5>LSTM: ${ssrInterpolate(((_a = unref(latestJob)) == null ? void 0 : _a.status) || "idle")}</span></div><div class="markdown-card" data-v-d58b2ce5>`);
      if (!unref(latestInsight)) {
        _push(`<p data-v-d58b2ce5>点击“生成区域提案”后，我方 Nitro 会把聚合快照发给队友 LLM 服务，并缓存 Markdown 报告。</p>`);
      } else {
        _push(`<pre data-v-d58b2ce5>${ssrInterpolate(unref(latestInsight).content)}</pre>`);
      }
      _push(`</div>`);
      if (unref(latestJob)) {
        _push(`<div class="job-card" data-v-d58b2ce5><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).job_id)}</b><span data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).status)} · ${ssrInterpolate(unref(latestJob).progress)}%</span></div><pre data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).result ? JSON.stringify(unref(latestJob).result, null, 2) : unref(latestJob).error_message || "等待 LSTM 服务返回时序分析结果…")}</pre></div>`);
      } else {
        _push(`<!---->`);
      }
      _push(`</article></section></main>`);
    };
  }
};
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/index.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-d58b2ce5"]]);
export {
  index as default
};
//# sourceMappingURL=index-DXuxTScr.js.map
