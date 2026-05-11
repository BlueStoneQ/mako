# AI-Agent — 开源 AI Coding Agent 框架

> TypeScript 实现，模型无关，支持 MiMo/Claude/GPT/DeepSeek。
> 能自主完成软件工程任务：读代码、写代码、跑测试、修 bug。

## 项目定位

一个开源的 AI Coding Agent 框架，对标 Claude Code，但：
- **开源**：任何人可以用、可以贡献
- **模型无关**：可接入任意 OpenAI 兼容接口的模型
- **可扩展**：Tool/Skill 可插拔
- **面向评测**：内置 Benchmark 框架，可评估不同模型的 Coding 能力

## 设计理念

1. **开闭原则（插件化）**：核心稳定，能力通过插件扩展。Tool、Skill、Scorer、Validator 都是可插拔的，不改核心代码就能加新能力。
2. **模型无关**：不绑定任何一个 LLM，通过适配层接入任意 OpenAI 兼容模型。
3. **配置驱动**：行为通过配置文件控制（Steering/Skills/Benchmark），不硬编码。
4. **面向评测**：不只是一个 Agent 产品，也是一个评测平台——能系统化地衡量和对比不同模型的 Coding 能力。
5. **渐进式**：从最小可用开始，逐步加能力，不过度设计。

## 文档索引

| 文档 | 内容 |
|------|------|
| [架构设计](./architecture.md) | 整体架构、分层设计、数据流 |
| [里程碑](./milestones.md) | 开发计划、阶段目标 |
| [技术选型](./tech-stack.md) | 技术栈选择与理由 |

## 快速开始（待实现）

```bash
# 安装
npm install -g ai-agent

# 使用（在项目目录下）
ai-agent

# 配置模型
ai-agent config --model mimo --api-key xxx --base-url xxx
```
