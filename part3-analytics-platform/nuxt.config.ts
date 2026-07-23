export default defineNuxtConfig({
  ssr: true,
  devServer: {
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '0.0.0.0'
  },
  app: {
    head: {
      title: 'SDG6 Aqua Civic Observatory',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'SDG6 water quality analytics dashboard with AMAP, LLM insight and LSTM orchestration.' }
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Serif+SC:wght@500;700;900&display=swap' }
      ]
    }
  },
  css: [],
  runtimeConfig: {
    public: {
      amapWebKey: process.env.AMAP_WEB_KEY || process.env.AMAP_KEY || ''
    }
  },
  nitro: {
    experimental: {
      wasm: true
    }
  },
  compatibilityDate: '2026-07-23'
});
