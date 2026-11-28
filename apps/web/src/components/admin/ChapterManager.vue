<script setup lang="ts">
import { computed } from 'vue';
import type { ChapterRow } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';

const props = defineProps<{
  chapters: ChapterRow[];
  /** Index whose delete is in flight, if any. */
  busyIdx: number | null;
}>();

const emit = defineEmits<{
  add: [];
  edit: [chapter: ChapterRow];
  remove: [chapter: ChapterRow];
}>();

const nextIdx = computed(() => {
  const max = props.chapters.reduce((acc, chapter) => Math.max(acc, chapter.idx), 0);
  return max + 1;
});

function excerpt(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > 90 ? `${compact.slice(0, 90)}…` : compact;
}
</script>

<template>
  <section class="panel" aria-labelledby="chapter-manager-title">
    <div class="panel-head">
      <div>
        <h2 id="chapter-manager-title">章节管理</h2>
        <p class="panel-sub">章节正文支持多段文本；删除章节会保留编号空位，不会重新编号。</p>
      </div>
      <AppButton size="sm" @click="emit('add')">＋ 新增章节</AppButton>
    </div>

    <ul class="chapter-list" aria-labelledby="chapter-manager-title">
      <li v-for="chapter in chapters" :key="chapter.idx" :aria-busy="busyIdx === chapter.idx || undefined">
        <span class="chapter-no" aria-hidden="true">{{ String(chapter.idx).padStart(2, '0') }}</span>
        <div class="chapter-info">
          <h3>{{ chapter.title }}</h3>
          <p class="chapter-sub">{{ excerpt(chapter.body) }}</p>
        </div>
        <div class="chapter-actions">
          <button
            type="button"
            class="btn-link"
            :aria-label="`编辑第 ${chapter.idx} 章：${chapter.title}`"
            :disabled="busyIdx !== null"
            @click="emit('edit', chapter)"
          >
            编辑
          </button>
          <button
            type="button"
            class="btn-link danger-text"
            :aria-label="`删除第 ${chapter.idx} 章：${chapter.title}`"
            :disabled="busyIdx !== null"
            @click="emit('remove', chapter)"
          >
            {{ busyIdx === chapter.idx ? '删除中…' : '删除' }}
          </button>
        </div>
      </li>
      <li v-if="chapters.length === 0" class="muted empty-row">暂无章节，点击右上角新增。</li>
    </ul>

    <p class="footnote">
      新增章节将追加为第 {{ nextIdx }} 章；删除章节后编号空缺保留，历史章节到达率仍可解释。
    </p>
  </section>
</template>

<style scoped>
.chapter-list {
  list-style: none;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.chapter-list li {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--line);
}

.chapter-list li:last-child {
  border-bottom: 0;
}

.chapter-list li.empty-row {
  display: block;
  color: var(--muted);
  font-size: 13.5px;
}

.chapter-no {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #eaf3fb;
  color: #1f5f9e;
  font-weight: 700;
  font-size: 13px;
}

.chapter-info {
  min-width: 0;
  flex: 1;
}

.chapter-info h3 {
  font-size: 14.5px;
}

.chapter-sub {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 2px;
}

.chapter-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>