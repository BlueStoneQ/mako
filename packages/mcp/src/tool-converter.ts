import type { Tool } from '@mako/core';
import type { MCPToolDefinition } from './types.js';

// We need a reference to MCPClient for the execute callback, but to avoid circular deps,
// we accept a callTool function instead of the full client.
type CallToolFn = (toolName: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;

/**
 * 生成带前缀的 Mako 工具名称
 * 格式: mcp_{serverName}_{toolName}
 */
export function buildMakoToolName(serverName: string, mcpToolName: string): string {
  return `mcp_${serverName}_${mcpToolName}`;
}

/**
 * 从带前缀的 Mako 工具名称中提取原始 MCP 工具名称
 */
export function extractMCPToolName(makoToolName: string, serverName: string): string {
  const prefix = `mcp_${serverName}_`;
  if (makoToolName.startsWith(prefix)) {
    return makoToolName.slice(prefix.length);
  }
  return makoToolName;
}

/**
 * 将 MCP 工具列表转换为 Mako Tool 数组
 * 每个工具的 execute 方法通过 callToolFn 转发调用
 */
export function convertMCPTools(
  serverName: string,
  tools: MCPToolDefinition[],
  callToolFn: CallToolFn,
): Tool[] {
  return tools.map((mcpTool) => ({
    name: buildMakoToolName(serverName, mcpTool.name),
    description: mcpTool.description || `[MCP:${serverName}] ${mcpTool.name}`,
    parameters: mcpTool.inputSchema,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const result = await callToolFn(mcpTool.name, args);
      if (result.isError) {
        return `Error: ${result.content}`;
      }
      return result.content;
    },
  }));
}
