import { QueryClient } from '@tanstack/react-query';

/**
 * Renderer QueryClient 설정.
 * IPC 기반이라 network mode 'always' — 브라우저 온오프라인 이벤트는 의미 없음.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        networkMode: 'always',
        retry: 0,
      },
    },
  });
}
