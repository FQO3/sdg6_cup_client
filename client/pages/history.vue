<script setup lang="ts">
// 历史页已合并进首页，保留本路由仅用于兼容旧链接。
onMounted(() => {
  navigateTo('/#reports', { replace: true })
})
</script>

<template>
  <main class="redirect-page">
    <p>历史记录已合并到首页，正在跳转…</p>
    <NuxtLink to="/#reports">如果没有自动跳转，点击这里查看历史记录</NuxtLink>
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
