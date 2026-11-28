<script setup lang="ts">
/**
 * Chapter quiz: local state only (no API mutation), mirroring v1 `bindQuiz`.
 * Submitting reveals the reference answer, explanation and source for every
 * question; "重做" clears selections and feedback.
 */
import { computed, ref, watch } from 'vue';
import type { Quiz } from '@/api/types';
import AppButton from '@/components/ui/AppButton.vue';

const props = defineProps<{ quiz: Quiz[] }>();

const answers = ref<Array<number | null>>(props.quiz.map(() => null));
const submitted = ref(false);

// The chapter view reuses this component across route params; reset when a
// different chapter's quiz arrives so selections never leak between chapters.
watch(
  () => props.quiz,
  () => {
    answers.value = props.quiz.map(() => null);
    submitted.value = false;
  },
);

const answeredCount = computed(
  () => answers.value.filter((value) => value !== null).length,
);

const correctCount = computed(
  () =>
    props.quiz.reduce((total, question, index) => {
      return answers.value[index] === question.answer ? total + 1 : total;
    }, 0),
);

const isPerfect = computed(
  () =>
    submitted.value &&
    answeredCount.value === props.quiz.length &&
    correctCount.value === props.quiz.length,
);

const scoreText = computed(() => {
  if (!submitted.value) return '';
  const total = props.quiz.length;
  if (answeredCount.value < total) {
    return `已作答 ${answeredCount.value}/${total}，答对 ${correctCount.value}/${total}（已显示全部解析）`;
  }
  return `得分 ${correctCount.value}/${total}${
    correctCount.value === total ? '，全部正确！' : '，看解析再试一次'
  }`;
});

function choose(questionIndex: number, optionIndex: number): void {
  answers.value[questionIndex] = optionIndex;
}

function optionState(question: Quiz, optionIndex: number, questionIndex: number): string {
  if (!submitted.value) return '';
  if (question.answer === optionIndex) return 'right';
  return answers.value[questionIndex] === optionIndex ? 'wrong' : '';
}

function submit(): void {
  submitted.value = true;
}

function reset(): void {
  answers.value = props.quiz.map(() => null);
  submitted.value = false;
}
</script>

<template>
  <form class="quiz" novalidate @submit.prevent="submit">
    <fieldset
      v-for="(question, questionIndex) in quiz"
      :key="questionIndex"
      class="quiz-item"
    >
      <legend>
        <span class="qnum">Q{{ questionIndex + 1 }}</span>{{ question.q }}
      </legend>

      <div class="options">
        <label
          v-for="(option, optionIndex) in question.options"
          :key="optionIndex"
          class="option"
          :class="optionState(question, optionIndex, questionIndex)"
        >
          <input
            type="radio"
            :name="`q${questionIndex}`"
            :value="optionIndex"
            :checked="answers[questionIndex] === optionIndex"
            @change="choose(questionIndex, optionIndex)"
          />
          <span>{{ option }}</span>
        </label>
      </div>

      <div v-if="submitted" class="explain">
        <strong>参考答案：{{ question.options[question.answer] }}</strong>
        <p>{{ question.explanation }}</p>
        <p class="source">依据：{{ question.source }}</p>
      </div>
    </fieldset>

    <div class="quiz-actions">
      <AppButton type="submit" size="sm">提交答案</AppButton>
      <AppButton variant="ghost" size="sm" @click="reset">重做</AppButton>
      <span class="quiz-score" :class="{ perfect: isPerfect }" role="status">
        {{ scoreText }}
      </span>
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
  min-width: 0;
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
  font-weight: 400;
  color: var(--ink);
  transition: border-color 0.14s, background 0.14s;
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

.explain p {
  margin-top: 4px;
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