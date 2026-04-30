import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { z } from 'zod';
import type { EventLogger } from '../../logging/event-logger';
import { buildOpenAiJsonSchema } from './json-schema';
import { buildJsonRepairPrompt, buildJsonRepairSystem } from './prompts';
import { redactKey } from './redaction';
import type { ChatRequest } from './types';

export async function repairJsonResponse<T>(
  req: ChatRequest<T> & { schema: z.ZodType<T> },
  rawText: string,
  logger: EventLogger,
): Promise<string | null> {
  if (!rawText.trim()) return null;
  try {
    if (req.config.provider === 'openai') return repairOpenAiJson(req, rawText);
    if (req.config.provider === 'anthropic') return repairAnthropicJson(req, rawText);
  } catch (cause) {
    logger.log({
      level: 'WARN',
      category: 'SYS',
      message: 'ai.chat.json-repair-failed',
      payload: {
        provider: req.config.provider,
        model: req.config.model,
        schemaName: req.schemaName,
        msg: redactKey(
          cause instanceof Error ? cause.message : String(cause),
          req.config.apiKeyPlain,
        ),
      },
    });
  }
  return null;
}

async function repairOpenAiJson<T>(
  req: ChatRequest<T> & { schema: z.ZodType<T> },
  rawText: string,
): Promise<string | null> {
  const client = new OpenAI({ apiKey: req.config.apiKeyPlain });
  const response = await client.chat.completions.create({
    model: req.config.model,
    max_tokens: req.maxOutputTokens ?? 1024,
    temperature: 0,
    response_format: buildOpenAiJsonSchema(req.schema, `${req.schemaName ?? 'AiResponse'}Repair`),
    messages: [
      { role: 'system', content: buildJsonRepairSystem(req) },
      { role: 'user', content: buildJsonRepairPrompt(req, rawText) },
    ],
  });
  return response.choices[0]?.message.content ?? null;
}

async function repairAnthropicJson<T>(
  req: ChatRequest<T> & { schema: z.ZodType<T> },
  rawText: string,
): Promise<string | null> {
  const client = new Anthropic({ apiKey: req.config.apiKeyPlain });
  const response = await client.messages.create({
    model: req.config.model,
    max_tokens: req.maxOutputTokens ?? 1024,
    temperature: 0,
    system: buildJsonRepairSystem(req),
    messages: [
      { role: 'user', content: buildJsonRepairPrompt(req, rawText) },
      { role: 'assistant', content: '{' },
    ],
  });
  const text = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) return null;
  return text.startsWith('{') ? text : `{${text}`;
}
