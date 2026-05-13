# Implementation Plan: ContextPipeline

## Overview

采用自底向上的分层实现策略，从基础类型和工具开始，逐层构建 5 层防御 + 检索恢复管道。每个任务聚焦一个独立模块，确保增量可验证。使用 TypeScript + Node.js 22+ ESM 模块系统，测试框架为 Vitest + @fast-check/vitest。

## Tasks

- [x] 1. 基础类型、配置与溢出存储
  - [x] 1.1 创建层接口与内部消息类型定义
    - 创建 `packages/core/src/context/layers/types.ts`
    - 定义 `InternalMessage`、`IngressLayer`、`EgressLayer`、`CompressionLayer`、`LayerContext`、`CompressionContext` 接口
    - 定义 `IndexDocument` 类型（BM25 索引文档结构）
    - 定义 `PipelineLogger` 可选日志接口
    - _Requirements: 1.1, 10.1, 10.2, 10.3, 11.1_

  - [x] 1.2 创建管道配置类型与默认值工厂
    - 创建 `packages/core/src/context/pipeline-config.ts`
    - 定义 `PipelineConfig` 及各层子配置接口（`TruncationConfig`、`DeduplicationConfig`、`MicroCompressionConfig`、`AutoCompressionConfig`、`FallbackConfig`、`RetrievalConfig`）
    - 实现 `createDefaultPipelineConfig()` 工厂函数，合并用户部分配置与默认值
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.3 实现溢出内容磁盘存储模块
    - 创建 `packages/core/src/context/overflow-store.ts`
    - 实现 `saveOverflow(toolCallId, toolName, content): Promise<string>` 方法，保存到 `.mako/overflow/{timestamp}_{toolCallId}.txt`
    - 实现 `readOverflow(filePath): Promise<string>` 方法
    - 处理磁盘写入失败的降级逻辑（记录警告，不抛异常）
    - _Requirements: 3.1, 3.4_

  - [ ]* 1.4 为配置默认值合并编写属性测试
    - **Property 3: 配置默认值合并**
    - 使用 fast-check 生成任意部分 PipelineConfig，验证构造后所有必需字段存在且缺失字段使用默认值
    - **Validates: Requirements 2.3**

  - [ ]* 1.5 为禁用层透传编写属性测试
    - **Property 4: 禁用层透传**
    - 使用 fast-check 生成任意消息，验证 `enabled: false` 的层不修改消息
    - **Validates: Requirements 2.2, 10.4**

- [x] 2. L1: 源头截断层
  - [x] 2.1 实现 TruncationLayer
    - 创建 `packages/core/src/context/layers/truncation-layer.ts`
    - 实现 `IngressLayer` 接口
    - 实现单条 Tool_Result 字符数截断（超过 singleResultLimit 时保留前 200 行预览 + overflow 路径引用）
    - 实现 read_file 行数截断（超过 fileReadLineLimit 时截断并附加提示）
    - 实现聚合截断逻辑（同一 assistant 关联的所有 Tool_Result 总字符数超过 aggregateLimit 时从最早开始截断）
    - 调用 OverflowStore 保存完整内容
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 为单条结果截断编写属性测试
    - **Property 5: 单条结果截断**
    - 使用 fast-check 生成超过 singleResultLimit 的 Tool_Result，验证处理后长度在限制内且 overflow 文件已保存
    - **Validates: Requirements 3.1**

  - [ ]* 2.3 为聚合结果截断编写属性测试
    - **Property 6: 聚合结果截断**
    - 使用 fast-check 生成一组关联 Tool_Result，验证总字符数不超过 aggregateLimit
    - **Validates: Requirements 3.2**

  - [ ]* 2.4 为行数截断编写属性测试
    - **Property 7: 行数截断**
    - 使用 fast-check 生成超过 fileReadLineLimit 行的 read_file 结果，验证处理后行数等于 fileReadLineLimit
    - **Validates: Requirements 3.3**

  - [ ]* 2.5 编写 TruncationLayer 单元测试
    - 测试边界值（恰好 50000 字符、恰好 2000 行）
    - 测试非 tool 消息透传
    - 测试 overflow 文件格式和路径
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. L2: 去重层
  - [x] 3.1 实现 DeduplicationLayer
    - 创建 `packages/core/src/context/layers/deduplication-layer.ts`
    - 实现 `IngressLayer` 接口
    - 使用 SHA-256 计算 read_file 结果的 Content_Hash
    - 维护 `hashCache: Map<string, { hash: string; round: number }>` 缓存
    - 相同哈希时替换为存根 `[文件未变化: {path}，内容与第 {round} 轮读取相同]`
    - 不同哈希时更新缓存并保留完整内容
    - 实现文件路径提取逻辑（从 tool_call arguments 或内容首行提取）
    - 提供 `getHashCache()` 方法用于持久化
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 3.2 为去重正确性编写属性测试
    - **Property 8: 去重正确性**
    - 使用 fast-check 生成文件路径和内容，验证重复内容被替换为存根、不同内容被保留
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 3.3 编写 DeduplicationLayer 单元测试
    - 测试首次读取保留完整内容
    - 测试重复读取替换为存根
    - 测试内容变化后更新缓存
    - 测试非 read_file 消息透传
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [~] 4. Checkpoint - 确保入口层测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 5. L3: 微压缩层
  - [x] 5.1 实现 MicroCompressionLayer
    - 创建 `packages/core/src/context/layers/micro-compression-layer.ts`
    - 实现 `EgressLayer` 接口
    - 在 `process()` 中识别超过 keepRounds 轮的 READ_Tool 结果
    - 将过期的 READ_Tool 结果替换为存根 `[已清理: {tool_name} 结果，第 {round} 轮]`
    - 保留所有 WRITE_Tool 结果不变
    - 通过 `LayerContext.isReadTool()` / `isWriteTool()` 判断工具类型（配置驱动，不硬编码）
    - 将被清理的消息传递给检索层索引
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 11.4_

  - [ ]* 5.2 为微压缩保留写入工具结果编写属性测试
    - **Property 9: 微压缩保留写入工具结果**
    - 使用 fast-check 生成混合 READ/WRITE 工具结果的消息列表，验证 WRITE_Tool 结果始终保留、过期 READ_Tool 结果被替换
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 5.3 为工具分类配置驱动编写属性测试
    - **Property 16: 工具分类配置驱动**
    - 使用 fast-check 生成自定义 toolClassification 配置，验证微压缩层按配置而非硬编码名称决定清理行为
    - **Validates: Requirements 11.4**

  - [ ]* 5.4 编写 MicroCompressionLayer 单元测试
    - 测试轮次边界（恰好第 N 轮和第 N+1 轮）
    - 测试 bash 工具归类为 READ_Tool
    - 测试存根格式正确性
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. L4: 自动压缩层
  - [x] 6.1 实现 AutoCompressionLayer
    - 创建 `packages/core/src/context/layers/auto-compression-layer.ts`
    - 实现 `CompressionLayer` 接口
    - 实现 9 维结构化压缩提示词构建
    - 提取最近 3 条 user 消息原文嵌入第 9 维
    - 调用 LLM 生成摘要
    - 压缩后恢复最近读取的文件（最多 maxRecentFiles 个，去重同路径）
    - 保留当前轮次消息
    - 附加续接指令系统消息
    - 将被压缩的消息索引到检索层
    - 处理 LLM 调用失败的降级（跳过本次压缩）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.2 为压缩阈值触发编写属性测试
    - **Property 10: 压缩阈值触发**
    - 使用 fast-check 生成不同 token 数的上下文状态，验证超过阈值时触发压缩、未超过时保持不变
    - **Validates: Requirements 6.1**

  - [ ]* 6.3 为压缩摘要结构完整性编写属性测试
    - **Property 11: 压缩摘要结构完整性**
    - 使用 fast-check 生成对话历史，验证生成的摘要包含 9 个维度且第 9 维包含最近 user 消息原文
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 6.4 编写 AutoCompressionLayer 单元测试
    - 测试 9 维 prompt 构建正确性
    - 测试恢复文件选择逻辑（去重、最多 5 个）
    - 测试 LLM 调用失败时的降级行为
    - 测试续接指令附加
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 7. L5: 兜底层
  - [x] 7.1 实现 FallbackLayer
    - 创建 `packages/core/src/context/layers/fallback-layer.ts`
    - 实现 `CompressionLayer` 接口
    - 检测 token 超过 95% 阈值时触发
    - 保存完整对话到 transcript 文件（`.mako/transcripts/{sessionId}_{timestamp}.json`）
    - 索引所有消息到检索层
    - 从最早的消息组（按 round 分组）逐组截断，直到 token 降至 70% 以内
    - 插入归档提示系统消息
    - 处理 transcript 保存失败的降级
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 7.2 为兜底层 token 目标编写属性测试
    - **Property 12: 兜底层 token 目标**
    - 使用 fast-check 生成超过 95% 阈值的消息列表，验证兜底执行后 token 不超过 70%
    - **Validates: Requirements 7.1**

  - [ ]* 7.3 编写 FallbackLayer 单元测试
    - 测试逐组截断逻辑（按 round 分组）
    - 测试 transcript 保存格式
    - 测试归档提示插入
    - 测试 transcript 保存失败时继续执行
    - _Requirements: 7.1, 7.2, 7.3_

- [~] 8. Checkpoint - 确保压缩层测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 9. L6: 检索恢复层
  - [x] 9.1 实现 RetrievalLayer
    - 创建 `packages/core/src/context/layers/retrieval-layer.ts`
    - 安装 minisearch 依赖：`pnpm add minisearch --filter @mako/core`
    - 使用 MiniSearch 创建 BM25 索引，字段为 content、toolName、role
    - 实现 `indexMessages(messages: InternalMessage[]): void` 方法（避免重复索引）
    - 实现 `recall(query: string, topK?: number): string[]` 方法
    - 实现 `loadFromTranscripts(transcriptDir: string): Promise<void>` 从 transcript 重建索引
    - 实现 `exportState()` / `importState(state)` 用于持久化
    - 处理索引损坏时重建空索引
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 9.2 为检索恢复可达性编写属性测试
    - **Property 13: 检索恢复可达性**
    - 使用 fast-check 生成消息并索引，验证使用消息内容关键词调用 recall 能找到该消息
    - **Validates: Requirements 8.1, 8.2**

  - [ ]* 9.3 为检索结果数量限制编写属性测试
    - **Property 14: 检索结果数量限制**
    - 使用 fast-check 生成查询和 topK 参数，验证 recall 返回结果数不超过 topK
    - **Validates: Requirements 8.4**

  - [ ]* 9.4 编写 RetrievalLayer 单元测试
    - 测试索引和搜索基本流程
    - 测试避免重复索引
    - 测试 exportState/importState 往返
    - 测试从 transcript 文件重建索引
    - 测试空查询和无结果场景
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 10. ContextPipeline 主类组装
  - [x] 10.1 实现 ContextPipeline 主类
    - 创建 `packages/core/src/context/context-pipeline.ts`
    - 实现构造函数：接收 PipelineConfig 和 LLMAdapter，初始化各层实例
    - 实现 `addMessage()`：包装为 InternalMessage，按顺序执行入口层（L1 截断 → L2 去重）
    - 实现 `assemble()`：执行出口层（L3 微压缩），组装 system prompt + 处理后消息
    - 实现 `compressIfNeeded()`：按顺序执行 L4 自动压缩 → L5 兜底
    - 实现 `getMessages()`：返回消息列表副本
    - 实现 `getTokenCount()`：计算 system prompt + 所有消息的 token 总数
    - 实现 `clear()`：清空消息和内部状态
    - 实现 `recall()`：委托给 RetrievalLayer
    - 实现 `updateConfig()`：动态更新配置
    - 实现 `save()` / `load()`：持久化完整状态（消息、哈希缓存、索引状态）
    - 实现 LayerContext / CompressionContext 构建逻辑
    - 跳过 `enabled: false` 的层
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4_

  - [ ]* 10.2 为消息存储往返一致性编写属性测试
    - **Property 1: 消息存储往返一致性**
    - 使用 fast-check 生成 Message 序列，验证 addMessage 后 getMessages 包含所有消息且返回副本不影响内部状态
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 10.3 为 Token 计数一致性编写属性测试
    - **Property 2: Token 计数一致性**
    - 使用 fast-check 生成消息列表，验证 getTokenCount 等于 system prompt token + 所有消息 token 之和
    - **Validates: Requirements 1.5**

  - [ ]* 10.4 为持久化往返一致性编写属性测试
    - **Property 15: 持久化往返一致性**
    - 使用 fast-check 生成 ContextPipeline 状态，验证 save → load 后 getMessages 返回相同消息
    - **Validates: Requirements 9.1, 9.2**

  - [ ]* 10.5 编写 ContextPipeline 单元测试
    - 测试接口兼容性（与 ContextManager 相同的方法签名）
    - 测试层执行顺序
    - 测试配置合并
    - 测试 clear 清空所有状态
    - 测试 updateConfig 动态修改
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 10.1, 10.2, 10.3, 10.4_

- [x] 11. 迁移与集成
  - [x] 11.1 迁移 Agent 使用 ContextPipeline
    - 修改 `packages/core/src/agent.ts`：导入 ContextPipeline 和 createDefaultPipelineConfig
    - 将 `new ContextManager(...)` 替换为 `new ContextPipeline(pipelineConfig, llm)`
    - 标记旧 ContextManager 为 `@deprecated`
    - 更新 `packages/core/src/index.ts` 导出 ContextPipeline 相关类型
    - 确保 Agent 类型兼容（`context: ContextManager | ContextPipeline`）
    - _Requirements: 1.1, 1.2, 11.1, 11.2, 11.3_

  - [ ]* 11.2 编写集成测试
    - 创建 `packages/core/__tests__/context-pipeline.integration.test.ts`
    - 模拟 100 轮对话，验证 token 始终在限制内
    - 测试持久化往返：save → load → 验证状态一致
    - 测试压缩触发：填充消息至阈值，验证压缩行为
    - 测试检索恢复：清理消息后通过 recall 找回
    - 测试完整管道端到端流程
    - _Requirements: 1.1, 1.2, 1.5, 6.1, 7.1, 8.1, 9.1_

- [~] 12. Final checkpoint - 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用具体的 requirements 条款，确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证 16 个正确性属性的普遍正确性
- 单元测试验证具体示例和边界条件
- 集成测试验证完整管道端到端行为
- 所有层实现遵循错误不向上传播原则：层内捕获异常，消息原样传递

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "3.3"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "6.1", "7.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "7.2", "7.3", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2", "10.3", "10.4", "10.5"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["11.2"] }
  ]
}
```
