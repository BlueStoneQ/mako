import MiniSearch from 'minisearch';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InternalMessage, IndexDocument } from './types.js';
import type { RetrievalConfig } from '../pipeline-config.js';

/**
 * L6: 检索恢复层
 * 维护 BM25 索引，支持关键词搜索恢复历史内容。
 *
 * 使用 MiniSearch 实现 BM25 全文搜索:
 * - Fields: content, toolName, role
 * - Store fields: content, role, toolName, round, timestamp
 */
export class RetrievalLayer {
  private index: MiniSearch<IndexDocument>;
  private indexedIds: Set<string> = new Set();
  private config: RetrievalConfig;

  constructor(config: RetrievalConfig) {
    this.config = config;
    this.index = this.createFreshIndex();
  }

  /**
   * Index messages into the BM25 index.
   * Skips already-compressed messages and avoids duplicate indexing.
   */
  indexMessages(messages: InternalMessage[]): void {
    const docs: IndexDocument[] = messages
      .filter((m) => m.message.content && !m.compressed)
      .map((m, i) => ({
        id: `${m.round}_${m.timestamp}_${i}`,
        role: m.message.role,
        content: m.message.content!,
        toolName: m.toolName ?? '',
        round: m.round,
        timestamp: m.timestamp,
      }));

    for (const doc of docs) {
      if (!this.indexedIds.has(doc.id)) {
        try {
          this.index.add(doc);
          this.indexedIds.add(doc.id);
        } catch {
          // Skip documents that cause indexing errors (e.g., duplicate IDs from race conditions)
        }
      }
    }
  }

  /**
   * Search historical messages using BM25 full-text search.
   * Returns formatted results as `[第 {round} 轮][{role}/{toolName}]: {content}`
   */
  recall(query: string, topK?: number): string[] {
    const limit = topK ?? this.config.defaultTopK;

    if (!query.trim()) return [];

    try {
      const results = this.index.search(query).slice(0, limit);

      return results.map((r) => {
        const role = (r as unknown as { role: string }).role;
        const toolName = (r as unknown as { toolName: string }).toolName;
        const content = (r as unknown as { content: string }).content;
        const round = (r as unknown as { round: number }).round;

        const roleLabel = toolName ? `${role}/${toolName}` : role;
        return `[第 ${round} 轮][${roleLabel}]: ${content}`;
      });
    } catch {
      // Index corruption — rebuild fresh index
      this.index = this.createFreshIndex();
      this.indexedIds.clear();
      return [];
    }
  }

  /**
   * Load and index messages from transcript JSON files in a directory.
   */
  async loadFromTranscripts(transcriptDir: string): Promise<void> {
    try {
      const files = await readdir(transcriptDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = join(transcriptDir, file);
          const raw = await readFile(filePath, 'utf-8');
          const data = JSON.parse(raw) as { messages?: InternalMessage[] };

          if (data.messages && Array.isArray(data.messages)) {
            this.indexMessages(data.messages);
          }
        } catch {
          // Skip individual files that fail to parse
        }
      }
    } catch {
      // Directory doesn't exist or can't be read — skip silently
    }
  }

  /**
   * Export the index state for persistence.
   */
  exportState(): object {
    return this.index.toJSON();
  }

  /**
   * Import index state from a previously exported JSON.
   * Handles corruption by creating a fresh index.
   */
  importState(state: object): void {
    try {
      this.index = MiniSearch.loadJSON(JSON.stringify(state), {
        fields: ['content', 'toolName', 'role'],
        storeFields: ['content', 'role', 'toolName', 'round', 'timestamp'],
      });
      // Rebuild indexedIds from the loaded index
      this.indexedIds.clear();
    } catch {
      // Import failed — create fresh index
      this.index = this.createFreshIndex();
      this.indexedIds.clear();
    }
  }

  /**
   * Create a fresh MiniSearch index with the configured fields.
   */
  private createFreshIndex(): MiniSearch<IndexDocument> {
    return new MiniSearch<IndexDocument>({
      fields: ['content', 'toolName', 'role'],
      storeFields: ['content', 'role', 'toolName', 'round', 'timestamp'],
      searchOptions: {
        boost: { content: 2, toolName: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }
}
