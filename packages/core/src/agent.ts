import type { AgentConfig } from './types.js';
import type { LLMAdapter } from './llm/types.js';
import { ContextManager } from './context/context-manager.js';
import { ToolRegistry } from './tools/tool-registry.js';

export interface AgentResponse {
  content: string;
  iterations: number;
}

export class Agent {
  private llm: LLMAdapter;
  private context: ContextManager;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;

  constructor(config: AgentConfig, llm: LLMAdapter, toolRegistry: ToolRegistry) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.maxIterations = config.maxIterations;
    this.context = new ContextManager(
      config.systemPrompt,
      config.contextConfig,
      llm,
    );
  }

  async chat(userMessage: string): Promise<AgentResponse> {
    this.context.addMessage({ role: 'user', content: userMessage });

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      await this.context.compressIfNeeded();

      const messages = this.context.assemble();
      const tools = this.toolRegistry.listForLLM();
      const response = await this.llm.chat(messages, { tools: tools.length > 0 ? tools : undefined });

      if (response.type === 'text') {
        this.context.addMessage({ role: 'assistant', content: response.content });
        return { content: response.content, iterations };
      }

      if (response.type === 'tool_calls') {
        this.context.addMessage({
          role: 'assistant',
          content: null,
          toolCalls: response.toolCalls,
        });

        for (const toolCall of response.toolCalls) {
          let result: string;
          try {
            result = await this.toolRegistry.execute(toolCall);
          } catch (error) {
            result = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
          this.context.addMessage({
            role: 'tool',
            content: result,
            toolCallId: toolCall.id,
          });
        }
      }
    }

    throw new Error(`Agent exceeded maximum iterations (${this.maxIterations})`);
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getContext(): ContextManager {
    return this.context;
  }
}
