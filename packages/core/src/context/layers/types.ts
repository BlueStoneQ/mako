import type { Message } from '../../types.js';
import type { LLMAdapter } from '../../llm/types.js';

/** 内部消息包装，附加管道元数据 */
export interface InternalMessage {
  message: Message;
  /** 所属轮次（user 消息递增） */
  round: number;
  /** 关联的工具调用 ID */
  toolCallId?: string;
  /** 关联的工具名称 */
  toolName?: string;
  /** 原始 token 数 */
  originalTokens: number;
  /** 是否已被压缩/清理 */
  compressed: boolean;
  /** 时间戳 */
  timestamp: number;
}

/** 入口层接口 — 在 addMessage 时执行 */
export interface IngressLayer {
  readonly name: string;
  readonly enabled: boolean;
  /** 处理单条消息，可能修改或替换 */
  process(
    msg: InternalMessage,
    context: LayerContext,
  ): Promise<InternalMessage>;
}

/** 出口层接口 — 在 assemble 时执行 */
export interface EgressLayer {
  readonly name: string;
  readonly enabled: boolean;
  /** 处理整个消息列表，返回处理后的列表 */
  process(
    messages: InternalMessage[],
    context: LayerContext,
  ): InternalMessage[];
}

/** 压缩层接口 — 在 compressIfNeeded 时执行 */
export interface CompressionLayer {
  readonly name: string;
  readonly enabled: boolean;
  /** 执行压缩，直接修改 pipeline 状态 */
  compress(context: CompressionContext): Promise<void>;
}

/** 层执行上下文 */
export interface LayerContext {
  /** 当前轮次 */
  currentRound: number;
  /** 工具分类查询 */
  isReadTool(toolName: string): boolean;
  isWriteTool(toolName: string): boolean;
  /** 获取当前 token 数 */
  getTokenCount(): number;
  /** 最大 token 数 */
  maxTokens: number;
}

/** 压缩层执行上下文 */
export interface CompressionContext extends LayerContext {
  /** 当前所有消息 */
  messages: InternalMessage[];
  /** 替换消息列表 */
  setMessages(messages: InternalMessage[]): void;
  /** LLM 适配器（用于生成摘要） */
  llm: LLMAdapter;
  /** 系统提示词 */
  systemPrompt: string;
  /** 索引消息到检索层 */
  indexMessages(messages: InternalMessage[]): void;
  /** 保存 transcript */
  saveTranscript(messages: InternalMessage[]): Promise<void>;
}

/** BM25 索引文档结构 */
export interface IndexDocument {
  id: string;
  role: string;
  content: string;
  toolName: string;
  round: number;
  timestamp: number;
}

/** 可选的日志接口 */
export interface PipelineLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
