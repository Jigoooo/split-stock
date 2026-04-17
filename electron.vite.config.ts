import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * ESM 출력 모듈 상단에 __dirname/__filename shim을 주입한다.
 * Electron main/preload는 번들된 CJS 의존성(electron, trpc-electron 등)이
 * top-level에서 이 전역을 참조하므로, 순수 ESM 환경에서도 반드시 정의 필요.
 */
const ESM_DIRNAME_SHIM = [
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __dirnameFn } from 'node:path';",
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __dirnameFn(__filename);',
].join('\n');

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
        output: {
          format: 'es',
          entryFileNames: '[name].mjs',
          // ESM 모듈이지만 번들된 CJS 의존성(electron/trpc-electron 등)이
          // __dirname/__filename을 참조하므로 top-level에 shim 주입
          banner: ESM_DIRNAME_SHIM,
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
        output: {
          format: 'es',
          entryFileNames: '[name].mjs',
          banner: ESM_DIRNAME_SHIM,
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
      // React Compiler — plugin-react v6가 rolldown용 babel preset을 export,
      // @rolldown/plugin-babel이 이를 rolldown transform 파이프라인에 주입.
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
