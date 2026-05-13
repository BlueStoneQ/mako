import type { InternalMessage, CompressionLayer, CompressionContext } from './types.js';
import type { FallbackConfig } from '../pipeline-config.js';
import { countTokens } from '../token-counter.js';

/**
 * L5: 兜底层
 * 自动压缩后仍超限时的最终保护。
 *
 * 流程:
 * 1. 检测 token 超过 95% 阈值时触发
 * 2. 保存完整对话到 transcript 文件
 * 3. 索引所有消息到检索层
 * 4. 从最早的消息组（按 round 分组）逐组截断，直到 token 降至 70% 以内
 * 5. 插入归档提示系统消息
 */
export class FallbackLayer implements CompressionLayer {
  readonly name = 'fallback';

  get enabled(): boolean {
    return this.config.enabled;
  }

  private config: FallbackConfig;

  constructor(config: FallbackConfig) {
    this.config = config;
  }

  async compress(ctx: CompressionContext): Promise<void> {
    const tokenCount = ctx.getTokenCount();
    const triggerLimit = ctx.maxTokens * this.config.triggerThreshold; // 0.95
    const targetLimit = ctx.maxTokens * this.config.targetThreshold; // 0.70

    // Not over trigger threshold — skip
    if (tokenCount <= triggerLimit) return;

    // 1. Save full transcript (handle failure gracefully)
    try {
      await ctx.saveTranscript(ctx.messages);
    } catch {
      // Transcript save failed — continue with truncation anyway
    }

    // 2. Index all messages to retrieval layer
    ctx.indexMessages(ctx.messages);

    // 3. Group messages by round and remove oldest groups until under target
    const messages = [...ctx.messages];

    while (this.calculateTokens(messages) > targetLimit && messages.length > 1) {
      // Find the earliest round
      const earliestRound = messages[0].round;
      // Find where the next round starts
      const cutIndex = messages.findIndex((m) => m.round !== earliestRound);

      if (cutIndex === -1) {
        // All messages are in the same round — can't remove more
        break;
      }

      // Remove the earliest round group
      messages.splice(0, cutIndex);
    }

    // 4. Prepend archive notice
    const archiveNotice: InternalMessage = {
      message: {
        role: 'system',
        content: '[系统提示: 早期对话已归档。如需回顾历史信息，请使用 recall 工具搜索。]',
      },
      round: ctx.currentRound,
      originalTokens: 0,
      compressed: false,
      timestamp: Date.now(),
    };

    ctx.setMessages([archiveNotice, ...messages]);
  }

  /**
   * Calculate total token count for a list of messages.
   */
  private calculateTokens(messages: InternalMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = msg.message.content ?? '';
      total += countTokens(content);
    }
    return total;
  }
}
