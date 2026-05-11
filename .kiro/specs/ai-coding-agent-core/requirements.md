# 需求文档

## 简介

**Mako** — 开源 AI Coding Agent 框架，v0.1 核心循环。目标：**跑通一个完整的 Agent 循环**，能接收用户指令、调用工具、返回结果。

架构哲学：**万物皆插件（Everything is a Plugin）**是长期愿景，但 v0.1 只搭骨架、留好边界，不实现完整插件系统。

v0.1 分层：
```
┌─────────────────────────────────────┐
│     CLI（交互入口）                   │
├─────────────────────────────────────┤
│     Core（调度 + 循环）               │
│  Agent Loop / Prompt 组装 / 响应解析  │
├─────────────────────────────────────┤
│     内置模块                          │
│  LLM Client / Context / ToolRegistry │
├─────────────────────────────────────┤
│     配置层                            │
│  模型配置 / 工具声明 / System Prompt  │
└─────────────────────────────────────┘
```

Core 直接调用内置模块，不需要调度器层或 EventBus。Core 本身就是调度者。

### v0.1 明确不做

- EventBus / HookSystem / Plugin Registry
- Skill / MCP / Steering 系统
- 复杂持久化策略（v0.1 用 JSON 文件即可）
- 评测框架
- 插件依赖排序、脚手架命令
- 热加载/热替换

## 术语表

- **Agent**：AI Coding Agent 系统核心实体，接收用户指令、调用 LLM、执行工具、返回结果
- **LLM_Client**：大语言模型客户端，通过 OpenAI 兼容协议格式（`/v1/chat/completions`）访问任意模型（MiMo/Claude/GPT/DeepSeek/本地模型），切换模型只需改 baseUrl 配置
- **LLM_Adapter_Interface**：LLM 客户端的 TypeScript 接口定义，方便后续替换实现
- **Context_Manager**：上下文管理器，维护对话历史和组装消息序列
- **Tool_Registry**：工具注册中心，管理所有可用工具的注册、查询和执行
- **Tool**：可被 Agent 调用的能力单元，包含 name、description、parameters（JSONSchema）、execute 函数
- **Agent_Loop**：Agent 核心循环，ReAct 模式（用户消息 → LLM → 文本回答或 Tool Call → 循环）
- **Tool_Call**：LLM 返回的工具调用请求，包含工具名称和参数
- **Message**：对话消息，包含角色（user/assistant/system/tool）和内容
- **System_Prompt**：系统提示词，定义 Agent 的行为规则
- **CLI**：命令行交互界面，Core API 的消费者

## 需求

### 需求 1：项目基础设施

**用户故事：** 作为开发者，我希望项目使用现代 TypeScript monorepo 结构，以便多包独立开发并保证代码质量。

#### 验收标准

1. THE 项目 SHALL 使用 pnpm workspace 管理 `packages/core`、`packages/tools`、`packages/cli` 三个子包
2. THE 项目 SHALL 使用 TypeScript 严格模式编译所有源代码
3. THE 项目 SHALL 使用 ESM 模块系统作为输出格式
4. THE 项目 SHALL 使用 tsup 作为构建工具
5. THE 项目 SHALL 使用 vitest 作为测试框架
6. THE 项目 SHALL 使用 ESLint 进行代码质量检查
7. THE 项目核心模块 SHALL 有单元测试（实现和测试同步编写）
8. THE 项目 SHALL 包含端到端集成测试验证 Agent 循环的完整行为

---

### 需求 2：LLM Client（内置模块）

**用户故事：** 作为开发者，我希望通过统一的客户端接入 OpenAI 兼容模型，以便切换模型只需改配置。

#### 验收标准

1. THE LLM_Client SHALL 基于 openai SDK 实现
2. THE LLM_Client SHALL 通过 `baseUrl`、`apiKey`、`model` 三个配置项连接任意 OpenAI 兼容接口
3. THE LLM_Client SHALL 提供 `chat` 方法，发送 Message 数组，返回 LLM 响应（文本或 Tool_Call）
4. THE LLM_Client SHALL 提供 `stream` 方法，发送 Message 数组，返回流式响应
5. THE LLM_Client SHALL 基于 LLM_Adapter_Interface 定义，接口和实现分离
6. IF LLM 请求失败，THEN THE LLM_Client SHALL 返回包含错误信息的结构化错误

---

### 需求 3：Context Manager（内置模块）

**用户故事：** 作为开发者，我希望 Agent 能管理对话历史、持久化上下文、自动处理上下文超限问题并正确组装消息序列，以便关闭终端后上下文不丢失，且 LLM 始终能理解完整上下文而不会因 token 超限报错。

#### 验收标准

1. THE Context_Manager SHALL 维护有序的 Message 列表作为对话历史
2. THE Context_Manager SHALL 提供 `addMessage` 方法添加消息
3. THE Context_Manager SHALL 提供 `getMessages` 方法返回当前对话历史
4. THE Context_Manager SHALL 提供 `clear` 方法清空对话历史
5. THE Context_Manager SHALL 组装完整消息序列：System_Prompt 作为第一条消息 + 对话历史
6. THE Context_Manager SHALL 支持配置 System_Prompt 内容
7. THE Context_Manager SHALL 监控当前消息序列的 token 数量
8. WHEN 消息序列的 token 数量超出配置的阈值，THE Context_Manager SHALL 自动对早期消息进行摘要压缩，保留最近的消息不变
9. THE Context_Manager SHALL 将对话历史持久化到项目根目录下的 `.mako/sessions/` 目录（JSON 文件格式）
10. WHEN Agent 启动时，THE Context_Manager SHALL 从 `.mako/sessions/` 加载上一次的对话历史
11. THE Context_Manager SHALL 封装所有上下文复杂度（存储、压缩、持久化、组装），Agent_Loop 仅通过其接口读写消息，不感知内部实现

---

### 需求 4：Tool Registry + 执行（内置模块）

**用户故事：** 作为开发者，我希望有一个工具注册中心管理 Agent 可用的工具，以便动态注册和调用工具。

#### 验收标准

1. THE Tool_Registry SHALL 提供 `register` 方法注册符合 Tool 接口的对象
2. THE Tool_Registry SHALL 提供 `get` 方法根据名称返回 Tool 对象
3. THE Tool_Registry SHALL 提供 `list` 方法返回所有已注册工具
4. THE Tool_Registry SHALL 提供 `listForLLM` 方法返回 OpenAI function calling 格式的工具描述
5. IF 注册的工具名称与已有工具重复，THEN THE Tool_Registry SHALL 抛出名称冲突错误
6. WHEN 收到 Tool_Call，THE Tool_Registry SHALL 根据 name 找到对应工具并执行其 execute 方法

---

### 需求 5：Agent Loop（Core 层）

**用户故事：** 作为用户，我希望 Agent 能通过 ReAct 循环自主完成任务——调用工具、观察结果、继续推理——直到给出最终回答。

#### 验收标准

1. WHEN 用户发送消息，THE Agent SHALL 将消息加入 Context_Manager 并调用 LLM_Client
2. WHEN LLM 返回文本响应，THE Agent SHALL 将其作为最终回答返回给用户
3. WHEN LLM 返回 Tool_Call，THE Agent SHALL 通过 Tool_Registry 执行对应工具，将结果作为 tool 角色消息加入对话历史，然后再次调用 LLM 继续循环
4. THE Agent SHALL 支持配置最大循环次数，防止无限循环
5. IF 达到最大循环次数仍未产生文本回答，THEN THE Agent SHALL 终止循环并返回错误提示
6. IF 工具执行过程中发生错误，THEN THE Agent SHALL 将错误信息作为工具结果返回给 LLM，由 LLM 决定下一步行动
7. THE Agent_Loop SHALL 直接调用 LLM_Client、Context_Manager、Tool_Registry，不经过调度器或事件总线

---

### 需求 6：内置工具

**用户故事：** 作为用户，我希望 Agent 具备文件操作、命令执行和网络访问能力，以便完成编码任务。

#### 验收标准

1. THE read_file 工具 SHALL 接收 `path` 参数，以 UTF-8 编码读取并返回文件内容
2. IF 文件不存在或路径是目录，THEN THE read_file 工具 SHALL 返回描述性错误信息
3. THE write_file 工具 SHALL 接收 `path` 和 `content` 参数，写入文件内容（自动创建父目录，覆写已有文件）
4. THE replace_in_file 工具 SHALL 接收 `path`、`oldStr`、`newStr` 参数，精确替换文件中匹配 oldStr 的内容为 newStr
5. IF oldStr 在文件中匹配 0 处，THEN THE replace_in_file 工具 SHALL 返回"未找到匹配内容"错误
6. IF oldStr 在文件中匹配多处，THEN THE replace_in_file 工具 SHALL 返回"匹配到多处，请提供更多上下文"错误
7. THE list_directory 工具 SHALL 接收 `path` 参数，返回该目录下的文件和子目录列表（含类型标识）
8. THE bash 工具 SHALL 接收 `command` 参数，在子进程中执行 Shell 命令并返回 stdout
9. IF 命令执行超时（默认 30 秒），THEN THE bash 工具 SHALL 终止子进程并返回超时错误
10. IF 命令执行失败（非零退出码），THEN THE bash 工具 SHALL 返回包含 stderr 和退出码的错误信息
11. THE search 工具 SHALL 接收 `pattern` 参数和可选的 `path` 参数，递归搜索文件内容，返回文件路径 + 行号 + 匹配行
12. THE fetch_url 工具 SHALL 接收 `url` 参数，发送 HTTP GET 请求并返回响应的文本内容
13. IF fetch_url 请求失败或超时（默认 10 秒），THEN THE fetch_url 工具 SHALL 返回包含状态码或错误原因的错误信息

---

### 需求 7：CLI 交互入口

**用户故事：** 作为用户，我希望通过命令行与 Agent 交互，输入自然语言指令并看到回答和工具调用过程。

#### 验收标准

1. THE CLI SHALL 提供 readline 交互界面等待用户输入
2. WHEN 用户输入消息，THE CLI SHALL 调用 Core API（agent.chat(message)）并显示 Agent 回答
3. THE CLI SHALL 在 Agent 处理过程中显示工具调用的 loading 状态
4. THE CLI SHALL 从配置文件或环境变量读取模型配置（apiKey、baseUrl、model）
5. THE CLI SHALL 支持 Ctrl+C 退出
6. THE `packages/core` SHALL 对 `packages/cli` 保持零依赖（Core 不 import CLI 模块，CLI 是 Core 的消费者）

---

## 端到端验收场景

```bash
$ mako
> 读取当前目录的 package.json，告诉我项目名和版本号

# Agent 应该：
# 1. 调用 read_file("package.json")
# 2. 解析内容
# 3. 回答项目名和版本号
# 在 3 次以内的 ReAct 循环中完成
```
