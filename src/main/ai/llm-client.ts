import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import type { EventLogger } from '../logging/event-logger';
import type { AiProvider, AiProviderConfigWithKey } from './ai-credentials-repo';

export interface LlmClientOptions {
  logger: EventLogger;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 이 호출할 수 있는 도구 정의.
 *
 * - parameters 는 zod schema → JSON Schema 자동 변환되어 LLM 에 노출.
 * - run 은 main 프로세스에서 실행 — 사용자 권한·rate limit·타임아웃 모두 caller 책임.
 * - 반환값은 string (LLM 이 다시 입력으로 받음). 큰 객체는 JSON.stringify 로 직렬화.
 */
export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  run: (args: I) => Promise<string>;
}

export interface ChatRequest<T> {
  config: AiProviderConfigWithKey;
  messages: ChatMessage[];
  /** 응답을 JSON 으로 받기 위한 zod schema. 미지정 시 텍스트 그대로 반환. */
  schema?: z.ZodType<T>;
  /** schema 사용 시 LLM 에 전달할 schema 설명 (한국어). */
  schemaName?: string;
  maxOutputTokens?: number;
  /** 결정성 우선 — 기본 0.2. 설명적 출력에서 일관성 유지. 양 provider 동일 의미. */
  temperature?: number;
  /** LLM 이 필요 시 호출할 도구 목록. 비면 단순 single-shot 호출. */
  tools?: ToolDef[];
  /** tool 루프 최대 반복 횟수 — 무한 루프 방지. 기본 4. */
  maxToolIterations?: number;
}

export interface ChatResponse<T> {
  /** schema 가 주어지고 파싱 성공이면 객체. 아니면 raw text. */
  parsed: T | null;
  text: string;
  /** LLM 이 호출한 도구 이름 목록 (호출 순서). 빈 배열이면 도구 미호출. */
  toolCalls: Array<{ name: string; args: unknown; result: string }>;
}

/**
 * OpenAI / Anthropic provider 추상화 클라이언트.
 *
 * - main 프로세스 전용. renderer 에서 직접 호출 X.
 * - 키는 호출자가 AiCredentialsRepo 에서 받아 config 로 주입.
 * - 응답을 JSON 으로 받고 싶으면 schema 를 넘김. parsed 가 null 이면 schema 검증 실패.
 * - tools 를 넘기면 양 provider 모두 동일한 tool-use 루프로 LLM 이 추가 정보 수집 가능.
 */
export class LlmClient {
  constructor(private readonly opts: LlmClientOptions) {}

  async chat<T>(req: ChatRequest<T>): Promise<ChatResponse<T>> {
    const startedAt = Date.now();
    try {
      const { text, toolCalls } = await this.callProvider(req);
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
          toolCalls: toolCalls.length,
        },
      });
      return { parsed, text, toolCalls };
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

  private async callProvider<T>(
    req: ChatRequest<T>,
  ): Promise<{ text: string; toolCalls: ChatResponse<T>['toolCalls'] }> {
    const provider = req.config.provider;
    if (provider === 'openai') return this.callOpenAi(req);
    if (provider === 'anthropic') return this.callAnthropic(req);
    throw new Error(`Unsupported provider: ${provider satisfies never}`);
  }

  private async callOpenAi<T>(
    req: ChatRequest<T>,
  ): Promise<{ text: string; toolCalls: ChatResponse<T>['toolCalls'] }> {
    const client = new OpenAI({ apiKey: req.config.apiKeyPlain });
    const systemPrompt = buildSystemPrompt(req);
    const userMessages = req.messages.filter((m) => m.role !== 'system');

    const responseFormat = req.schema
      ? buildOpenAiJsonSchema(req.schema, req.schemaName ?? 'AiResponse')
      : undefined;

    const tools = req.tools ?? [];
    const openAiTools =
      tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: zodToJsonSchema(t.parameters),
            },
          }))
        : undefined;

    const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const toolCallLog: ChatResponse<T>['toolCalls'] = [];
    const maxIters = req.maxToolIterations ?? 4;

    for (let iter = 0; iter <= maxIters; iter++) {
      // response_format 는 항상 적용 — content 필드에만 영향, tool_calls 와 공존 가능.
      // OpenAI 가 tool 을 부르면 content 가 비고 tool_calls 채움 / 더 이상 안 부르면 content 에 schema 따른 JSON.
      const response = await client.chat.completions.create({
        model: req.config.model,
        max_tokens: req.maxOutputTokens ?? 1024,
        temperature: req.temperature ?? 0.2,
        messages: conversation,
        ...(openAiTools ? { tools: openAiTools } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });

      const choice = response.choices[0]?.message;
      if (!choice) return { text: '', toolCalls: toolCallLog };

      // tool_calls 가 없으면 종료. function-type tool 만 처리 (custom tool 미지원).
      const functionCalls = (choice.tool_calls ?? []).filter(
        (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === 'function',
      );
      if (functionCalls.length === 0) {
        return {
          text: typeof choice.content === 'string' ? choice.content : '',
          toolCalls: toolCallLog,
        };
      }

      conversation.push({
        role: 'assistant',
        ...(choice.content ? { content: choice.content } : { content: null }),
        tool_calls: functionCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      // 도구 실행.
      for (const tc of functionCalls) {
        const fnName = tc.function.name;
        const fnArgs = tc.function.arguments;
        const tool = tools.find((t) => t.name === fnName);
        let result: string;
        let parsedArgs: unknown = null;
        try {
          parsedArgs = JSON.parse(fnArgs);
        } catch {
          result = `Error: invalid JSON arguments for ${fnName}`;
          conversation.push({ role: 'tool', tool_call_id: tc.id, content: result });
          toolCallLog.push({ name: fnName, args: fnArgs, result });
          continue;
        }
        if (!tool) {
          result = `Error: unknown tool ${fnName}`;
        } else {
          const validated = tool.parameters.safeParse(parsedArgs);
          if (!validated.success) {
            result = `Error: invalid arguments for ${fnName}: ${validated.error.message}`;
          } else {
            try {
              result = await tool.run(validated.data);
            } catch (e) {
              result = `Error executing ${fnName}: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }
        conversation.push({ role: 'tool', tool_call_id: tc.id, content: result });
        toolCallLog.push({ name: fnName, args: parsedArgs, result });
      }
    }

    // 반복 한도 도달 — 마지막 라운드 결과로 final 응답 강제.
    return { text: '', toolCalls: toolCallLog };
  }

  private async callAnthropic<T>(
    req: ChatRequest<T>,
  ): Promise<{ text: string; toolCalls: ChatResponse<T>['toolCalls'] }> {
    const client = new Anthropic({ apiKey: req.config.apiKeyPlain });
    const systemPrompt = buildSystemPrompt(req);
    const userMessages = req.messages.filter((m) => m.role !== 'system');

    const tools = req.tools ?? [];
    const anthropicTools: Anthropic.Messages.Tool[] | undefined =
      tools.length > 0
        ? tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: zodToJsonSchema(t.parameters) as Anthropic.Messages.Tool['input_schema'],
          }))
        : undefined;

    const conversation: Anthropic.Messages.MessageParam[] = userMessages.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));
    const toolCallLog: ChatResponse<T>['toolCalls'] = [];
    const maxIters = req.maxToolIterations ?? 4;

    for (let iter = 0; iter <= maxIters; iter++) {
      const response = await client.messages.create({
        model: req.config.model,
        max_tokens: req.maxOutputTokens ?? 1024,
        temperature: req.temperature ?? 0.2,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        messages: conversation,
      });

      const stopReason = response.stop_reason;
      const texts: string[] = [];
      const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
      for (const block of response.content) {
        if (block.type === 'text') texts.push(block.text);
        else if (block.type === 'tool_use') {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      // tool_use 없으면 종료.
      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        return { text: texts.join('\n'), toolCalls: toolCallLog };
      }

      // assistant 의 응답(tool_use 블록 포함) 그대로 conversation 에 추가.
      conversation.push({
        role: 'assistant',
        content: response.content,
      });

      // 모든 tool_use 를 한 번의 user 메시지로 묶어 결과 전달.
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const tool = tools.find((t) => t.name === tu.name);
        let result: string;
        if (!tool) {
          result = `Error: unknown tool ${tu.name}`;
        } else {
          const validated = tool.parameters.safeParse(tu.input);
          if (!validated.success) {
            result = `Error: invalid arguments for ${tu.name}: ${validated.error.message}`;
          } else {
            try {
              result = await tool.run(validated.data);
            } catch (e) {
              result = `Error executing ${tu.name}: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
        toolCallLog.push({ name: tu.name, args: tu.input, result });
      }
      conversation.push({ role: 'user', content: toolResults });
    }

    return { text: '', toolCalls: toolCallLog };
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

function zodToJsonSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * zod schema → OpenAI json_schema response_format.
 *
 * - additionalProperties: false 강제 (strict 모드 요구사항)
 * - 객체의 모든 properties 를 required 로 (OpenAI strict 가 모든 필드를 요구)
 * - default 가 있는 필드는 zod 가 optional 처리하지만 strict 에서는 명시 필요 → 클라이언트 측 strict=false
 *   로 fallback (parse 실패율 ↓ 효과는 유지). zod default 는 응답 검증 단에서 적용.
 */
function buildOpenAiJsonSchema<T>(
  schema: z.ZodType<T>,
  name: string,
): {
  type: 'json_schema';
  json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
} {
  const jsonSchema = zodToJsonSchema(schema);
  // strict=false — zod default 필드가 optional 인 경우 strict 가 거부할 수 있어 안전하게.
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: sanitizeSchemaName(name),
      schema: jsonSchema,
      strict: false,
    },
  };
}

function sanitizeSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
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
