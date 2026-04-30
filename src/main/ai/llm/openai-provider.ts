import OpenAI from 'openai';
import { buildOpenAiJsonSchema, zodToJsonSchema } from './json-schema';
import { buildSystemPrompt } from './prompts';
import type { ChatRequest, ChatResponse, ProviderCallResult, ToolDef } from './types';

export async function callOpenAi<T>(req: ChatRequest<T>): Promise<ProviderCallResult<T>> {
  const client = new OpenAI({ apiKey: req.config.apiKeyPlain });
  const systemPrompt = buildSystemPrompt(req);
  const userMessages = req.messages.filter((message) => message.role !== 'system');
  const responseFormat = req.schema
    ? buildOpenAiJsonSchema(req.schema, req.schemaName ?? 'AiResponse')
    : undefined;
  const tools = req.tools ?? [];
  const openAiTools = buildOpenAiTools(tools);
  const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...userMessages.map((message) => ({ role: message.role, content: message.content })),
  ];
  const toolCallLog: ChatResponse<T>['toolCalls'] = [];

  for (let iter = 0; iter <= (req.maxToolIterations ?? 4); iter++) {
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

    const functionCalls = (choice.tool_calls ?? []).filter(
      (toolCall): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        toolCall.type === 'function',
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
      tool_calls: functionCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })),
    });
    for (const toolCall of functionCalls) {
      await runOpenAiTool(toolCall, tools, conversation, toolCallLog);
    }
  }

  return { text: '', toolCalls: toolCallLog };
}

function buildOpenAiTools(tools: ReadonlyArray<ToolDef>) {
  return tools.length > 0
    ? tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToJsonSchema(tool.parameters),
        },
      }))
    : undefined;
}

async function runOpenAiTool<T>(
  toolCall: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
  tools: ReadonlyArray<ToolDef>,
  conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  toolCallLog: ChatResponse<T>['toolCalls'],
): Promise<void> {
  const fnName = toolCall.function.name;
  const fnArgs = toolCall.function.arguments;
  const tool = tools.find((candidate) => candidate.name === fnName);
  let result: string;
  let parsedArgs: unknown = null;
  try {
    parsedArgs = JSON.parse(fnArgs);
  } catch {
    result = `Error: invalid JSON arguments for ${fnName}`;
    conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    toolCallLog.push({ name: fnName, args: fnArgs, result });
    return;
  }

  result = await runValidatedTool(fnName, parsedArgs, tool);
  conversation.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
  toolCallLog.push({ name: fnName, args: parsedArgs, result });
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
