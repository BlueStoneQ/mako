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

/** Agent 流式事件 */
export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_confirm'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_end'; name: string; result: string; error: boolean }
  | { type: 'done'; content: string; iterations: number }
  | { type: 'error'; message: string };

/** chatStream 的 next() 传入值类型 */
export type AgentStreamInput = boolean | undefined;

/** 工具执行确认回调，返回 true 允许执行，false 跳过 */
export type ToolConfirmFn = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

/** 需要确认的危险工具列表 */
export const DANGEROUS_TOOLS = new Set(['bash', 'write_file', 'replace_in_file']);
