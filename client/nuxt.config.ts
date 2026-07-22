// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  // 开发服务器监听 0.0.0.0:3000
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },

  // 生产构建使用 Nitro node-server 预设；
  // 运行时监听地址/端口由环境变量 HOST/PORT 控制（见 package.json start 脚本）
  nitro: {
    preset: 'node-server',
  },

  // 运行时配置：private 仅服务端(BFF)可读，public 客户端可读
  runtimeConfig: {
    // 后端(队友 Express)真实地址与鉴权 Key —— 只存在 server 侧，不下发浏览器
    backendBaseUrl: process.env.BACKEND_BASE_URL || 'http://localhost:4000/api/v1',
    backendApiKey: process.env.BACKEND_API_KEY || 'dev-key-change-me',
    // ★ Water Quality Pipeline（随机森林 GB 等级预测，FastAPI 端口 8080）
    pipelineBaseUrl: process.env.PIPELINE_BASE_URL || 'http://localhost:8080',
    // 高德地图 Web 服务 Key：仅服务端(BFF)可读，用于逆地理编码 REST API，不下发浏览器
    amapKey: process.env.NUXT_PUBLIC_AMAP_KEY,
    public: {
      // 客户端可见配置
      demoMode: process.env.NUXT_PUBLIC_DEMO_MODE === 'true',
      appName: 'AquaCheck',
    },

  },

  // Web Bluetooth 要求 HTTPS 或 localhost；本地 dev 用 localhost 即可
  // 部署时务必启用 HTTPS（Vercel/Netlify/Cloudflare 默认满足）
  app: {
    head: {
      title: 'AquaCheck · SDG6 水质检测',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
})
