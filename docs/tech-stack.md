# 技术选型

## 目录

- [一、语言与运行时](#一语言与运行时)
- [二、项目管理](#二项目管理)
- [三、LLM 接入](#三llm-接入)
- [四、CLI 框架](#四cli-框架)
- [五、测试](#五测试)
- [六、构建与发布](#六构建与发布)

---

## 一、语言与运行时

| 选择 | 理由 |
|------|------|
| **TypeScript** | 类型安全、生态大、AI Agent 领域主流选择、和前端技能栈一致 |
| **Node.js 22+** | LTS 版本、原生 ESM、fetch API 内置 |
| **ESM** | 现代模块系统，tree-shaking 友好 |

---

## 二、项目管理

| 选择 | 理由 |
|------|------|
| **pnpm** | 快、磁盘效率高、workspace 支持好 |
| **monorepo** | 多包管理（core/tools/cli/eval 独立发布） |
| **tsup** | TypeScript 打包（基于 esbuild，快） |
| **changesets** | 版本管理和 changelog 生成 |

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

---

## 三、LLM 接入

| 选择 | 理由 |
|------|------|
| **OpenAI 兼容接口** | MiMo/Claude/GPT/DeepSeek 都支持这个格式 |
| **openai SDK** | 官方 TypeScript SDK，类型完善 |
| **流式响应** | 用户体验（打字机效果） |

### 模型配置

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-xxx"
}
```

切换模型只需改配置，代码不用动。

---

## 四、CLI 框架

| 选择 | 理由 |
|------|------|
| **ink** (React for CLI) | 声明式终端 UI，组件化，适合复杂交互 |
| 或 **readline + chalk** | 更轻量，如果不需要复杂 UI |
| **ora** | 加载动画（spinner） |
| **chalk** | 终端颜色 |

MVP 阶段用 readline + chalk 就够了，后续如果需要复杂 UI 再换 ink。

---

## 五、测试

| 选择 | 理由 |
|------|------|
| **vitest** | 快、ESM 原生支持、和 Vite 生态一致 |
| **Docker**（eval 沙箱） | Benchmark 执行需要隔离环境 |

---

## 六、构建与发布

| 选择 | 理由 |
|------|------|
| **tsup** | TypeScript → JS 打包，基于 esbuild |
| **GitHub Actions** | CI/CD（lint + test + build + publish） |
| **npm** | 包发布（@ai-agent/cli） |
| **changeset** | 版本管理 |

### 发布流程

```
代码合并到 main
  ↓ GitHub Actions
lint + test + build
  ↓ changeset version
更新版本号 + changelog
  ↓ changeset publish
发布到 npm
```
