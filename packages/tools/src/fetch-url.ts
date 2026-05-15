import type { Tool } from '@mako-agent/core';

export const fetchUrlTool: Tool = {
  name: 'fetch_url',
  description: '访问指定 URL 并返回响应的文本内容',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要访问的 URL' },
    },
    required: ['url'],
  },
  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }
      const text = await response.text();
      return text;
    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        return `Error: Request timed out after 10s`;
      }
      return `Error: ${err.message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
