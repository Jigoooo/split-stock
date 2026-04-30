import type { z } from 'zod';
import type { EventLogger } from '../../logging/event-logger';
import type { AiProviderConfigWithKey } from '../ai-credentials-repo';

export interface LlmClientOptions {
  logger: EventLogger;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  run: (args: I) => Promise<string>;
}

export interface ChatRequest<T> {
  config: AiProviderConfigWithKey;
  messages: ChatMessage[];
  schema?: z.ZodType<T>;
  schemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  tools?: ToolDef[];
  maxToolIterations?: number;
}

export interface ChatResponse<T> {
  parsed: T | null;
  text: string;
  toolCalls: Array<{ name: string; args: unknown; result: string }>;
}

export type ProviderCallResult<T> = {
  text: string;
  toolCalls: ChatResponse<T>['toolCalls'];
};
