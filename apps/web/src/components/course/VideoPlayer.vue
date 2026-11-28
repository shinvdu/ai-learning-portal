<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CourseVideo } from '@/api/types';

const props = withDefaults(
  defineProps<{
    video: CourseVideo;
    /** Accessible name for the player (course / chapter context). */
    label: string;
  }>(),
  {},
);

/** Common extensions; unknown extensions omit `type` so the browser sniffs. */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
};

const sourceType = computed(() => {
  const clean = props.video.src.split('#')[0]?.split('?')[0] ?? '';
  const ext = clean.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXT[ext] ?? '';
});

const loading = ref(true);
const failed = ref(false);

watch(
  () => props.video.src,
  () => {
    loading.value = true;
    failed.value = false;
  },
);

function onReady(): void {
  loading.value = false;
  failed.value = false;
}

function onError(): void {
  loading.value = false;
  failed.value = true;
}
</script>

<template>
  <div class="video-frame">
    <video
      controls
      preload="metadata"
      playsinline
      :poster="video.poster"
      :aria-label="label"
      :aria-busy="loading || undefined"
      @loadeddata="onReady"
      @canplay="onReady"
      @error="onError"
    >
      <source :src="video.src" :type="sourceType || undefined" />
      你的浏览器不支持视频播放，可<a :href="video.src" download>下载视频</a>。
    </video>

    <p v-if="loading && !failed" class="video-status" aria-live="polite">视频加载中…</p>
    <p v-else-if="failed" class="video-status video-status-error" role="alert">
      视频加载失败，可能是格式不支持或文件暂时不可用。
      <a :href="video.src" download>下载视频</a>
    </p>
  </div>
</template>

<style scoped>
.video-frame {
  position: relative;
  z-index: 1;
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 22px 50px -22px rgba(0, 0, 0, 0.85);
}

.video-frame video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}

.video-status {
  position: absolute;
  left: 10px;
  top: 10px;
  margin: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 40, 0.72);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.video-status-error {
  pointer-events: auto;
  background: rgba(90, 1, 1, 0.82);
}

.video-status a {
  color: #fff;
  text-decoration: underline;
  margin-left: 4px;
}
</style>