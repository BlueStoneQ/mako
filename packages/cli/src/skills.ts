import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Skill 定义
 */
export interface Skill {
  name: string;
  description: string;
  /** 注入到 System Prompt 的指令 */
  instructions: string;
  /** 该 Skill 可用的工具白名单（空 = 不限制） */
  tools?: string[];
  /** 自动激活条件 */
  triggers?: {
    keywords?: string[];
    filePatterns?: string[];
  };
}

/**
 * 从 .mako/skills/ 目录加载所有 Skill
 * 支持 .md 格式（frontmatter + 正文作为 instructions）
 */
export function loadSkills(projectDir: string = process.cwd()): Skill[] {
  const skillsDir = join(projectDir, '.mako', 'skills');
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];

  try {
    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = readFileSync(join(skillsDir, file), 'utf-8');
        const skill = parseSkillFile(file, content);
        if (skill) skills.push(skill);
      } catch {
        // Skip invalid skill files
      }
    }
  } catch {
    // Directory read failed
  }

  return skills;
}

/**
 * 解析 Skill 文件（Markdown + YAML frontmatter）
 *
 * 格式：
 * ---
 * name: code-review
 * description: 代码审查专家
 * tools: [read_file, search]
 * triggers:
 *   keywords: [review, 审查, CR]
 * ---
 * 你是一个代码审查专家...（instructions 正文）
 */
function parseSkillFile(filename: string, content: string): Skill | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter — treat entire content as instructions
    const name = filename.replace('.md', '');
    return {
      name,
      description: name,
      instructions: content.trim(),
    };
  }

  const [, frontmatter, body] = frontmatterMatch;
  const meta = parseSimpleYaml(frontmatter);

  return {
    name: (meta.name as string) || filename.replace('.md', ''),
    description: (meta.description as string) || '',
    instructions: body.trim(),
    tools: meta.tools as string[] | undefined,
    triggers: meta.triggers as Skill['triggers'] | undefined,
  };
}

/**
 * 简单的 YAML 解析（不引入 yaml 库）
 * 只支持顶层 key: value 和简单数组
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');

  let currentKey = '';

  for (const line of lines) {
    // key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      currentKey = key;

      // Array inline: [a, b, c]
      const arrayMatch = value.match(/^\[(.*)\]$/);
      if (arrayMatch) {
        result[key] = arrayMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      } else if (value) {
        result[key] = value;
      } else {
        result[key] = {};
      }
      continue;
    }

    // Nested key:value under current key (e.g., triggers.keywords)
    const nestedKvMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (nestedKvMatch && currentKey) {
      const [, nestedKey, nestedValue] = nestedKvMatch;
      if (typeof result[currentKey] !== 'object') result[currentKey] = {};

      const arrayMatch = nestedValue.match(/^\[(.*)\]$/);
      if (arrayMatch) {
        (result[currentKey] as Record<string, unknown>)[nestedKey] =
          arrayMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      } else {
        (result[currentKey] as Record<string, unknown>)[nestedKey] = nestedValue;
      }
    }
  }

  return result;
}

/**
 * 根据用户消息自动匹配 Skill（基于 triggers.keywords）
 */
export function matchSkills(message: string, skills: Skill[]): Skill[] {
  return skills.filter(skill => {
    if (!skill.triggers?.keywords) return false;
    return skill.triggers.keywords.some(kw =>
      message.toLowerCase().includes(kw.toLowerCase())
    );
  });
}

/**
 * 将激活的 Skills 的 instructions 拼接为 System Prompt 片段
 */
export function buildSkillPrompt(activeSkills: Skill[]): string {
  if (activeSkills.length === 0) return '';

  const parts = activeSkills.map(s =>
    `## Skill: ${s.name}\n${s.instructions}`
  );

  return '\n\n## 激活的 Skills\n\n' + parts.join('\n\n---\n\n');
}
