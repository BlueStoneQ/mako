# Mako 🦈

> 开源 AI Coding Agent 框架。模型无关、可扩展、可观测。

[English](./README.md)

## Mako 是什么？

Mako 是一个开源的 AI Coding Agent，运行在终端中。它能读代码、写代码、执行命令，帮你完成软件开发任务——支持任意 OpenAI 兼容的大模型。

**核心特色：**
- 🔌 **模型无关** — 支持 GPT、Claude、MiMo、DeepSeek、本地模型，切换只需改配置
- 🧠 **超长会话** — 5 层 ContextPipeline 支持 200+ 轮对话（体感无限对话），自动压缩 + BM25 检索恢复
- 📊 **可观测** — 内置执行追踪，每次交互自动记录，`mako trace` 提供 AI 分析
- 🎯 **可定制** — 项目级行为规则（`.mako/steering.md`），让 Agent 遵循你的项目规范
- 🛠️ **可扩展** — 微内核 + 万物皆插件的架构设计，为后续扩展留好了骨架

## 快速开始

```bash
# 全局安装
npm install -g @mako/cli

# 配置模型
mako config

# 开始对话
mako
```

### 开发环境

```bash
git clone https://github.com/BlueStoneQ/mako.git
cd mako
pnpm install
pnpm build
npx mako
```

## 功能

### 🧠 超长会话管理 — 200+ 轮对话，5 层防御自动管理

Mako 实现了 **5 层上下文防御体系**（参考 Claude Code 架构设计），支持数百轮重度工具调用的复杂编码会话，自动管理上下文窗口，无需手动干预。

```
┌──────────────────────────────────────────────────────┐
│  L1 源头截断      大工具结果 → 落盘 + 预览             │
│  L2 去重          未变化文件 → 存根引用                │
│  L3 微压缩        旧的只读结果 → 自动清理              │
│  L4 自动压缩      9 维结构化摘要，保留意图 + 决策       │
│  L5 兜底 + 检索   归档到磁盘 + BM25 关键词检索恢复     │
└──────────────────────────────────────────────────────┘
```

**工作原理：**
- 工具结果超过 50K 字符 → 完整内容保存到磁盘，上下文只保留预览
- 重复读取未变化的文件 → SHA-256 哈希检测，返回存根（不重复占用 token）
- 旧的只读工具结果 → 自动清理（写入操作的变更历史永远保留）
- 上下文达到 80% → AI 生成 9 维结构化摘要（保留用户意图、关键决策、原文引用）
- 上下文达到 95% → 最旧消息归档到磁盘，通过 BM25 关键词检索可随时恢复
- **所有被压缩的内容都可恢复** — 没有信息真正丢失

**效果：** 无限对话长度。零配置。开箱即用。

### 💬 交互式对话 + 工具调用

```
$ mako
> 读取 package.json，告诉我项目名和版本号

  bash
  │ command: cat package.json | jq '{name, version}'
  ✓ {"name": "mako", "version": "0.1.0"}

项目名是 mako，版本号是 0.1.0。
(2 轮)
```

Agent 通过 ReAct 循环自主决定使用什么工具、怎么组合，直到给出最终回答。

### 📊 执行追踪与 AI 分析

每次交互自动保存到 `.mako/traces/`。使用 `mako trace` 获取 AI 分析：

```
$ mako trace

## Mako Agent 执行分析
- 总交互次数: 15
- 平均响应时间: 2300ms
- 平均循环轮次: 2.1
- 总工具调用: 28

### 工具使用统计
| 工具 | 调用次数 | 错误次数 |
|------|---------|----------|
| bash | 12 | 1 |
| read_file | 8 | 0 |
| write_file | 5 | 0 |

### 最近 5 次交互
- "读取 package.json" → 2轮, 1200ms, 工具: bash
- "帮我加个错误处理" → 4轮, 3500ms, 工具: read_file, replace_in_file
...

[AI 分析建议]
Agent 整体表现良好。bash 工具有 1 次错误，建议检查...
```

**价值**：不只是让 Agent 跑起来，还能看清它在想什么、哪里慢、哪里出错。这是评测和优化的基础。

### 🎯 项目级 Steering

创建 `.mako/steering.md`（或 `.mako/steering/*.md`），Mako 启动时自动读取并注入 System Prompt：

```markdown
<!-- .mako/steering.md -->
# 项目规则
- 包管理器用 pnpm，不要用 npm
- 测试框架是 vitest
- 代码风格：单引号、无分号
- 修改代码后必须跑 pnpm test
- 这个项目是 TypeScript monorepo
```

类似 Claude Code 的 `CLAUDE.md`，让 Agent 了解你的项目规范。

### 🔧 内置工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容（UTF-8） |
| `write_file` | 创建或覆写文件（自动创建父目录） |
| `replace_in_file` | 精确替换文件内容（要求唯一匹配） |
| `list_directory` | 列出目录结构 |
| `bash` | 执行 Shell 命令（30 秒超时） |
| `search` | 递归搜索文件内容（正则匹配） |
| `fetch_url` | 访问网页获取内容（10 秒超时） |

## 命令

| 命令 | 说明 |
|------|------|
| `mako` | 启动交互式对话 |
| `mako config` | 配置模型（API Key、接口地址、模型名） |
| `mako trace` | 分析 Agent 执行历史（AI 辅助分析） |
| `mako --help` | 显示帮助 |
| `mako --version` | 显示版本 |

## 配置

### 配置文件（`.mako/config.json`）

```json
{
  "llm": {
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  },
  "agent": {
    "maxIterations": 20
  },
  "context": {
    "maxTokens": 128000,
    "compressThreshold": 100000
  }
}
```

### 环境变量（优先级高于配置文件）

| 变量 | 说明 |
|------|------|
| `MAKO_API_KEY` | API Key（必须） |
| `MAKO_BASE_URL` | 模型接口地址（默认 `https://api.openai.com/v1`） |
| `MAKO_MODEL` | 模型名称（默认 `gpt-4o`） |

## 架构

```
packages/core   — Agent ReAct 循环、LLM 适配器、上下文管理、工具注册
packages/tools  — 7 个内置工具
packages/cli    — 终端交互、配置、Steering、Trace
```

**设计哲学**：万物皆插件（Everything is a Plugin）。当前 v0.1 搭好骨架，后续演进为完整的微内核 + 插件系统。

详见 [架构设计](./docs/architecture.md) | [远景规划](./docs/vision.md)

## 开发

```bash
pnpm install      # 安装依赖
pnpm build        # 构建所有包
pnpm test         # 运行测试
npx mako          # 本地运行
```

## 文档

| 文档 | 内容 |
|------|------|
| [架构设计](./docs/architecture.md) | 分层架构、数据流、模块设计 |
| [远景规划](./docs/vision.md) | 差异化方向、路线图 |
| [里程碑](./docs/milestones.md) | 开发计划、阶段目标 |
| [技术选型](./docs/tech-stack.md) | 技术栈与选择理由 |

## License

MIT
