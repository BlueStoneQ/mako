/** 单个 MCP Server 的配置 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  alwaysAllow?: string[];
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

export type MCPServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface MCPServerInfo {
  name: string;
  status: MCPServerStatus;
  tools: string[];
  error?: string;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult {
  content: string;
  isError: boolean;
}
