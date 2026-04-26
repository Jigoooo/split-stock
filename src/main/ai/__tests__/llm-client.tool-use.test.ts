import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiProviderConfigWithKey } from '../ai-credentials-repo';

/* ────────── SDK 모듈 mock ────────── */

const openAiCreateMock = vi.fn();
const anthropicCreateMock = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: openAiCreateMock } };
  }
  return { default: MockOpenAI };
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: anthropicCreateMock };
  }
  return { default: MockAnthropic };
});

/** 모킹된 logger — payload 만 모은다. */
const loggedEvents: Array<{ message: string; payload: unknown }> = [];
const stubLogger = {
  log: (e: { message: string; payload: unknown }) => {
    loggedEvents.push({ message: e.message, payload: e.payload });
  },
} as unknown as import('../../logging/event-logger').EventLogger;

const openaiConfig: AiProviderConfigWithKey = {
  id: 1,
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyPlain: 'sk-test-openai',
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AiProviderConfigWithKey;

const anthropicConfig: AiProviderConfigWithKey = {
  id: 2,
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  apiKeyPlain: 'sk-ant-test-key',
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AiProviderConfigWithKey;

beforeEach(() => {
  openAiCreateMock.mockReset();
  anthropicCreateMock.mockReset();
  loggedEvents.length = 0;
});

describe('LlmClient — OpenAI tool 루프', () => {
  it('도구 호출 1회 → run 콜백 받은 args 검증 → 다음 응답에 schema 적용된 JSON', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });
    const runSpy = vi.fn().mockResolvedValue('{"date":"2026-04-26","title":"테스트"}');

    // 1차 응답 — 도구 호출.
    openAiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search_news', arguments: '{"query":"삼성","max":3}' },
              },
            ],
          },
        },
      ],
    });
    // 2차 응답 — 최종 JSON.
    openAiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '{"answer":"ok"}',
            tool_calls: null,
          },
        },
      ],
    });

    const result = await client.chat({
      config: openaiConfig,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'fetch news' },
      ],
      schema: z.object({ answer: z.string() }),
      tools: [
        {
          name: 'search_news',
          description: 'mock',
          parameters: z.object({ query: z.string(), max: z.number() }),
          run: runSpy,
        },
      ],
    });

    expect(runSpy).toHaveBeenCalledWith({ query: '삼성', max: 3 });
    expect(result.parsed).toEqual({ answer: 'ok' });
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]?.name).toBe('search_news');

    // Advisor critical check: OpenAI 호출 시 response_format 이 항상 적용되는지.
    // 1차/2차 모두 schema 가 들어가야 함 (content 가 비어도 도구 후 response 는 JSON 형식 강제).
    expect(openAiCreateMock).toHaveBeenCalledTimes(2);
    const first = openAiCreateMock.mock.calls[0]?.[0];
    const second = openAiCreateMock.mock.calls[1]?.[0];
    expect(first.response_format).toBeDefined();
    expect(second.response_format).toBeDefined();
    expect(first.tools).toBeDefined();
    expect(first.temperature).toBe(0.2);
  });

  it('잘못된 tool 인자 → schema 검증 실패 후 에러 메시지를 LLM 에 다시 전달', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });
    const runSpy = vi.fn();

    openAiCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search_news', arguments: '{"query":42}' }, // 잘못된 타입
              },
            ],
          },
        },
      ],
    });
    openAiCreateMock.mockResolvedValueOnce({
      choices: [
        { message: { role: 'assistant', content: '{"answer":"recovered"}', tool_calls: null } },
      ],
    });

    const result = await client.chat({
      config: openaiConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema: z.object({ answer: z.string() }),
      tools: [
        {
          name: 'search_news',
          description: 'mock',
          parameters: z.object({ query: z.string() }),
          run: runSpy,
        },
      ],
    });

    expect(runSpy).not.toHaveBeenCalled();
    expect(result.parsed).toEqual({ answer: 'recovered' });
    expect(result.toolCalls[0]?.result).toContain('Error: invalid arguments');
  });

  it('도구 미호출 시 1회로 종료 + schema 파싱', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });

    openAiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: '{"answer":"direct"}' } }],
    });

    const result = await client.chat({
      config: openaiConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema: z.object({ answer: z.string() }),
      tools: [],
    });
    expect(openAiCreateMock).toHaveBeenCalledTimes(1);
    expect(result.parsed).toEqual({ answer: 'direct' });
    expect(result.toolCalls).toEqual([]);
  });
});

describe('LlmClient — Anthropic tool 루프', () => {
  it('tool_use 응답 → run 호출 → 최종 JSON 응답 파싱', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });
    const runSpy = vi.fn().mockResolvedValue('disclosure data');

    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: '검색합니다' },
        { type: 'tool_use', id: 'tu_1', name: 'get_dart', input: { code: 'A001' } },
      ],
    });
    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"answer":"final"}' }],
    });

    const result = await client.chat({
      config: anthropicConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema: z.object({ answer: z.string() }),
      tools: [
        {
          name: 'get_dart',
          description: 'mock',
          parameters: z.object({ code: z.string() }),
          run: runSpy,
        },
      ],
    });

    expect(runSpy).toHaveBeenCalledWith({ code: 'A001' });
    expect(result.parsed).toEqual({ answer: 'final' });
    expect(result.toolCalls.length).toBe(1);
    expect(anthropicCreateMock).toHaveBeenCalledTimes(2);
    // temperature 0.2 기본 — 양 provider 동등.
    expect(anthropicCreateMock.mock.calls[0]?.[0]?.temperature).toBe(0.2);
  });

  it('Anthropic 도 응답 stop_reason=end_turn 시 1회로 종료', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });

    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"answer":"direct"}' }],
    });

    const result = await client.chat({
      config: anthropicConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema: z.object({ answer: z.string() }),
    });

    expect(result.parsed).toEqual({ answer: 'direct' });
    expect(result.toolCalls).toEqual([]);
  });
});

describe('LlmClient — provider 동등성', () => {
  it('동일 schema·tools 입력 시 양쪽 모두 toolCalls + parsed 형태 반환 contract 준수', async () => {
    const { LlmClient } = await import('../llm-client');
    const client = new LlmClient({ logger: stubLogger });

    openAiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"v":1}' } }],
    });
    anthropicCreateMock.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"v":2}' }],
    });

    const schema = z.object({ v: z.number() });
    const a = await client.chat({
      config: openaiConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema,
    });
    const b = await client.chat({
      config: anthropicConfig,
      messages: [{ role: 'user', content: 'go' }],
      schema,
    });

    // Contract: 두 응답 모두 { parsed, text, toolCalls } 형태 — Provider 차이 흡수 검증.
    for (const r of [a, b]) {
      expect(r).toHaveProperty('parsed');
      expect(r).toHaveProperty('text');
      expect(r).toHaveProperty('toolCalls');
      expect(Array.isArray(r.toolCalls)).toBe(true);
    }
    expect(a.parsed).toEqual({ v: 1 });
    expect(b.parsed).toEqual({ v: 2 });
  });
});
