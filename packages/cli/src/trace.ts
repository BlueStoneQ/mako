import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@mako-agent/core';

/** 单次 Trace 记录 */
export interface TraceEntry {
  type: 'llm_call' | 'tool_exec' | 'text_output';
  timestamp: number;
  duration_ms?: number;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: string;
  tool_error?: boolean;
  content?: string;
  tokens_estimate?: number;
}

/** 完整的 Trace */
export interface Trace {
  id: string;
  startedAt: string;
  userMessage: string;
  entries: TraceEntry[];
  totalDuration_ms: number;
  iterations: number;
}

/** Trace 收集器 — 在 chatStream 事件循环中调用 */
export class TraceCollector {
  private entries: TraceEntry[] = [];
  private startTime: number = Date.now();
  private lastEventTime: number = Date.now();
  private userMessage: string = '';
  private iterations: number = 0;

  start(userMessage: string): void {
    this.entries = [];
    this.startTime = Date.now();
    this.lastEventTime = Date.now();
    this.userMessage = userMessage;
    this.iterations = 0;
  }

  /** 记录 AgentEvent */
  record(event: AgentEvent): void {
    const now = Date.now();
    const duration = now - this.lastEventTime;

    switch (event.type) {
      case 'tool_start':
        this.entries.push({
          type: 'tool_exec',
          timestamp: now,
          tool_name: event.name,
          tool_args: event.arguments,
        });
        break;

      case 'tool_end': {
        // 更新最后一个 tool_exec 条目
        const lastTool = [...this.entries].reverse().find(e => e.type === 'tool_exec' && !e.duration_ms);
        if (lastTool) {
          lastTool.duration_ms = duration;
          lastTool.tool_result = event.result.slice(0, 500); // 截断保存
          lastTool.tool_error = event.error;
        }
        break;
      }

      case 'text_delta':
        // 文本增量不单独记录，在 done 时汇总
        break;

      case 'done':
        this.iterations = event.iterations;
        this.entries.push({
          type: 'text_output',
          timestamp: now,
          duration_ms: now - this.startTime,
          content: event.content.slice(0, 200), // 截断保存
        });
        break;

      case 'error':
        this.entries.push({
          type: 'text_output',
          timestamp: now,
          content: `Error: ${event.message}`,
        });
        break;
    }

    this.lastEventTime = now;
  }

  /** 生成完整 Trace 对象 */
  finalize(): Trace {
    return {
      id: `trace_${new Date().toISOString().replace(/[:.]/g, '-')}`,
      startedAt: new Date(this.startTime).toISOString(),
      userMessage: this.userMessage,
      entries: this.entries,
      totalDuration_ms: Date.now() - this.startTime,
      iterations: this.iterations,
    };
  }
}

/** 保存 Trace 到磁盘 */
export function saveTrace(trace: Trace, dir: string = join(process.cwd(), '.mako', 'traces')): string {
  mkdirSync(dir, { recursive: true });
  const filename = `${trace.id}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(trace, null, 2), 'utf-8');
  return filepath;
}

/** 加载所有 Trace 文件 */
export function loadTraces(dir: string = join(process.cwd(), '.mako', 'traces')): Trace[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  return files.map(f => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    return JSON.parse(raw) as Trace;
  });
}

/** 生成 Trace 分析摘要（供 AI 分析用） */
export function summarizeTraces(traces: Trace[]): string {
  if (traces.length === 0) return '没有找到 Trace 记录。';

  const totalInteractions = traces.length;
  const totalDuration = traces.reduce((sum, t) => sum + t.totalDuration_ms, 0);
  const avgDuration = Math.round(totalDuration / totalInteractions);
  const totalIterations = traces.reduce((sum, t) => sum + t.iterations, 0);
  const avgIterations = (totalIterations / totalInteractions).toFixed(1);

  const toolUsage: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  let totalToolCalls = 0;

  for (const trace of traces) {
    for (const entry of trace.entries) {
      if (entry.type === 'tool_exec' && entry.tool_name) {
        toolUsage[entry.tool_name] = (toolUsage[entry.tool_name] || 0) + 1;
        totalToolCalls++;
        if (entry.tool_error) {
          toolErrors[entry.tool_name] = (toolErrors[entry.tool_name] || 0) + 1;
        }
      }
    }
  }

  let summary = `## Mako Agent 执行分析\n\n`;
  summary += `- 总交互次数: ${totalInteractions}\n`;
  summary += `- 平均响应时间: ${avgDuration}ms\n`;
  summary += `- 平均循环轮次: ${avgIterations}\n`;
  summary += `- 总工具调用: ${totalToolCalls}\n\n`;

  summary += `### 工具使用统计\n\n`;
  summary += `| 工具 | 调用次数 | 错误次数 |\n|------|---------|----------|\n`;
  for (const [name, count] of Object.entries(toolUsage).sort((a, b) => b[1] - a[1])) {
    summary += `| ${name} | ${count} | ${toolErrors[name] || 0} |\n`;
  }

  summary += `\n### 最近 5 次交互\n\n`;
  for (const trace of traces.slice(0, 5)) {
    const tools = trace.entries.filter(e => e.type === 'tool_exec').map(e => e.tool_name).join(', ');
    summary += `- "${trace.userMessage.slice(0, 50)}" → ${trace.iterations}轮, ${trace.totalDuration_ms}ms${tools ? `, 工具: ${tools}` : ''}\n`;
  }

  return summary;
}
