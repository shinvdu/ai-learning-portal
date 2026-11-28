<script setup lang="ts">
import type { AuditRow } from '@/api/types';
import { fmtTime } from '@/utils/format';

defineProps<{ rows: AuditRow[] }>();
</script>

<template>
  <section class="panel" aria-labelledby="admin-audit-title">
    <div class="panel-head">
      <div>
        <h2 id="admin-audit-title">审计日志</h2>
        <p class="panel-sub">最近 30 条登录、权限与数据变更记录；只读、按时间倒序。</p>
      </div>
      <span class="tag">{{ rows.length }} 条</span>
    </div>

    <div class="table-wrap">
      <table class="data-table" aria-describedby="admin-audit-title">
        <caption class="sr-only">审计日志：时间、操作者、动作、目标与 IP</caption>
        <thead>
          <tr>
            <th scope="col">时间</th>
            <th scope="col">操作者</th>
            <th scope="col">动作</th>
            <th scope="col">目标</th>
            <th scope="col">IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="muted nowrap">{{ fmtTime(row.created_at) }}</td>
            <td>{{ row.actor_email ?? '—' }}</td>
            <td><code>{{ row.action }}</code></td>
            <td class="muted">
              {{ row.target_type ?? '—' }}<template v-if="row.target_id"> · {{ row.target_id }}</template>
            </td>
            <td class="muted">{{ row.ip ?? '—' }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="5" class="muted">暂无审计记录。</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
td code {
  white-space: nowrap;
}
</style>