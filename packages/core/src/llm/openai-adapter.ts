import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { LLMAdapter, ChatOptions } from './types.js';
import { LLMError } from './types.js';
import type { Message, LLMResponse, LLMStreamChunk, LLMConfig, ToolCall } from '../types.js';

/**
 * OpenAI-compatible LLM adapter.
 * Works with any OpenAI-compatible API (OpenAI, Azure, local proxies).
 */
export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse> {
    try {
      const openaiMessages = messages.map(convertMessage);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        ...(options?.tools && options.tools.length > 0 && { tools: options.tools }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new LLMError('No choices returned from LLM');
      }

      const message = choice.message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }));
        return { type: 'tool_calls', toolCalls };
      }

      return { type: 'text', content: message.content ?? '' };
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }
      throw wrapError(error);
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncIterable<LLMStreamChunk> {
    try {
      const openaiMessages = messages.map(convertMessage);
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        stream: true,
        ...(options?.tools && options.tools.length > 0 && { tools: options.tools }),
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      });

      // Accumulate tool call deltas by index
      const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Text content delta
        if (delta.content) {
          yield { type: 'text_delta', content: delta.content };
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, { id: '', name: '', arguments: '' });
            }
            const acc = toolCallAccumulators.get(idx)!;

            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;

            yield {
              type: 'tool_call_delta',
              toolCall: {
                id: acc.id || undefined,
                name: acc.name || undefined,
                arguments: tryParseArguments(acc.arguments),
              },
            };
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }
      throw wrapError(error);
    }
  }
}

/** Convert internal Message to OpenAI SDK format */
function convertMessage(msg: Message): ChatCompletionMessageParam {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content ?? '' };
    case 'user':
      return { role: 'user', content: msg.content ?? '' };
    case 'assistant':
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: 'assistant', content: msg.content ?? '' };
    case 'tool':
      return {
        role: 'tool',
        content: msg.content ?? '',
        tool_call_id: msg.toolCallId ?? '',
      };
  }
}

/** Wrap unknown errors into LLMError */
function wrapError(error: unknown): LLMError {
  if (error instanceof OpenAI.APIError) {
    return new LLMError(
      error.message,
      error.status,
      error,
    );
  }
  if (error instanceof Error) {
    return new LLMError(error.message, undefined, error);
  }
  return new LLMError(String(error), undefined, error);
}

/** Try to parse accumulated arguments JSON; return undefined if incomplete */
function tryParseArguments(args: string): Record<string, unknown> | undefined {
  if (!args) return undefined;
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
