export class MCPError extends Error {
  constructor(message: string, public readonly serverName: string) {
    super(`[MCP:${serverName}] ${message}`);
    this.name = 'MCPError';
  }
}

export class MCPConnectionError extends MCPError {
  constructor(serverName: string, cause: string) {
    super(`连接失败: ${cause}`, serverName);
    this.name = 'MCPConnectionError';
  }
}

export class MCPTimeoutError extends MCPError {
  constructor(serverName: string, operation: string, timeoutMs: number) {
    super(`${operation} 超时 (${timeoutMs}ms)`, serverName);
    this.name = 'MCPTimeoutError';
  }
}

export class MCPToolCallError extends MCPError {
  constructor(serverName: string, toolName: string, cause: string) {
    super(`工具调用失败 [${toolName}]: ${cause}`, serverName);
    this.name = 'MCPToolCallError';
  }
}

export class MCPServerUnavailableError extends MCPError {
  constructor(serverName: string) {
    super('Server 不可用', serverName);
    this.name = 'MCPServerUnavailableError';
  }
}
