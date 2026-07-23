import { ref, mergeProps, unref, useSSRContext } from 'vue';
import { ssrRenderAttrs, ssrRenderStyle, ssrIncludeBooleanAttr, ssrInterpolate, ssrRenderList, ssrRenderAttr } from 'vue/server-renderer';
import { _ as _export_sfc } from './server.mjs';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../routes/renderer.mjs';
import 'vue-bundle-renderer/runtime';
import 'devalue';
import '@unhead/ssr';
import 'unhead';
import '@unhead/shared';
import 'vue-router';

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
    const waterNames = { tap: "\u81EA\u6765\u6C34", river: "\u6CB3\u6C34", lake: "\u6E56\u6C34", well: "\u4E95\u6C34/\u5730\u4E0B\u6C34", purified: "\u7EAF\u51C0\u6C34/\u8FC7\u6EE4\u6C34", mineral: "\u77FF\u6CC9\u6C34", boiled: "\u716E\u6CB8\u540E\u7684\u6C34", other: "\u5176\u4ED6" };
    const waterLabel = (type) => waterNames[type] || type;
    const percent = (v) => typeof v === "number" ? `${Math.round(v * 100)}%` : "\u2014";
    const fixed = (v) => typeof v === "number" ? v.toFixed(2) : "\u2014";
    const shortTime = (t) => t ? new Date(t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "\u2014";
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
      var _a2, _b, _c;
      var _a;
      _push(`<main${ssrRenderAttrs(mergeProps({ class: "observatory" }, _attrs))} data-v-d58b2ce5><div class="grain" data-v-d58b2ce5></div><a class="deerflow-mark" href="https://deerflow.tech" target="_blank" rel="noreferrer" data-v-d58b2ce5>Created By Deerflow</a><section class="hero reveal" style="${ssrRenderStyle({ "--delay": "0ms" })}" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>SDG6 \xB7 Civic Water Intelligence</p><h1 data-v-d58b2ce5>Aqua Civic Observatory</h1><p class="lede" data-v-d58b2ce5>\u628A\u6C34\u676F\u7AEF\u4E0A\u4F20\u7684 20 \u6B21\u7A33\u5B9A\u539F\u59CB\u91C7\u6837\uFF0C\u8F6C\u5316\u4E3A\u5730\u56FE\u6001\u52BF\u3001NGO \u884C\u52A8\u63D0\u6848\u4E0E\u65F6\u5E8F\u98CE\u9669\u5224\u65AD\u3002</p></div><div class="hero-actions" data-v-d58b2ce5><button class="ink-btn" data-v-d58b2ce5>\u5237\u65B0\u6001\u52BF</button><button class="ghost-btn"${ssrIncludeBooleanAttr(unref(insightLoading)) ? " disabled" : ""} data-v-d58b2ce5>${ssrInterpolate(unref(insightLoading) ? "LLM \u751F\u6210\u4E2D\u2026" : "\u751F\u6210\u533A\u57DF\u63D0\u6848")}</button><button class="ghost-btn hot"${ssrIncludeBooleanAttr(unref(lstmLoading)) ? " disabled" : ""} data-v-d58b2ce5>${ssrInterpolate(unref(lstmLoading) ? "LSTM \u6392\u961F\u4E2D\u2026" : "\u542F\u52A8\u65F6\u5E8F\u5206\u6790")}</button></div></section><section class="kpi-grid reveal" style="${ssrRenderStyle({ "--delay": "120ms" })}" data-v-d58b2ce5><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>\u68C0\u6D4B\u62A5\u544A</span><strong data-v-d58b2ce5>${ssrInterpolate((_a2 = unref(kpis).total_reports) != null ? _a2 : "\u2014")}</strong><em data-v-d58b2ce5>reports</em></article><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>\u771F\u5B9E\u6C34\u4F53</span><strong data-v-d58b2ce5>${ssrInterpolate((_b = unref(kpis).real_reports) != null ? _b : "\u2014")}</strong><em data-v-d58b2ce5>confirmed</em></article><article class="kpi-card" data-v-d58b2ce5><span data-v-d58b2ce5>\u8FBE\u6807\u7387</span><strong data-v-d58b2ce5>${ssrInterpolate(percent(unref(kpis).pass_rate))}</strong><em data-v-d58b2ce5>GB grade \u2264 \u2162</em></article><article class="kpi-card danger" data-v-d58b2ce5><span data-v-d58b2ce5>\u6C61\u67D3\u8B66\u62A5</span><strong data-v-d58b2ce5>${ssrInterpolate((_c = unref(kpis).polluted_count) != null ? _c : "\u2014")}</strong><em data-v-d58b2ce5>grade \u2265 \u2163</em></article></section><section class="command-grid" data-v-d58b2ce5><div class="map-panel reveal" style="${ssrRenderStyle({ "--delay": "220ms" })}" data-v-d58b2ce5><div class="panel-head" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>AMAP Situation Layer</p><h2 data-v-d58b2ce5>\u5317\u4EAC\u6C34\u8D28\u70B9\u4F4D\u6563\u70B9\u56FE</h2></div><span class="live-dot" data-v-d58b2ce5>${ssrInterpolate(unref(amapReady) ? "AMAP ONLINE" : "FALLBACK VIEW")}</span></div><div id="amap" class="amap-canvas" data-v-d58b2ce5>`);
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
        _push(`<span style="${ssrRenderStyle({ "--c": g.color })}" data-v-d58b2ce5><i data-v-d58b2ce5></i>${ssrInterpolate(g.grade)} \xB7 ${ssrInterpolate(g.count)}</span>`);
      });
      _push(`<!--]--></div></div><aside class="intel-panel reveal" style="${ssrRenderStyle({ "--delay": "300ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>District Aggregation</p><h2 data-v-d58b2ce5>\u533A\u57DF\u57FA\u91D1\u4F18\u5148\u7EA7</h2></div></div><div class="district-list" data-v-d58b2ce5><!--[-->`);
      ssrRenderList(unref(districts), (d) => {
        _push(`<article class="district-row" data-v-d58b2ce5><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(d.district)}</b><span data-v-d58b2ce5>${ssrInterpolate(d.count)} samples</span></div><meter min="0" max="5"${ssrRenderAttr("value", d.avg_grade_index || 0)} data-v-d58b2ce5></meter><strong data-v-d58b2ce5>${ssrInterpolate(fixed(d.avg_grade_index))}</strong></article>`);
      });
      _push(`<!--]--></div></aside></section><section class="lower-grid" data-v-d58b2ce5><article class="feed-panel reveal" style="${ssrRenderStyle({ "--delay": "380ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>Report Stream</p><h2 data-v-d58b2ce5>\u6700\u65B0\u7A33\u5B9A\u91C7\u6837\u62A5\u544A</h2></div></div><div class="report-feed" data-v-d58b2ce5><!--[-->`);
      ssrRenderList(unref(reports), (r) => {
        var _a3;
        _push(`<button class="report-item" data-v-d58b2ce5><span class="grade-pill" style="${ssrRenderStyle({ background: r.grade_color })}" data-v-d58b2ce5>${ssrInterpolate(r.grade)}</span><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(r.location.district || r.location.city || "unknown")}</b><small data-v-d58b2ce5>${ssrInterpolate(waterLabel(r.water_type))} \xB7 pH ${ssrInterpolate(r.metrics.ph)} \xB7 TDS ${ssrInterpolate((_a3 = r.metrics.tds) != null ? _a3 : "\u2014")}</small></div><time data-v-d58b2ce5>${ssrInterpolate(shortTime(r.measured_at))}</time></button>`);
      });
      _push(`<!--]--></div></article><article class="ai-panel reveal" style="${ssrRenderStyle({ "--delay": "460ms" })}" data-v-d58b2ce5><div class="panel-head compact" data-v-d58b2ce5><div data-v-d58b2ce5><p class="eyebrow" data-v-d58b2ce5>LLM + LSTM Orchestration</p><h2 data-v-d58b2ce5>\u5916\u90E8\u6A21\u578B\u56DE\u4F20</h2></div></div><div class="status-strip" data-v-d58b2ce5><span data-v-d58b2ce5>LLM: ${ssrInterpolate(unref(insightLoading) ? "running" : "ready")}</span><span data-v-d58b2ce5>LSTM: ${ssrInterpolate(((_a = unref(latestJob)) == null ? void 0 : _a.status) || "idle")}</span></div><div class="markdown-card" data-v-d58b2ce5>`);
      if (!unref(latestInsight)) {
        _push(`<p data-v-d58b2ce5>\u70B9\u51FB\u201C\u751F\u6210\u533A\u57DF\u63D0\u6848\u201D\u540E\uFF0C\u6211\u65B9 Nitro \u4F1A\u628A\u805A\u5408\u5FEB\u7167\u53D1\u7ED9\u961F\u53CB LLM \u670D\u52A1\uFF0C\u5E76\u7F13\u5B58 Markdown \u62A5\u544A\u3002</p>`);
      } else {
        _push(`<pre data-v-d58b2ce5>${ssrInterpolate(unref(latestInsight).content)}</pre>`);
      }
      _push(`</div>`);
      if (unref(latestJob)) {
        _push(`<div class="job-card" data-v-d58b2ce5><div data-v-d58b2ce5><b data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).job_id)}</b><span data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).status)} \xB7 ${ssrInterpolate(unref(latestJob).progress)}%</span></div><pre data-v-d58b2ce5>${ssrInterpolate(unref(latestJob).result ? JSON.stringify(unref(latestJob).result, null, 2) : unref(latestJob).error_message || "\u7B49\u5F85 LSTM \u670D\u52A1\u8FD4\u56DE\u65F6\u5E8F\u5206\u6790\u7ED3\u679C\u2026")}</pre></div>`);
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

export { index as default };
//# sourceMappingURL=index-DXuxTScr.mjs.map
