# Requirements Document: MCP Client

## Introduction

为 Mako AI 编程助手实现 MCP（Model Context Protocol）客户端功能。MCP 是 Anthropic 提出的标准化协议，用于 AI Agent 与外部工具提供者之间的通信。本功能允许用户通过配置文件连接外部 MCP Server，自动发现并注册其提供的工具，使 Mako 能够像使用内置工具一样调用外部 MCP 工具。

## Glossary

- **MCP_Client**: MCP 客户端模块，负责与 MCP Server 建立连接、发现工具、转发工具调用
- **MCP_Server**: 外部 MCP 服务器进程，通过 JSON-RPC 协议暴露工具能力
- **Transport**: MCP 通信传输层，支持 stdio（标准输入输出）方式与 MCP Server 通信
- **Tool_Registry**: Mako 的工具注册中心，管理所有可用工具（内置工具 + MCP 工具）
- **Tool_Converter**: 将 MCP 工具 schema 转换为 Mako Tool 接口格式的转换器
- **Config_Loader**: 配置加载器，从 `.mako/config.json` 读取 MCP Server 配置
- **Server_Manager**: MCP Server 生命周期管理器，负责启动、监控和停止 MCP Server 进程
- **JSON_RPC**: JSON-RPC 2.0 协议，MCP 通信的底层协议格式
- **Mako_Tool**: Mako 的 Tool 接口，包含 name、description、parameters 和 execute 方法

## Requirements

### Requirement 1: MCP Server 配置加载

**User Story:** 作为开发者，我希望通过 `.mako/config.json` 配置 MCP Server 连接信息，以便 Mako 启动时自动连接外部工具服务。

#### Acceptance Criteria

1. WHEN Mako 启动时，THE Config_Loader SHALL 从 `.mako/config.json` 文件的 `mcpServers` 字段读取所有 MCP Server 配置
2. THE Config_Loader SHALL 解析每个 MCP Server 配置中的 `command`（启动命令）、`args`（命令参数）和 `env`（环境变量）字段
3. IF `mcpServers` 字段不存在或为空对象，THEN THE Config_Loader SHALL 跳过 MCP 初始化且不产生错误
4. IF 某个 MCP Server 配置缺少必需的 `command` 字段，THEN THE Config_Loader SHALL 输出该 Server 的配置错误信息并跳过该 Server
5. THE Config_Loader SHALL 支持在 `env` 字段中引用环境变量值（直接字符串值）

### Requirement 2: Stdio 传输层连接

**User Story:** 作为开发者，我希望 MCP Client 通过 stdio 方式与 MCP Server 通信，以便利用子进程的标准输入输出进行 JSON-RPC 消息交换。

#### Acceptance Criteria

1. WHEN MCP_Client 连接一个 MCP Server 时，THE Transport SHALL 使用配置的 `command` 和 `args` 启动子进程
2. THE Transport SHALL 通过子进程的 stdin 发送 JSON-RPC 请求消息
3. THE Transport SHALL 通过子进程的 stdout 接收 JSON-RPC 响应消息
4. THE Transport SHALL 将配置的 `env` 字段中的环境变量注入到子进程的环境中
5. IF 子进程启动失败（命令不存在或权限不足），THEN THE Transport SHALL 返回包含失败原因的错误信息
6. THE Transport SHALL 在发送请求后等待对应的响应消息，超时时间为 30 秒

### Requirement 3: 工具发现

**User Story:** 作为开发者，我希望 MCP Client 自动发现 MCP Server 提供的所有工具，以便无需手动配置即可使用外部工具。

#### Acceptance Criteria

1. WHEN Transport 连接建立成功后，THE MCP_Client SHALL 发送 `initialize` 请求完成协议握手
2. WHEN 协议握手完成后，THE MCP_Client SHALL 发送 `tools/list` 请求获取 MCP Server 提供的所有工具列表
3. THE MCP_Client SHALL 解析 `tools/list` 响应中每个工具的 `name`、`description` 和 `inputSchema` 字段
4. IF `tools/list` 请求失败或超时，THEN THE MCP_Client SHALL 记录错误日志并将该 Server 标记为不可用

### Requirement 4: 工具格式转换

**User Story:** 作为开发者，我希望 MCP 工具被转换为 Mako 的 Tool 接口格式，以便 MCP 工具能与内置工具统一管理和调用。

#### Acceptance Criteria

1. THE Tool_Converter SHALL 将 MCP 工具的 `name` 字段映射为 Mako_Tool 的 `name` 字段，并添加 MCP Server 名称作为前缀（格式：`mcp_{serverName}_{toolName}`）
2. THE Tool_Converter SHALL 将 MCP 工具的 `description` 字段映射为 Mako_Tool 的 `description` 字段
3. THE Tool_Converter SHALL 将 MCP 工具的 `inputSchema`（JSON Schema）映射为 Mako_Tool 的 `parameters` 字段
4. THE Tool_Converter SHALL 为每个转换后的 Mako_Tool 生成一个 `execute` 方法，该方法将调用参数转发给对应的 MCP Server
5. IF MCP 工具的 `name` 与已注册的内置工具名称冲突，THEN THE Tool_Converter SHALL 保留带前缀的命名格式以避免冲突

### Requirement 5: 工具注册

**User Story:** 作为开发者，我希望发现的 MCP 工具自动注册到 Mako 的 ToolRegistry 中，以便 Agent 循环能够像使用内置工具一样使用 MCP 工具。

#### Acceptance Criteria

1. WHEN 工具格式转换完成后，THE MCP_Client SHALL 将所有转换后的 Mako_Tool 注册到 Tool_Registry 中
2. THE Tool_Registry SHALL 在 `list()` 和 `listForLLM()` 方法中同时返回内置工具和 MCP 工具
3. IF 注册过程中发生工具名称重复，THEN THE MCP_Client SHALL 记录警告日志并跳过该重复工具

### Requirement 6: 工具调用转发

**User Story:** 作为开发者，我希望当 Agent 调用 MCP 工具时，调用请求被正确转发到对应的 MCP Server 并返回结果。

#### Acceptance Criteria

1. WHEN Agent 调用一个 MCP 工具时，THE MCP_Client SHALL 通过 Transport 向对应的 MCP Server 发送 `tools/call` 请求
2. THE MCP_Client SHALL 在 `tools/call` 请求中包含工具名称（去除前缀后的原始名称）和调用参数
3. WHEN MCP Server 返回成功响应时，THE MCP_Client SHALL 提取响应中的 `content` 字段并将文本内容返回给 Agent
4. IF MCP Server 返回错误响应，THEN THE MCP_Client SHALL 返回包含错误信息的字符串给 Agent
5. IF `tools/call` 请求超时（30 秒），THEN THE MCP_Client SHALL 返回超时错误信息给 Agent

### Requirement 7: Server 生命周期管理

**User Story:** 作为开发者，我希望 MCP Server 进程在 Mako 启动时自动启动，在 Mako 退出时自动停止，以便无需手动管理外部进程。

#### Acceptance Criteria

1. WHEN Mako 启动并加载 MCP 配置后，THE Server_Manager SHALL 按配置顺序启动所有 MCP Server 子进程
2. WHEN Mako 进程退出时（正常退出或收到 SIGINT/SIGTERM 信号），THE Server_Manager SHALL 向所有 MCP Server 子进程发送终止信号并等待其退出
3. IF 某个 MCP Server 子进程在收到终止信号后 5 秒内未退出，THEN THE Server_Manager SHALL 强制终止该进程（SIGKILL）
4. IF 某个 MCP Server 子进程在运行期间意外崩溃，THEN THE Server_Manager SHALL 记录错误日志并将该 Server 的工具标记为不可用
5. THE Server_Manager SHALL 支持单独重启某个 MCP Server（用于错误恢复场景）

### Requirement 8: 错误处理与容错

**User Story:** 作为开发者，我希望 MCP Client 能够优雅地处理各种错误情况，以便单个 MCP Server 的故障不会影响 Mako 的整体运行。

#### Acceptance Criteria

1. IF 某个 MCP Server 连接失败，THEN THE MCP_Client SHALL 记录错误日志并继续启动其他 MCP Server
2. IF MCP Server 返回格式不正确的 JSON-RPC 响应，THEN THE MCP_Client SHALL 返回解析错误信息给调用方
3. IF Transport 层检测到子进程的 stdout 流关闭，THEN THE Transport SHALL 将该 Server 标记为断开状态
4. WHILE 某个 MCP Server 处于不可用状态，THE MCP_Client SHALL 对该 Server 的工具调用直接返回 "Server 不可用" 错误信息
5. THE MCP_Client SHALL 确保单个 MCP Server 的故障不会阻塞 Mako 的启动流程或影响其他 Server 的正常运行

### Requirement 9: CLI 集成展示

**User Story:** 作为开发者，我希望在 CLI 中能够看到已连接的 MCP 工具列表，以便了解当前可用的外部工具。

#### Acceptance Criteria

1. WHEN 用户在 CLI 中查看可用工具列表时，THE CLI SHALL 同时展示内置工具和 MCP 工具
2. THE CLI SHALL 在 MCP 工具名称旁标注其来源 Server 名称（例如：`[github] create_issue`）
3. WHEN Mako 启动完成后，THE CLI SHALL 输出已成功连接的 MCP Server 数量和总工具数量

### Requirement 10: 危险工具确认机制

**User Story:** 作为开发者，我希望 MCP 工具也能参与 Mako 的危险工具确认机制，以便对可能产生副作用的外部工具调用进行人工确认。

#### Acceptance Criteria

1. THE MCP_Client SHALL 将所有 MCP 工具默认标记为需要确认的危险工具（因为外部工具的行为不可预测）
2. WHERE 用户在配置中为某个 MCP Server 设置了 `alwaysAllow` 工具列表，THE MCP_Client SHALL 将这些工具排除出危险工具确认流程
3. WHEN Agent 调用一个需要确认的 MCP 工具时，THE CLI SHALL 展示工具名称、来源 Server 和调用参数，等待用户确认后再执行
