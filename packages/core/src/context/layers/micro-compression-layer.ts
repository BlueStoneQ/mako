import type { InternalMessage, EgressLayer, LayerContext } from './types.js';
import type { MicroCompressionConfig } from '../pipeline-config.js';

/**
 * L3: 微压缩层
 * 在 assemble 时清理旧的只读工具结果。
 *
 * 规则:
 * - 超过 keepRounds 轮的 READ_Tool 结果替换为存根
 * - WRITE_Tool 结果永远保留，不受轮次限制
 * - 通过 LayerContext.isReadTool() / isWriteTool() 判断工具类型（配置驱动）
 */
export class MicroCompressionLayer implements EgressLayer {
  readonly name = 'microCompression';

  get enabled(): boolean {
    return this.config.enabled;
  }

  private config: MicroCompressionConfig;

  constructor(config: MicroCompressionConfig) {
    this.config = config;
  }

  process(messages: InternalMessage[], ctx: LayerContext): InternalMessage[] {
    const threshold = ctx.currentRound - this.config.keepRounds;

    return messages.map((msg) => {
      // Only process tool role messages
      if (msg.message.role !== 'tool') return msg;

      // Skip messages without a tool name
      if (!msg.toolName) return msg;

      // WRITE_Tool results are always preserved regardless of age
      if (ctx.isWriteTool(msg.toolName)) return msg;

      // Only clean up READ_Tool results older than keepRounds
      if (msg.round < threshold && ctx.isReadTool(msg.toolName)) {
        return {
          ...msg,
          message: {
            ...msg.message,
            content: `[已清理: ${msg.toolName} 结果，第 ${msg.round} 轮]`,
          },
          compressed: true,
        };
      }

      return msg;
    });
  }
}
