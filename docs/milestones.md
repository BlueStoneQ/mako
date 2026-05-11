# 里程碑

## 目录

- [v0.1 — 核心循环（第 1-2 周）](#v01--核心循环第-1-2-周)
- [v0.2 — 工程化能力（第 3-4 周）](#v02--工程化能力第-3-4-周)
- [v0.3 — 评测框架（第 5-6 周）](#v03--评测框架第-5-6-周)
- [v1.0 — 发布（第 7 周）](#v10--发布第-7-周)

---

## v0.1 — 核心循环（第 1-2 周）

**目标**：能跑通一个完整的 Agent 循环。

### Week 1

- [ ] 项目初始化（pnpm monorepo + TypeScript + ESLint）
- [ ] `packages/core`：Agent 主循环（ReAct）
- [ ] `packages/core`：LLM Adapter（OpenAI 兼容接口）
- [ ] `packages/core`：Context Manager（对话历史管理）
- [ ] `packages/core`：Tool Registry（工具注册机制）
- [ ] 能和 LLM 对话（纯文本，无工具）

### Week 2

- [ ] `packages/tools`：read_file 工具
- [ ] `packages/tools`：write_file 工具
- [ ] `packages/tools`：bash 工具（执行 Shell 命令）
- [ ] `packages/tools`：search 工具（grep/glob）
- [ ] `packages/cli`：基础 CLI 入口（readline 交互）
- [ ] 能完成一个简单任务（"读取 package.json 并告诉我版本号"）

### 验收标准

```bash
$ ai-agent
> 读取当前目录的 package.json，告诉我项目名和版本号

# Agent 应该：
# 1. 调用 read_file("package.json")
# 2. 解析内容
# 3. 回答 "项目名是 xxx，版本号是 xxx"
```

---

## v0.2 — 工程化能力（第 3-4 周）

**目标**：具备实用的 Coding Agent 能力。

### Week 3

- [ ] `packages/cli`：流式输出（打字机效果）
- [ ] `packages/cli`：工具调用可视化（显示正在执行什么）
- [ ] `packages/core`：上下文压缩（超出 token 限制时自动摘要）
- [ ] `packages/core`：Steering 系统（加载 .agent/steering/*.md）
- [ ] `packages/core`：Skill 系统（加载 .agent/skills/）
- [ ] 配置文件支持（.agent/config.json：模型/API Key/工具白名单）

### Week 4

- [ ] `packages/mcp`：MCP Client 实现（能连接 MCP Server）
- [ ] `packages/mcp`：Tool 自动发现（从 MCP Server 获取工具列表）
- [ ] `packages/tools`：list_directory 工具
- [ ] `packages/tools`：replace_in_file 工具（精确替换）
- [ ] 安全机制：工具执行前确认（危险操作需要用户同意）
- [ ] 能完成一个中等任务（"帮我给这个函数加上错误处理"）

### 验收标准

```bash
$ ai-agent
> 帮我给 src/utils.ts 里的 fetchData 函数加上 try-catch 错误处理

# Agent 应该：
# 1. read_file("src/utils.ts")
# 2. 找到 fetchData 函数
# 3. 生成带 try-catch 的新版本
# 4. write_file("src/utils.ts", newContent)（需要用户确认）
# 5. 回答 "已添加错误处理"
```

---

## v0.3 — 评测框架（第 5-6 周）

**目标**：能自动评估模型的 Coding 能力。

### Week 5

- [ ] `packages/eval`：Benchmark 定义格式（YAML/JSON）
- [ ] `packages/eval`：任务执行器（在沙箱里跑 Agent）
- [ ] `packages/eval`：评分器（跑测试用例、对比输出）
- [ ] `benchmarks/basic`：10 个基础编码任务（带测试用例）
- [ ] 能跑通一个 Benchmark（单任务执行 + 评分）

### Week 6

- [ ] `packages/eval`：批量执行（跑整个 Benchmark 集）
- [ ] `packages/eval`：多模型对比（同一任务用不同模型跑）
- [ ] `packages/eval`：报告生成（Markdown / JSON）
- [ ] `benchmarks/debug`：5 个调试任务
- [ ] `benchmarks/fullstack`：3 个全栈任务
- [ ] 产出一份 MiMo vs Claude vs GPT 的 Coding 能力对比报告

### Benchmark 格式示例

```yaml
# benchmarks/basic/001-add-function.yaml
name: "实现一个加法函数"
description: "在 src/math.ts 中实现 add 函数"
setup:
  files:
    - path: "src/math.ts"
      content: "// TODO: implement add function"
    - path: "src/math.test.ts"
      content: |
        import { add } from './math';
        test('add', () => {
          expect(add(1, 2)).toBe(3);
          expect(add(-1, 1)).toBe(0);
        });
prompt: "请在 src/math.ts 中实现 add 函数，使测试通过"
validation:
  type: "test"
  command: "npx vitest run src/math.test.ts"
  expected_exit_code: 0
```

---

## v1.0 — 发布（第 7 周）

- [ ] README.md（项目介绍、安装、使用、配置）
- [ ] CONTRIBUTING.md（贡献指南）
- [ ] LICENSE（MIT）
- [ ] npm 发布（@ai-agent/cli）
- [ ] GitHub Actions CI（lint + test + build）
- [ ] 评测报告发布（MiMo vs Claude vs GPT）
- [ ] 发布公告（GitHub Discussions / 技术社区）
