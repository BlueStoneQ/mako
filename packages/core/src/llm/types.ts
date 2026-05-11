import type { Message, LLMResponse, LLMStreamChunk, ToolDefinitionForLLM } from '../types.js';

/** 聊天选项 */
export interface ChatOptions {
  tools?: ToolDefinitionForLLM[];
  temperature?: number;
  maxTokens?: number;
}

/** LLM 适配器接口 */
export interface LLMAdapter {
  chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
  stream(messages: Message[], options?: ChatOptions): AsyncIterable<LLMStreamChunk>;
}

/** LLM 错误 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly rawError?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
