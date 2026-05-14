import { readFileSync, existsSync } from 'node:fs';
import type { MCPConfig, MCPServerConfig } from './types.js';

/**
 * 从 config.json 加载 MCP Server 配置
 */
export function loadMCPConfig(configPath: string): MCPConfig {
  if (!existsSync(configPath)) {
    return { servers: [] };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const mcpServers = config.mcpServers || {};

    const servers: MCPServerConfig[] = [];
    for (const [name, rawConfig] of Object.entries(mcpServers)) {
      const validated = validateServerConfig(name, rawConfig as Record<string, unknown>);
      if (validated) {
        servers.push(validated);
      }
    }

    return { servers };
  } catch {
    return { servers: [] };
  }
}

/**
 * 验证单个 Server 配置
 */
export function validateServerConfig(
  name: string,
  raw: Record<string, unknown>,
): MCPServerConfig | null {
  const command = raw.command;
  if (!command || typeof command !== 'string') {
    console.warn(`[MCP] Server "${name}" 缺少 command 字段，已跳过`);
    return null;
  }

  return {
    name,
    command,
    args: Array.isArray(raw.args) ? raw.args as string[] : [],
    env: (raw.env && typeof raw.env === 'object') ? raw.env as Record<string, string> : {},
    alwaysAllow: Array.isArray(raw.alwaysAllow) ? raw.alwaysAllow as string[] : [],
  };
}
