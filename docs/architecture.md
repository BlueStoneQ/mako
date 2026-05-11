# 架构设计

## 目录

- [一、整体架构](#一整体架构)
- [二、核心模块](#二核心模块)
- [三、数据流](#三数据流)
- [四、项目结构](#四项目结构)
- [五、和 Claude Code 的架构对比](#五和-claude-code-的架构对比)

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      CLI 交互层                          │
│  终端 UI / 流式输出 / 命令解析 / 用户确认               │
├─────────────────────────────────────────────────────────┤
│                      Agent 核心层                        │
│  ReAct 循环 / Planning / 上下文管理 / 对话历史           │
├─────────────────────────────────────────────────────────┤
│                      能力层                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Tool Use │ │  Skills  │ │ Memory   │ │ Steering │  │
│  │ 工具调用  │ │ 技能包   │ │ 记忆系统  │ │ 行为规则  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
├─────────────────────────────────────────────────────────┤
│                      LLM 适配层                          │
│  OpenAI 兼容接口 / 流式响应 / Token 计数 / 重试          │
│  支持：MiMo / Claude / GPT / DeepSeek / 本地模型         │
├─────────────────────────────────────────────────────────┤
│                      工具层                              │
│  read_file / write_file / bash / search / mcp_client    │
├─────────────────────────────────────────────────────────┤
│                      评测层（可选）                       │
│  Benchmark 定义 / 自动执行 / 评分 / 报告                 │
└─────────────────────────────────────────────────────────┘
```

---

## 二、核心模块

### 2.1 Agent Core（核心循环）

```typescript
// 伪代码：Agent 核心循环
async function agentLoop(userMessage: string) {
  context.addMessage({ role: 'user', content: userMessage });
  
  while (true) {
    // 1. 组装上下文（System Prompt + Steering + Skills + History）
    const messages = context.assemble();
    
    // 2. 调用 LLM
    const response = await llm.chat(messages, { tools: toolRegistry.list() });
    
    // 3. 解析响应
    if (response.type === 'text') {
      // 最终回答，退出循环
      context.addMessage({ role: 'assistant', content: response.text });
      return response.text;
    }
    
    if (response.type === 'tool_call') {
      // 工具调用，执行后继续循环
      const result = await toolExecutor.execute(response.toolCall);
      context.addMessage({ role: 'tool', content: result });
      // 继续循环（ReAct：观察结果后再思考）
    }
  }
}
```

### 2.2 LLM Adapter（模型适配）

```typescript
interface LLMAdapter {
  chat(messages: Message[], options: ChatOptions): Promise<LLMResponse>;
  stream(messages: Message[], options: ChatOptions): AsyncIterable<LLMChunk>;
  countTokens(text: string): number;
}

// OpenAI 兼容实现（MiMo/Claude/GPT 都走这个）
class OpenAICompatAdapter implements LLMAdapter {
  constructor(config: { baseUrl: string; apiKey: string; model: string }) {}
}
```

### 2.3 Tool Registry（工具注册）

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, any>): Promise<string>;
}

// 注册工具
toolRegistry.register({
  name: 'read_file',
  description: '读取文件内容',
  parameters: { path: { type: 'string', description: '文件路径' } },
  execute: async ({ path }) => fs.readFile(path, 'utf-8'),
});
```

### 2.4 Context Manager（上下文管理）

```typescript
class ContextManager {
  private messages: Message[] = [];
  private systemPrompt: string;
  private steering: string[];
  private activeSkills: Skill[];
  
  assemble(): Message[] {
    return [
      { role: 'system', content: this.buildSystemPrompt() },
      ...this.messages,
    ];
  }
  
  // 上下文压缩（超出 token 限制时）
  compact(): void {
    const summary = await llm.summarize(this.messages.slice(0, -10));
    this.messages = [{ role: 'system', content: summary }, ...this.messages.slice(-10)];
  }
}
```

### 2.5 Skill System（技能系统）

```typescript
interface Skill {
  name: string;
  description: string;
  instructions: string;      // 注入 System Prompt 的指令
  tools?: string[];          // 该 Skill 可用的工具白名单
  triggers?: {               // 自动激活条件
    keywords?: string[];
    filePatterns?: string[];
  };
}
```

---

## 三、数据流

### 一次完整的交互

```
用户输入 "帮我修复这个 bug"
  ↓
CLI 层接收输入
  ↓
Agent Core：组装上下文（System + Steering + History + 用户消息）
  ↓
LLM Adapter：发送给模型
  ↓
模型返回：tool_call { name: "read_file", args: { path: "src/index.ts" } }
  ↓
Tool Executor：执行 read_file → 返回文件内容
  ↓
Agent Core：把工具结果加入上下文，再次调用 LLM
  ↓
模型返回：tool_call { name: "write_file", args: { path: "src/index.ts", content: "..." } }
  ↓
Tool Executor：执行 write_file → 文件已修改
  ↓
Agent Core：再次调用 LLM
  ↓
模型返回：text "已修复 bug，问题是..."
  ↓
CLI 层：输出给用户
```

---

## 四、项目结构

```
ai-agent/
├── packages/
│   ├── core/               ← Agent 核心
│   │   ├── src/
│   │   │   ├── agent.ts        # Agent 主循环
│   │   │   ├── context.ts      # 上下文管理
│   │   │   ├── llm-adapter.ts  # LLM 适配层
│   │   │   ├── tool-registry.ts # 工具注册
│   │   │   └── types.ts        # 类型定义
│   │   └── package.json
│   ├── tools/              ← 内置工具
│   │   ├── src/
│   │   │   ├── read-file.ts
│   │   │   ├── write-file.ts
│   │   │   ├── bash.ts
│   │   │   ├── search.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── cli/                ← CLI 入口
│   │   ├── src/
│   │   │   ├── index.ts        # 入口
│   │   │   ├── ui.ts           # 终端 UI（流式输出、颜色）
│   │   │   └── config.ts       # 配置管理
│   │   └── package.json
│   ├── mcp/                ← MCP 兼容层
│   │   └── package.json
│   ├── eval/               ← 评测框架
│   │   ├── src/
│   │   │   ├── runner.ts       # Benchmark 执行器
│   │   │   ├── scorer.ts       # 评分器
│   │   │   └── reporter.ts     # 报告生成
│   │   └── package.json
│   └── skills/             ← 预置 Skill
│       ├── code-review/
│       ├── bug-fix/
│       └── refactor/
├── benchmarks/             ← 评测任务集
│   ├── basic/              # 基础编码任务
│   ├── debug/              # 调试任务
│   └── fullstack/          # 全栈任务
├── docs/                   ← 文档（当前位置）
├── examples/               ← 使用示例
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

---

## 五、和 Claude Code 的架构对比

| 层 | Claude Code | 本项目 |
|---|---|---|
| 交互 | 终端 CLI | 终端 CLI（一致） |
| Agent 循环 | 内部实现（闭源） | ReAct 循环（开源） |
| 模型 | 绑定 Claude | 任意模型（OpenAI 兼容） |
| 工具 | 内置 7-8 个 + MCP | 内置工具 + MCP 兼容 |
| 记忆 | CLAUDE.md 自动记忆 | Memory 系统（可配置） |
| 行为规则 | .claude/ 配置 | Steering 文件 |
| 评测 | 无 | 内置 Benchmark 框架 |
| 扩展 | MCP Server | MCP + Skill 系统 |


---

## 六、评测框架架构（插件化设计）

### 设计原则

评测框架是一个**平台**，不是一组写死的测试：
- 评测标准可插拔（内置 + 自定义）
- 评分器可扩展（每个维度独立插件）
- 验证器可扩展（不同验证方式独立插件）
- 任务集可配置（YAML/JSON 定义，不改代码加新任务）

### 架构

```
┌─────────────────────────────────────────────────────────┐
│                    评测入口（CLI / API）                  │
│  eval run --benchmark basic --models mimo,claude,gpt     │
├─────────────────────────────────────────────────────────┤
│                    评测引擎                              │
│  任务加载 → 环境准备 → Agent 执行 → 结果收集 → 评分      │
├─────────────────────────────────────────────────────────┤
│                    插件层                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │  Validators   │ │   Scorers    │ │  Reporters   │    │
│  │  验证器插件    │ │  评分器插件   │ │  报告器插件   │    │
│  └──────────────┘ └──────────────┘ └──────────────┘    │
├─────────────────────────────────────────────────────────┤
│                    任务定义层                             │
│  benchmarks/basic/*.yaml                                │
│  benchmarks/debug/*.yaml                                │
│  benchmarks/fullstack/*.yaml                            │
│  benchmarks/custom/*.yaml  ← 用户自定义                  │
├─────────────────────────────────────────────────────────┤
│                    执行沙箱                              │
│  Docker 容器 / 临时目录 / 超时控制 / 资源限制             │
└─────────────────────────────────────────────────────────┘
```

### 插件接口定义

```typescript
// 验证器接口（判断 Agent 的输出是否正确）
interface Validator {
  name: string;
  validate(context: TaskContext): Promise<ValidationResult>;
}

// 内置验证器
// - TestRunnerValidator：跑测试命令，检查退出码
// - DiffValidator：对比文件内容和预期
// - VisualRegressionValidator：截图对比
// - OutputMatchValidator：检查标准输出

// 评分器接口（从多个维度打分）
interface Scorer {
  name: string;
  dimension: string;  // 评分维度名
  score(context: TaskContext, validationResult: ValidationResult): Promise<Score>;
}

// 内置评分器
// - CorrectnessScorer：正确性（测试通过率）
// - CodeQualityScorer：代码质量（ESLint 分数、圈复杂度）
// - EfficiencyScorer：效率（Token 消耗、调用轮次、耗时）
// - MinimalChangeScorer：最小化修改（diff 行数）
// - SecurityScorer：安全性（静态扫描）

// 报告器接口（生成评测报告）
interface Reporter {
  name: string;
  generate(results: EvalResult[]): Promise<void>;
}

// 内置报告器
// - MarkdownReporter：生成 Markdown 报告
// - JSONReporter：生成 JSON 数据
// - HTMLReporter：生成可视化 HTML 报告
```

### 评测任务分级

```
Level 1: 函数级（类似 HumanEval）
  - 输入：函数签名 + 描述
  - 输出：函数实现
  - 验证：单元测试
  - 难度：低

Level 2: 文件级（类似 Aider Benchmark）
  - 输入：文件 + 修改指令
  - 输出：修改后的文件
  - 验证：测试 + diff 检查
  - 难度：中

Level 3: 项目级（类似 SWE-bench）
  - 输入：完整项目 + Issue 描述
  - 输出：跨文件修改（patch）
  - 验证：项目测试套件 + 回归检查
  - 难度：高
```

### 自定义评测标准

用户可以通过配置文件定义自己的评测标准：

```yaml
# .agent/eval-config.yaml
scorers:
  - name: correctness
    weight: 0.5
  - name: code-quality
    weight: 0.2
  - name: efficiency
    weight: 0.2
  - name: minimal-change
    weight: 0.1

validators:
  - name: test-runner
    config:
      command: "npm test"
      timeout: 30

# 自定义评分器（插件）
custom_scorers:
  - path: "./my-scorers/business-logic-scorer.ts"
```

### 多模型对比报告示例

```markdown
# Coding Benchmark Report

## Summary
| Model | Level 1 | Level 2 | Level 3 | Overall |
|-------|---------|---------|---------|---------|
| MiMo  | 85%     | 62%     | 35%     | 60.7%   |
| Claude | 92%     | 78%     | 52%     | 74.0%   |
| GPT-4o | 88%     | 70%     | 45%     | 67.7%   |

## By Dimension
| Model | Correctness | Quality | Efficiency | Minimal Change |
|-------|-------------|---------|------------|----------------|
| MiMo  | 70%         | 82%     | 90%        | 65%            |
| Claude | 85%         | 88%     | 75%        | 80%            |

## Failure Analysis
- MiMo 在 Level 3 的主要失败原因：跨文件引用理解不足（12/20 失败案例）
- 建议：增加多文件上下文的训练数据
```

这份报告的价值不只是"做了一个 Agent"，而是"用系统化的方法评估了模型能力，定位了问题，给出了改进方向"。
