import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Message, ContextConfig } from '../types.js';
import type { LLMAdapter } from '../llm/types.js';
import { countTokens, countMessageTokens } from './token-counter.js';

export class ContextManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private config: ContextConfig;
  private llm: LLMAdapter;

  constructor(systemPrompt: string, config: ContextConfig, llm: LLMAdapter) {
    this.systemPrompt = systemPrompt;
    this.config = config;
    this.llm = llm;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  assemble(): Message[] {
    return [
      { role: 'system', content: this.systemPrompt },
      ...this.messages,
    ];
  }

  clear(): void {
    this.messages = [];
  }

  getTokenCount(): number {
    const systemTokens = countTokens(this.systemPrompt) + 4;
    return systemTokens + countMessageTokens(this.messages);
  }

  async compressIfNeeded(): Promise<void> {
    const tokenCount = this.getTokenCount();
    if (tokenCount <= this.config.compressThreshold) {
      return;
    }

    // 保留最近的消息（至少保留最后 10 条或一半，取较小值）
    const keepCount = Math.min(10, Math.floor(this.messages.length / 2));
    if (keepCount >= this.messages.length) {
      return; // 消息太少，无法压缩
    }

    const earlyMessages = this.messages.slice(0, this.messages.length - keepCount);
    const recentMessages = this.messages.slice(this.messages.length - keepCount);

    // 用 LLM 生成摘要
    const summaryPrompt = '请将以下对话历史压缩为简洁摘要，保留关键信息、决策和工具调用结果：\n\n' +
      earlyMessages.map(m => `[${m.role}]: ${m.content ?? JSON.stringify(m.toolCalls)}`).join('\n');

    const response = await this.llm.chat([
      { role: 'system', content: '你是一个对话摘要助手。请生成简洁的摘要。' },
      { role: 'user', content: summaryPrompt },
    ]);

    if (response.type === 'text') {
      this.messages = [
        { role: 'system', content: `[对话摘要]: ${response.content}` },
        ...recentMessages,
      ];
    }
  }

  async save(sessionId: string): Promise<void> {
    const filePath = join(this.config.sessionDir, `${sessionId}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    const data = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: this.messages,
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<void> {
    const filePath = join(this.config.sessionDir, `${sessionId}.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.messages && Array.isArray(data.messages)) {
        this.messages = data.messages;
      }
    } catch {
      // 文件不存在或解析失败，保持空历史
    }
  }
}
