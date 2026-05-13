// Types
export type {
  MessageRole,
  ToolCall,
  Message,
  LLMResponse,
  LLMStreamChunk,
  Tool,
  ToolDefinitionForLLM,
  AgentConfig,
  LLMConfig,
  ContextConfig,
  AgentEvent,
  ToolConfirmFn,
} from './types.js';

export { DANGEROUS_TOOLS } from './types.js';

// LLM
export type { ChatOptions, LLMAdapter } from './llm/types.js';
export { LLMError } from './llm/types.js';

// These will be uncommented as they are implemented:
export { OpenAIAdapter } from './llm/openai-adapter.js';
/** @deprecated Use ContextPipeline instead */
export { ContextManager } from './context/context-manager.js';
export { ContextPipeline } from './context/context-pipeline.js';
export { createDefaultPipelineConfig } from './context/pipeline-config.js';
export type { PipelineConfig } from './context/pipeline-config.js';
export { countTokens, countMessageTokens } from './context/token-counter.js';
export { ToolRegistry } from './tools/tool-registry.js';
export { Agent } from './agent.js';
export type { AgentResponse } from './agent.js';
