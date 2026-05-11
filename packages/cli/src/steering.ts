import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 加载项目级 Steering 规则
 * 从 .mako/steering/*.md 和 .mako/steering.md 读取内容
 * 拼接为一段文本注入到 System Prompt
 */
export function loadSteering(projectDir: string = process.cwd()): string {
  const parts: string[] = [];

  // 1. 单文件模式：.mako/steering.md
  const singleFile = join(projectDir, '.mako', 'steering.md');
  if (existsSync(singleFile)) {
    parts.push(readFileSync(singleFile, 'utf-8').trim());
  }

  // 2. 目录模式：.mako/steering/*.md
  const steeringDir = join(projectDir, '.mako', 'steering');
  if (existsSync(steeringDir)) {
    try {
      const files = readdirSync(steeringDir)
        .filter(f => f.endsWith('.md'))
        .sort();
      for (const file of files) {
        const content = readFileSync(join(steeringDir, file), 'utf-8').trim();
        if (content) {
          parts.push(content);
        }
      }
    } catch {
      // 目录读取失败，忽略
    }
  }

  if (parts.length === 0) return '';

  return '\n\n## 项目规则（Steering）\n\n' + parts.join('\n\n---\n\n');
}
