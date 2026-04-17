import { type CreateTRPCReact, createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../../main/trpc/app-router';

/**
 * Renderer용 trpc-react client.
 * main에서 export한 AppRouter 타입을 타입 전용 import로 받아 완전 타입세이프.
 *
 * NOTE: 이 파일은 **타입만** main에서 가져온다. 런타임 import는 없으므로
 * Vite 빌드 시 main 코드가 renderer 번들에 포함되지 않는다.
 *
 * 명시적 타입 annotation은 composite 프로젝트에서 inferred type의 portability 오류
 * (TS 2883: DecorateRouterRecord ...)를 방지하기 위함.
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
