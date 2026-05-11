import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { Agent, OpenAIAdapter, ToolRegistry } from '@mako/core';
import {
  readFileTool, writeFileTool, replaceInFileTool,
  listDirectoryTool, bashTool, searchTool, fetchUrlTool,
} from '@mako/tools';
import { loadConfig } from './config.js';

const VERSION = '0.1.0';

const HELP = `
${chalk.cyan('Mako')} — 开源 AI Coding Agent

${chalk.bold('用法:')}
  mako              启动交互式对话
  mako config       配置模型（API Key、接口地址、模型名称）
  mako --help       显示帮助信息
  mako --version    显示版本号

${chalk.bold('配置:')}
  环境变量:
    MAKO_API_KEY    API Key（必须）
    MAKO_BASE_URL   模型接口地址（默认 https://api.openai.com/v1）
    MAKO_MODEL      模型名称（默认 gpt-4o）

  配置文件:
    .mako/config.json

${chalk.bold('内置工具:')}
  read_file         读取文件
  write_file        写入/创建文件
  replace_in_file   精确替换文件内容
  list_directory    列出目录结构
  bash              执行 Shell 命令
  search            搜索文件内容
  fetch_url         访问网址
`.trim();

// 处理命令行参数
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}
if (args[0] === 'config') {
  await runConfig();
  process.exit(0);
}

/** 交互式配置引导 */
async function runConfig() {
  const configDir = join(process.cwd(), '.mako');
  const configPath = join(configDir, 'config.json');

  // 读取已有配置
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      // 忽略解析错误
    }
  }
  const llmExisting = (existing.llm || {}) as Record<string, string>;

  console.log(chalk.cyan('\nMako 配置向导\n'));
  console.log(chalk.gray('按回车保留当前值，输入新值覆盖\n'));

  const rl = createInterface({ input: stdin, output: stdout });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  const apiKey = await question(
    chalk.white(`API Key ${llmExisting.apiKey ? chalk.gray(`[${maskKey(llmExisting.apiKey)}]`) : chalk.red('[未设置]')}: `),
  );

  const baseUrl = await question(
    chalk.white(`接口地址 ${chalk.gray(`[${llmExisting.baseUrl || 'https://api.openai.com/v1'}]`)}: `),
  );

  const model = await question(
    chalk.white(`模型名称 ${chalk.gray(`[${llmExisting.model || 'gpt-4o'}]`)}: `),
  );

  rl.close();

  // 合并配置
  const config = {
    ...existing,
    llm: {
      apiKey: apiKey.trim() || llmExisting.apiKey || '',
      baseUrl: baseUrl.trim() || llmExisting.baseUrl || 'https://api.openai.com/v1',
      model: model.trim() || llmExisting.model || 'gpt-4o',
    },
  };

  // 写入文件
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  console.log(chalk.green(`\n✓ 配置已保存到 ${configPath}`));
  console.log(chalk.gray('\n运行 mako 开始对话\n'));
}

/** 遮蔽 API Key，只显示前 4 位和后 4 位 */
function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

async function main() {
  const config = loadConfigOrExit();

  const llm = new OpenAIAdapter(config.llm);
  const toolRegistry = new ToolRegistry();

  // 注册内置工具
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(replaceInFileTool);
  toolRegistry.register(listDirectoryTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(searchTool);
  toolRegistry.register(fetchUrlTool);

  const agent = new Agent(
    { ...config.agent, llm: config.llm },
    llm,
    toolRegistry,
  );

  // 尝试加载上一次会话
  const sessionId = 'default';
  await agent.getContext().load(sessionId);

  console.log(chalk.cyan('Mako v0.1 — AI Coding Agent'));
  console.log(chalk.gray('输入消息开始对话，Ctrl+C 退出\n'));

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  rl.setPrompt(chalk.green('> '));
  rl.prompt();

  let processing = false;

  rl.on('line', async (line: string) => {
    if (processing) return;

    const message = line.trim();
    if (!message) {
      rl.prompt();
      return;
    }

    processing = true;
    rl.pause();

    // 清除 readline 回显的输入行，避免重复显示
    process.stdout.write('\x1B[1A\x1B[2K');

    // 显示用户输入（带颜色）
    console.log(chalk.green('> ') + chalk.white(message));
    console.log();

    try {
      let hasOutput = false;
      const spinner = ora({ text: '思考中...', color: 'cyan' }).start();

      for await (const event of agent.chatStream(message)) {
        switch (event.type) {
          case 'text_delta':
            if (!hasOutput) {
              spinner.stop();
              hasOutput = true;
            }
            process.stdout.write(event.content);
            break;

          case 'tool_start':
            if (!hasOutput) {
              spinner.stop();
              hasOutput = true;
            }
            console.log(chalk.cyan(`  ⚡ ${event.name}`) + chalk.gray(` ${formatArgs(event.arguments)}`));
            break;

          case 'tool_end':
            if (event.error) {
              console.log(chalk.red(`  ✗ 失败: `) + chalk.gray(truncate(event.result, 100)));
            } else {
              console.log(chalk.green(`  ✓ 完成`) + chalk.gray(` ${truncate(event.result, 80)}`));
            }
            console.log();
            break;

          case 'done':
            if (!hasOutput) spinner.stop();
            if (hasOutput) console.log(); // 换行结束流式文本
            console.log(chalk.gray(`(${event.iterations} 轮)`));
            break;

          case 'error':
            spinner.stop();
            console.log(chalk.red(`\n错误: ${event.message}`));
            break;
        }
      }
    } catch (error) {
      console.error(chalk.red(`\n错误: ${(error as Error).message}`));
    }

    // 保存会话
    await agent.getContext().save(sessionId);
    console.log();
    processing = false;
    rl.resume();
    rl.prompt();
  });

  rl.on('close', async () => {
    await agent.getContext().save(sessionId);
    console.log(chalk.gray('\n再见！'));
    process.exit(0);
  });
}

/** 格式化工具参数为简短字符串 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => {
    const val = typeof v === 'string' ? truncate(v, 40) : JSON.stringify(v);
    return `${k}: ${val}`;
  }).join(', ');
}

/** 截断字符串 */
function truncate(str: string, maxLen: number): string {
  const oneLine = str.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + '...';
}

main().catch((error) => {
  console.error(chalk.red(`启动失败: ${(error as Error).message}`));
  process.exit(1);
});
