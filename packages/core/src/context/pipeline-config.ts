/** 截断层配置 */
export interface TruncationConfig {
  enabled: boolean;
  /** 单个 Tool_Result 最大字符数，默认 50000 */
  singleResultLimit: number;
  /** 单条 assistant 关联的所有 Tool_Result 总字符数上限，默认 200000 */
  aggregateLimit: number;
  /** read_file 结果最大行数，默认 2000 */
  fileReadLineLimit: number;
  /** 溢出文件存储目录 */
  overflowDir: string;
}

/** 去重层配置 */
export interface DeduplicationConfig {
  enabled: boolean;
}

/** 微压缩层配置 */
export interface MicroCompressionConfig {
  enabled: boolean;
  /** 保留最近 N 轮的 READ_Tool 结果，默认 5 */
  keepRounds: number;
}

/** 自动压缩层配置 */
export interface AutoCompressionConfig {
  enabled: boolean;
  /** 触发压缩的 token 占比阈值，默认 0.8 */
  threshold: number;
  /** 压缩后恢复的最近文件数上限，默认 5 */
  maxRecentFiles: number;
}

/** 兜底层配置 */
export interface FallbackConfig {
  enabled: boolean;
  /** 兜底触发阈值（占 maxTokens 比例），默认 0.95 */
  triggerThreshold: number;
  /** 兜底目标（占 maxTokens 比例），默认 0.70 */
  targetThreshold: number;
  /** transcript 保存目录 */
  transcriptDir: string;
}

/** 检索恢复层配置 */
export interface RetrievalConfig {
  enabled: boolean;
  /** recall 默认返回条数，默认 5 */
  defaultTopK: number;
  /** transcript 目录（用于初始化时重建索引） */
  transcriptDir: string;
}

/** 管道配置 */
export interface PipelineConfig {
  maxTokens: number;
  systemPrompt: string;
  sessionDir: string;

  /** 工具分类配置 */
  toolClassification: {
    readTools: string[];
    writeTools: string[];
  };

  /** 各层配置 */
  layers: {
    truncation: TruncationConfig;
    deduplication: DeduplicationConfig;
    microCompression: MicroCompressionConfig;
    autoCompression: AutoCompressionConfig;
    fallback: FallbackConfig;
    retrieval: RetrievalConfig;
  };
}

/** 用于 createDefaultPipelineConfig 的部分覆盖类型 */
export type PipelineConfigOverrides = Partial<
  Pick<PipelineConfig, 'maxTokens' | 'systemPrompt' | 'sessionDir'> & {
    toolClassification?: Partial<PipelineConfig['toolClassification']>;
    layers?: Partial<{
      truncation: Partial<TruncationConfig>;
      deduplication: Partial<DeduplicationConfig>;
      microCompression: Partial<MicroCompressionConfig>;
      autoCompression: Partial<AutoCompressionConfig>;
      fallback: Partial<FallbackConfig>;
      retrieval: Partial<RetrievalConfig>;
    }>;
  }
>;

/** 创建默认管道配置，合并用户部分配置与默认值 */
export function createDefaultPipelineConfig(
  overrides?: PipelineConfigOverrides,
): PipelineConfig {
  return {
    maxTokens: overrides?.maxTokens ?? 128000,
    systemPrompt: overrides?.systemPrompt ?? '',
    sessionDir: overrides?.sessionDir ?? '.mako/sessions',
    toolClassification: {
      readTools: overrides?.toolClassification?.readTools ?? [
        'read_file',
        'bash',
        'search',
        'list_directory',
        'fetch_url',
      ],
      writeTools: overrides?.toolClassification?.writeTools ?? [
        'write_file',
        'replace_in_file',
      ],
    },
    layers: {
      truncation: {
        enabled: overrides?.layers?.truncation?.enabled ?? true,
        singleResultLimit:
          overrides?.layers?.truncation?.singleResultLimit ?? 50000,
        aggregateLimit:
          overrides?.layers?.truncation?.aggregateLimit ?? 200000,
        fileReadLineLimit:
          overrides?.layers?.truncation?.fileReadLineLimit ?? 2000,
        overflowDir:
          overrides?.layers?.truncation?.overflowDir ?? '.mako/overflow',
      },
      deduplication: {
        enabled: overrides?.layers?.deduplication?.enabled ?? true,
      },
      microCompression: {
        enabled: overrides?.layers?.microCompression?.enabled ?? true,
        keepRounds: overrides?.layers?.microCompression?.keepRounds ?? 5,
      },
      autoCompression: {
        enabled: overrides?.layers?.autoCompression?.enabled ?? true,
        threshold: overrides?.layers?.autoCompression?.threshold ?? 0.8,
        maxRecentFiles:
          overrides?.layers?.autoCompression?.maxRecentFiles ?? 5,
      },
      fallback: {
        enabled: overrides?.layers?.fallback?.enabled ?? true,
        triggerThreshold:
          overrides?.layers?.fallback?.triggerThreshold ?? 0.95,
        targetThreshold:
          overrides?.layers?.fallback?.targetThreshold ?? 0.70,
        transcriptDir:
          overrides?.layers?.fallback?.transcriptDir ?? '.mako/transcripts',
      },
      retrieval: {
        enabled: overrides?.layers?.retrieval?.enabled ?? true,
        defaultTopK: overrides?.layers?.retrieval?.defaultTopK ?? 5,
        transcriptDir:
          overrides?.layers?.retrieval?.transcriptDir ?? '.mako/transcripts',
      },
    },
  };
}
