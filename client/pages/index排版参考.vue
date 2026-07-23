<script setup lang="ts">
// 排版参考页已归档，避免作为 Nuxt 页面参与旧契约构建。
onMounted(() => {
  navigateTo('/', { replace: true })
})
</script>

<template>
  <main class="redirect-page">
    <p>排版参考页已归档，正在返回首页…</p>
    <NuxtLink to="/">返回首页</NuxtLink>
  </main>
</template>

<style scoped>
.redirect-page {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 12px;
  padding: 24px;
  color: #105179;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  text-align: center;
  background: linear-gradient(135deg, #dff9ff, #bfeeff);
}
.redirect-page p {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
}
.redirect-page a {
  color: #168bd4;
  font-weight: 800;
}
</style>
