import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Message } from '../types.js';
import type { LLMAdapter } from '../llm/types.js';
import type { PipelineConfig } from './pipeline-config.js';
import type {
  InternalMessage,
  IngressLayer,
  EgressLayer,
  CompressionLayer,
  LayerContext,
  CompressionContext,
} from './layers/types.js';
import { TruncationLayer } from './layers/truncation-layer.js';
import { DeduplicationLayer } from './layers/deduplication-layer.js';
import { MicroCompressionLayer } from './layers/micro-compression-layer.js';
import { AutoCompressionLayer } from './layers/auto-compression-layer.js';
import { FallbackLayer } from './layers/fallback-layer.js';
import { RetrievalLayer } from './layers/retrieval-layer.js';
import { countTokens, countMessageTokens } from './token-counter.js';

/**
 * ContextPipeline — 5 层防御 + 检索恢复的管道式上下文管理器。
 *
 * 替代旧的 ContextManager，保持相同的外部接口：
 * addMessage / assemble / compressIfNeeded / getMessages / getTokenCount / clear / save / load
 */
export class ContextPipeline {
  private messages: InternalMessage[] = [];
  private currentRound = 0;
  private config: PipelineConfig;
  private llm: LLMAdapter;

  // Layer instances
  private truncationLayer: TruncationLayer;
  private deduplicationLayer: DeduplicationLayer;
  private microCompressionLayer: MicroCompressionLayer;
  private autoCompressionLayer: AutoCompressionLayer;
  private fallbackLayer: FallbackLayer;
  private retrievalLayer: RetrievalLayer;

  // Ordered layer arrays
  private ingressLayers: IngressLayer[];
  private egressLayers: EgressLayer[];
  private compressionLayers: CompressionLayer[];

  constructor(config: PipelineConfig, llm: LLMAdapter) {
    this.config = config;
    this.llm = llm;

    // Initialize layer instances
    this.truncationLayer = new TruncationLayer(config.layers.truncation);
    this.deduplicationLayer = new DeduplicationLayer(config.layers.deduplication);
    this.microCompressionLayer = new MicroCompressionLayer(config.layers.microCompression);
    this.autoCompressionLayer = new AutoCompressionLayer(config.layers.autoCompression);
    this.fallbackLayer = new FallbackLayer(config.layers.fallback);
    this.retrievalLayer = new RetrievalLayer(config.layers.retrieval);

    // Ordered pipelines
    this.ingressLayers = [this.truncationLayer, this.deduplicationLayer];
    this.egressLayers = [this.microCompressionLayer];
    this.compressionLayers = [this.autoCompressionLayer, this.fallbackLayer];
  }

  /**
   * Add a message — wraps as InternalMessage and runs through ingress layers.
   */
  addMessage(message: Message): void {
    // Increment round on user messages
    if (message.role === 'user') {
      this.currentRound++;
    }

    // Determine tool metadata from the message
    const toolName = this.resolveToolName(message);

    // Wrap as InternalMessage
    const internal: InternalMessage = {
      message,
      round: this.currentRound,
      toolCallId: message.toolCallId,
      toolName,
      originalTokens: this.computeMessageTokens(message),
      compressed: false,
      timestamp: Date.now(),
    };

    // Run through ingress layers synchronously (we'll handle the async in a sync wrapper)
    // Since addMessage is sync in the old interface, we process ingress layers eagerly.
    // The layers are async but we need to maintain sync interface compatibility.
    // We'll store the promise and resolve it before assemble/compress.
    this.messages.push(internal);
    this.runIngressAsync(internal, this.messages.length - 1);
  }

  /**
   * Run ingress layers asynchronously and update the stored message in-place.
   * This is fire-and-forget since addMessage must remain synchronous.
   */
  private runIngressAsync(msg: InternalMessage, index: number): void {
    const ctx = this.buildLayerContext();

    // We run ingress layers as a microtask to maintain sync addMessage interface
    const process = async () => {
      let processed = msg;
      for (const layer of this.ingressLayers) {
        if (!layer.enabled) continue;
        try {
          processed = await layer.process(processed, ctx);
        } catch {
          // Layer error — pass message through unchanged
        }
      }
      // Update in-place
      if (index < this.messages.length && this.messages[index] === msg) {
        this.messages[index] = processed;
      }
    };

    // Execute immediately as a microtask
    this._pendingIngress = (this._pendingIngress ?? Promise.resolve()).then(process);
  }

  /** Pending ingress processing promise chain */
  private _pendingIngress: Promise<void> | null = null;

  /** Ensure all pending ingress processing is complete */
  private async ensureIngressComplete(): Promise<void> {
    if (this._pendingIngress) {
      await this._pendingIngress;
      this._pendingIngress = null;
    }
  }

  /**
   * Assemble context for LLM — runs egress layers, then builds [system_prompt, ...messages].
   */
  assemble(): Message[] {
    const ctx = this.buildLayerContext();

    // Run egress layers (synchronous)
    let processed = [...this.messages];
    for (const layer of this.egressLayers) {
      if (!layer.enabled) continue;
      try {
        processed = layer.process(processed, ctx);
      } catch {
        // Layer error — use unprocessed messages
      }
    }

    // Build final message array
    return [
      { role: 'system', content: this.config.systemPrompt },
      ...processed.map((m) => m.message),
    ];
  }

  /**
   * Run compression layers if needed (L4 auto-compression → L5 fallback).
   */
  async compressIfNeeded(): Promise<void> {
    await this.ensureIngressComplete();

    for (const layer of this.compressionLayers) {
      if (!layer.enabled) continue;
      try {
        const ctx = this.buildCompressionContext();
        await layer.compress(ctx);
      } catch {
        // Compression layer error — skip this layer
      }
    }
  }

  /**
   * Get a copy of raw messages (as Message[]).
   */
  getMessages(): Message[] {
    return this.messages.map((m) => ({ ...m.message }));
  }

  /**
   * Get current total token count (system prompt + all messages).
   */
  getTokenCount(): number {
    const systemTokens = countTokens(this.config.systemPrompt) + 4;
    const messageTokens = this.messages.reduce((sum, m) => {
      let tokens = 0;
      if (m.message.content) {
        tokens += countTokens(m.message.content);
      }
      if (m.message.toolCalls) {
        tokens += countTokens(JSON.stringify(m.message.toolCalls));
      }
      tokens += 4; // per-message overhead
      return sum + tokens;
    }, 0);
    return systemTokens + messageTokens;
  }

  /**
   * Clear all messages and internal state.
   */
  clear(): void {
    this.messages = [];
    this.currentRound = 0;
    this._pendingIngress = null;
    // Reset deduplication hash cache
    this.deduplicationLayer.setHashCache(new Map());
    // Retrieval layer keeps its index (can be rebuilt from transcripts)
  }

  /**
   * Search historical messages via BM25 retrieval.
   */
  recall(query: string, topK?: number): string[] {
    return this.retrievalLayer.recall(query, topK);
  }

  /**
   * Dynamically update pipeline configuration.
   */
  updateConfig(partial: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.layers) {
      this.config.layers = { ...this.config.layers, ...partial.layers };
    }
    if (partial.toolClassification) {
      this.config.toolClassification = {
        ...this.config.toolClassification,
        ...partial.toolClassification,
      };
    }
  }

  /**
   * Persist full pipeline state to disk.
   */
  async save(sessionId: string): Promise<void> {
    await this.ensureIngressComplete();

    const filePath = join(this.config.sessionDir, `${sessionId}.json`);
    await mkdir(dirname(filePath), { recursive: true });

    const data = {
      version: 1,
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentRound: this.currentRound,
      messages: this.messages,
      hashCache: Object.fromEntries(this.deduplicationLayer.getHashCache()),
      indexState: this.retrievalLayer.exportState(),
    };

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Restore pipeline state from disk.
   */
  async load(sessionId: string): Promise<void> {
    const filePath = join(this.config.sessionDir, `${sessionId}.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);

      if (data.version === 1) {
        // New format
        this.messages = data.messages ?? [];
        this.currentRound = data.currentRound ?? 0;

        if (data.hashCache) {
          this.deduplicationLayer.setHashCache(
            new Map(Object.entries(data.hashCache)),
          );
        }

        if (data.indexState) {
          this.retrievalLayer.importState(data.indexState);
        }
      } else if (data.messages && Array.isArray(data.messages)) {
        // Legacy ContextManager format — wrap messages as InternalMessage
        this.messages = (data.messages as Message[]).map((msg, i) => ({
          message: msg,
          round: 0,
          toolCallId: msg.toolCallId,
          toolName: undefined,
          originalTokens: 0,
          compressed: false,
          timestamp: Date.now() + i,
        }));
        this.currentRound = 0;
      }
    } catch {
      // File doesn't exist or parse failed — keep empty state (Requirement 9.3)
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Resolve tool name from a message.
   * For tool messages, look up the corresponding assistant toolCalls.
   */
  private resolveToolName(message: Message): string | undefined {
    if (message.role === 'tool' && message.toolCallId) {
      // Find the assistant message with matching toolCall
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.message.role === 'assistant' && m.message.toolCalls) {
          const call = m.message.toolCalls.find((tc) => tc.id === message.toolCallId);
          if (call) return call.name;
        }
      }
    }
    return undefined;
  }

  /**
   * Compute token count for a single message.
   */
  private computeMessageTokens(message: Message): number {
    let tokens = 4; // overhead
    if (message.content) tokens += countTokens(message.content);
    if (message.toolCalls) tokens += countTokens(JSON.stringify(message.toolCalls));
    return tokens;
  }

  /**
   * Build LayerContext from current pipeline state.
   */
  private buildLayerContext(): LayerContext {
    const readTools = new Set(this.config.toolClassification.readTools);
    const writeTools = new Set(this.config.toolClassification.writeTools);

    return {
      currentRound: this.currentRound,
      isReadTool: (name: string) => readTools.has(name),
      isWriteTool: (name: string) => writeTools.has(name),
      getTokenCount: () => this.getTokenCount(),
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Build CompressionContext from current pipeline state.
   */
  private buildCompressionContext(): CompressionContext {
    const base = this.buildLayerContext();

    return {
      ...base,
      messages: this.messages,
      setMessages: (msgs: InternalMessage[]) => {
        this.messages = msgs;
      },
      llm: this.llm,
      systemPrompt: this.config.systemPrompt,
      indexMessages: (msgs: InternalMessage[]) => {
        this.retrievalLayer.indexMessages(msgs);
      },
      saveTranscript: async (msgs: InternalMessage[]) => {
        const transcriptDir = this.config.layers.fallback.transcriptDir;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = join(transcriptDir, `transcript_${timestamp}.json`);
        await mkdir(dirname(filePath), { recursive: true });
        const data = {
          timestamp: new Date().toISOString(),
          messages: msgs,
          reason: 'fallback_truncation',
        };
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      },
    };
  }
}
