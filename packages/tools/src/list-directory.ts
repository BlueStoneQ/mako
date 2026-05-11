import { readdir } from 'node:fs/promises';
import type { Tool } from '@mako/core';

export const listDirectoryTool: Tool = {
  name: 'list_directory',
  description: '列出指定目录下的文件和子目录',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径（默认当前目录）' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = (args.path as string) || '.';
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const lines = entries.map((entry) =>
        entry.isDirectory() ? `${entry.name}/` : entry.name,
      );
      return lines.join('\n');
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return `Error: Directory not found: ${dirPath}`;
      }
      return `Error: ${err.message}`;
    }
  },
};
