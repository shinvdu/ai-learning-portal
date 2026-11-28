<script setup lang="ts">
/** Course switcher for the knowledge center; the selection lives in the URL. */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppTabs from '@/components/ui/AppTabs.vue';

const props = defineProps<{
  courses: Array<{ id: string; name: string }>;
}>();

const route = useRoute();
const router = useRouter();

const tabs = computed(() => props.courses.map((course) => ({ id: course.id, label: course.name })));

const selected = computed<string>({
  get(): string {
    const raw = route.params.id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value ? value : 'C1';
  },
  set(value: string): void {
    if (value === selected.value) return;
    void router.push(`/knowledge/${value}`);
  },
});
</script>

<template>
  <div class="knowledge-tabs">
    <AppTabs v-model="selected" :tabs="tabs" label="选择课程" />
  </div>
</template>

<style scoped>
.knowledge-tabs :deep(.tabs) {
  border-bottom: 0;
  margin-bottom: 0;
  padding: 5px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
}

.knowledge-tabs :deep(.tab) {
  border: 0;
  border-radius: 10px;
  margin-bottom: 0;
  font-size: 13px;
  padding: 7px 13px;
}

.knowledge-tabs :deep(.tab[aria-selected='true']) {
  background: var(--navy);
  color: #fff;
}
</style>
