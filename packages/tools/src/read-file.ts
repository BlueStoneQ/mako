import { readFile } from 'node:fs/promises';
import type { Tool } from '@mako/core';

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取指定路径的文件内容（UTF-8 编码）',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return `Error: File not found: ${filePath}`;
      }
      if (err.code === 'EISDIR') {
        return `Error: Path is a directory: ${filePath}`;
      }
      return `Error: ${err.message}`;
    }
  },
};
