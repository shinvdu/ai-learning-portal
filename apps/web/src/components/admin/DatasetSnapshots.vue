<script setup lang="ts">
/**
 * Admin data-snapshot panel (F064).
 *
 * Lists the immutable snapshots written before every destructive CSV import /
 * demo reset, and restores one after an explicit confirmation. The API
 * snapshots the current rows as `pre-restore` first, so a restore can itself be
 * undone from this list.
 *
 * Refreshes on mount and whenever the window regains focus, so returning from
 * the dashboard's import/reset playground shows the new snapshots. A
 * `portal:dataset-changed` window event also triggers a refresh for future
 * callers that emit it.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { datasetApi } from '@/api/endpoints';
import type { DatasetSnapshot } from '@/api/types';
import { errorMessage } from '@/api/client';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useToastStore } from '@/stores/toast';
import { fmtTime } from '@/utils/format';

const emit = defineEmits<{ restored: [] }>();

const toast = useToastStore();
const confirm = useConfirm();

const snapshots = ref<DatasetSnapshot[]>([]);
const loading = ref(false);
const error = ref('');
const restoringId = ref<number | null>(null);

const REFRESH_EVENT = 'portal:dataset-changed';

const REASON_LABELS: Record<string, string> = {
  'csv-import': 'CSV 导入前',
  'seed-reset': '恢复示例数据前',
  'pre-restore': '恢复快照前',
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    snapshots.value = (await datasetApi.snapshots()).snapshots;
  } catch (thrown) {
    error.value = errorMessage(thrown);
  } finally {
    loading.value = false;
  }
}

async function restore(snapshot: DatasetSnapshot): Promise<void> {
  const ok = await confirm({
    title: '恢复数据快照',
    message:
      `恢复到 ${fmtTime(snapshot.created_at)} 的快照（${snapshot.row_count} 条记录）？\n` +
      '当前全部学习记录会被整体替换；系统会先把当前数据另存为一份快照，因此本次恢复仍可回滚。',
    confirmText: '恢复快照',
    danger: true,
  });
  if (!ok) return;

  restoringId.value = snapshot.id;
  try {
    const result = await datasetApi.restore(snapshot.id);
    toast.ok(`已恢复 ${result.restored} 条记录`);
    emit('restored');
    await load();
  } catch (thrown) {
    toast.error(`恢复失败：${errorMessage(thrown)}`);
  } finally {
    restoringId.value = null;
  }
}

function onWindowFocus(): void {
  if (document.visibilityState === 'visible') void load();
}

onMounted(() => {
  void load();
  window.addEventListener('focus', onWindowFocus);
  document.addEventListener('visibilitychange', onWindowFocus);
  window.addEventListener(REFRESH_EVENT, load);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus);
  document.removeEventListener('visibilitychange', onWindowFocus);
  window.removeEventListener(REFRESH_EVENT, load);
});

defineExpose({ refresh: load });
</script>

<template>
  <section class="panel" aria-labelledby="dataset-snapshots-title">
    <div class="panel-head">
      <div>
        <h2 id="dataset-snapshots-title">数据快照</h2>
        <p class="panel-sub">
          CSV 导入、恢复示例数据与快照恢复前都会自动保存一份完整记录集；恢复前会把当前数据再存一份。
        </p>
      </div>
      <div class="head-actions">
        <span class="tag">{{ snapshots.length }} 份</span>
        <AppButton variant="ghost" size="sm" :loading="loading" @click="load">刷新</AppButton>
      </div>
    </div>

    <LoadingBlock v-if="loading && snapshots.length === 0" text="正在加载数据快照…" />
    <ErrorCard v-else-if="error" :message="error" @retry="load" />
    <EmptyState
      v-else-if="snapshots.length === 0"
      title="暂无数据快照"
      message="执行 CSV 导入、恢复示例数据或恢复快照后，这里会出现自动快照。"
    />

    <div v-else class="table-wrap">
      <table class="data-table" aria-describedby="dataset-snapshots-title">
        <caption class="sr-only">数据快照：时间、来源、记录数、操作者与恢复操作</caption>
        <thead>
          <tr>
            <th scope="col">时间</th>
            <th scope="col">来源</th>
            <th scope="col">记录数</th>
            <th scope="col">操作者</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="snapshot in snapshots" :key="snapshot.id">
            <td class="muted nowrap">{{ fmtTime(snapshot.created_at) }}</td>
            <td>
              <span class="snapshot-reason">{{ reasonLabel(snapshot.reason) }}</span>
              <code class="snapshot-id">#{{ snapshot.id }}</code>
            </td>
            <td>{{ snapshot.row_count }}</td>
            <td class="muted">{{ snapshot.actor_email ?? '—' }}</td>
            <td>
              <AppButton
                variant="danger"
                size="sm"
                :loading="restoringId === snapshot.id"
                :disabled="restoringId !== null && restoringId !== snapshot.id"
                :aria-label="`恢复 ${fmtTime(snapshot.created_at)} 的快照`"
                @click="restore(snapshot)"
              >
                恢复
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.snapshot-reason {
  font-weight: 600;
}

.snapshot-id {
  margin-left: 8px;
  color: var(--muted);
  font-size: 0.85em;
}

td code {
  white-space: nowrap;
}
</style>
