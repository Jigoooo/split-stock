import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
// electron-vite 5는 기본으로 package.json의 dependencies를 자동 external 처리
// (build.externalizeDeps: true가 기본값). electron은 devDependencies이므로
// rollupOptions.external로 수동 추가.
import { defineConfig } from 'electron-vite';

/**
 * .env.local 을 빌드타임에 직접 읽어 main 프로세스에 process.env.* 로 임베드.
 * 사용자 BYO 가 아닌 키(DART/KRX 등)는 빌드 시 코드에 박는다 — 사용자가 따로 발급할 필요 X.
 *
 * dev/packaged 모두 main 코드에서 `process.env.DART_API_KEY` 로 접근.
 */
function loadEnvLocal(): Record<string, string> {
  const envPath = resolve(__dirname, '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

const envLocal = loadEnvLocal();
const EMBEDDED_KEYS = [
  'DART_API_KEY',
  'ECOS_API_KEY',
  'KRX_API_KEY',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
] as const;
const mainDefine: Record<string, string> = {};
for (const key of EMBEDDED_KEYS) {
  mainDefine[`process.env.${key}`] = JSON.stringify(envLocal[key] ?? process.env[key] ?? '');
}

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
    define: mainDefine,
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // electron/native 모듈은 반드시 external — 번들 inline되면
        // Electron 내부 `path.txt` / better-sqlite3 `.node` 바인딩 경로가 깨진다.
        external: ['electron', 'better-sqlite3'],
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
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        // electron-vite rebases the renderer plugin root to `src/renderer`, so these
        // resolve to repo-level `./src/renderer/src/routes` and `./src/renderer/src/routeTree.gen.ts`.
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        quoteStyle: 'single',
        semicolons: true,
      }),
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
