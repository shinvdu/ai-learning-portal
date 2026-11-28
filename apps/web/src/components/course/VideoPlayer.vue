<script setup lang="ts">
import type { CourseVideo } from '@/api/types';

withDefaults(
  defineProps<{
    video: CourseVideo;
    /** Accessible name for the player (course / chapter context). */
    label: string;
  }>(),
  {},
);
</script>

<template>
  <div class="video-frame">
    <video controls preload="metadata" playsinline :poster="video.poster" :aria-label="label">
      <source :src="video.src" type="video/mp4" />
      你的浏览器不支持视频播放，可<a :href="video.src" download>下载视频</a>。
    </video>
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
</style>