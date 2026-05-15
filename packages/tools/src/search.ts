import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { Tool } from '@mako-agent/core';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.woff', '.woff2', '.ttf', '.eot',
  '.class', '.pyc', '.o', '.obj',
]);

export const searchTool: Tool = {
  name: 'search',
  description: '递归搜索文件内容，返回匹配的文件路径、行号和内容',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索模式（正则表达式）' },
      path: { type: 'string', description: '搜索起始路径（默认当前目录）' },
    },
    required: ['pattern'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || '.';

    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      return `Error: Invalid pattern: ${pattern}`;
    }

    const files = await fg('**/*', {
      cwd: searchPath,
      ignore: ['**/node_modules/**', '**/.git/**'],
      absolute: false,
      onlyFiles: true,
    });

    const results: string[] = [];

    for (const file of files) {
      const ext = file.substring(file.lastIndexOf('.'));
      if (BINARY_EXTENSIONS.has(ext)) {
        continue;
      }

      const fullPath = searchPath === '.' ? file : `${searchPath}/${file}`;
      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${fullPath}:${i + 1}:${lines[i]}`);
        }
      }
    }

    if (results.length === 0) {
      return 'No matches found.';
    }

    return results.join('\n');
  },
};
