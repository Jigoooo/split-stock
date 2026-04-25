import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { aiProviderConfigs } from '../db/schema';
import type { EventLogger } from '../logging/event-logger';

export type AiProvider = 'openai' | 'anthropic';

export interface AiProviderConfigRow {
  id: number;
  provider: AiProvider;
  model: string;
  apiKeyMasked: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiProviderConfigWithKey extends AiProviderConfigRow {
  /** safeStorage.decryptString 결과 — main 내부 사용만, renderer 로 절대 노출 X. */
  apiKeyPlain: string;
}

export interface SafeStorageHooks {
  isEncryptionAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

export interface AiCredentialsRepoOptions {
  db: Db;
  safeStorage: SafeStorageHooks;
  logger: EventLogger;
  now?: () => Date;
}

export interface CreateAiConfigInput {
  provider: AiProvider;
  model: string;
  apiKey: string;
  isDefault?: boolean | undefined;
}

export interface UpdateAiConfigInput {
  id: number;
  provider?: AiProvider | undefined;
  model?: string | undefined;
  /** undefined 면 기존 키 유지, 빈 문자열은 거부. */
  apiKey?: string | undefined;
  isDefault?: boolean | undefined;
}

/**
 * AI provider 키 저장소.
 *
 * 보안 불변식:
 *   - 평문 키는 절대 DB / 로그 / renderer 로 새지 않는다.
 *   - safeStorage 사용 불가 환경(Linux libsecret 미설치 등) 에서는 등록 자체를 거부.
 *   - apiKeyMasked 는 renderer 안전 표시용 (앞 4자 + ****).
 */
export class AiCredentialsRepo {
  constructor(private readonly opts: AiCredentialsRepoOptions) {}

  list(): AiProviderConfigRow[] {
    const rows = this.opts.db.select().from(aiProviderConfigs).all();
    return rows.map(rowToView);
  }

  get(id: number): AiProviderConfigRow | null {
    const row = this.opts.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, id))
      .get();
    return row ? rowToView(row) : null;
  }

  /**
   * default config 1건을 평문 키와 함께 조회 — main 내부 LLM 호출에만 사용.
   */
  getDefaultWithKey(): AiProviderConfigWithKey | null {
    const row = this.opts.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.isDefault, true))
      .get();
    if (!row) return null;
    return rowToWithKey(row, this.opts.safeStorage);
  }

  getWithKey(id: number): AiProviderConfigWithKey | null {
    const row = this.opts.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, id))
      .get();
    return row ? rowToWithKey(row, this.opts.safeStorage) : null;
  }

  create(input: CreateAiConfigInput): AiProviderConfigRow {
    if (!this.opts.safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage 암호화를 사용할 수 없습니다 (Linux libsecret 등 확인).');
    }
    if (!input.apiKey || input.apiKey.trim().length < 8) {
      throw new Error('API 키가 너무 짧습니다.');
    }
    const trimmed = input.apiKey.trim();
    const encrypted = this.opts.safeStorage.encryptString(trimmed);
    const masked = maskKey(trimmed);
    const now = this.now();

    return this.opts.db.transaction(() => {
      if (input.isDefault) {
        // 기존 default 해제.
        this.opts.db
          .update(aiProviderConfigs)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(aiProviderConfigs.isDefault, true))
          .run();
      }
      const result = this.opts.db
        .insert(aiProviderConfigs)
        .values({
          provider: input.provider,
          model: input.model,
          encryptedApiKey: encrypted,
          apiKeyMasked: masked,
          isDefault: input.isDefault === true,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.config.created',
        payload: { id: result.id, provider: result.provider, model: result.model },
      });
      return rowToView(result);
    });
  }

  update(input: UpdateAiConfigInput): AiProviderConfigRow {
    const row = this.opts.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, input.id))
      .get();
    if (!row) throw new Error(`AI config 미존재: id=${input.id}`);

    const now = this.now();
    const patch: Partial<typeof aiProviderConfigs.$inferInsert> = { updatedAt: now };
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.model !== undefined) patch.model = input.model;
    if (input.apiKey !== undefined) {
      if (input.apiKey.trim().length < 8) {
        throw new Error('API 키가 너무 짧습니다.');
      }
      if (!this.opts.safeStorage.isEncryptionAvailable()) {
        throw new Error('safeStorage 암호화를 사용할 수 없습니다.');
      }
      const trimmed = input.apiKey.trim();
      patch.encryptedApiKey = this.opts.safeStorage.encryptString(trimmed);
      patch.apiKeyMasked = maskKey(trimmed);
    }

    return this.opts.db.transaction(() => {
      if (input.isDefault === true) {
        this.opts.db
          .update(aiProviderConfigs)
          .set({ isDefault: false, updatedAt: now })
          .where(and(eq(aiProviderConfigs.isDefault, true), ne(aiProviderConfigs.id, input.id)))
          .run();
        patch.isDefault = true;
      } else if (input.isDefault === false) {
        patch.isDefault = false;
      }
      const result = this.opts.db
        .update(aiProviderConfigs)
        .set(patch)
        .where(eq(aiProviderConfigs.id, input.id))
        .returning()
        .get();
      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.config.updated',
        payload: {
          id: result.id,
          provider: result.provider,
          model: result.model,
          keyChanged: input.apiKey !== undefined,
        },
      });
      return rowToView(result);
    });
  }

  delete(id: number): void {
    const result = this.opts.db.delete(aiProviderConfigs).where(eq(aiProviderConfigs.id, id)).run();
    if (result.changes > 0) {
      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.config.deleted',
        payload: { id },
      });
    }
  }

  setDefault(id: number): AiProviderConfigRow {
    const now = this.now();
    return this.opts.db.transaction(() => {
      const exists = this.opts.db
        .select({ id: aiProviderConfigs.id })
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.id, id))
        .get();
      if (!exists) throw new Error(`AI config 미존재: id=${id}`);
      this.opts.db
        .update(aiProviderConfigs)
        .set({ isDefault: false, updatedAt: now })
        .where(and(eq(aiProviderConfigs.isDefault, true), ne(aiProviderConfigs.id, id)))
        .run();
      const result = this.opts.db
        .update(aiProviderConfigs)
        .set({ isDefault: true, updatedAt: now })
        .where(eq(aiProviderConfigs.id, id))
        .returning()
        .get();
      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.config.set-default',
        payload: { id: result.id, provider: result.provider, model: result.model },
      });
      return rowToView(result);
    });
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }
}

function rowToView(row: typeof aiProviderConfigs.$inferSelect): AiProviderConfigRow {
  return {
    id: row.id,
    provider: row.provider as AiProvider,
    model: row.model,
    apiKeyMasked: row.apiKeyMasked,
    isDefault: row.isDefault === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToWithKey(
  row: typeof aiProviderConfigs.$inferSelect,
  safeStorage: SafeStorageHooks,
): AiProviderConfigWithKey {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 암호화를 사용할 수 없어 키 복호화 불가.');
  }
  const buf = Buffer.isBuffer(row.encryptedApiKey)
    ? row.encryptedApiKey
    : Buffer.from(row.encryptedApiKey as Uint8Array);
  return {
    ...rowToView(row),
    apiKeyPlain: safeStorage.decryptString(buf),
  };
}

/**
 * 키 마스킹 — 앞 4자 + '****'. 전체 키 길이가 8 미만이면 전체 ****.
 */
export function maskKey(plain: string): string {
  if (plain.length < 8) return '****';
  return `${plain.slice(0, 4)}****`;
}
