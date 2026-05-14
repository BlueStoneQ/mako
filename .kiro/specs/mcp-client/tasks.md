# Implementation Plan: MCP Client

## 概述

本实现计划将 MCP Client 设计拆分为可增量执行的编码任务。采用自底向上的构建顺序：先搭建包基础设施和类型定义，再逐层实现各组件（配置加载 → 工具转换 → 单 Server 连接 → 多 Server 管理 → CLI 集成），每层都包含对应的测试任务。

## Tasks

- [x] 1. 搭建 `packages/mcp/` 包基础设施
  - [x] 1.1 创建包配置文件
    - 创建 `packages/mcp/package.json`，设置 name 为 `@mako/mcp`，type 为 `module`
    - 添加依赖：`@modelcontextprotocol/sdk`，`@mako/core: workspace:*`
    - 添加 devDependencies：`vitest`、`fast-check`、`typescript`、`tsup`
    - 创建 `packages/mcp/tsconfig.json`，继承根配置，设置 ESM 输出
    - 创建 `packages/mcp/tsup.config.ts`，配置入口为 `src/index.ts`，格式为 ESM
    - _Requirements: 项目结构基础_

  - [x] 1.2 创建类型定义和错误类型
    - 创建 `src/types.ts`，定义 `MCPServerConfig`、`MCPConfig`、`MCPServerStatus`、`MCPServerInfo`、`MCPToolDefinition`、`MCPToolCallResult` 接口
    - 创建 `src/errors.ts`，实现 `MCPError`、`MCPConnectionError`、`MCPTimeoutError`、`MCPToolCallError`、`MCPServerUnavailableError` 错误类
    - 创建 `src/index.ts` 公共导出文件，导出所有类型和模块
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 2. 实现配置加载器
  - [x] 2.1 实现 `MCPConfigLoader` 模块
    - 创建 `src/config-loader.ts`
    - 实现 `loadMCPConfig(configPath: string): MCPConfig` 函数：读取 config.json，提取 `mcpServers` 字段
    - 实现 `validateServerConfig(name, raw): MCPServerConfig | null` 函数：验证 command 必填，解析 args/env/alwaysAllow 默认值
    - 处理文件不存在、字段缺失、格式错误等边界情况
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.2 编写配置加载器属性测试
    - **Property 1: 配置解析往返一致性** — 有效配置序列化后再解析应产生等价对象
    - **Property 2: 无效配置过滤** — 缺少 command 的配置应被过滤，返回数量 = 有效配置数
    - 创建 `__tests__/config-loader.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [ ]* 2.3 编写配置加载器单元测试
    - 创建 `__tests__/config-loader.test.ts`
    - 测试用例：空配置文件、mcpServers 字段不存在、缺少 command 字段、env 变量传递、多 Server 配置
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. 实现工具转换器
  - [x] 3.1 实现 `ToolConverter` 模块
    - 创建 `src/tool-converter.ts`
    - 实现 `buildMakoToolName(serverName, mcpToolName): string` — 生成 `mcp_{serverName}_{toolName}` 格式名称
    - 实现 `extractMCPToolName(makoToolName, serverName): string` — 从带前缀名称提取原始工具名
    - 实现 `convertMCPTools(serverName, tools, client): Tool[]` — 将 MCP 工具列表转换为 Mako Tool 数组，每个 Tool 的 execute 方法通过 client.callTool 转发调用
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.2 编写工具转换器属性测试
    - **Property 3: 工具转换保持字段完整性** — 转换后 name 格式正确、description 不变、parameters 与 inputSchema 相同
    - **Property 4: 工具名称前缀往返一致性** — `extractMCPToolName(buildMakoToolName(s, t), s) === t`
    - 创建 `__tests__/tool-converter.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 6.2**

  - [ ]* 3.3 编写工具转换器单元测试
    - 创建 `__tests__/tool-converter.test.ts`
    - 测试用例：具体工具转换示例、description 为空的情况、名称冲突场景、execute 方法调用转发
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [~] 4. Checkpoint - 确保基础模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 5. 实现 MCPClient（单 Server 连接）
  - [x] 5.1 实现 `MCPClient` 类
    - 创建 `src/mcp-client.ts`
    - 实现构造函数：接收 `MCPServerConfig`，初始化 `@modelcontextprotocol/sdk` 的 `Client` 实例
    - 实现 `connect()` 方法：创建 `StdioClientTransport` → 调用 `client.connect(transport)` → 调用 `client.listTools()` → 监听 close/error 事件 → 更新状态
    - 实现 `callTool(toolName, args)` 方法：检查连接状态 → 调用 `client.callTool()` → 提取 content 文本 → 处理 30 秒超时
    - 实现 `disconnect()` 方法：关闭 transport → 更新状态
    - 暴露 `status`、`tools`、`serverName` 只读属性
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 5.2 编写 MCPClient 属性测试
    - **Property 7: 响应内容提取** — 成功响应中所有 type="text" 的 content 拼接；错误响应 isError=true
    - **Property 8: 不可用 Server 的工具调用** — disconnected/error 状态下调用返回 "Server 不可用" 错误
    - 创建 `__tests__/mcp-client.property.test.ts`，使用 mock 替代实际 SDK 调用
    - **Validates: Requirements 6.3, 6.4, 8.4**

  - [ ]* 5.3 编写 MCPClient 单元测试
    - 创建 `__tests__/mcp-client.test.ts`
    - 测试用例：连接成功流程、连接超时、命令不存在错误、工具调用超时、stdout 流关闭后状态变更
    - 使用 vitest mock 模拟 `@modelcontextprotocol/sdk`
    - _Requirements: 2.5, 2.6, 3.4, 6.5, 8.2, 8.3_

- [x] 6. 实现 MCPServerManager（多 Server 生命周期管理）
  - [x] 6.1 实现 `MCPServerManager` 类
    - 创建 `src/server-manager.ts`
    - 实现构造函数：接收 `MCPServerConfig[]` 和 `ToolRegistry`
    - 实现 `initializeAll()` 方法：逐个连接 Server，单个失败不影响其他，连接成功后调用 `convertMCPTools` 并注册到 ToolRegistry
    - 实现 `restartServer(name)` 方法：移除旧工具 → 断开 → 重连 → 重新注册
    - 实现 `shutdownAll()` 方法：并行关闭所有 client，5 秒超时后 SIGKILL
    - 实现 `getServerInfos()` 方法：返回所有 Server 的状态信息
    - 实现 `getDangerousTools()` 方法：返回不在 alwaysAllow 中的 MCP 工具集合
    - _Requirements: 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.5, 10.1, 10.2_

  - [ ]* 6.2 编写 ServerManager 属性测试
    - **Property 5: 注册完整性** — 注册后 registry.list() 包含所有内置工具 + MCP 工具
    - **Property 6: 重复工具跳过** — 重名工具被跳过，registry 大小 = 去重后总数
    - **Property 9: 危险工具分类与 alwaysAllow 过滤** — getDangerousTools() 正确排除 alwaysAllow 中的工具
    - 创建 `__tests__/server-manager.property.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3, 10.1, 10.2**

  - [ ]* 6.3 编写 ServerManager 单元测试
    - 创建 `__tests__/server-manager.test.ts`
    - 测试用例：多 Server 启动顺序、单 Server 失败隔离、重启流程、shutdownAll 超时强制终止
    - 使用 vitest mock 模拟 MCPClient
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.5_

- [~] 7. Checkpoint - 确保核心模块测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 8. CLI 集成
  - [x] 8.1 在 CLI 入口集成 MCP 初始化
    - 修改 `packages/cli/src/index.ts`
    - 在内置工具注册之后，调用 `loadMCPConfig` 加载配置
    - 创建 `MCPServerManager` 实例并调用 `initializeAll()`
    - 输出连接结果摘要（已连接 Server 数量、总工具数量、各 Server 工具数）
    - 将 `getDangerousTools()` 返回的工具加入 `DANGEROUS_TOOLS` 集合
    - _Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_

  - [x] 8.2 注册进程退出钩子
    - 在 CLI 入口注册 `SIGINT`、`SIGTERM`、`exit` 事件处理
    - 退出时调用 `mcpManager.shutdownAll()` 确保子进程被清理
    - _Requirements: 7.2, 7.3_

  - [x] 8.3 更新 `packages/cli/package.json` 添加 `@mako/mcp` 依赖
    - 添加 `"@mako/mcp": "workspace:*"` 到 dependencies
    - _Requirements: 项目集成_

- [ ] 9. 集成测试
  - [ ]* 9.1 创建 Mock MCP Server 脚本
    - 创建 `__tests__/integration/mock-mcp-server.ts`
    - 实现最小化 MCP Server：支持 `initialize`、`tools/list`、`tools/call` 三个 JSON-RPC 方法
    - 通过 stdio 通信，用于集成测试
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [ ]* 9.2 编写集成测试
    - 创建 `__tests__/integration/mcp-client.integration.test.ts`
    - 测试完整连接生命周期：connect → discover → call → disconnect
    - 测试 Server 崩溃后的状态变更
    - 测试多 Server 并行连接
    - _Requirements: 2.1, 3.1, 3.2, 6.1, 6.3, 7.4, 8.1_

- [~] 10. Final Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号以确保可追溯性
- Checkpoint 任务确保增量验证
- 属性测试验证设计文档中定义的正确性属性（Property 1-9）
- 单元测试验证具体示例和边界情况
- 集成测试使用 mock MCP Server 脚本验证端到端流程
- 测试框架使用 Vitest + fast-check（项目已有配置）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2"] }
  ]
}
```
