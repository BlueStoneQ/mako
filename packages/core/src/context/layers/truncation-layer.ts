import type { InternalMessage, IngressLayer, LayerContext } from './types.js';
import type { TruncationConfig } from '../pipeline-config.js';
import { OverflowStore } from '../overflow-store.js';

/**
 * L1: 源头截断层
 * 在消息进入存储前，截断过大的工具结果。
 *
 * 规则:
 * 1. read_file 行数限制: 超过 fileReadLineLimit 行时截断
 * 2. 单条结果字符限制: 超过 singleResultLimit 时保存到 overflow，保留前 200 行预览
 * 3. 聚合限制: 同一 assistant 关联的所有 Tool_Result 总字符数超过 aggregateLimit 时从最早截断
 */
export class TruncationLayer implements IngressLayer {
  readonly name = 'truncation';

  get enabled(): boolean {
    return this.config.enabled;
  }

  private config: TruncationConfig;
  private overflowStore: OverflowStore;

  constructor(config: TruncationConfig) {
    this.config = config;
    this.overflowStore = new OverflowStore(config.overflowDir);
  }

  async process(msg: InternalMessage, ctx: LayerContext): Promise<InternalMessage> {
    // Only process tool messages
    if (msg.message.role !== 'tool' || !msg.message.content) return msg;

    let content = msg.message.content;

    // Rule 1: read_file line limit
    if (msg.toolName === 'read_file') {
      const lines = content.split('\n');
      if (lines.length > this.config.fileReadLineLimit) {
        const fullContent = content;
        content =
          lines.slice(0, this.config.fileReadLineLimit).join('\n') +
          `\n\n[截断: 文件共 ${lines.length} 行，仅显示前 ${this.config.fileReadLineLimit} 行]`;
        await this.overflowStore.save(
          msg.toolCallId ?? 'unknown',
          msg.toolName ?? 'unknown',
          fullContent,
        );
      }
    }

    // Rule 2: Single result char limit
    if (content.length > this.config.singleResultLimit) {
      const fullContent = content;
      const previewLines = content.split('\n').slice(0, 200).join('\n');
      const overflowPath = await this.overflowStore.save(
        msg.toolCallId ?? 'unknown',
        msg.toolName ?? 'unknown',
        fullContent,
      );
      content = overflowPath
        ? `${previewLines}\n\n[截断: 完整内容已保存至 ${overflowPath}]`
        : `${previewLines}\n\n[截断: 内容过大，已截断]`;
    }

    if (content !== msg.message.content) {
      return { ...msg, message: { ...msg.message, content } };
    }
    return msg;
  }
}
