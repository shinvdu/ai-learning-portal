<script setup lang="ts">
/**
 * Admin-only learning-record playground (F083).
 *
 * Search/filter/pagination against `GET /records` (page size 10), CRUD through
 * `RecordDialog`, CSV import with a dry-run preview followed by an explicit
 * whole-table replacement confirmation, CSV export, and a confirmed restore of
 * the bundled demo dataset. Mutations emit `changed` so the dashboard recomputes
 * every KPI and chart from the API.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { catalogApi, datasetApi, recordsApi } from '@/api/endpoints';
import type { ImportResponse, RecordRow, RecordsResponse } from '@/api/types';
import { errorMessage } from '@/api/client';
import AppButton from '@/components/ui/AppButton.vue';
import RecordDialog from '@/components/dashboard/RecordDialog.vue';
import { recordErrorList } from '@/components/dashboard/recordErrors';
import { useConfirm } from '@/composables/useConfirm';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { num } from '@/utils/format';

const PAGE_SIZE = 10;

const props = withDefaults(
  defineProps<{
    /** Course names for the record editor's course selector. */
    courseOptions?: string[];
  }>(),
  { courseOptions: () => [] },
);

const emit = defineEmits<{ changed: [] }>();

const auth = useAuthStore();
const toast = useToastStore();
const confirm = useConfirm();

const page = ref<RecordsResponse | null>(null);
const loading = ref(false);
const loadError = ref('');
const offset = ref(0);
const searchText = ref('');
const appliedQuery = ref('');
const courseFilter = ref('');
const catalog = ref<string[]>([...props.courseOptions]);

const dialogOpen = ref(false);
const editing = ref<RecordRow | null>(null);

const importBusy = ref(false);
const exportBusy = ref(false);
const resetBusy = ref(false);
const importErrors = ref<string[]>([]);
const resetError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadSeq = 0;

const rows = computed(() => page.value?.rows ?? []);
const total = computed(() => page.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const pageNo = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const hasNext = computed(() => offset.value + PAGE_SIZE < total.value);

const selectableCourses = computed(() => {
  const names = new Set(catalog.value);
  for (const row of rows.value) names.add(row.course_name);
  if (courseFilter.value) names.add(courseFilter.value);
  return [...names];
});

function mergeCourses(names: string[]): void {
  const merged = new Set([...catalog.value, ...names]);
  catalog.value = [...merged];
}

watch(
  () => props.courseOptions,
  (names) => mergeCourses(names ?? []),
);

async function loadRecords(): Promise<void> {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await recordsApi.list({
      q: appliedQuery.value || undefined,
      course: courseFilter.value || undefined,
      limit: PAGE_SIZE,
      offset: offset.value,
    });
    if (seq === loadSeq) page.value = result;
  } catch (error) {
    if (seq === loadSeq) loadError.value = recordErrorList(error).join('；');
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function refreshCatalog(): Promise<void> {
  try {
    const meta = await catalogApi.meta();
    mergeCourses(meta.courses.map((course) => course.name));
  } catch {
    /* the catalogue is a convenience for the editor; ignore failures */
  }
}

watch(searchText, (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    appliedQuery.value = value.trim();
    offset.value = 0;
    void loadRecords();
  }, 250);
});

watch(courseFilter, () => {
  offset.value = 0;
  void loadRecords();
});

onMounted(() => {
  if (catalog.value.length === 0) void refreshCatalog();
  void loadRecords();
});

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});

function goPrev(): void {
  if (offset.value <= 0) return;
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  void loadRecords();
}

function goNext(): void {
  if (!hasNext.value) return;
  offset.value += PAGE_SIZE;
  void loadRecords();
}

function openAdd(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(row: RecordRow): void {
  editing.value = row;
  dialogOpen.value = true;
}

async function onSaved(): Promise<void> {
  await loadRecords();
  emit('changed');
}

async function removeRow(row: RecordRow): Promise<void> {
  const ok = await confirm({
    title: '删除记录',
    message: `确定删除记录 #${row.id}？删除后指标会立即重算。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;

  try {
    await recordsApi.remove(row.id);
    toast.ok('记录已删除，指标已重新计算');
    if (rows.value.length === 1 && offset.value > 0) {
      offset.value = Math.max(0, offset.value - PAGE_SIZE);
    }
    await loadRecords();
    emit('changed');
  } catch (error) {
    toast.error(recordErrorList(error).join('；'));
  }
}

function pickFile(): void {
  importErrors.value = [];
  resetError.value = '';
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  importErrors.value = [];
  resetError.value = '';
  importBusy.value = true;

  try {
    const csv = await file.text();
    if (!csv.trim()) {
      importErrors.value = ['CSV 文件为空'];
      toast.error('CSV 文件为空');
      return;
    }

    let preview: ImportResponse;
    try {
      preview = await recordsApi.importCsv(csv, true);
    } catch (error) {
      importErrors.value = recordErrorList(error);
      toast.error('CSV 校验未通过，本次未写入任何数据');
      return;
    }

    if (!preview.ok || preview.inserted === 0) {
      importErrors.value =
        preview.errors.length > 0 ? preview.errors : ['CSV 中没有可导入的有效行'];
      toast.error('CSV 校验未通过，本次未写入任何数据');
      return;
    }

    const skippedText = preview.skipped > 0 ? `，跳过 ${preview.skipped} 行` : '';
    const ok = await confirm({
      title: '导入 CSV',
      message:
        `校验通过：有效 ${preview.inserted} 行${skippedText}。\n` +
        '导入会整体替换当前全部学习记录（包括筛选之外的记录），且无法撤销。确定继续？',
      confirmText: '整体替换',
      danger: true,
    });
    if (!ok) return;

    let result: ImportResponse;
    try {
      result = await recordsApi.importCsv(csv);
    } catch (error) {
      importErrors.value = recordErrorList(error);
      toast.error('导入失败，数据未被替换');
      return;
    }

    importErrors.value = result.errors ?? [];
    if (result.ok) {
      toast.ok(`导入完成：写入 ${result.inserted} 条，跳过 ${result.skipped} 条`);
    } else {
      toast.warn(`导入完成但存在问题：写入 ${result.inserted} 条，跳过 ${result.skipped} 条`);
    }
    offset.value = 0;
    await loadRecords();
    void refreshCatalog();
    emit('changed');
  } catch (error) {
    importErrors.value = recordErrorList(error);
    toast.error('导入失败，数据未被替换');
  } finally {
    importBusy.value = false;
  }
}

async function exportCsv(): Promise<void> {
  exportBusy.value = true;
  try {
    const { blob, filename } = await recordsApi.exportCsv();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename ?? 'learning_records.csv';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.ok('CSV 已导出');
  } catch (error) {
    toast.error(`导出失败：${errorMessage(error)}`);
  } finally {
    exportBusy.value = false;
  }
}

async function resetDataset(): Promise<void> {
  resetError.value = '';
  importErrors.value = [];
  const ok = await confirm({
    title: '恢复初始数据',
    message: '恢复初始数据？所有手工修改与导入内容都会被清空，指标将回到示例基线。',
    confirmText: '恢复初始数据',
    danger: true,
  });
  if (!ok) return;

  resetBusy.value = true;
  try {
    const result = await datasetApi.reset();
    toast.ok(`已恢复初始数据：${result.inserted} 条记录`);
    offset.value = 0;
    await loadRecords();
    emit('changed');
  } catch (error) {
    // The API's production gate (ALLOW_DEMO_RESET) returns the exact reason.
    resetError.value = errorMessage(error);
    toast.error(`恢复失败：${errorMessage(error)}`);
  } finally {
    resetBusy.value = false;
  }
}
</script>

<template>
  <section v-if="auth.isAdmin" class="panel" aria-labelledby="record-playground-title">
    <div class="panel-head">
      <div>
        <h2 id="record-playground-title">数据演示面板</h2>
        <p class="panel-sub">
          编辑学习记录、导入导出 CSV 或恢复示例数据；任何修改都会立即重算 KPI 与图表。
        </p>
      </div>
      <span class="tag tag-warn">仅管理员</span>
    </div>

    <div class="playground-toolbar">
      <label class="sr-only" for="recSearch">搜索学习记录</label>
      <input
        id="recSearch"
        v-model="searchText"
        type="search"
        placeholder="搜索学生编号或课程"
        aria-label="搜索学生编号或课程"
      />
      <label class="sr-only" for="recCourse">按课程筛选记录</label>
      <select id="recCourse" v-model="courseFilter" aria-label="按课程筛选记录" class="course-filter">
        <option value="">全部课程</option>
        <option v-for="name in catalog" :key="name" :value="name">{{ name }}</option>
      </select>
      <AppButton size="sm" @click="openAdd">＋ 新增记录</AppButton>
      <AppButton variant="ghost" size="sm" :loading="importBusy" @click="pickFile">导入 CSV</AppButton>
      <AppButton variant="ghost" size="sm" :loading="exportBusy" @click="exportCsv">导出 CSV</AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        class="danger-text"
        :loading="resetBusy"
        @click="resetDataset"
      >
        恢复初始数据
      </AppButton>
      <input
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        class="sr-only"
        aria-label="选择要导入的 CSV 文件"
        @change="onFileChange"
      />
    </div>

    <div v-if="importErrors.length > 0" class="form-error" role="alert">
      <strong>CSV 导入未完成（{{ importErrors.length }} 个问题）</strong>
      <ul class="error-list">
        <li v-for="message in importErrors.slice(0, 20)" :key="message">{{ message }}</li>
      </ul>
      <p v-if="importErrors.length > 20" class="muted">仅显示前 20 条。</p>
    </div>

    <div v-if="resetError" class="form-error" role="alert">{{ resetError }}</div>

    <div v-if="loadError" class="form-error" role="alert">
      {{ loadError }}
      <AppButton variant="ghost" size="sm" class="mt-1" @click="loadRecords">重试</AppButton>
    </div>

    <div class="table-wrap">
      <table class="data-table record-table" aria-describedby="record-playground-title" :aria-busy="loading || undefined">
        <caption class="sr-only">学习记录（每页 10 条）：学生、课程、日期、时长、章节与成绩</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">学生</th>
            <th scope="col">课程</th>
            <th scope="col">日期</th>
            <th scope="col" class="num">分钟</th>
            <th scope="col" class="num">章节</th>
            <th scope="col" class="num">成绩</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && rows.length === 0">
            <td colspan="8" class="muted">正在加载…</td>
          </tr>
          <template v-else>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.id }}</td>
              <td><code>{{ row.student_id }}</code></td>
              <td>{{ row.course_name }}</td>
              <td>{{ row.learning_date }}</td>
              <td class="num">{{ row.learning_minutes }}</td>
              <td class="num">{{ row.chapters_done }}/{{ row.total_chapters }}</td>
              <td class="num">
                <span v-if="row.quiz_score === null" class="muted">—</span>
                <template v-else>{{ num(row.quiz_score) }}</template>
              </td>
              <td class="actions">
                <button
                  type="button"
                  class="btn-link"
                  :aria-label="`编辑记录 ${row.id}`"
                  @click="openEdit(row)"
                >
                  编辑
                </button>
                <button
                  type="button"
                  class="btn-link danger-text"
                  :aria-label="`删除记录 ${row.id}`"
                  @click="removeRow(row)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="8" class="muted">没有匹配的记录</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <AppButton variant="ghost" size="sm" :disabled="offset <= 0 || loading" @click="goPrev">
        上一页
      </AppButton>
      <span class="pager-info">第 {{ pageNo }} / {{ pageCount }} 页 · 共 {{ total }} 条</span>
      <AppButton variant="ghost" size="sm" :disabled="!hasNext || loading" @click="goNext">
        下一页
      </AppButton>
    </div>

    <p class="footnote">
      本面板仅供管理员使用，修改的是模拟数据；所有指标都由 API 从数据库重新计算，不使用写死的数字。
    </p>
  </section>

  <section v-else class="panel" aria-labelledby="record-playground-restricted">
    <h2 id="record-playground-restricted">数据演示面板</h2>
    <p class="footnote">数据演示面板仅对管理员开放。登录管理员账号后可编辑学习记录、导入 CSV 或恢复初始数据。</p>
  </section>

  <RecordDialog
    v-if="auth.isAdmin"
    v-model:open="dialogOpen"
    :record="editing"
    :course-options="selectableCourses"
    @saved="onSaved"
  />
</template>

<style scoped>
.playground-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0 14px;
}

.playground-toolbar input[type='search'] {
  flex: 1;
  min-width: 200px;
}

.course-filter {
  width: auto;
  min-width: 170px;
}

.error-list {
  margin: 6px 0 0;
  padding-left: 18px;
}

.record-table .actions {
  white-space: nowrap;
}

.record-table .actions .btn-link {
  padding: 2px 6px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.pager-info {
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 640px) {
  .playground-toolbar input[type='search'],
  .course-filter {
    width: 100%;
    flex: 1 1 100%;
  }
}
</style>