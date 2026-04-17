import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
// electron-vite 5는 기본으로 package.json의 dependencies를 자동 external 처리
// (build.externalizeDeps: true가 기본값). electron은 devDependencies이므로
// rollupOptions.external로 수동 추가.
import { defineConfig } from 'electron-vite';

/**
 * Main/Preload 빌드 전략:
 * - 출력은 **CJS (.cjs)** 로 고정.
 *   이유: `electron` 모듈 자체가 CJS-only이며 named exports(`app`, `BrowserWindow`,
 *   `contextBridge` 등)를 제공한다. ESM 출력으로 번들하면 Node.js ESM 로더가
 *   electron의 named export를 분석 못 해 SyntaxError로 로딩 실패.
 * - 소스 코드는 ESM 문법 그대로 (`import { app } from 'electron'`) — Rollup이
 *   CJS output 시 `const { app } = require('electron')` 로 변환하여 호환.
 * - CJS 환경에서 `__dirname`은 native로 자동 제공되므로 별도 shim 불필요.
 *
 * Renderer만 ESM + rolldown + React Compiler(babel preset) 파이프라인 유지.
 */
export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
