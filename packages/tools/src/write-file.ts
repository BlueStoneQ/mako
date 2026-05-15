import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '@mako-agent/core';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '写入文件内容（自动创建父目录，覆写已有文件）',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const content = args.content as string;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      return `Successfully wrote to ${filePath}`;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES') {
        return `Error: Permission denied: ${filePath}`;
      }
      return `Error: ${err.message}`;
    }
  },
};
