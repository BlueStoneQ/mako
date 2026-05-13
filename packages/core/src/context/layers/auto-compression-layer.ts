import type { InternalMessage, CompressionLayer, CompressionContext } from './types.js';
import type { AutoCompressionConfig } from '../pipeline-config.js';

/**
 * 9 维结构化压缩提示词
 */
const COMPRESSION_PROMPT = `你是一个对话压缩助手。请将以下对话历史压缩为结构化摘要，严格按照以下 9 个维度输出：

## 1. 用户原始意图
用户最初想要完成什么任务？

## 2. 当前任务状态
任务进展到哪一步了？当前正在做什么？

## 3. 关键决策记录
对话中做出了哪些重要的技术/设计决策？

## 4. 已完成的操作
列出已经成功执行的操作（文件创建/修改、命令执行等）

## 5. 待完成的操作
还有哪些步骤需要完成？

## 6. 重要文件列表
列出当前任务涉及的关键文件路径及其用途

## 7. 错误和解决方案
遇到了哪些错误？如何解决的？

## 8. 用户偏好和约束
用户表达了哪些偏好或约束条件？

## 9. 最近用户消息原文
（以下为最近 3 条用户消息的原文引用，不要修改）
`;

/**
 * L4: 自动压缩层
 * 当 token 超过阈值时，生成 9 维结构化摘要替换旧消息。
 *
 * 流程:
 * 1. 检查 token 是否超过阈值
 * 2. 提取最近 3 条 user 消息原文
 * 3. 构建 9 维压缩提示词
 * 4. 调用 LLM 生成摘要
 * 5. 索引旧消息到检索层
 * 6. 构建新消息列表: [摘要, 最近文件读取, 当前轮次消息, 续接指令]
 */
export class AutoCompressionLayer implements CompressionLayer {
  readonly name = 'autoCompression';

  get enabled(): boolean {
    return this.config.enabled;
  }

  private config: AutoCompressionConfig;

  constructor(config: AutoCompressionConfig) {
    this.config = config;
  }

  async compress(ctx: CompressionContext): Promise<void> {
    const tokenCount = ctx.getTokenCount();
    const threshold = ctx.maxTokens * this.config.threshold;

    // Not over threshold — skip compression
    if (tokenCount <= threshold) return;

    // 1. Extract last 3 user messages verbatim for dimension 9
    const recentUserMessages = ctx.messages
      .filter((m) => m.message.role === 'user' && m.message.content)
      .slice(-3)
      .map((m) => m.message.content!);

    // 2. Build conversation text for compression
    const conversationText = ctx.messages
      .map((m) => {
        const content = m.message.content ?? JSON.stringify(m.message.toolCalls ?? '');
        return `[${m.message.role}][R${m.round}]: ${content}`;
      })
      .join('\n');

    // 3. Build the 9-dimension compression prompt
    const prompt =
      COMPRESSION_PROMPT +
      recentUserMessages.map((c, i) => `\n### 用户消息 ${i + 1}\n${c}`).join('') +
      '\n\n---\n\n以下是需要压缩的对话历史：\n\n' +
      conversationText;

    // 4. Call LLM to generate summary
    let summaryContent: string;
    try {
      const response = await ctx.llm.chat([
        { role: 'system', content: '你是一个对话压缩助手。' },
        { role: 'user', content: prompt },
      ]);

      if (response.type !== 'text') return;
      summaryContent = response.content;
    } catch {
      // LLM call failed — skip compression this time
      return;
    }

    // 5. Index old messages to retrieval layer
    ctx.indexMessages(ctx.messages);

    // 6. Build summary message
    const summaryMessage: InternalMessage = {
      message: { role: 'system', content: `[对话摘要]:\n${summaryContent}` },
      round: ctx.currentRound,
      originalTokens: 0,
      compressed: true,
      timestamp: Date.now(),
    };

    // 7. Recover recent file reads (max maxRecentFiles, deduplicated by path)
    const recentFiles = this.getRecentFileReads(ctx.messages, this.config.maxRecentFiles);

    // 8. Keep current round messages
    const currentRoundMessages = ctx.messages.filter((m) => m.round === ctx.currentRound);

    // 9. Continuation instruction
    const continuationMessage: InternalMessage = {
      message: {
        role: 'system',
        content: '[系统提示: 上下文已压缩。请直接继续执行任务，无需确认或重复摘要内容。]',
      },
      round: ctx.currentRound,
      originalTokens: 0,
      compressed: false,
      timestamp: Date.now(),
    };

    // Set the new message list
    ctx.setMessages([summaryMessage, ...recentFiles, ...currentRoundMessages, continuationMessage]);
  }

  /**
   * Find recent read_file results, deduplicated by file path (keep latest).
   */
  private getRecentFileReads(messages: InternalMessage[], max: number): InternalMessage[] {
    const seen = new Set<string>();
    const result: InternalMessage[] = [];

    for (let i = messages.length - 1; i >= 0 && result.length < max; i--) {
      const msg = messages[i];
      if (msg.toolName === 'read_file' && !msg.compressed && msg.message.content) {
        const path = msg.toolCallId ?? `file_${i}`;
        if (!seen.has(path)) {
          seen.add(path);
          result.unshift(msg);
        }
      }
    }

    return result;
  }
}
