import { createHash } from 'node:crypto';
import type { InternalMessage, IngressLayer, LayerContext } from './types.js';
import type { DeduplicationConfig } from '../pipeline-config.js';

/**
 * L2: 去重层
 * 检测重复读取的文件，用存根替换未变化的内容。
 *
 * 使用 SHA-256 哈希比较文件内容，相同内容替换为存根引用。
 */
export class DeduplicationLayer implements IngressLayer {
  readonly name = 'deduplication';

  get enabled(): boolean {
    return this.config.enabled;
  }

  private config: DeduplicationConfig;
  /** file path → { hash, round } */
  private hashCache: Map<string, { hash: string; round: number }> = new Map();

  constructor(config: DeduplicationConfig) {
    this.config = config;
  }

  async process(msg: InternalMessage, ctx: LayerContext): Promise<InternalMessage> {
    // Only process read_file tool results
    if (msg.message.role !== 'tool' || msg.toolName !== 'read_file' || !msg.message.content) {
      return msg;
    }

    const filePath = this.extractFilePath(msg);
    if (!filePath) return msg;

    const hash = createHash('sha256').update(msg.message.content).digest('hex');
    const cached = this.hashCache.get(filePath);

    if (cached && cached.hash === hash) {
      // Content unchanged — replace with stub
      return {
        ...msg,
        message: {
          ...msg.message,
          content: `[文件未变化: ${filePath}，内容与第 ${cached.round} 轮读取相同]`,
        },
        compressed: true,
      };
    }

    // New or changed content — update cache
    this.hashCache.set(filePath, { hash, round: ctx.currentRound });
    return msg;
  }

  /**
   * Extract file path from tool call arguments (stored in toolCallId context).
   * Uses toolCallId as a proxy for the file path identifier.
   */
  private extractFilePath(msg: InternalMessage): string | null {
    return msg.toolCallId ?? null;
  }

  /** Get hash cache for persistence */
  getHashCache(): Map<string, { hash: string; round: number }> {
    return new Map(this.hashCache);
  }

  /** Restore hash cache from persistence */
  setHashCache(cache: Map<string, { hash: string; round: number }>): void {
    this.hashCache = new Map(cache);
  }
}
