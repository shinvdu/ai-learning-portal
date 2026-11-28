<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { CourseWithStats } from '@/api/types';
import MeterBar from '@/components/ui/MeterBar.vue';
import { courseBadge, courseColor, completionOf } from './course';
import { num, pct } from '@/utils/format';

const props = defineProps<{ course: CourseWithStats }>();

const accent = computed(() => courseColor(props.course));
const badge = computed(() => courseBadge(props.course));
const completion = computed(() => completionOf(props.course.stats));
const courseLink = computed(() => `/courses/${encodeURIComponent(props.course.id)}`);
const knowledgeLink = computed(() => `/knowledge/${encodeURIComponent(props.course.id)}`);
</script>

<template>
  <article class="course-card" :style="{ '--accent': accent }">
    <div class="course-top">
      <span class="course-badge" :style="{ background: accent }" aria-hidden="true">
        {{ badge }}
      </span>
      <span class="tag">{{ course.category }}</span>
    </div>

    <h3>
      <RouterLink class="stretched" :to="courseLink">{{ course.name }}</RouterLink>
    </h3>

    <p class="course-intro">{{ course.intro }}</p>

    <p class="course-meta">
      {{ course.teacher }} · {{ course.level }} · {{ course.chapters.length }} 章
      <span v-if="course.video" class="video-inline">▶ 视频导览</span>
    </p>

    <div class="course-kpis">
      <span><b>{{ num(course.stats?.learners) }}</b> 人学习</span>
      <span>完成率 <b>{{ pct(course.stats?.completion) }}</b></span>
    </div>

    <MeterBar :value="completion" />

    <div class="course-foot">
      <span class="course-link">课程详情 <span aria-hidden="true">→</span></span>
      <RouterLink class="mini-link" :to="knowledgeLink">知识中心</RouterLink>
    </div>
  </article>
</template>

<style scoped>
.course-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  background: var(--card);
  border: 1px solid var(--line);
  border-top: 4px solid var(--accent, var(--blue));
  border-radius: var(--radius);
  padding: 20px 20px 16px;
  box-shadow: var(--shadow);
  transition: transform 0.18s, box-shadow 0.18s;
}

.course-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}

.course-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.course-badge {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.5px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.course-card h3 {
  font-size: 19px;
  margin-top: 4px;
}

.stretched {
  color: var(--navy);
  text-decoration: none;
}

.stretched::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius);
}

.course-card:hover h3 .stretched {
  color: #15307f;
}

.course-intro {
  color: var(--muted);
  font-size: 13.5px;
  min-height: 44px;
}

.course-meta {
  color: #7c86a0;
  font-size: 12.5px;
}

.video-inline {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: #e9f6f7;
  color: #087d82;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  vertical-align: 2px;
}

.course-kpis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--muted);
  margin-top: 2px;
}

.course-kpis b {
  color: var(--navy);
  font-size: 15px;
}

.course-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
  font-size: 12.5px;
}

.course-link {
  color: var(--blue);
  font-weight: 600;
}

.mini-link {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 600;
}
</style>