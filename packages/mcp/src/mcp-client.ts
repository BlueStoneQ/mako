import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPServerConfig, MCPToolDefinition, MCPToolCallResult, MCPServerStatus } from './types.js';
import { MCPConnectionError, MCPTimeoutError, MCPServerUnavailableError, MCPToolCallError } from './errors.js';

/**
 * 单个 MCP Server 的连接客户端。
 * 封装 @modelcontextprotocol/sdk 的 Client，提供简化的 API。
 */
export class MCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private config: MCPServerConfig;
  private _status: MCPServerStatus = 'disconnected';
  private _tools: MCPToolDefinition[] = [];

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.client = new Client(
      { name: 'mako', version: '0.1.0' },
      { capabilities: {} },
    );
  }

  get status(): MCPServerStatus { return this._status; }
  get tools(): MCPToolDefinition[] { return this._tools; }
  get serverName(): string { return this.config.name; }

  /**
   * 连接到 MCP Server：启动子进程 → 协议握手 → 发现工具
   * @throws MCPConnectionError 连接失败时
   */
  async connect(): Promise<MCPToolDefinition[]> {
    this._status = 'connecting';
    try {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: { ...process.env, ...this.config.env } as Record<string, string>,
      });

      await this.client.connect(this.transport);

      const response = await this.client.listTools();
      this._tools = (response.tools || []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      this._status = 'connected';

      // Listen for transport close/error events
      this.transport.onclose = () => {
        this._status = 'disconnected';
      };
      this.transport.onerror = () => {
        this._status = 'error';
      };

      return this._tools;
    } catch (error) {
      this._status = 'error';
      throw new MCPConnectionError(this.config.name, (error as Error).message);
    }
  }

  /**
   * 调用 MCP Server 上的工具
   * @param toolName 原始工具名称（不含前缀）
   * @param args 调用参数
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    if (this._status !== 'connected') {
      throw new MCPServerUnavailableError(this.config.name);
    }

    try {
      const response = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: 30000 },
      );

      // Extract text content from response
      const content = (response.content as Array<{ type: string; text?: string }>)
        ?.filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join('\n') || '';

      return {
        content,
        isError: response.isError === true,
      };
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes('Timeout') || err.message?.includes('timeout')) {
        throw new MCPTimeoutError(this.config.name, `callTool(${toolName})`, 30000);
      }
      throw new MCPToolCallError(this.config.name, toolName, err.message);
    }
  }

  /**
   * 断开连接并终止子进程
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Ignore close errors
    }
    this._status = 'disconnected';
    this.transport = null;
  }
}
