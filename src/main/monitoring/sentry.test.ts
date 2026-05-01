import { describe, expect, it, vi } from 'vitest';
import { bootstrapSchema } from '../db/bootstrap-schema';
import { createTestDb } from '../db/client';
import { SettingsRepo } from '../db/settings-repo';
import {
  initSentryFromSettings,
  SENTRY_KEYS,
  type SentryEventLike,
  scrubSentryEvent,
} from './sentry';

function setupSettings(): SettingsRepo {
  const db = createTestDb();
  bootstrapSchema(db);
  return new SettingsRepo(db);
}

describe('scrubSentryEvent', () => {
  it('extra.appKey/appSecret/token 필드를 maskPayload 규칙으로 마스킹', () => {
    const event: SentryEventLike = {
      extra: {
        appKey: 'ABCDEFGHIJKL1234',
        accessKey: 'UPBITACCESSKEY1234',
        secretKey: 'UPBITSECRETKEY1234',
        pdno: '005930',
        nested: { token: 'SECRET_TOKEN_XYZ1' },
      },
    };
    const scrubbed = scrubSentryEvent(event);
    const extra = scrubbed.extra as {
      accessKey: string;
      appKey: string;
      pdno: string;
      secretKey: string;
      nested: { token: string };
    };
    expect(extra.appKey).toBe('************1234');
    expect(extra.accessKey).toBe('**************1234');
    expect(extra.secretKey).toBe('**************1234');
    expect(extra.pdno).toBe('005930');
    expect(extra.nested.token).not.toContain('SECRET_TOKEN');
    expect(extra.nested.token.endsWith('XYZ1')).toBe(true);
  });

  it('user/request/contexts/tags 모두 마스킹', () => {
    const event: SentryEventLike = {
      user: { token: 'USERSECRET1234' },
      request: { authorization: 'Bearer SUPERSECRETAUTH5678' },
      contexts: { auth: { appSecret: 'VERYLONGSECRETVAL' } },
      tags: { password: 'plaintextplaintext' },
    };
    const scrubbed = scrubSentryEvent(event);
    expect((scrubbed.user as { token: string }).token).not.toContain('USERSECRET');
    expect((scrubbed.request as { authorization: string }).authorization).not.toContain(
      'SUPERSECRETAUTH',
    );
    expect((scrubbed.contexts as { auth: { appSecret: string } }).auth.appSecret).not.toContain(
      'VERYLONGSECRET',
    );
  });

  it('민감 필드 없는 이벤트는 동일 구조 유지', () => {
    const event: SentryEventLike = { extra: { pdno: '005930', qty: 10 } };
    const scrubbed = scrubSentryEvent(event);
    expect(scrubbed.extra).toEqual({ pdno: '005930', qty: 10 });
  });
});

describe('initSentryFromSettings', () => {
  it('DSN 없으면 no_dsn 반환 (initFn 미호출)', async () => {
    const settings = setupSettings();
    const initFn = vi.fn();
    const r = await initSentryFromSettings({
      settingsRepo: settings,
      isPackaged: true,
      initFn,
    });
    expect(r).toEqual({ active: false, reason: 'no_dsn' });
    expect(initFn).not.toHaveBeenCalled();
  });

  it('DSN 있고 packaged → active', async () => {
    const settings = setupSettings();
    settings.set(SENTRY_KEYS.DSN, 'https://key@example.sentry.io/1');
    const initFn = vi.fn();
    const r = await initSentryFromSettings({
      settingsRepo: settings,
      isPackaged: true,
      initFn,
    });
    expect(r.active).toBe(true);
    if (r.active) {
      expect(r.environment).toBe('production');
      expect(r.dsn).toContain('example.sentry.io');
    }
    expect(initFn).toHaveBeenCalledOnce();
  });

  it('dev 기본 비활성: DSN 있어도 reason=dev_disabled', async () => {
    const settings = setupSettings();
    settings.set(SENTRY_KEYS.DSN, 'https://key@example.sentry.io/1');
    const r = await initSentryFromSettings({
      settingsRepo: settings,
      isPackaged: false,
      initFn: vi.fn(),
    });
    expect(r).toEqual({ active: false, reason: 'dev_disabled' });
  });

  it('dev 활성: enableInDev=true 명시적 opt-in 시 active', async () => {
    const settings = setupSettings();
    settings.set(SENTRY_KEYS.DSN, 'https://key@example.sentry.io/1');
    settings.set(SENTRY_KEYS.ENABLE_IN_DEV, 'true');
    const r = await initSentryFromSettings({
      settingsRepo: settings,
      isPackaged: false,
      initFn: vi.fn(),
    });
    expect(r.active).toBe(true);
    if (r.active) expect(r.environment).toBe('development');
  });

  it('beforeSend 훅이 scrub 규칙을 그대로 사용', async () => {
    const settings = setupSettings();
    settings.set(SENTRY_KEYS.DSN, 'https://key@example.sentry.io/1');
    let capturedBeforeSend: ((e: SentryEventLike) => SentryEventLike) | null = null;
    await initSentryFromSettings({
      settingsRepo: settings,
      isPackaged: true,
      initFn: ({ beforeSend }) => {
        capturedBeforeSend = beforeSend;
      },
    });
    if (!capturedBeforeSend) throw new Error('beforeSend not captured');
    const scrubbed = (capturedBeforeSend as (e: SentryEventLike) => SentryEventLike)({
      extra: { appKey: 'ABCDEFGHIJKL1234' },
    });
    expect((scrubbed.extra as { appKey: string }).appKey).toBe('************1234');
  });
});
