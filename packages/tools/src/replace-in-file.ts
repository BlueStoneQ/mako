import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from '@mako-agent/core';

export const replaceInFileTool: Tool = {
  name: 'replace_in_file',
  description: '精确替换文件中的一段内容（oldStr 必须唯一匹配）',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      oldStr: { type: 'string', description: '要被替换的原文（必须精确匹配文件中的内容）' },
      newStr: { type: 'string', description: '替换后的新内容' },
    },
    required: ['path', 'oldStr', 'newStr'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const oldStr = args.oldStr as string;
    const newStr = args.newStr as string;

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return `Error: File not found: ${filePath}`;
      }
      return `Error: ${err.message}`;
    }

    const occurrences = content.split(oldStr).length - 1;

    if (occurrences === 0) {
      return `Error: oldStr not found in ${filePath}`;
    }
    if (occurrences > 1) {
      return `Error: oldStr matches ${occurrences} locations, provide more context`;
    }

    const updated = content.replace(oldStr, newStr);
    await writeFile(filePath, updated, 'utf-8');
    return `Successfully replaced content in ${filePath}`;
  },
};
