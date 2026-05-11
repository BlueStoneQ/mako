import type { AgentConfig, AgentEvent, ToolCall, ToolConfirmFn } from './types.js';
import { DANGEROUS_TOOLS } from './types.js';
import type { LLMAdapter } from './llm/types.js';
import { ContextManager } from './context/context-manager.js';
import { ToolRegistry } from './tools/tool-registry.js';

export interface AgentResponse {
  content: string;
  iterations: number;
}

export interface AgentOptions {
  /** 工具执行前的确认回调，仅对危险工具生效 */
  confirmTool?: ToolConfirmFn;
}

export class Agent {
  private llm: LLMAdapter;
  private context: ContextManager;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private confirmTool?: ToolConfirmFn;

  constructor(config: AgentConfig, llm: LLMAdapter, toolRegistry: ToolRegistry, options?: AgentOptions) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.maxIterations = config.maxIterations;
    this.confirmTool = options?.confirmTool;
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

  /** 流式对话 — 通过 AsyncGenerator yield AgentEvent，支持工具确认回调 */
  async *chatStream(userMessage: string, confirmFn?: ToolConfirmFn): AsyncGenerator<AgentEvent> {
    this.context.addMessage({ role: 'user', content: userMessage });

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      await this.context.compressIfNeeded();

      const messages = this.context.assemble();
      const tools = this.toolRegistry.listForLLM();

      // 用流式调用获取文本，用非流式获取 tool_calls（流式 tool_call 累积复杂）
      let fullContent = '';
      let hasToolCalls = false;

      for await (const chunk of this.llm.stream(messages, { tools: tools.length > 0 ? tools : undefined })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          yield { type: 'text_delta', content: chunk.content };
        }
        if (chunk.type === 'tool_call_delta') {
          hasToolCalls = true;
        }
        if (chunk.type === 'done') break;
      }

      // 纯文本回答
      if (fullContent && !hasToolCalls) {
        this.context.addMessage({ role: 'assistant', content: fullContent });
        yield { type: 'done', content: fullContent, iterations };
        return;
      }

      // 有 tool_calls — 用非流式重新获取完整响应
      if (hasToolCalls || !fullContent) {
        const response = await this.llm.chat(messages, { tools: tools.length > 0 ? tools : undefined });

        if (response.type === 'text') {
          this.context.addMessage({ role: 'assistant', content: response.content });
          if (!fullContent) {
            yield { type: 'text_delta', content: response.content };
          }
          yield { type: 'done', content: response.content, iterations };
          return;
        }

        if (response.type === 'tool_calls') {
          this.context.addMessage({
            role: 'assistant',
            content: null,
            toolCalls: response.toolCalls,
          });

          for (const toolCall of response.toolCalls) {
            yield { type: 'tool_start', name: toolCall.name, arguments: toolCall.arguments };

            // 确认回调
            if (confirmFn) {
              const confirmed = await confirmFn(toolCall.name, toolCall.arguments);
              if (!confirmed) {
                const skipResult = `用户拒绝执行 ${toolCall.name}`;
                this.context.addMessage({
                  role: 'tool',
                  content: skipResult,
                  toolCallId: toolCall.id,
                });
                yield { type: 'tool_end', name: toolCall.name, result: skipResult, error: true };
                continue;
              }
            }

            let result: string;
            let isError = false;
            try {
              result = await this.toolRegistry.execute(toolCall);
            } catch (error) {
              result = `Error: ${error instanceof Error ? error.message : String(error)}`;
              isError = true;
            }

            this.context.addMessage({
              role: 'tool',
              content: result,
              toolCallId: toolCall.id,
            });

            yield { type: 'tool_end', name: toolCall.name, result, error: isError };
          }
        }
      }
    }

    yield { type: 'error', message: `Agent exceeded maximum iterations (${this.maxIterations})` };
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getContext(): ContextManager {
    return this.context;
  }
}
