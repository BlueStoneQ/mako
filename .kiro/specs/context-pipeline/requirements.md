# Requirements Document

## Introduction

ContextPipeline 是 Mako AI Coding Agent 的新一代上下文管理模块，替换现有的 ContextManager。该模块实现 5 层防御体系（源头截断、去重、微压缩、自动压缩、兜底）加检索恢复层，解决生产环境下长对话（100+ 轮、大量工具调用）的上下文爆炸问题。

ContextPipeline 作为独立模块位于 `packages/core/src/context/`，对外保持与现有 ContextManager 相同的接口（`addMessage()`、`assemble()`），Agent Loop 无需修改即可切换。

## Glossary

- **Context_Pipeline**: 新的上下文管理模块，实现 5 层防御 + 检索恢复的管道式处理
- **Agent_Loop**: Agent 核心循环，调用 `addMessage()` 添加消息、调用 `assemble()` 组装上下文发送给 LLM
- **Message**: 对话消息对象，包含 role、content、toolCalls、toolCallId 字段
- **Tool_Result**: 工具执行后返回的结果字符串，作为 role=tool 的 Message 存储
- **READ_Tool**: 只读类工具，包括 read_file、bash、search、list_directory、fetch_url
- **WRITE_Tool**: 写入类工具，包括 write_file、replace_in_file
- **Token_Counter**: Token 计数器，使用 gpt-tokenizer 库计算消息的 token 数量
- **Round**: 一轮对话，定义为一次 user 消息到下一次 user 消息之间的所有消息
- **Content_Hash**: 文件内容的哈希值（SHA-256），用于检测文件是否发生变化
- **Transcript**: 完整对话记录，保存在 `.mako/transcripts/` 目录下
- **BM25_Index**: 基于 minisearch 库的全文检索索引，用于搜索历史上下文
- **Pipeline_Config**: ContextPipeline 的配置对象，控制各层的启用/禁用和参数
- **Compression_Summary**: 自动压缩层生成的 9 维结构化摘要

## Requirements

### Requirement 1: 模块接口兼容

**User Story:** 作为 Agent_Loop 的维护者，我希望 Context_Pipeline 提供与现有 ContextManager 相同的外部接口，以便无需修改 Agent_Loop 代码即可切换到新模块。

#### Acceptance Criteria

1. THE Context_Pipeline SHALL 提供 `addMessage(message: Message): void` 方法，接受符合 Message 类型的消息对象
2. THE Context_Pipeline SHALL 提供 `assemble(): Message[]` 方法，返回包含 system prompt 和处理后消息列表的数组
3. THE Context_Pipeline SHALL 提供 `getMessages(): Message[]` 方法，返回当前存储的原始消息列表副本
4. THE Context_Pipeline SHALL 提供 `clear(): void` 方法，清空所有存储的消息和内部状态
5. THE Context_Pipeline SHALL 提供 `getTokenCount(): number` 方法，返回当前上下文的 token 总数
6. THE Context_Pipeline SHALL 提供 `compressIfNeeded(): Promise<void>` 方法，在需要时触发压缩流程

### Requirement 2: 管道配置

**User Story:** 作为 Mako 的使用者，我希望能够通过配置对象控制 Context_Pipeline 各层的启用状态和参数，以便根据不同场景调整行为。

#### Acceptance Criteria

1. THE Context_Pipeline SHALL 接受 Pipeline_Config 对象作为构造参数
2. THE Pipeline_Config SHALL 包含每一层的独立启用/禁用开关（`layers.truncation.enabled`、`layers.deduplication.enabled`、`layers.microCompression.enabled`、`layers.autoCompression.enabled`、`layers.fallback.enabled`、`layers.retrieval.enabled`）
3. WHEN Pipeline_Config 未提供某层配置时，THE Context_Pipeline SHALL 使用该层的默认配置值
4. THE Pipeline_Config SHALL 支持运行时动态修改，通过 `updateConfig(partial: Partial<Pipeline_Config>)` 方法生效

### Requirement 3: 源头截断层

**User Story:** 作为 Mako 的使用者，我希望过大的工具结果在进入上下文前被截断并保存到磁盘，以便防止单次工具调用占满上下文窗口。

#### Acceptance Criteria

1. WHEN 单个 Tool_Result 的字符数超过 50000 时，THE Context_Pipeline SHALL 将完整结果保存到磁盘文件，并将 Tool_Result 替换为前 200 行预览文本加磁盘路径引用
2. WHEN 单条 assistant 消息关联的所有 Tool_Result 字符数总和超过 200000 时，THE Context_Pipeline SHALL 从最早的 Tool_Result 开始截断，直到总字符数降至 200000 以内
3. WHEN read_file 工具的结果超过 2000 行时，THE Context_Pipeline SHALL 仅保留前 2000 行并附加截断提示信息
4. THE Context_Pipeline SHALL 将截断的完整内容保存到 `.mako/overflow/` 目录，文件名包含时间戳和工具调用 ID
5. THE Pipeline_Config SHALL 允许配置 `layers.truncation.singleResultLimit`（默认 50000）、`layers.truncation.aggregateLimit`（默认 200000）、`layers.truncation.fileReadLineLimit`（默认 2000）

### Requirement 4: 去重层

**User Story:** 作为 Mako 的使用者，我希望重复读取未变化的文件时不再占用上下文空间，以便在频繁引用同一文件的长对话中节省 token。

#### Acceptance Criteria

1. WHEN `addMessage()` 接收到 read_file 类型的 Tool_Result 时，THE Context_Pipeline SHALL 计算结果内容的 Content_Hash 并存储
2. WHEN 同一文件路径的 Content_Hash 与上次读取相同时，THE Context_Pipeline SHALL 将 Tool_Result 替换为存根消息 `[文件未变化: {path}，内容与第 {round} 轮读取相同]`
3. WHEN 同一文件路径的 Content_Hash 与上次读取不同时，THE Context_Pipeline SHALL 保留完整的 Tool_Result 并更新存储的 Content_Hash
4. THE Context_Pipeline SHALL 从 Tool_Result 中提取文件路径，支持 read_file 工具的 `path` 参数格式

### Requirement 5: 微压缩层

**User Story:** 作为 Mako 的使用者，我希望旧的只读工具结果被自动清理，以便为新的对话内容腾出上下文空间，同时保留写入操作的变更历史。

#### Acceptance Criteria

1. WHEN `assemble()` 被调用时，THE Context_Pipeline SHALL 识别所有超过 N 轮的 READ_Tool 类型 Tool_Result 消息
2. THE Context_Pipeline SHALL 将超过 N 轮的 READ_Tool 结果替换为摘要存根 `[已清理: {tool_name} 结果，第 {round} 轮]`
3. THE Context_Pipeline SHALL 保留所有 WRITE_Tool 类型的 Tool_Result 消息，无论其轮次
4. THE Pipeline_Config SHALL 允许配置 `layers.microCompression.keepRounds` 参数（默认值 5）
5. THE Context_Pipeline SHALL 将 bash 工具结果归类为 READ_Tool 类型进行清理

### Requirement 6: 自动压缩层

**User Story:** 作为 Mako 的使用者，我希望当上下文接近 token 上限时自动触发结构化摘要压缩，以便对话能够无限延续而不丢失关键信息。

#### Acceptance Criteria

1. WHEN `compressIfNeeded()` 被调用且当前 token 数超过 `maxTokens * compressThreshold` 时，THE Context_Pipeline SHALL 触发自动压缩流程
2. THE Context_Pipeline SHALL 生成包含以下 9 个维度的 Compression_Summary：(1) 用户原始意图 (2) 当前任务状态 (3) 关键决策记录 (4) 已完成的操作 (5) 待完成的操作 (6) 重要文件列表 (7) 错误和解决方案 (8) 用户偏好和约束 (9) 最近用户消息的原文引用
3. THE Context_Pipeline SHALL 在 Compression_Summary 中包含最近 3 条 user 消息的原文引用，防止意图漂移
4. WHEN 压缩完成后，THE Context_Pipeline SHALL 恢复以下内容到上下文：最近读取的文件内容（最多 5 个）、当前执行计划、工具 schema 定义
5. THE Context_Pipeline SHALL 在压缩后的上下文末尾附加续接指令：`[系统提示: 上下文已压缩。请直接继续执行任务，无需确认或重复摘要内容。]`
6. THE Pipeline_Config SHALL 允许配置 `layers.autoCompression.threshold`（默认 0.8）和 `layers.autoCompression.maxRecentFiles`（默认 5）

### Requirement 7: 兜底层

**User Story:** 作为 Mako 的使用者，我希望即使压缩后仍超出窗口限制时有最终保护机制，以便 Agent 在极端情况下仍能继续工作。

#### Acceptance Criteria

1. IF 自动压缩后 token 数仍超过 `maxTokens` 的 95%，THEN THE Context_Pipeline SHALL 从最早的消息组开始逐组截断，直到 token 数降至 `maxTokens` 的 70% 以内
2. WHEN 兜底截断触发前，THE Context_Pipeline SHALL 将完整对话记录保存到 `.mako/transcripts/` 目录，文件名格式为 `{sessionId}_{timestamp}.json`
3. THE Context_Pipeline SHALL 在截断后的上下文开头插入提示：`[系统提示: 早期对话已归档。如需回顾历史信息，请使用 recall 工具搜索。]`

### Requirement 8: 检索恢复层

**User Story:** 作为 Mako 的使用者，我希望被压缩或丢弃的历史内容可以通过关键词搜索恢复，以便 Agent 在需要时能回顾早期对话细节。

#### Acceptance Criteria

1. WHEN 消息被微压缩层清理或兜底层截断时，THE Context_Pipeline SHALL 将消息内容索引到 BM25_Index 中
2. THE Context_Pipeline SHALL 提供 `recall(query: string, topK?: number): string[]` 方法，返回与查询最相关的历史消息片段
3. THE Context_Pipeline SHALL 使用 minisearch 库实现 BM25_Index，索引字段包含 role、content、tool_name、round_number
4. WHEN `recall()` 被调用时，THE Context_Pipeline SHALL 返回最多 topK 条结果（默认 5），每条结果包含原始消息内容和所属轮次信息
5. THE BM25_Index SHALL 在 Context_Pipeline 初始化时从 `.mako/transcripts/` 目录加载历史数据重建索引

### Requirement 9: 对话持久化

**User Story:** 作为 Mako 的使用者，我希望对话状态能够保存和恢复，以便跨会话继续工作。

#### Acceptance Criteria

1. THE Context_Pipeline SHALL 提供 `save(sessionId: string): Promise<void>` 方法，将当前消息列表、Content_Hash 缓存、BM25_Index 状态保存到 `.mako/sessions/` 目录
2. THE Context_Pipeline SHALL 提供 `load(sessionId: string): Promise<void>` 方法，从磁盘恢复完整的 Context_Pipeline 状态
3. IF 加载会话文件失败（文件不存在或格式错误），THEN THE Context_Pipeline SHALL 保持空状态并静默处理，不抛出异常

### Requirement 10: 管道执行顺序

**User Story:** 作为 Context_Pipeline 的开发者，我希望各层按照确定的顺序执行，以便保证处理结果的一致性和可预测性。

#### Acceptance Criteria

1. WHEN `addMessage()` 被调用时，THE Context_Pipeline SHALL 按以下顺序执行入口层处理：(1) 源头截断 (2) 去重
2. WHEN `assemble()` 被调用时，THE Context_Pipeline SHALL 按以下顺序执行出口层处理：(1) 微压缩 (2) 组装最终消息数组
3. WHEN `compressIfNeeded()` 被调用时，THE Context_Pipeline SHALL 按以下顺序执行：(1) 自动压缩 (2) 兜底截断（仅在自动压缩后仍超限时）
4. THE Context_Pipeline SHALL 跳过配置中被禁用的层，直接传递数据到下一层

### Requirement 11: 独立性与解耦

**User Story:** 作为 Mako 的开发者，我希望 Context_Pipeline 不依赖 Agent、CLI 或 Tools 模块，以便独立开发、测试和复用。

#### Acceptance Criteria

1. THE Context_Pipeline SHALL 仅依赖 Message 类型定义和 LLMAdapter 接口（用于压缩摘要生成）
2. THE Context_Pipeline SHALL 不导入 `packages/cli/` 或 `packages/tools/` 中的任何模块
3. THE Context_Pipeline SHALL 通过构造函数注入 LLMAdapter 实例，不自行创建 LLM 连接
4. THE Context_Pipeline SHALL 通过 Pipeline_Config 中的工具分类配置（READ_Tool 列表、WRITE_Tool 列表）识别工具类型，不硬编码工具名称
