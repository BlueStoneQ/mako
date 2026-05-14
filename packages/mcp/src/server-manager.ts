import { ToolRegistry } from '@mako/core';
import type { MCPServerConfig, MCPServerInfo } from './types.js';
import { MCPClient } from './mcp-client.js';
import { convertMCPTools } from './tool-converter.js';

/**
 * 管理所有 MCP Server 的生命周期。
 * 负责启动、监控、停止和重启 MCP Server。
 */
export class MCPServerManager {
  private clients: Map<string, MCPClient> = new Map();
  private toolRegistry: ToolRegistry;
  private configs: MCPServerConfig[];

  constructor(configs: MCPServerConfig[], toolRegistry: ToolRegistry) {
    this.configs = configs;
    this.toolRegistry = toolRegistry;
  }

  /**
   * 初始化所有配置的 MCP Server。
   * 单个 Server 失败不影响其他 Server。
   * @returns 连接结果摘要
   */
  async initializeAll(): Promise<MCPServerInfo[]> {
    const results: MCPServerInfo[] = [];

    for (const config of this.configs) {
      const client = new MCPClient(config);
      this.clients.set(config.name, client);

      try {
        const tools = await client.connect();

        // Convert and register tools
        const makoTools = convertMCPTools(
          config.name,
          tools,
          (toolName, args) => client.callTool(toolName, args),
        );

        for (const tool of makoTools) {
          try {
            this.toolRegistry.register(tool);
          } catch {
            // Skip duplicate tool names
          }
        }

        results.push({
          name: config.name,
          status: 'connected',
          tools: tools.map(t => t.name),
        });
      } catch (error) {
        results.push({
          name: config.name,
          status: 'error',
          tools: [],
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  /**
   * 重启指定的 MCP Server
   */
  async restartServer(name: string): Promise<MCPServerInfo> {
    const client = this.clients.get(name);
    if (!client) {
      return { name, status: 'error', tools: [], error: 'Server not found' };
    }

    await client.disconnect();

    try {
      const tools = await client.connect();
      const makoTools = convertMCPTools(
        name,
        tools,
        (toolName, args) => client.callTool(toolName, args),
      );

      for (const tool of makoTools) {
        try {
          this.toolRegistry.register(tool);
        } catch {
          // Skip duplicates
        }
      }

      return { name, status: 'connected', tools: tools.map(t => t.name) };
    } catch (error) {
      return { name, status: 'error', tools: [], error: (error as Error).message };
    }
  }

  /**
   * 关闭所有 MCP Server 连接。
   * 发送 SIGTERM，5 秒后强制终止。
   */
  async shutdownAll(): Promise<void> {
    const shutdowns = [...this.clients.values()].map(client =>
      Promise.race([
        client.disconnect(),
        new Promise<void>(resolve => setTimeout(resolve, 5000)),
      ]),
    );
    await Promise.all(shutdowns);
    this.clients.clear();
  }

  /**
   * 获取所有 Server 的状态信息
   */
  getServerInfos(): MCPServerInfo[] {
    return [...this.clients.entries()].map(([name, client]) => ({
      name,
      status: client.status,
      tools: client.tools.map(t => t.name),
    }));
  }

  /**
   * 获取需要确认的危险工具集合。
   * 所有 MCP 工具默认为危险工具，除非在 alwaysAllow 中。
   */
  getDangerousTools(): Set<string> {
    const dangerous = new Set<string>();
    for (const config of this.configs) {
      const client = this.clients.get(config.name);
      if (!client) continue;

      const alwaysAllow = new Set(config.alwaysAllow || []);
      for (const tool of client.tools) {
        const makoName = `mcp_${config.name}_${tool.name}`;
        if (!alwaysAllow.has(tool.name)) {
          dangerous.add(makoName);
        }
      }
    }
    return dangerous;
  }
}
