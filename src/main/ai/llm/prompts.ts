import type { z } from 'zod';
import { zodToJsonSchema } from './json-schema';
import type { ChatRequest } from './types';

export function buildSystemPrompt<T>(req: ChatRequest<T>): string {
  const baseSystem = req.messages.find((message) => message.role === 'system')?.content ?? '';
  if (!req.schema) return baseSystem;
  const jsonInstr =
    '응답은 반드시 단일 JSON 객체로만 답하세요. 코드 블록(```), 설명, 추가 텍스트 금지.';
  return baseSystem ? `${baseSystem}\n\n${jsonInstr}` : jsonInstr;
}

export function buildJsonRepairSystem<T>(req: ChatRequest<T> & { schema: z.ZodType<T> }): string {
  return [
    '당신은 JSON repair 엔진입니다.',
    '입력으로 받은 assistant 응답을 요청 schema 에 맞는 단일 JSON 객체로 변환하세요.',
    '설명문, 마크다운, 코드 블록, 접두사, 접미사는 절대 출력하지 마세요.',
    '문자열은 schema 의 maxLength 제약을 넘지 않게 핵심만 남겨 짧게 줄이세요.',
    `schemaName: ${req.schemaName ?? 'AiResponse'}`,
  ].join('\n');
}

export function buildJsonRepairPrompt<T>(
  req: ChatRequest<T> & { schema: z.ZodType<T> },
  rawText: string,
): string {
  return [
    'JSON Schema:',
    JSON.stringify(zodToJsonSchema(req.schema)),
    '',
    'Original assistant response:',
    rawText.slice(0, 16_000),
    '',
    'Return only the JSON object.',
  ].join('\n');
}
