import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest 4 config — 현재는 main/shared 테스트(Node 환경)만 커버.
 * renderer(jsdom) 테스트가 추가되면 vitest.renderer.config.ts로 분리 예정.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts'],
    },
  },
});
