/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 对话消息 */
export interface Message {
  role: MessageRole;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** LLM 响应 */
export type LLMResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[] };

/** LLM 流式响应块 */
export interface LLMStreamChunk {
  type: 'text_delta' | 'tool_call_delta' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
}

/** 工具定义 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>;
}

/** OpenAI function calling 格式 */
export interface ToolDefinitionForLLM {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Agent 配置 */
export interface AgentConfig {
  llm: LLMConfig;
  maxIterations: number;
  systemPrompt: string;
  contextConfig: ContextConfig;
}

/** LLM 配置 */
export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 上下文配置 */
export interface ContextConfig {
  maxTokens: number;
  compressThreshold: number;
  sessionDir: string;
}
