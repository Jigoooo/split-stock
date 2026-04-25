import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { z } from 'zod';
import type { EventLogger } from '../logging/event-logger';
import type { AiProvider, AiProviderConfigWithKey } from './ai-credentials-repo';

export interface LlmClientOptions {
  logger: EventLogger;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest<T> {
  config: AiProviderConfigWithKey;
  messages: ChatMessage[];
  /** 응답을 JSON 으로 받기 위한 zod schema. 미지정 시 텍스트 그대로 반환. */
  schema?: z.ZodType<T>;
  /** schema 사용 시 LLM 에 전달할 schema 설명 (한국어). */
  schemaName?: string;
  maxOutputTokens?: number;
}

export interface ChatResponse<T> {
  /** schema 가 주어지고 파싱 성공이면 객체. 아니면 raw text. */
  parsed: T | null;
  text: string;
}

/**
 * OpenAI / Anthropic provider 추상화 클라이언트.
 *
 * - main 프로세스 전용. renderer 에서 직접 호출 X.
 * - 키는 호출자가 AiCredentialsRepo 에서 받아 config 로 주입.
 * - 응답을 JSON 으로 받고 싶으면 schema 를 넘김. parsed 가 null 이면 schema 검증 실패.
 */
export class LlmClient {
  constructor(private readonly opts: LlmClientOptions) {}

  async chat<T>(req: ChatRequest<T>): Promise<ChatResponse<T>> {
    const startedAt = Date.now();
    try {
      const text = await this.callProvider(req);
      const parsed = req.schema ? this.tryParseJson(text, req.schema) : null;
      this.opts.logger.log({
        level: 'INFO',
        category: 'SYS',
        message: 'ai.chat.ok',
        payload: {
          provider: req.config.provider,
          model: req.config.model,
          durationMs: Date.now() - startedAt,
          schemaName: req.schemaName,
          parsedOk: req.schema ? parsed !== null : null,
          chars: text.length,
        },
      });
      return { parsed, text };
    } catch (cause) {
      const sanitizedMsg = redactKey(
        cause instanceof Error ? cause.message : String(cause),
        req.config.apiKeyPlain,
      );
      this.opts.logger.log({
        level: 'ERROR',
        category: 'SYS',
        message: 'ai.chat.failed',
        payload: {
          provider: req.config.provider,
          model: req.config.model,
          durationMs: Date.now() - startedAt,
          schemaName: req.schemaName,
          msg: sanitizedMsg,
        },
      });
      // 평문 키가 SDK 에러 메시지에 포함될 수 있어 sanitize 한 새 Error 로 다시 throw —
      // renderer 토스트로 키가 새지 않도록.
      throw cause instanceof Error ? new Error(sanitizedMsg) : new Error(sanitizedMsg);
    }
  }

  /**
   * 가벼운 ping — 키가 유효한지 1회 호출. 응답 텍스트는 무시.
   * 사용자 "연결 테스트" 버튼에서 호출.
   */
  async ping(config: AiProviderConfigWithKey): Promise<void> {
    try {
      await this.callProvider({
        config,
        messages: [
          {
            role: 'user',
            content: 'ping. respond with the single word: pong',
          },
        ],
        maxOutputTokens: 10,
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new Error(redactKey(msg, config.apiKeyPlain));
    }
  }

  private async callProvider<T>(req: ChatRequest<T>): Promise<string> {
    const provider = req.config.provider;
    if (provider === 'openai') return this.callOpenAi(req);
    if (provider === 'anthropic') return this.callAnthropic(req);
    throw new Error(`Unsupported provider: ${provider satisfies never}`);
  }

  private async callOpenAi<T>(req: ChatRequest<T>): Promise<string> {
    const client = new OpenAI({ apiKey: req.config.apiKeyPlain });
    const systemPrompt = buildSystemPrompt(req);
    const userMessages = req.messages.filter((m) => m.role !== 'system');

    const response = await client.chat.completions.create({
      model: req.config.model,
      max_tokens: req.maxOutputTokens ?? 1024,
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...userMessages.map((m) => ({ role: m.role, content: m.content })),
      ],
      ...(req.schema ? { response_format: { type: 'json_object' as const } } : {}),
    });

    const choice = response.choices[0]?.message?.content;
    return typeof choice === 'string' ? choice : '';
  }

  private async callAnthropic<T>(req: ChatRequest<T>): Promise<string> {
    const client = new Anthropic({ apiKey: req.config.apiKeyPlain });
    const systemPrompt = buildSystemPrompt(req);
    const userMessages = req.messages.filter((m) => m.role !== 'system');

    const response = await client.messages.create({
      model: req.config.model,
      max_tokens: req.maxOutputTokens ?? 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: userMessages.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    });

    const texts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') texts.push(block.text);
    }
    return texts.join('\n');
  }

  private tryParseJson<T>(text: string, schema: z.ZodType<T>): T | null {
    const stripped = stripCodeFence(text).trim();
    if (!stripped) return null;
    try {
      const json = JSON.parse(stripped);
      const parsed = schema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

function buildSystemPrompt<T>(req: ChatRequest<T>): string {
  const baseSystem = req.messages.find((m) => m.role === 'system')?.content ?? '';
  if (!req.schema) return baseSystem;
  // structured output 강제 — Anthropic 은 JSON mode 가 별도 없으므로 system prompt 로 강제.
  const jsonInstr =
    '응답은 반드시 단일 JSON 객체로만 답하세요. 코드 블록(```), 설명, 추가 텍스트 금지.';
  return baseSystem ? `${baseSystem}\n\n${jsonInstr}` : jsonInstr;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    const lastFence = trimmed.lastIndexOf('```');
    if (firstNewline !== -1 && lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim();
    }
  }
  return trimmed;
}

/**
 * 사용자가 카드에 보여줄 provider 식별을 위한 표시 라벨.
 */
export function providerLabel(p: AiProvider): string {
  return p === 'openai' ? 'OpenAI' : 'Claude';
}

/**
 * SDK 에러 메시지에 평문 API 키가 포함될 수 있어 sanitize.
 * - 키 자체와 prefix(앞 4자) 패턴 모두 마스킹.
 * - main 로그 / renderer 토스트 어디로 흘러도 안전하도록 main 측에서 1회 마스킹.
 */
export function redactKey(msg: string, plainKey: string): string {
  if (!msg || !plainKey) return msg;
  let out = msg.split(plainKey).join('[REDACTED]');
  // sk-... 형태 prefix 가 우연히 떠도 추가 마스킹.
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  return out;
}
