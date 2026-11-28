<script setup lang="ts">
/** Per-chapter inferred reach rates, mirroring v1 `chapter-rate-list`. */
import { RouterLink } from 'vue-router';
import type { ChapterStat } from '@/api/types';
import { clampPercent, pct } from '@/utils/format';

defineProps<{
  chapters: ChapterStat[];
  courseId: string;
  currentIdx: number;
}>();

function chapterLink(courseId: string, idx: number): string {
  return `/courses/${encodeURIComponent(courseId)}/chapters/${idx}`;
}
</script>

<template>
  <ul class="chapter-rate-list">
    <li v-for="chapter in chapters" :key="chapter.idx" :class="{ active: chapter.idx === currentIdx }">
      <RouterLink
        :to="chapterLink(courseId, chapter.idx)"
        :aria-current="chapter.idx === currentIdx ? 'page' : undefined"
      >
        <span class="rate-name">{{ chapter.idx }}. {{ chapter.title }}</span>
        <span class="rate-bar" aria-hidden="true">
          <span :style="{ width: `${clampPercent(chapter.reachRate)}%` }" />
        </span>
        <em>{{ pct(chapter.reachRate) }}</em>
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped>
.chapter-rate-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chapter-rate-list a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px 42px;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  color: #3c4659;
  font-size: 12.5px;
  text-decoration: none;
}

.chapter-rate-list a:hover {
  background: #f5f8fd;
  text-decoration: none;
}

.chapter-rate-list li.active a {
  background: #eef5ff;
  color: var(--navy);
  font-weight: 600;
}

.rate-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rate-bar {
  height: 5px;
  background: #e9eef7;
  border-radius: 999px;
  overflow: hidden;
}

.rate-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--teal);
}

.chapter-rate-list em {
  font-style: normal;
  text-align: right;
  font-size: 11.5px;
  color: var(--muted);
}
</style>