<script setup lang="ts">
import AppButton from '@/components/ui/AppButton.vue';
</script>

<template>
  <section class="auth-gate">
    <span class="eyebrow">404</span>
    <h1>页面不存在</h1>
    <p>你访问的地址不存在或已被移动。可以返回课程广场继续浏览。</p>
    <div class="row" style="justify-content: center">
      <AppButton to="/">返回首页</AppButton>
      <AppButton variant="ghost" to="/dashboard">查看学习看板</AppButton>
    </div>
  </section>
</template>