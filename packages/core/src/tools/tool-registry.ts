import type { Tool, ToolDefinitionForLLM, ToolCall } from '../types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  listForLLM(): ToolDefinitionForLLM[] {
    return this.list().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  async execute(toolCall: ToolCall): Promise<string> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return `Error: Tool not found: ${toolCall.name}`;
    }
    return tool.execute(toolCall.arguments);
  }
}
