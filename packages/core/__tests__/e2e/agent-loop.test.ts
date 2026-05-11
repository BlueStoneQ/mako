import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/agent.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import type { LLMAdapter, ChatOptions } from '../../src/llm/types.js';
import type { Message, LLMResponse, LLMStreamChunk, Tool } from '../../src/types.js';

// Mock LLM that returns scripted responses
class MockLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[];
  private callIndex = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chat(_messages: Message[], _options?: ChatOptions): Promise<LLMResponse> {
    if (this.callIndex >= this.responses.length) {
      return { type: 'text', content: 'No more scripted responses' };
    }
    return this.responses[this.callIndex++];
  }

  async *stream(_messages: Message[], _options?: ChatOptions): AsyncIterable<LLMStreamChunk> {
    yield { type: 'done' };
  }
}

// Simple read_file tool for testing
const mockReadFileTool: Tool = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async execute(args) {
    if (args.path === 'package.json') {
      return JSON.stringify({ name: 'mako', version: '0.1.0' });
    }
    return 'Error: File not found';
  },
};

describe('Agent E2E', () => {
  it('完成一个完整的 ReAct 循环：读取 package.json 并回答', async () => {
    const mockLLM = new MockLLMAdapter([
      // 第一轮：LLM 决定调用 read_file
      {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'package.json' } }],
      },
      // 第二轮：LLM 根据工具结果给出最终回答
      {
        type: 'text',
        content: '项目名是 mako，版本号是 0.1.0',
      },
    ]);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(mockReadFileTool);

    const agent = new Agent(
      {
        llm: { baseUrl: '', apiKey: '', model: '' },
        maxIterations: 10,
        systemPrompt: '你是 Mako',
        contextConfig: { maxTokens: 128000, compressThreshold: 100000, sessionDir: '/tmp/mako-test' },
      },
      mockLLM,
      toolRegistry,
    );

    const response = await agent.chat('读取当前目录的 package.json，告诉我项目名和版本号');

    expect(response.content).toBe('项目名是 mako，版本号是 0.1.0');
    expect(response.iterations).toBe(2);
  });

  it('在 3 次循环内完成任务', async () => {
    const mockLLM = new MockLLMAdapter([
      { type: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'package.json' } }] },
      { type: 'text', content: '项目名是 mako，版本号是 0.1.0' },
    ]);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(mockReadFileTool);

    const agent = new Agent(
      {
        llm: { baseUrl: '', apiKey: '', model: '' },
        maxIterations: 3,
        systemPrompt: '你是 Mako',
        contextConfig: { maxTokens: 128000, compressThreshold: 100000, sessionDir: '/tmp/mako-test' },
      },
      mockLLM,
      toolRegistry,
    );

    const response = await agent.chat('读取 package.json');
    expect(response.iterations).toBeLessThanOrEqual(3);
  });

  it('超出最大循环次数时抛出错误', async () => {
    // LLM 一直返回 tool_calls，永不给文本回答
    const mockLLM = new MockLLMAdapter([
      { type: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } }] },
      { type: 'tool_calls', toolCalls: [{ id: 'call_2', name: 'read_file', arguments: { path: 'b.txt' } }] },
      { type: 'tool_calls', toolCalls: [{ id: 'call_3', name: 'read_file', arguments: { path: 'c.txt' } }] },
    ]);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(mockReadFileTool);

    const agent = new Agent(
      {
        llm: { baseUrl: '', apiKey: '', model: '' },
        maxIterations: 2,
        systemPrompt: '你是 Mako',
        contextConfig: { maxTokens: 128000, compressThreshold: 100000, sessionDir: '/tmp/mako-test' },
      },
      mockLLM,
      toolRegistry,
    );

    await expect(agent.chat('做点什么')).rejects.toThrow('exceeded maximum iterations');
  });

  it('工具执行错误被捕获并返回给 LLM', async () => {
    const failingTool: Tool = {
      name: 'failing_tool',
      description: 'Always fails',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() { throw new Error('Something went wrong'); },
    };

    const mockLLM = new MockLLMAdapter([
      { type: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'failing_tool', arguments: {} }] },
      { type: 'text', content: '工具执行失败了，我来换个方式' },
    ]);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(failingTool);

    const agent = new Agent(
      {
        llm: { baseUrl: '', apiKey: '', model: '' },
        maxIterations: 10,
        systemPrompt: '你是 Mako',
        contextConfig: { maxTokens: 128000, compressThreshold: 100000, sessionDir: '/tmp/mako-test' },
      },
      mockLLM,
      toolRegistry,
    );

    const response = await agent.chat('用那个工具');
    expect(response.content).toBe('工具执行失败了，我来换个方式');

    // 验证错误信息被加入了上下文
    const messages = agent.getContext().getMessages();
    const toolMessage = messages.find(m => m.role === 'tool');
    expect(toolMessage?.content).toContain('Something went wrong');
  });
});
