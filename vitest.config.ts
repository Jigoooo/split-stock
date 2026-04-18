import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
  '@shared': resolve(__dirname, 'src/shared'),
};

/**
 * Vitest 4 projects: main/shared는 Node 환경, renderer는 jsdom + jest-dom matchers.
 */
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/index.ts'],
    },
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: [resolve(__dirname, 'vitest.renderer.setup.ts')],
        },
      },
    ],
  },
});
