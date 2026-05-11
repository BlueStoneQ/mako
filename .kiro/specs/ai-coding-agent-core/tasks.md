# 实现计划：Mako v0.1 — AI Coding Agent 核心

## 概述

使用 pnpm monorepo 实现核心 Agent 循环框架，包含三个包（`@mako/core`、`@mako/tools`、`@mako/cli`）。实现采用自底向上的方式：项目脚手架 → 核心类型 → LLM 适配器 → 上下文管理器 → 工具注册中心 → Agent 循环 → 内置工具 → CLI → 测试。

## 任务

- [x] 1. 项目脚手架与 monorepo 搭建
  - [x] 1.1 初始化根项目与 pnpm workspace
    - 创建根 `package.json`，包含 workspace 脚本（`test`、`test:unit`、`test:property`、`test:e2e`、`test:coverage`、`build`、`lint`）
    - 创建 `pnpm-workspace.yaml` 引用 `packages/*`
    - 创建 `tsconfig.base.json`，启用严格模式、ESM 输出、路径别名
    - 创建根 `vitest.config.ts`，配置测试匹配模式和覆盖率
    - 创建根 `.eslintrc.cjs`，配置 `@typescript-eslint` 规则
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 搭建 `packages/core` 包结构
    - 创建 `packages/core/package.json`，包名 `@mako/core`，类型 `module`，依赖（`openai`、`gpt-tokenizer`），开发依赖（`typescript`、`tsup`、`vitest`、`fast-check`）
    - 创建 `packages/core/tsconfig.json` 继承基础配置
    - 创建 `packages/core/tsup.config.ts` 用于 ESM 构建
    - 创建目录结构：`src/`、`src/llm/`、`src/context/`、`src/tools/`、`__tests__/`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.3 搭建 `packages/tools` 包结构
    - 创建 `packages/tools/package.json`，包名 `@mako/tools`，类型 `module`，依赖 `fast-glob`
    - 创建 `packages/tools/tsconfig.json` 继承基础配置
    - 创建 `packages/tools/tsup.config.ts`
    - 创建目录结构：`src/`、`__tests__/`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.4 搭建 `packages/cli` 包结构
    - 创建 `packages/cli/package.json`，包名 `@mako/cli`，类型 `module`，依赖 `@mako/core`、`@mako/tools`、`chalk`、`ora`，bin 入口 `mako`
    - 创建 `packages/cli/tsconfig.json` 继承基础配置
    - 创建 `packages/cli/tsup.config.ts`
    - 创建目录结构：`src/`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.6_

- [x] 2. 核心类型与接口
  - [x] 2.1 定义公共类型（`packages/core/src/types.ts`）
    - 按照设计文档精确实现 `MessageRole`、`ToolCall`、`Message`、`LLMResponse`、`LLMStreamChunk`、`Tool`、`ToolDefinitionForLLM`、`AgentConfig`、`LLMConfig`、`ContextConfig` 类型/接口
    - _Requirements: 2.3, 2.5, 3.1, 4.1, 4.4, 5.1_

  - [x] 2.2 定义 LLM 适配器接口（`packages/core/src/llm/types.ts`）
    - 实现 `ChatOptions`、`LLMAdapter` 接口，包含 `chat` 和 `stream` 方法
    - 实现 `LLMError` 类，包含 `statusCode` 和 `rawError` 属性
    - _Requirements: 2.5, 2.6_

  - [x] 2.3 创建包索引导出（`packages/core/src/index.ts`）
    - 导出所有公共类型、`Agent`、`ContextManager`、`ToolRegistry`、`OpenAIAdapter`、`LLMError`
    - _Requirements: 7.6_

- [x] 3. LLM 适配器实现
  - [x] 3.1 实现 OpenAI 适配器（`packages/core/src/llm/openai-adapter.ts`）
    - 创建 `OpenAIAdapter` 类实现 `LLMAdapter` 接口
    - 构造函数接收 `LLMConfig`，使用 `baseURL` 和 `apiKey` 创建 OpenAI 客户端
    - 实现 `chat` 方法：将内部 `Message[]` 转换为 OpenAI 格式，调用 `client.chat.completions.create`，将响应解析为 `LLMResponse`（文本或 tool_calls）
    - 实现 `stream` 方法：使用 `stream: true` 调用，yield `LLMStreamChunk` 对象
    - 将所有 OpenAI SDK 错误包装为 `LLMError`，附带相应状态码
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.2 编写 OpenAI 适配器单元测试
    - 测试消息格式转换（内部格式 → OpenAI SDK 格式）
    - 测试响应解析（文本响应、tool_calls 响应）
    - 测试错误包装（网络错误、401、429、500、格式异常响应）
    - Mock OpenAI SDK 客户端
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

- [x] 4. 上下文管理器（Context Manager）实现
  - [x] 4.1 实现 token 计数器（`packages/core/src/context/token-counter.ts`）
    - 使用 `gpt-tokenizer` 的 `encode` 创建 `countTokens(text: string): number` 函数
    - 创建 `countMessageTokens(messages: Message[]): number` 辅助函数
    - _Requirements: 3.7_

  - [x] 4.2 实现上下文管理器（`packages/core/src/context/context-manager.ts`）
    - 创建 `ContextManager` 类，构造函数接收 `systemPrompt`、`ContextConfig`、`LLMAdapter`
    - 实现 `addMessage(message: Message): void` — 追加到内部数组
    - 实现 `getMessages(): Message[]` — 返回消息历史的副本
    - 实现 `assemble(): Message[]` — 返回 `[{role: 'system', content: systemPrompt}, ...messages]`
    - 实现 `clear(): void` — 重置消息数组
    - 实现 `getTokenCount(): number` — 计算系统提示词 + 所有消息的 token 数
    - 实现 `compressIfNeeded(): Promise<void>` — 若 token 数超过阈值，通过 LLM 对早期消息进行摘要，替换为摘要消息
    - 实现 `save(sessionId: string): Promise<void>` — 将消息写入 `.mako/sessions/{sessionId}.json`
    - 实现 `load(sessionId: string): Promise<void>` — 从磁盘读取消息
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ]* 4.3 编写上下文管理器属性测试
    - **属性 1：消息插入保持顺序**
    - **属性 2：清空重置状态**
    - **属性 3：组装产生正确结构**
    - **属性 4：Token 计数一致性**
    - **验证: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

  - [ ]* 4.4 编写压缩属性测试
    - **属性 5：压缩减少 token 数同时保留最近消息**
    - **验证: Requirements 3.8**

  - [ ]* 4.5 编写会话持久化属性测试
    - **属性 6：会话持久化往返一致性**
    - **验证: Requirements 3.9, 3.10**

  - [ ]* 4.6 编写上下文管理器单元测试
    - 测试压缩触发边界（刚好低于阈值、恰好在阈值、超过阈值）
    - 测试空历史边界情况
    - 测试单条消息历史
    - 测试加载不存在的会话文件
    - _Requirements: 3.7, 3.8, 3.9, 3.10_

- [x] 5. 工具注册中心（Tool Registry）实现
  - [x] 5.1 实现工具注册中心（`packages/core/src/tools/tool-registry.ts`）
    - 创建 `ToolRegistry` 类，内部使用 `Map<string, Tool>`
    - 实现 `register(tool: Tool): void` — 若名称已存在则抛出错误
    - 实现 `get(name: string): Tool | undefined`
    - 实现 `list(): Tool[]`
    - 实现 `listForLLM(): ToolDefinitionForLLM[]` — 将工具映射为 OpenAI function calling 格式
    - 实现 `execute(toolCall: ToolCall): Promise<string>` — 根据名称查找工具，使用参数调用 `execute`，返回结果字符串
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 5.2 编写工具注册中心属性测试
    - **属性 7：工具注册与检索往返一致性**
    - **属性 8：listForLLM 产生有效的 OpenAI function 格式**
    - **属性 9：重复工具名称拒绝**
    - **属性 10：工具执行正确分发**
    - **验证: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

  - [ ]* 5.3 编写工具注册中心单元测试
    - 测试空注册中心 `get` 返回 undefined
    - 测试 `execute` 使用未注册的工具名称
    - 测试 `listForLLM` 输出结构符合 OpenAI 规范
    - _Requirements: 4.2, 4.4, 4.6_

- [x] 6. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 7. Agent 循环实现
  - [x] 7.1 实现 Agent 类（`packages/core/src/agent.ts`）
    - 创建 `Agent` 类，构造函数接收 `AgentConfig`、`LLMAdapter`、`ToolRegistry`
    - 内部使用系统提示词、上下文配置和 LLM 适配器初始化 `ContextManager`
    - 实现 `chat(userMessage: string): Promise<AgentResponse>`，包含完整 ReAct 循环：
      1. 将用户消息添加到上下文
      2. 循环最多 `maxIterations` 次：
         - 调用 `context.compressIfNeeded()`
         - 通过 `context.assemble()` 组装消息
         - 调用 `llm.chat(messages, { tools })`
         - 若为文本响应：添加到上下文，返回 `{ content, iterations }`
         - 若为 tool_calls：添加 assistant 消息，通过注册中心执行每个工具，将工具结果添加到上下文
      3. 若循环耗尽：抛出包含最大迭代次数信息的错误
    - 实现 `getToolRegistry(): ToolRegistry`
    - 实现 `getContext(): ContextManager`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 7.2 编写 Agent 循环属性测试
    - **属性 11：Agent 循环以文本响应终止**
    - **属性 12：Agent 循环遵守最大迭代次数**
    - **属性 13：工具错误被捕获为工具结果**
    - **验证: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

  - [ ]* 7.3 编写 Agent 循环单元测试
    - 测试单轮文本响应（无工具调用）
    - 测试多轮工具调用后返回文本响应
    - 测试工具执行错误被捕获并发送回 LLM
    - 测试超过最大迭代次数抛出错误
    - 测试未知工具名称返回错误消息给 LLM
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 8. 内置工具实现
  - [x] 8.1 实现 `read_file` 工具（`packages/tools/src/read-file.ts`）
    - 接收 `path` 参数，使用 `fs.readFile(path, 'utf-8')` 读取文件
    - 返回文件内容字符串
    - 错误：文件未找到 → `"Error: File not found: {path}"`
    - 错误：路径是目录 → `"Error: Path is a directory: {path}"`
    - _Requirements: 6.1, 6.2_

  - [x] 8.2 实现 `write_file` 工具（`packages/tools/src/write-file.ts`）
    - 接收 `path` 和 `content` 参数
    - 使用 `fs.mkdir(dirname(path), { recursive: true })` 创建父目录
    - 使用 `fs.writeFile(path, content, 'utf-8')` 写入内容
    - 返回成功消息
    - _Requirements: 6.3_

  - [x] 8.3 实现 `replace_in_file` 工具（`packages/tools/src/replace-in-file.ts`）
    - 接收 `path`、`oldStr`、`newStr` 参数
    - 读取文件，统计 `oldStr` 出现次数
    - 0 次匹配 → 返回 `"Error: oldStr not found in {path}"`
    - 多次匹配 → 返回 `"Error: oldStr matches N locations, provide more context"`
    - 恰好 1 次匹配 → 替换并写回
    - _Requirements: 6.4, 6.5, 6.6_

  - [x] 8.4 实现 `list_directory` 工具（`packages/tools/src/list-directory.ts`）
    - 接收 `path` 参数（默认 `.`）
    - 使用 `fs.readdir(path, { withFileTypes: true })`
    - 返回格式化列表，目录带 `/` 后缀
    - _Requirements: 6.7_

  - [x] 8.5 实现 `bash` 工具（`packages/tools/src/bash.ts`）
    - 接收 `command` 参数
    - 通过 `child_process.execSync` 或 `spawn` 执行，30 秒超时
    - 成功时返回 stdout
    - 超时 → `"Error: Command timed out after 30s"`
    - 非零退出码 → `"Error (exit {code}): {stderr}"`
    - _Requirements: 6.8, 6.9, 6.10_

  - [x] 8.6 实现 `search` 工具（`packages/tools/src/search.ts`）
    - 接收 `pattern` 和可选的 `path` 参数
    - 使用 `fast-glob` 查找文件，逐行读取每个文件
    - 将行与正则表达式模式匹配
    - 返回结果格式为 `filepath:line_number:matched_line`
    - 优雅处理无效正则表达式
    - _Requirements: 6.11_

  - [x] 8.7 实现 `fetch_url` 工具（`packages/tools/src/fetch-url.ts`）
    - 接收 `url` 参数
    - 使用 Node.js 内置 `fetch` 配合 `AbortController` 实现 10 秒超时
    - 返回响应文本内容
    - 错误：超时 → 包含超时信息
    - 错误：非 2xx → 包含状态码
    - 错误：网络故障 → 包含错误原因
    - _Requirements: 6.12, 6.13_

  - [x] 8.8 创建工具索引导出（`packages/tools/src/index.ts`）
    - 从各自模块导出全部 7 个工具对象
    - _Requirements: 6.1–6.13_

  - [ ]* 8.9 编写内置工具属性测试
    - **属性 14：文件读写往返一致性**
    - **属性 15：搜索找到所有匹配行**
    - **验证: Requirements 6.1, 6.3, 6.11**

  - [ ]* 8.10 编写内置工具单元测试
    - `read_file`：文件未找到、路径是目录、大文件
    - `write_file`：创建嵌套目录、覆写已有文件
    - `replace_in_file`：0 次匹配、多次匹配、恰好 1 次匹配
    - `bash`：超时、非零退出码、空命令
    - `search`：无效正则、空目录、跳过二进制文件
    - `fetch_url`：超时、非 2xx 状态码、网络错误（mock fetch）
    - _Requirements: 6.1–6.13_

- [x] 9. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 10. CLI 实现
  - [x] 10.1 实现配置加载器（`packages/cli/src/config.ts`）
    - 若存在则从 `.mako/config.json` 加载配置
    - 应用环境变量覆盖：`MAKO_API_KEY` → `llm.apiKey`、`MAKO_BASE_URL` → `llm.baseUrl`、`MAKO_MODEL` → `llm.model`
    - 为非敏感值提供合理默认值
    - 若未配置 API key 则抛出明确错误
    - _Requirements: 7.4_

  - [x] 10.2 实现 CLI 入口（`packages/cli/src/index.ts`）
    - 通过 `loadConfig()` 加载配置
    - 使用 LLM 配置创建 `OpenAIAdapter`
    - 创建 `ToolRegistry`，注册全部 7 个内置工具
    - 使用配置、适配器和注册中心创建 `Agent`
    - 若存在则加载上一次会话
    - 设置 `readline` 接口接收交互输入
    - 用户输入时：调用 `agent.chat(message)`，使用 `chalk` 显示响应
    - 使用 `ora` 在 Agent 处理期间显示加载动画
    - 支持 `Ctrl+C` 优雅退出（退出前保存会话）
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 10.3 编写配置加载属性测试
    - **属性 16：配置加载与环境变量覆盖**
    - **验证: Requirements 7.4**

  - [ ]* 10.4 编写 CLI 配置单元测试
    - 测试配置文件加载
    - 测试环境变量覆盖优先级
    - 测试缺少 API key 的错误
    - 测试默认值
    - _Requirements: 7.4_

- [x] 11. 端到端集成测试
  - [x] 11.1 编写完整 Agent 循环的 E2E 集成测试
    - 创建 mock LLM 服务器/适配器，返回预设响应
    - 测试场景：用户请求读取 `package.json` → LLM 返回 `read_file` 工具调用 → 工具执行 → LLM 返回文本回答
    - 验证：循环在 3 次迭代内完成、上下文包含所有预期消息、最终响应包含正确内容
    - 测试场景：LLM 在最终回答前返回多次连续工具调用
    - _Requirements: 1.8, 5.1, 5.2, 5.3_

- [x] 12. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选，可跳过以加快 MVP 进度
- 每个任务引用了具体需求以便追溯
- 检查点确保增量验证
- 属性测试验证设计文档中的通用正确性属性（共 16 个属性）
- 单元测试验证具体示例和边界情况
- 实现语言全程使用 TypeScript（如设计文档所述）
- 依赖：`openai`、`gpt-tokenizer`、`fast-glob`、`chalk`、`ora`、`fast-check`（开发依赖）
