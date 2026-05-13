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
import { loadSteering } from './steering.js';
import { TraceCollector, saveTrace, loadTraces, summarizeTraces } from './trace.js';
import { getSpecPrompt, getPhaseLabel } from './spec-prompts.js';
import type { SpecPhase } from './spec-prompts.js';

const VERSION = '0.1.0';

const HELP = `
${chalk.cyan('Mako')} — 开源 AI Coding Agent

${chalk.bold('用法:')}
  mako              启动交互式对话
  mako config       配置模型（API Key、接口地址、模型名称）
  mako trace        分析 Agent 执行历史（AI 辅助分析）
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
if (args[0] === 'trace') {
  await runTrace();
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

/** Trace 分析命令 */
async function runTrace() {
  const traces = loadTraces();
  if (traces.length === 0) {
    console.log(chalk.gray('没有找到 Trace 记录。使用 mako 对话后会自动生成。'));
    return;
  }

  const summary = summarizeTraces(traces);
  console.log(summary);

  // 用 LLM 分析
  const config = loadConfigOrExit();
  const llm = new OpenAIAdapter(config.llm);
  console.log(chalk.gray('\n正在用 AI 分析...\n'));

  const response = await llm.chat([
    { role: 'system', content: '你是一个 AI Agent 性能分析师。根据以下执行数据，给出改进建议。' },
    { role: 'user', content: `请分析以下 Mako Agent 的执行数据，指出性能瓶颈和改进方向：\n\n${summary}` },
  ]);

  if (response.type === 'text') {
    console.log(response.content);
  }
}

async function main() {
  const config = loadConfigOrExit();

  const llm = new OpenAIAdapter(config.llm);
  let currentLlmConfig = config.llm;
  const toolRegistry = new ToolRegistry();

  // 注册内置工具
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(replaceInFileTool);
  toolRegistry.register(listDirectoryTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(searchTool);
  toolRegistry.register(fetchUrlTool);

  // 加载 Steering 规则
  const steering = loadSteering();
  const systemPrompt = config.agent.systemPrompt + steering;

  const agent = new Agent(
    { ...config.agent, systemPrompt, llm: config.llm },
    llm,
    toolRegistry,
  );

  // 尝试加载上一次会话
  const sessionId = 'default';
  await agent.getContext().load(sessionId);

  console.log(chalk.cyan('Mako v0.1 — AI Coding Agent'));
  console.log(chalk.gray('输入消息开始对话，/spec 进入规划模式，/help 查看命令\n'));

  let trustAll = false;
  let currentMode: 'vibe' | 'spec' = 'vibe';
  let specPhase: SpecPhase = 'requirements';
  let specFeatureName = '';

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  /** 等待用户按键确认（y/n/a） */
  function waitForConfirm(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      process.stdout.write(
        chalk.yellow('  ? 执行? ') + chalk.gray('[y/n/a(全部信任)] ')
      );
      rl.resume();
      rl.once('line', (answer) => {
        rl.pause();
        const a = answer.trim().toLowerCase();
        if (a === 'a') {
          trustAll = true;
          resolve(true);
        } else if (a === 'n') {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

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

    // 处理斜杠命令
    if (message.startsWith('/')) {
      const [cmd, ...rest] = message.slice(1).split(' ');
      const cmdArg = rest.join(' ').trim();

      switch (cmd) {
        case 'spec':
          currentMode = 'spec';
          specPhase = 'requirements';
          specFeatureName = cmdArg || 'unnamed';
          console.log(chalk.magenta(`\n📋 进入 Spec 模式 — ${specFeatureName}`));
          console.log(chalk.gray(`  阶段: ${getPhaseLabel(specPhase)}`));
          console.log(chalk.gray(`  输入你的需求描述，Mako 会生成结构化文档\n`));
          rl.prompt();
          return;

        case 'vibe':
          currentMode = 'vibe';
          console.log(chalk.cyan('\n💬 切换到 Vibe 模式 — 自由对话\n'));
          rl.prompt();
          return;

        case 'next':
          if (currentMode === 'spec') {
            const phases: SpecPhase[] = ['requirements', 'design', 'tasks', 'execute', 'done'];
            const currentIdx = phases.indexOf(specPhase);
            if (currentIdx < phases.length - 2) {
              specPhase = phases[currentIdx + 1];
              console.log(chalk.magenta(`\n📋 进入下一阶段: ${getPhaseLabel(specPhase)}\n`));
            } else {
              currentMode = 'vibe';
              console.log(chalk.green('\n✅ Spec 流程完成，切换回 Vibe 模式\n'));
            }
          }
          rl.prompt();
          return;

        case 'help':
          console.log(`
${chalk.bold('命令:')}
  /spec <名称>    进入 Spec 模式（需求 → 设计 → 任务 → 执行）
  /vibe           切换到 Vibe 模式（自由对话）
  /next           Spec 模式下进入下一阶段
  /help           显示此帮助
  Ctrl+C          退出
`);
          rl.prompt();
          return;

        default:
          console.log(chalk.gray(`  未知命令: /${cmd}，输入 /help 查看可用命令`));
          rl.prompt();
          return;
      }
    }

    processing = true;
    rl.pause();

    const trace = new TraceCollector();

    // 清除 readline 回显的输入行，避免重复显示
    process.stdout.write('\x1B[1A\x1B[2K');

    // 显示用户输入（带颜色）
    console.log(chalk.green('> ') + chalk.white(message));
    console.log();

    // 处理斜杠命令
    if (message.startsWith('/')) {
      const [cmd, ...args] = message.slice(1).split(' ');
      switch (cmd) {
        case 'spec': {
          const featureName = args.join(' ').trim();
          if (!featureName) {
            console.log(chalk.yellow('用法: /spec <功能名称>'));
            console.log(chalk.gray('例如: /spec 用户认证\n'));
            processing = false;
            rl.resume();
            rl.prompt();
            return;
          }
          currentMode = 'spec';
          specPhase = 'requirements';
          specFeatureName = featureName;
          console.log(chalk.cyan(`🔄 进入 Spec 模式: ${specFeatureName}`));
          console.log(chalk.gray(`  阶段: ${getPhaseLabel(specPhase)}`));
          console.log(chalk.gray('  描述你的需求，Mako 会帮你规划\n'));
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
        case 'vibe': {
          currentMode = 'vibe';
          console.log(chalk.cyan('🔄 切换到 Vibe 模式（自由对话）\n'));
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
        case 'help': {
          console.log(chalk.bold('可用命令:'));
          console.log('  /spec [功能名]  进入 Spec 模式（需求→设计→任务→执行）');
          console.log('  /vibe           切换到 Vibe 模式（自由对话）');
          console.log('  /model [名称]   查看/切换模型');
          console.log('  /clear          清空当前会话');
          console.log('  /help           显示此帮助');
          console.log();
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
        case 'clear': {
          agent.getContext().clear();
          console.log(chalk.gray('会话已清空\n'));
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
        case 'model': {
          const modelName = args[0];
          if (!modelName) {
            console.log(chalk.bold('可用模型:'));
            for (const [name, cfg] of Object.entries(config.models)) {
              const isCurrent = cfg.baseUrl === currentLlmConfig.baseUrl && cfg.model === currentLlmConfig.model;
              console.log(`  ${isCurrent ? chalk.green('→') : ' '} ${name}: ${cfg.model} (${cfg.baseUrl})`);
            }
            console.log(chalk.gray('\n用法: /model <名称>\n'));
          } else if (config.models[modelName]) {
            currentLlmConfig = config.models[modelName];
            agent.switchLLM(new OpenAIAdapter(currentLlmConfig));
            console.log(chalk.green(`✓ 已切换到模型: ${modelName} (${currentLlmConfig.model})\n`));
          } else {
            console.log(chalk.red(`未知模型: ${modelName}。可用: ${Object.keys(config.models).join(', ')}\n`));
          }
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
        default: {
          console.log(chalk.red(`未知命令: /${cmd}。输入 /help 查看可用命令\n`));
          processing = false;
          rl.resume();
          rl.prompt();
          return;
        }
      }
    }

    // Spec 模式：阶段确认处理
    if (currentMode === 'spec' && (message === 'y' || message === 'n')) {
      if (message === 'y') {
        // 进入下一阶段
        const phases: SpecPhase[] = ['requirements', 'design', 'tasks', 'execute', 'done'];
        const currentIdx = phases.indexOf(specPhase);
        if (currentIdx < phases.length - 1) {
          specPhase = phases[currentIdx + 1];
          if (specPhase === 'done') {
            currentMode = 'vibe';
            console.log(chalk.green('✅ Spec 流程完成，已切换回 Vibe 模式\n'));
            processing = false;
            rl.resume();
            rl.prompt();
            return;
          }
          console.log(chalk.cyan(`\n🔄 进入阶段: ${getPhaseLabel(specPhase)}\n`));
          // 自动发送阶段切换消息给 Agent
          const phaseMsg = `请继续进入${getPhaseLabel(specPhase)}阶段。基于之前的内容继续。`;
          // 不 return，让下面的 chat 逻辑处理这个消息
          // 但需要覆盖 message... 这里用 fallthrough
        }
      } else {
        console.log(chalk.gray('请修改后重新输入\n'));
        processing = false;
        rl.resume();
        rl.prompt();
        return;
      }
    }

    // 确定使用的 System Prompt（Spec 模式下按阶段切换）
    if (currentMode === 'spec') {
      const specPrompt = getSpecPrompt(specPhase);
      agent.getContext().updateConfig?.({ systemPrompt: config.agent.systemPrompt + steering + '\n\n' + specPrompt });
    }

    try {
      let hasOutput = false;
      const spinner = ora({ text: '思考中...', color: 'cyan' }).start();
      trace.start(message);

      // Spec 模式下，功能名作为上下文提示
      let chatMessage = message;
      if (currentMode === 'spec' && specPhase === 'requirements' && !message.includes(specFeatureName)) {
        chatMessage = `功能: ${specFeatureName}\n\n${message}`;
      }

      // 使用手动 next() 调用实现双向通信
      const gen = agent.chatStream(chatMessage);
      let nextInput: boolean | undefined = undefined;

      while (true) {
        const { value: event, done } = await gen.next(nextInput);
        if (done || !event) break;

        nextInput = undefined; // 默认不传值
        trace.record(event);

        switch (event.type) {
          case 'text_delta':
            if (!hasOutput) {
              spinner.stop();
              hasOutput = true;
            }
            process.stdout.write(event.content);
            break;

          case 'tool_start': {
            if (!hasOutput) {
              spinner.stop();
              hasOutput = true;
            }
            const toolLabel = chalk.bgCyan.black(` ${event.name} `);
            console.log(`\n  ${toolLabel}`);
            for (const [key, val] of Object.entries(event.arguments)) {
              const displayVal = typeof val === 'string' ? val : JSON.stringify(val);
              console.log(chalk.gray(`  │ ${key}: `) + chalk.white(truncate(displayVal, 70)));
            }
            break;
          }

          case 'tool_confirm': {
            // 危险工具确认 — 等待用户输入
            if (trustAll) {
              nextInput = true;
            } else {
              nextInput = await waitForConfirm();
            }
            break;
          }

          case 'tool_end':
            spinner.stop();
            if (event.error) {
              console.log(chalk.red(`  ✗ 失败: ${truncate(event.result, 120)}`));
            } else {
              const resultPreview = truncate(event.result, 100);
              console.log(chalk.green(`  ✓ `) + chalk.gray(resultPreview));
            }
            console.log();
            break;

          case 'done':
            if (!hasOutput) spinner.stop();
            if (hasOutput) console.log();
            console.log(chalk.gray(`(${event.iterations} 轮)`));
            // Spec 模式提示
            if (currentMode === 'spec' && specPhase !== 'done') {
              console.log(chalk.magenta(`\n  📋 当前阶段: ${getPhaseLabel(specPhase)}`));
              console.log(chalk.gray(`  输入 /next 进入下一阶段，或继续补充当前阶段`));
            }
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

    // 保存会话 + Trace
    await agent.getContext().save(sessionId);
    saveTrace(trace.finalize());
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
