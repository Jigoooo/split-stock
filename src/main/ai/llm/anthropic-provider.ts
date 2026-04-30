import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from './json-schema';
import { buildSystemPrompt } from './prompts';
import type { ChatRequest, ChatResponse, ProviderCallResult, ToolDef } from './types';

export async function callAnthropic<T>(req: ChatRequest<T>): Promise<ProviderCallResult<T>> {
  const client = new Anthropic({ apiKey: req.config.apiKeyPlain });
  const systemPrompt = buildSystemPrompt(req);
  const tools = req.tools ?? [];
  const anthropicTools = buildAnthropicTools(tools);
  const conversation: Anthropic.Messages.MessageParam[] = req.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: message.content,
    }));
  const toolCallLog: ChatResponse<T>['toolCalls'] = [];

  for (let iter = 0; iter <= (req.maxToolIterations ?? 4); iter++) {
    const request: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: req.config.model,
      max_tokens: req.maxOutputTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: conversation,
    };
    if (anthropicTools) request.tools = anthropicTools;
    const response = await client.messages.create(request);
    const { texts, toolUses } = parseAnthropicContent(response);
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return { text: texts.join('\n'), toolCalls: toolCallLog };
    }

    conversation.push({ role: 'assistant', content: response.content });
    conversation.push({
      role: 'user',
      content: await runAnthropicTools(toolUses, tools, toolCallLog),
    });
  }

  if (toolCallLog.length > 0) {
    return synthesizeAfterToolLoop(req, client, conversation, systemPrompt, toolCallLog);
  }
  return { text: '', toolCalls: toolCallLog };
}

function buildAnthropicTools(
  tools: ReadonlyArray<ToolDef>,
): Anthropic.Messages.ToolUnion[] | undefined {
  return tools.length > 0
    ? tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: zodToJsonSchema(tool.parameters) as Anthropic.Messages.Tool['input_schema'],
      }))
    : undefined;
}

function parseAnthropicContent(response: Anthropic.Messages.Message) {
  const texts: string[] = [];
  const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of response.content) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'tool_use') {
      toolUses.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return { texts, toolUses };
}

async function runAnthropicTools<T>(
  toolUses: ReadonlyArray<{ id: string; name: string; input: unknown }>,
  tools: ReadonlyArray<ToolDef>,
  toolCallLog: ChatResponse<T>['toolCalls'],
): Promise<Anthropic.Messages.ToolResultBlockParam[]> {
  const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
  for (const toolUse of toolUses) {
    const result = await runValidatedTool(
      toolUse.name,
      toolUse.input,
      tools.find((tool) => tool.name === toolUse.name),
    );
    toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
    toolCallLog.push({ name: toolUse.name, args: toolUse.input, result });
  }
  return toolResults;
}

async function runValidatedTool(
  name: string,
  args: unknown,
  tool: ToolDef | undefined,
): Promise<string> {
  if (!tool) return `Error: unknown tool ${name}`;
  const validated = tool.parameters.safeParse(args);
  if (!validated.success) return `Error: invalid arguments for ${name}: ${validated.error.message}`;
  try {
    return await tool.run(validated.data);
  } catch (cause) {
    return `Error executing ${name}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

async function synthesizeAfterToolLoop<T>(
  req: ChatRequest<T>,
  client: Anthropic,
  conversation: Anthropic.Messages.MessageParam[],
  systemPrompt: string,
  toolCallLog: ChatResponse<T>['toolCalls'],
): Promise<ProviderCallResult<T>> {
  const response = await client.messages.create({
    model: req.config.model,
    max_tokens: req.maxOutputTokens ?? 1024,
    temperature: req.temperature ?? 0.2,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [
      ...conversation,
      {
        role: 'user',
        content:
          '위 도구 결과를 바탕으로 요청된 JSON 형식으로만 최종 답변을 작성하세요. 코드 블록이나 설명 텍스트 없이 순수 JSON만 반환하세요.',
      },
    ],
  });
  const text = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return { text, toolCalls: toolCallLog };
}
