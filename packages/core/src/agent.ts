import type { AgentConfig, AgentEvent, ToolCall } from './types.js';
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

  /** 流式对话 — 通过 AsyncGenerator yield AgentEvent */
  async *chatStream(userMessage: string): AsyncGenerator<AgentEvent> {
    this.context.addMessage({ role: 'user', content: userMessage });

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      await this.context.compressIfNeeded();

      const messages = this.context.assemble();
      const tools = this.toolRegistry.listForLLM();

      // 使用流式调用
      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      const toolCallAccumulators = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of this.llm.stream(messages, { tools: tools.length > 0 ? tools : undefined })) {
        if (chunk.type === 'text_delta' && chunk.content) {
          fullContent += chunk.content;
          yield { type: 'text_delta', content: chunk.content };
        }

        if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
          const tc = chunk.toolCall;
          // 累积 tool call 信息（流式中 tool call 是分块到达的）
          // 这里只是累积，完整的 tool call 在 done 时处理
          if (tc.id) {
            const idx = toolCallAccumulators.size;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, { id: tc.id, name: tc.name ?? '', arguments: '' });
            }
          }
          // 更新最后一个累积器
          const lastIdx = toolCallAccumulators.size - 1;
          if (lastIdx >= 0) {
            const acc = toolCallAccumulators.get(lastIdx)!;
            if (tc.name && !acc.name) acc.name = tc.name;
            if (tc.arguments) {
              // arguments 已经被 adapter 解析过了，这里用原始字符串累积
            }
          }
        }

        if (chunk.type === 'done') {
          break;
        }
      }

      // 如果有文本内容，说明是最终回答
      if (fullContent && toolCallAccumulators.size === 0) {
        this.context.addMessage({ role: 'assistant', content: fullContent });
        yield { type: 'done', content: fullContent, iterations };
        return;
      }

      // 如果有 tool calls，需要用非流式方式重新获取完整的 tool_calls
      // （因为流式 tool_call 累积比较复杂，这里用 fallback 策略）
      if (fullContent === '' || toolCallAccumulators.size > 0) {
        // 用非流式调用获取完整响应
        const response = await this.llm.chat(messages, { tools: tools.length > 0 ? tools : undefined });

        if (response.type === 'text') {
          this.context.addMessage({ role: 'assistant', content: response.content });
          // 如果流式已经输出了部分文本，这里不重复输出
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
