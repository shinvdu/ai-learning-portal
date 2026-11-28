<script setup lang="ts">
import { RouterLink } from 'vue-router';
import type { AdminCourse } from '@/api/types';
import { num } from '@/utils/format';

defineProps<{ courses: AdminCourse[] }>();

const emit = defineEmits<{ remove: [course: AdminCourse] }>();
</script>

<template>
  <section class="panel" aria-labelledby="admin-courses-title">
    <div class="panel-head">
      <div>
        <h2 id="admin-courses-title">课程</h2>
        <p class="panel-sub">
          课程名称变更不会改写历史学习记录；删除有学习记录的课程需要二次确认并强制删除。
        </p>
      </div>
      <span class="tag">{{ courses.length }} 门课程</span>
    </div>

    <div class="table-wrap">
      <table class="data-table" aria-describedby="admin-courses-title">
        <caption class="sr-only">课程列表：课程信息、章节数、学习人数与操作</caption>
        <thead>
          <tr>
            <th scope="col">课程</th>
            <th scope="col">讲师 / 难度</th>
            <th scope="col">章节</th>
            <th scope="col" class="num">学习人数</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="course in courses" :key="course.id">
            <td>
              <strong>{{ course.name }}</strong>
              <div class="muted">{{ course.id }} · {{ course.category }}</div>
            </td>
            <td>{{ course.teacher }} <span class="muted">/ {{ course.level }}</span></td>
            <td>{{ course.chapterDetails.length }}</td>
            <td class="num">{{ course.stats ? num(course.stats.learners) : '—' }}</td>
            <td class="actions">
              <RouterLink class="btn-link" :to="`/admin/courses/${encodeURIComponent(course.id)}`">
                编辑
              </RouterLink>
              <button
                type="button"
                class="btn-link danger-text"
                :aria-label="`删除课程：${course.name}`"
                @click="emit('remove', course)"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="courses.length === 0">
            <td colspan="5" class="muted">暂无课程。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.actions {
  white-space: nowrap;
}

.actions .btn-link {
  padding: 2px 6px;
  margin-right: 4px;
}
</style>