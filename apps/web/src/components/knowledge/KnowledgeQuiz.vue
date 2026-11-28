<script setup lang="ts">
/**
 * Three-question single-choice quiz with client-side grading.
 *
 * Answers, explanations and sources come straight from the knowledge payload;
 * every text node is interpolated (no `v-html`).
 */
import { computed, ref, watch } from 'vue';
import type { Quiz } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';

const props = defineProps<{ quiz: Quiz[] }>();

const selected = ref<Array<number | null>>(props.quiz.map(() => null));
/** Frozen answers used for grading; changing radios does not regrade until submit. */
const graded = ref<Array<number | null> | null>(null);
const submitted = ref(false);

watch(
  () => props.quiz,
  (quiz) => {
    selected.value = quiz.map(() => null);
    graded.value = null;
    submitted.value = false;
  },
);

const answered = computed(
  () => graded.value?.filter((value) => value !== null && value !== undefined).length ?? 0,
);

const correct = computed(() => {
  const answers = graded.value;
  if (!answers) return 0;
  return props.quiz.reduce((total, question, index) => {
    return total + (answers[index] === question.answer ? 1 : 0);
  }, 0);
});

const perfect = computed(
  () =>
    submitted.value && answered.value === props.quiz.length && correct.value === props.quiz.length,
);

const scoreText = computed(() => {
  if (!submitted.value) return '';
  if (answered.value < props.quiz.length) {
    return `已作答 ${answered.value}/${props.quiz.length}，答对 ${correct.value}/${props.quiz.length}（已显示全部解析）`;
  }
  return `得分 ${correct.value}/${props.quiz.length}${
    correct.value === props.quiz.length ? '，全部正确！' : '，看解析再试一次'
  }`;
});

function choose(questionIndex: number, optionIndex: number): void {
  selected.value[questionIndex] = optionIndex;
}

function submitQuiz(): void {
  graded.value = [...selected.value];
  submitted.value = true;
}

function resetQuiz(): void {
  selected.value = props.quiz.map(() => null);
  graded.value = null;
  submitted.value = false;
}
</script>

<template>
  <form class="quiz" novalidate @submit.prevent="submitQuiz">
    <fieldset v-for="(question, qi) in quiz" :key="qi" class="quiz-item">
      <legend>
        <span class="qnum">Q{{ qi + 1 }}</span
        >{{ question.q }}
      </legend>

      <div class="options">
        <label
          v-for="(option, oi) in question.options"
          :key="oi"
          class="option"
          :class="{
            right: submitted && oi === question.answer,
            wrong: submitted && graded?.[qi] === oi && oi !== question.answer,
          }"
        >
          <input
            type="radio"
            :name="`knowledge-q${qi}`"
            :value="oi"
            :checked="selected[qi] === oi"
            @change="choose(qi, oi)"
          />
          <span>{{ option }}</span>
        </label>
      </div>

      <p v-if="submitted" class="explain">
        <strong>参考答案：{{ question.options[question.answer] ?? '—' }}</strong>
        ｜{{ question.explanation }}
        <span class="source">依据：{{ question.source }}</span>
      </p>
    </fieldset>

    <div class="quiz-actions">
      <AppButton type="submit">提交答案</AppButton>
      <AppButton variant="ghost" @click="resetQuiz">重做</AppButton>
      <span class="quiz-score" :class="{ perfect }" role="status">{{ scoreText }}</span>
    </div>
  </form>
</template>

<style scoped>
.quiz {
  margin-top: 6px;
}

.quiz-item {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 16px 12px;
  margin: 0 0 11px;
  background: #fcfdff;
}

.quiz-item legend {
  font-weight: 600;
  font-size: 14.5px;
  color: #26304f;
  padding: 0 4px;
}

.qnum {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 8px;
  border-radius: 8px;
  background: var(--navy);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  vertical-align: middle;
}

.options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.option {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 11px;
  background: #fff;
  cursor: pointer;
  font-size: 13.5px;
  transition:
    border-color 0.14s,
    background 0.14s;
}

.option:hover {
  border-color: #b9c9e6;
}

.option input {
  accent-color: var(--navy);
  margin: 0;
}

.option.right {
  background: #edfaf3;
  border-color: #9ddfb9;
}

.option.wrong {
  background: #fff1f1;
  border-color: #f0b0b0;
}

.explain {
  margin-top: 11px;
  font-size: 13px;
  color: #3f4a5f;
  background: #f2f7ff;
  border-left: 3px solid var(--blue);
  border-radius: 8px;
  padding: 10px 12px;
  line-height: 1.7;
}

.explain .source {
  color: #6b7690;
  font-size: 12px;
}

.quiz-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.quiz-score {
  font-size: 13.5px;
  font-weight: 600;
  color: #4b5568;
}

.quiz-score.perfect {
  color: var(--green);
}

@media (max-width: 720px) {
  .options {
    grid-template-columns: 1fr;
  }
}
</style>
