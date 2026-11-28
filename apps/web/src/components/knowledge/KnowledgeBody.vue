<script setup lang="ts">
/** Full knowledge document: summary, objectives, points, terms, FAQ, quiz, review, sources. */
import { computed } from 'vue';
import type { KnowledgeCourse, KnowledgePayload } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';
import KnowledgeQuiz from './KnowledgeQuiz.vue';

const props = defineProps<{
  course: KnowledgeCourse;
  knowledge: KnowledgePayload;
}>();

const coursePath = computed(() => `/courses/${encodeURIComponent(props.course.id)}`);
const dashboardPath = computed(() => `/dashboard?course=${encodeURIComponent(props.course.name)}`);
</script>

<template>
  <div class="knowledge-layout">
    <div class="knowledge-main">
      <section class="panel summary-panel">
        <div class="summary-label">200 字以内摘要</div>
        <p>{{ knowledge.summary }}</p>
      </section>

      <section class="panel">
        <h2>学习目标</h2>
        <ul class="objective-list">
          <li v-for="(item, index) in knowledge.objectives" :key="index">{{ item }}</li>
        </ul>
      </section>

      <section class="panel">
        <h2>5 个核心知识点</h2>
        <ol class="point-list">
          <li v-for="(item, index) in knowledge.points" :key="index">{{ item }}</li>
        </ol>
      </section>

      <section class="panel">
        <h2>术语解释</h2>
        <div class="term-grid">
          <article v-for="term in knowledge.terms" :key="term.term" class="term-card">
            <h3>{{ term.term }}</h3>
            <p>{{ term.definition }}</p>
          </article>
        </div>
      </section>

      <section class="panel">
        <h2>常见问题 FAQ</h2>
        <div class="faq-list">
          <details
            v-for="(item, index) in knowledge.faq"
            :key="item.q"
            class="faq-item"
            :open="index === 0"
          >
            <summary>{{ item.q }}</summary>
            <p>{{ item.a }}</p>
          </details>
        </div>
      </section>

      <section class="panel" aria-labelledby="knowledgeQuizTitle">
        <div class="panel-head">
          <div>
            <h2 id="knowledgeQuizTitle">随堂小测验</h2>
            <p class="panel-sub">3 道单选题，作答后显示答案、解析与讲义依据。</p>
          </div>
          <span class="tag tag-plain">可交互</span>
        </div>
        <KnowledgeQuiz :quiz="knowledge.quiz" />
      </section>

      <section class="panel review-panel">
        <h2>人工修正记录</h2>
        <p class="panel-sub">保留一处 AI 初稿与人工修正的对照，便于追溯资料核查过程。</p>
        <div class="review-grid">
          <article class="review-before">
            <span class="review-tag">AI 初稿 · 待核对</span>
            <p>{{ knowledge.review.before }}</p>
          </article>
          <article class="review-after">
            <span class="review-tag">人工修正 · 对照原文</span>
            <p>{{ knowledge.review.after }}</p>
          </article>
        </div>
        <p class="review-note">{{ knowledge.review.note }}</p>
      </section>

      <section class="panel">
        <h2>原文摘录（核对用）</h2>
        <p class="panel-sub">
          知识中心的所有结论都可在此找到依据；若发现补充内容，请以此处原文为准。
        </p>
        <div class="original-list">
          <details
            v-for="(excerpt, index) in knowledge.original"
            :key="index"
            class="original-item"
          >
            <summary>{{ excerpt.chapter }}</summary>
            <blockquote>{{ excerpt.text }}</blockquote>
          </details>
        </div>
      </section>
    </div>

    <aside class="knowledge-side">
      <section class="panel side-panel">
        <h2>这门课</h2>
        <dl class="kv">
          <div>
            <dt>课程</dt>
            <dd>{{ course.name }}</dd>
          </div>
          <div>
            <dt>章节数</dt>
            <dd>{{ course.chapters.length }}</dd>
          </div>
          <div>
            <dt>原始讲义</dt>
            <dd>{{ knowledge.source }}</dd>
          </div>
        </dl>
        <AppButton variant="primary" block :to="coursePath">查看课程详情</AppButton>
        <AppButton variant="ghost" block :to="dashboardPath">查看学习数据</AppButton>
      </section>

      <section class="panel side-note-card">
        <h2>提炼规则</h2>
        <ul>
          <li>只依据讲义原文，不补充外部事实。</li>
          <li>每道题标注出处章节，便于人工复核。</li>
          <li>摘要控制在 200 字以内。</li>
        </ul>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.knowledge-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

.knowledge-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.knowledge-side {
  position: sticky;
  top: 84px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.summary-panel {
  background: linear-gradient(180deg, rgba(255, 251, 245, 0.9), rgba(255, 255, 255, 1)), #fff;
  border-left: 5px solid var(--teal);
}

.summary-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.7px;
  color: #0a8c91;
  margin-bottom: 8px;
}

.summary-panel p {
  font-size: 15.5px;
  color: #2a3244;
  line-height: 1.8;
}

.objective-list,
.point-list {
  margin: 8px 0 0;
  padding-left: 20px;
}

.objective-list li,
.point-list li {
  margin: 7px 0;
  font-size: 14px;
  color: #333c4f;
}

.point-list li::marker {
  color: var(--teal);
  font-weight: 700;
}

.term-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 11px;
  margin-top: 10px;
}

.term-card {
  background: #f8fafe;
  border: 1px solid #e4ebf6;
  border-radius: 13px;
  padding: 13px 14px;
}

.term-card h3 {
  font-size: 14px;
  color: #18488b;
  margin-bottom: 4px;
}

.term-card p {
  font-size: 13px;
  color: #4b5568;
}

.faq-list,
.original-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.faq-item,
.original-item {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fbfcfe;
  overflow: hidden;
}

.faq-item summary,
.original-item summary {
  cursor: pointer;
  padding: 12px 34px 12px 15px;
  font-weight: 600;
  font-size: 14px;
  color: #253052;
  list-style: none;
  position: relative;
}

.faq-item summary::-webkit-details-marker,
.original-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::after,
.original-item summary::after {
  content: '＋';
  position: absolute;
  right: 15px;
  top: 11px;
  color: #8a93a6;
  font-weight: 400;
}

.faq-item[open] summary::after,
.original-item[open] summary::after {
  content: '－';
}

.faq-item p {
  padding: 0 15px 14px;
  font-size: 13.5px;
  color: #4b5568;
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.review-before,
.review-after {
  border-radius: 13px;
  padding: 14px 15px;
  font-size: 13.5px;
}

.review-before {
  background: #fff7f7;
  border: 1px solid #f2cece;
}

.review-after {
  background: #f0fbf5;
  border: 1px solid #bfe8cf;
}

.review-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  margin-bottom: 6px;
}

.review-before .review-tag {
  color: #b03b3b;
}

.review-after .review-tag {
  color: #167a4d;
}

.review-note {
  margin-top: 11px;
  font-size: 12.5px;
  color: var(--muted);
  background: #f8f9fc;
  border-radius: 9px;
  padding: 9px 12px;
}

.original-item blockquote {
  margin: 0 0 0 15px;
  padding: 0 18px 16px;
  font-size: 13px;
  color: #4b5568;
  line-height: 1.85;
  border-left: 3px solid #d9e2f0;
  white-space: pre-wrap;
}

.kv {
  margin: 8px 0 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.kv > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 6px;
}

.kv dt {
  color: var(--muted);
}

.kv dd {
  margin: 0;
  color: #2a3244;
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}

.side-note-card ul {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--muted);
}

.side-note-card li {
  margin: 5px 0;
}

@media (max-width: 1080px) {
  .knowledge-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .knowledge-side {
    position: static;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }
}

@media (max-width: 720px) {
  .review-grid {
    grid-template-columns: 1fr;
  }
}
</style>
