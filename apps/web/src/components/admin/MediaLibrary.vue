<script setup lang="ts">
/**
 * Admin media library (F097).
 *
 * Lists stored objects (newest first) with the course/chapter fields that
 * still reference each one, so an admin can see what a delete would break.
 * Deletion is single-object with confirmation; referenced objects require a
 * second, explicit force confirmation. The cleanup panel runs the server-side
 * orphan janitor, first as a dry run and then for real.
 *
 * References come from the API scan of course/chapter `video.src|poster`
 * payloads for `/api/v1/media/<key>`; they are advisory when the page was
 * loaded but are re-checked server-side on DELETE (409 + `references`).
 */
import { computed, onMounted, ref } from 'vue';
import { ApiError, errorMessage } from '@/api/client';
import { mediaLibraryApi } from '@/api/endpoints';
import type { MediaCleanupResult, MediaObject, MediaReference } from '@/api/types';
import { fmtTime } from '@/utils/format';
import AppButton from '@/components/ui/AppButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorCard from '@/components/ui/ErrorCard.vue';
import LoadingBlock from '@/components/ui/LoadingBlock.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useToastStore } from '@/stores/toast';

const PAGE_SIZE = 25;

const toast = useToastStore();
const confirm = useConfirm();

const items = ref<MediaObject[]>([]);
const total = ref(0);
const offset = ref(0);
const loading = ref(false);
const error = ref('');
const deletingKey = ref<string | null>(null);
const orphanOnly = ref(false);

const graceHours = ref(24);
const cleaning = ref<'dry' | 'run' | null>(null);
const cleanupResult = ref<MediaCleanupResult | null>(null);
const cleanupWasDryRun = ref(true);

const visibleItems = computed(() =>
  orphanOnly.value ? items.value.filter((item) => item.references.length === 0) : items.value,
);
const orphanCount = computed(() => items.value.filter((item) => item.references.length === 0).length);
const page = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function referenceLabel(reference: MediaReference): string {
  const owner = reference.type === 'course' ? '课程' : '章节';
  const field = reference.field === 'src' ? '视频/源' : '封面';
  return `${owner} ${reference.id} · ${field}`;
}

function referenceSummary(references: MediaReference[]): string {
  const labels = references.map(referenceLabel);
  return labels.length > 3 ? `${labels.slice(0, 3).join('、')} 等 ${labels.length} 处` : labels.join('、');
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const pageData = await mediaLibraryApi.list({ limit: PAGE_SIZE, offset: offset.value });
    items.value = pageData.items;
    total.value = pageData.total;
    // Deleting the last item of the last page leaves it empty; step back once.
    if (items.value.length === 0 && pageData.total > 0 && offset.value > 0) {
      offset.value = Math.max(0, offset.value - PAGE_SIZE);
      return await load();
    }
  } catch (thrown) {
    error.value = errorMessage(thrown);
  } finally {
    loading.value = false;
  }
}

function goTo(nextOffset: number): void {
  if (loading.value) return;
  offset.value = Math.max(0, nextOffset);
  void load();
}

async function removeItem(item: MediaObject): Promise<void> {
  if (deletingKey.value) return;
  const referenced = item.references.length > 0;
  const ok = await confirm({
    title: referenced ? '强制删除被引用的媒体' : '删除媒体文件',
    message: referenced
      ? `该文件仍被 ${referenceSummary(item.references)} 引用。\n` +
        '强制删除后，对应课程/章节的视频或封面会失效（返回 404），且无法恢复。确定继续？'
      : `确定删除 ${item.key}（${formatBytes(item.size)}）？\n删除后不可恢复。`,
    confirmText: referenced ? '仍要删除' : '删除',
    danger: true,
  });
  if (!ok) return;

  deletingKey.value = item.key;
  try {
    await mediaLibraryApi.remove(item.key, referenced);
    toast.ok('媒体文件已删除');
    if (items.value.length === 1 && offset.value > 0) offset.value -= PAGE_SIZE;
    await load();
  } catch (thrown) {
    if (thrown instanceof ApiError && thrown.status === 409) {
      toast.error('该文件仍被课程或章节引用（可能刚刚添加），请刷新后重试。');
    } else {
      toast.error(errorMessage(thrown));
    }
  } finally {
    deletingKey.value = null;
  }
}

async function runCleanup(dryRun: boolean): Promise<void> {
  if (cleaning.value) return;
  const hours = Math.min(8760, Math.max(0, Math.floor(Number(graceHours.value) || 0)));

  if (!dryRun) {
    const ok = await confirm({
      title: '执行孤儿清理',
      message:
        `删除所有未被课程/章节引用、且最后修改超过 ${hours} 小时的媒体对象。\n` +
        '被引用的对象永远不会被清理；删除后不可恢复。确定执行？',
      confirmText: '执行清理',
      danger: true,
    });
    if (!ok) return;
  }

  cleaning.value = dryRun ? 'dry' : 'run';
  try {
    const result = await mediaLibraryApi.cleanup({ dryRun, graceHours: hours });
    cleanupResult.value = result;
    cleanupWasDryRun.value = dryRun;
    if (dryRun) {
      toast.info(`预演完成：可清理 ${result.items.length} 个对象`);
    } else {
      toast.ok(`清理完成：删除 ${result.deleted} 个对象`);
      await load();
    }
  } catch (thrown) {
    toast.error(`清理失败：${errorMessage(thrown)}`);
  } finally {
    cleaning.value = null;
  }
}

onMounted(load);
</script>

<template>
  <section class="panel" aria-labelledby="admin-media-title">
    <div class="panel-head">
      <div>
        <h2 id="admin-media-title">媒体库</h2>
        <p class="panel-sub">
          课程视频与章节封面都存放在媒体库中。这里列出每个对象被哪些课程/章节字段引用，
          并提供删除与孤儿清理；删除被引用的对象会让对应页面视频失效。
        </p>
      </div>
      <div class="head-actions">
        <span class="tag">{{ total }} 个对象</span>
        <AppButton variant="ghost" size="sm" :loading="loading" @click="load">刷新</AppButton>
      </div>
    </div>

    <div class="media-maintenance">
      <div class="maintenance-copy">
        <strong>孤儿清理</strong>
        <p class="field-hint">
          删除未被任何课程/章节引用、且超过宽限期的对象；被引用的对象始终跳过。先「预演」查看结果，再执行。
        </p>
      </div>
      <label class="grace-field">
        <span class="field-label">宽限期（小时）</span>
        <input
          v-model.number="graceHours"
          type="number"
          min="0"
          max="8760"
          step="1"
          :disabled="cleaning !== null"
        />
      </label>
      <div class="maintenance-actions">
        <AppButton
          variant="ghost"
          size="sm"
          :loading="cleaning === 'dry'"
          :disabled="cleaning !== null"
          @click="runCleanup(true)"
        >
          预演
        </AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :loading="cleaning === 'run'"
          :disabled="cleaning !== null"
          @click="runCleanup(false)"
        >
          执行清理
        </AppButton>
      </div>
    </div>

    <div v-if="cleanupResult" class="cleanup-result" aria-live="polite">
      <h3>{{ cleanupWasDryRun ? '预演结果（未执行删除）' : '清理结果' }}</h3>
      <p class="cleanup-summary">
        <span class="tag tag-warn">删除 {{ cleanupWasDryRun ? cleanupResult.items.length : cleanupResult.deleted }}</span>
        <span class="tag tag-plain">跳过被引用 {{ cleanupResult.skippedReferenced }}</span>
        <span class="tag tag-plain">跳过未到期 {{ cleanupResult.skippedYoung }}</span>
        <span class="tag tag-plain">过期上传会话 {{ cleanupResult.purgedUploads }}</span>
        <span v-if="cleanupResult.errors.length" class="tag tag-warn">错误 {{ cleanupResult.errors.length }}</span>
      </p>
      <ul v-if="cleanupResult.items.length" class="cleanup-items">
        <li v-for="item in cleanupResult.items.slice(0, 10)" :key="item.key">
          <code>{{ item.key }}</code>
          <span class="muted">{{ formatBytes(item.size) }} · {{ fmtTime(item.lastModified) }}</span>
        </li>
      </ul>
      <p v-if="cleanupResult.items.length > 10" class="field-hint">
        仅显示前 10 个，共 {{ cleanupResult.items.length }} 个。
      </p>
      <ul v-if="cleanupResult.errors.length" class="cleanup-errors">
        <li v-for="failure in cleanupResult.errors" :key="failure.key">
          <code>{{ failure.key }}</code>：{{ failure.error }}
        </li>
      </ul>
    </div>

    <div class="media-toolbar">
      <label class="orphan-toggle">
        <input v-model="orphanOnly" type="checkbox" />
        只看本页未被引用的对象（本页 {{ orphanCount }} 个）
      </label>
      <span class="field-hint">按最后修改时间倒序，共 {{ total }} 个对象。</span>
    </div>

    <LoadingBlock v-if="loading && items.length === 0" text="正在加载媒体库…" />
    <ErrorCard v-else-if="error" :message="error" @retry="load" />
    <EmptyState
      v-else-if="visibleItems.length === 0"
      :title="orphanOnly ? '本页没有未被引用的对象' : '媒体库为空'"
      :message="
        orphanOnly
          ? '取消筛选可查看全部对象；也可以使用上方孤儿清理处理其他页面的孤儿。'
          : '在课程或章节中上传视频/封面后，这里会显示对应媒体对象。'
      "
    />

    <div v-else class="table-wrap">
      <table class="data-table" aria-describedby="admin-media-title">
        <caption class="sr-only">媒体库：对象、路径、类型、大小、修改时间、引用与操作</caption>
        <thead>
          <tr>
            <th scope="col">对象</th>
            <th scope="col">类型</th>
            <th scope="col">大小</th>
            <th scope="col">最后修改</th>
            <th scope="col">引用</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in visibleItems" :key="item.key">
            <td>
              <code class="media-key">{{ item.key }}</code>
              <a class="media-path" :href="item.path" target="_blank" rel="noopener">
                {{ item.path }}
              </a>
            </td>
            <td class="muted nowrap">{{ item.contentType }}</td>
            <td class="nowrap">{{ formatBytes(item.size) }}</td>
            <td class="muted nowrap">{{ fmtTime(item.lastModified) }}</td>
            <td>
              <span v-if="item.references.length === 0" class="tag tag-warn">未被引用</span>
              <span v-else class="tag">{{ item.references.length }} 处引用</span>
              <ul v-if="item.references.length" class="ref-list">
                <li v-for="reference in item.references.slice(0, 4)" :key="`${reference.type}-${reference.id}-${reference.field}`">
                  {{ referenceLabel(reference) }}
                </li>
              </ul>
            </td>
            <td>
              <AppButton
                variant="danger"
                size="sm"
                :loading="deletingKey === item.key"
                :disabled="deletingKey !== null && deletingKey !== item.key"
                :aria-label="`删除媒体 ${item.key}`"
                @click="removeItem(item)"
              >
                删除
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav v-if="total > 0" class="media-pager" aria-label="媒体库分页">
      <AppButton variant="ghost" size="sm" :disabled="offset === 0 || loading" @click="goTo(offset - PAGE_SIZE)">
        上一页
      </AppButton>
      <span class="field-hint">第 {{ page }} / {{ pageCount }} 页</span>
      <AppButton
        variant="ghost"
        size="sm"
        :disabled="offset + PAGE_SIZE >= total || loading"
        @click="goTo(offset + PAGE_SIZE)"
      >
        下一页
      </AppButton>
    </nav>

    <p class="footnote">
      删除与清理操作会写入审计日志；媒体对象被引用时需二次确认强制删除。清理不会触碰进行中的上传会话。
    </p>
  </section>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.media-maintenance {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
  margin: 16px 0 12px;
  padding: 14px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fbfcff;
}

.maintenance-copy {
  flex: 1 1 320px;
  min-width: 0;
}

.maintenance-copy p {
  margin: 4px 0 0;
}

.grace-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: #4b5568;
}

.grace-field input {
  width: 120px;
}

.maintenance-actions {
  display: flex;
  gap: 8px;
}

.cleanup-result {
  margin: 0 0 14px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #f7f9fd;
}

.cleanup-result h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.cleanup-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 8px;
}

.cleanup-items,
.cleanup-errors {
  margin: 6px 0;
  padding-left: 18px;
  font-size: 12.5px;
}

.cleanup-items li,
.cleanup-errors li {
  margin: 3px 0;
}

.cleanup-errors {
  color: #a52f2f;
}

.media-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 10px 0 12px;
}

.orphan-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: #4b5568;
}

.media-key {
  display: block;
  font-size: 12.5px;
  word-break: break-all;
}

.media-path {
  display: inline-block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--blue);
  word-break: break-all;
}

.ref-list {
  margin: 5px 0 0;
  padding-left: 16px;
  color: var(--muted);
  font-size: 12px;
}

.media-pager {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>