import { execSync } from 'node:child_process';
import type { Tool } from '@mako/core';

export const bashTool: Tool = {
  name: 'bash',
  description: '在子进程中执行 Shell 命令',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell 命令' },
    },
    required: ['command'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const command = args.command as string;
    try {
      const stdout = execSync(command, {
        timeout: 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return stdout;
    } catch (error: unknown) {
      const err = error as {
        killed?: boolean;
        signal?: string;
        status?: number;
        stderr?: string;
        message?: string;
      };
      if (err.killed || err.signal === 'SIGTERM') {
        return 'Error: Command timed out after 30s';
      }
      if (err.status != null) {
        const stderr = err.stderr || err.message || '';
        return `Error (exit ${err.status}): ${stderr}`;
      }
      return `Error: ${err.message || String(error)}`;
    }
  },
};
