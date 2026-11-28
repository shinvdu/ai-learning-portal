<script setup lang="ts">
/**
 * Renders lecture plain text as paragraphs and lists without `v-html`.
 *
 * Blocks are separated by blank lines (the v1 `lectureHtml` rule). Within a
 * block, `- item` lines become `<ul>`, `1. item` / `1、item` lines become `<ol>`
 * and everything else is a paragraph. Content is interpolated by Vue, so any
 * markup in the source stays literal text.
 */
import { computed } from 'vue';

type Block =
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] };

const props = defineProps<{ body: string }>();

function parseLecture(body: string): Block[] {
  const blocks: Block[] = [];

  for (const rawBlock of body.split(/\n{2,}/)) {
    const lines = rawBlock
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let openList: { type: 'ul' | 'ol'; items: string[] } | null = null;

    for (const line of lines) {
      const bullet = line.match(/^-\s+(.*)$/);
      const numbered = line.match(/^\d+[.、]\s*(.*)$/);

      if (bullet || numbered) {
        const type: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
        const text = (bullet ? bullet[1] : numbered?.[1]) ?? '';
        if (openList && openList.type === type) {
          openList.items.push(text);
        } else {
          openList = { type, items: [text] };
          blocks.push(openList);
        }
      } else {
        openList = null;
        blocks.push({ type: 'p', text: line });
      }
    }
  }

  return blocks;
}

const blocks = computed(() => parseLecture(props.body ?? ''));
</script>

<template>
  <div class="lecture-text">
    <template v-for="(block, index) in blocks" :key="index">
      <p v-if="block.type === 'p'">{{ block.text }}</p>
      <ul v-else-if="block.type === 'ul'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ item }}</li>
      </ul>
      <ol v-else>
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ item }}</li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.lecture-text {
  background: var(--cream);
  border: 1px solid #f2e7d5;
  border-left: 4px solid var(--teal);
  border-radius: 12px;
  padding: 18px 20px;
  font-size: 14px;
  line-height: 1.95;
  color: #333c4f;
}

.lecture-text p {
  margin: 0 0 12px;
}

.lecture-text p:last-child {
  margin-bottom: 0;
}

.lecture-text ul,
.lecture-text ol {
  margin: 8px 0 14px;
  padding-left: 22px;
}

.lecture-text li {
  margin: 5px 0;
}
</style>