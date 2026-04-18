import type { SettingsRepo } from '../db/settings-repo';
import { maskPayload } from '../logging/event-logger';

export const SENTRY_KEYS = {
  DSN: 'sentry.dsn',
  ENABLE_IN_DEV: 'sentry.enableInDev',
} as const;

/** Sentry event(any) — 실제 @sentry/core 타입 없이 느슨하게 정의. */
export interface SentryEventLike {
  extra?: Record<string, unknown>;
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

/**
 * beforeSend 훅 — Sentry로 전송되는 이벤트에서 PII/secret 필드 마스킹.
 * event-logger와 동일한 maskPayload 규칙으로 재귀 스크러빙.
 * @sentry 모듈 없이 호출 가능하도록 함수 분리.
 */
export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  const cleaned: SentryEventLike = { ...event };
  if (event.extra) cleaned.extra = maskPayload(event.extra) as Record<string, unknown>;
  if (event.request) cleaned.request = maskPayload(event.request) as Record<string, unknown>;
  if (event.user) cleaned.user = maskPayload(event.user) as Record<string, unknown>;
  if (event.contexts) {
    cleaned.contexts = maskPayload(event.contexts) as Record<string, unknown>;
  }
  if (event.tags) cleaned.tags = maskPayload(event.tags) as Record<string, unknown>;
  return cleaned as T;
}

export interface SentryInitDeps {
  settingsRepo: SettingsRepo;
  isPackaged: boolean;
  /** 테스트 주입용 — 실제 Sentry.init은 dynamic import로 lazy 로드. */
  initFn?: (opts: {
    dsn: string;
    environment: string;
    beforeSend: <T extends SentryEventLike>(event: T) => T;
  }) => void;
}

export type SentryInitResult =
  | { active: true; dsn: string; environment: string }
  | { active: false; reason: 'no_dsn' | 'dev_disabled' };

/**
 * settings의 sentry.dsn을 읽어 opt-in으로 @sentry/electron 초기화.
 * - dsn 없으면 no-op
 * - isPackaged=false(dev) 에서는 기본 비활성, settings 'sentry.enableInDev'=='true'일 때만 활성
 * - 실제 Sentry.init은 dynamic import로 안전하게 lazy 로드 (electron 미가동 테스트 환경에서도 안전)
 */
export async function initSentryFromSettings(deps: SentryInitDeps): Promise<SentryInitResult> {
  const dsn = deps.settingsRepo.get(SENTRY_KEYS.DSN);
  if (!dsn || dsn.trim().length === 0) {
    return { active: false, reason: 'no_dsn' };
  }

  if (!deps.isPackaged) {
    const enableInDev = deps.settingsRepo.get(SENTRY_KEYS.ENABLE_IN_DEV);
    if (enableInDev !== 'true') {
      return { active: false, reason: 'dev_disabled' };
    }
  }

  const environment = deps.isPackaged ? 'production' : 'development';

  if (deps.initFn) {
    deps.initFn({ dsn, environment, beforeSend: scrubSentryEvent });
    return { active: true, dsn, environment };
  }

  try {
    const mod = (await import('@sentry/electron/main')) as unknown as {
      init: (opts: {
        dsn: string;
        environment: string;
        beforeSend: (event: unknown) => unknown;
      }) => void;
    };
    mod.init({
      dsn,
      environment,
      beforeSend: (event: unknown) => scrubSentryEvent(event as SentryEventLike),
    });
    return { active: true, dsn, environment };
  } catch {
    return { active: false, reason: 'no_dsn' };
  }
}
