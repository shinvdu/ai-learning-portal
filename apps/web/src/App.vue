<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppFooter from '@/components/layout/AppFooter.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
</script>

<template>
  <a class="skip-link" href="#main">跳到主要内容</a>

  <AppHeader />

  <main id="main" tabindex="-1">
    <RouterView />
  </main>

  <AppFooter />

  <ToastHost />
  <ConfirmDialog />
</template>