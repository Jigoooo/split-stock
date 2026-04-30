import type { z } from 'zod';
import { callAnthropic } from './llm/anthropic-provider';
import { tryParseJson } from './llm/json-parser';
import { repairJsonResponse } from './llm/json-repair';
import { callOpenAi } from './llm/openai-provider';
import { providerLabel, redactKey } from './llm/redaction';
import type { ChatRequest, ChatResponse, LlmClientOptions, ProviderCallResult } from './llm/types';

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmClientOptions,
  ToolDef,
} from './llm/types';
export { providerLabel, redactKey };

/**
 * OpenAI / Anthropic provider 추상화 클라이언트.
 *
 * Provider별 호출, tool-use loop, JSON repair 는 llm/ 내부 모듈에 두고
 * 이 파일은 기존 public import path 를 보존하는 facade 로만 유지한다.
 */
export class LlmClient {
  constructor(private readonly opts: LlmClientOptions) {}

  async chat<T>(req: ChatRequest<T>): Promise<ChatResponse<T>> {
    const startedAt = Date.now();
    try {
      let { text, toolCalls } = await this.callProvider(req);
      let parsed = req.schema ? tryParseJson(text, req.schema) : null;
      let repaired = false;
      if (req.schema && parsed === null) {
        const repairedText = await repairJsonResponse(
          req as ChatRequest<T> & { schema: z.ZodType<T> },
          text,
          this.opts.logger,
        );
        if (repairedText) {
          const repairedParsed = tryParseJson(repairedText, req.schema);
          if (repairedParsed !== null) {
            text = repairedText;
            parsed = repairedParsed;
            repaired = true;
          }
        }
      }
      this.logOk(req, startedAt, text, toolCalls, parsed, repaired);
      return { parsed, text, toolCalls };
    } catch (cause) {
      const sanitizedMsg = redactKey(
        cause instanceof Error ? cause.message : String(cause),
        req.config.apiKeyPlain,
      );
      this.logFailure(req, startedAt, sanitizedMsg);
      throw new Error(sanitizedMsg);
    }
  }

  async ping(config: ChatRequest<unknown>['config']): Promise<void> {
    try {
      await this.callProvider({
        config,
        messages: [{ role: 'user', content: 'ping. respond with the single word: pong' }],
        maxOutputTokens: 10,
      });
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new Error(redactKey(msg, config.apiKeyPlain));
    }
  }

  private async callProvider<T>(req: ChatRequest<T>): Promise<ProviderCallResult<T>> {
    const provider = req.config.provider;
    if (provider === 'openai') return callOpenAi(req);
    if (provider === 'anthropic') return callAnthropic(req);
    throw new Error(`Unsupported provider: ${provider satisfies never}`);
  }

  private logOk<T>(
    req: ChatRequest<T>,
    startedAt: number,
    text: string,
    toolCalls: ChatResponse<T>['toolCalls'],
    parsed: T | null,
    repaired: boolean,
  ): void {
    this.opts.logger.log({
      level: 'INFO',
      category: 'AI',
      message: 'ai.chat.ok',
      payload: {
        provider: req.config.provider,
        model: req.config.model,
        durationMs: Date.now() - startedAt,
        schemaName: req.schemaName,
        parsedOk: req.schema ? parsed !== null : null,
        repaired,
        chars: text.length,
        toolCalls: toolCalls.length,
      },
    });
  }

  private logFailure<T>(req: ChatRequest<T>, startedAt: number, sanitizedMsg: string): void {
    this.opts.logger.log({
      level: 'ERROR',
      category: 'AI',
      message: 'ai.chat.failed',
      payload: {
        provider: req.config.provider,
        model: req.config.model,
        durationMs: Date.now() - startedAt,
        schemaName: req.schemaName,
        msg: sanitizedMsg,
      },
    });
  }
}
