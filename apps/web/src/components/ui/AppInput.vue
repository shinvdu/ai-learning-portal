<script setup lang="ts">
import { computed, useId } from 'vue';

const model = defineModel<string | number>({ default: '' });

const props = withDefaults(
  defineProps<{
    id?: string;
    label?: string;
    type?: string;
    name?: string;
    placeholder?: string;
    autocomplete?: string;
    inputmode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';
    hint?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    maxlength?: number;
    minlength?: number;
    min?: number | string;
    max?: number | string;
    step?: number | string;
  }>(),
  { type: 'text' },
);

const uid = useId();
const inputId = computed(() => props.id ?? `field-${uid}`);
const errorId = computed(() => `${inputId.value}-error`);
const hintId = computed(() => `${inputId.value}-hint`);

const describedBy = computed(() => {
  const ids = [props.hint ? hintId.value : '', props.error ? errorId.value : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
});

function onInput(event: Event): void {
  model.value = (event.target as HTMLInputElement).value;
}
</script>

<template>
  <label class="field" :for="inputId">
    <span v-if="label" class="field-label">
      {{ label }}
      <span v-if="required" class="field-required" aria-hidden="true">*</span>
    </span>

    <input
      :id="inputId"
      :type="type"
      :name="name"
      :value="model"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :required="required"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxlength"
      :minlength="minlength"
      :min="min"
      :max="max"
      :step="step"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
      @input="onInput"
    />

    <span v-if="hint" :id="hintId" class="field-hint">{{ hint }}</span>
    <span v-if="error" :id="errorId" class="field-error" role="alert">{{ error }}</span>
  </label>
</template>