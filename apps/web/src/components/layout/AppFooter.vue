<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { catalogApi } from '@/api/endpoints';
import type { DatasetMeta } from '@/api/types';
import { fmtTime, num, sourceLabel } from '@/utils/format';

const dataset = ref<DatasetMeta | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const meta = await catalogApi.meta();
    dataset.value = meta.dataset;
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="footer-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="30" height="30" role="img" aria-label="AI Learning Portal">
            <polygon points="20,3 35,11.5 35,28.5 20,37 5,28.5 5,11.5" fill="#000048" opacity="0.1" />
            <polygon
              points="20,6 32,13 32,27 20,34 8,27 8,13"
              fill="none"
              stroke="#000048"
              stroke-width="2"
            />
            <path
              d="M13 27 20 12l7 15h-3.2l-1.2-2.7h-5.2L16.2 27H13zm5.2-5.2h3.6L20 16.4l-1.8 5.4z"
              fill="#000048"
            />
          </svg>
        </span>
        <div class="footer-wordmark">
          <strong>AI Learning Portal</strong>
          <p>AI 学习与数据分析门户 · 课程广场、知识中心、学习看板与数据洞察</p>
        </div>
      </div>

      <p class="footer-note">本网站数据均为模拟数据，不含真实姓名、联系方式或公司信息。</p>

      <p class="footer-meta">
        <template v-if="dataset">
          数据源：{{ sourceLabel(dataset.source) }} · 最近更新：{{ fmtTime(dataset.updatedAt) }} ·
          手工修改 {{ num(dataset.manualEdits) }} 次 · PostgreSQL + Vue 3
        </template>
        <template v-else-if="failed">数据源信息暂时不可用 · PostgreSQL + Vue 3</template>
        <template v-else>数据源信息加载中…</template>
      </p>
    </div>
  </footer>
</template>