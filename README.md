# Mako 🦈

> Open-source AI Coding Agent framework. Model-agnostic, extensible, observable.

[中文文档](./README.zh-CN.md)

## What is Mako?

Mako is an open-source AI Coding Agent that runs in your terminal. It can read code, write code, run commands, and help you build software — powered by any OpenAI-compatible LLM.

**Key differentiators:**
- 🔌 **Model-agnostic** — Works with GPT, Claude, MiMo, DeepSeek, local models
- 📊 **Observable** — Built-in execution tracing with AI-powered analysis (`mako trace`)
- 🎯 **Steerable** — Project-level rules via `.mako/steering.md`
- 🧠 **Long context** — 5-layer context pipeline supports 100+ round conversations without context explosion
- 🛠️ **Extensible** — Plugin-ready architecture (microkernel design)

## Quick Start

```bash
# Install globally
npm install -g @mako/cli

# Configure your model
mako config

# Start chatting
mako
```

### Development Setup

```bash
git clone https://github.com/BlueStoneQ/mako.git
cd mako
pnpm install
pnpm build
npx mako
```

## Features

### 💬 Interactive Chat with Tool Use

```
$ npx mako
> Read package.json and tell me the version

  bash
  │ command: cat package.json | jq .version
  ✓ "0.1.0"

The version is 0.1.0.
(2 rounds)
```

### 📊 Execution Tracing & Analysis

Every interaction is automatically traced to `.mako/traces/`. Use `mako trace` for AI-powered analysis of your Agent's behavior:

```
$ npx mako trace

## Mako Agent Execution Analysis
- Total interactions: 15
- Average response time: 2300ms
- Average loop iterations: 2.1
- Total tool calls: 28

### Tool Usage
| Tool | Calls | Errors |
|------|-------|--------|
| bash | 12 | 1 |
| read_file | 8 | 0 |
| write_file | 5 | 0 |

[AI-powered analysis and recommendations follow...]
```

### 🎯 Project Steering

Create `.mako/steering.md` (or `.mako/steering/*.md`) to give Mako project-specific rules that are automatically injected into the system prompt:

```markdown
# Project Rules
- Use pnpm, not npm
- Test framework: vitest
- Code style: single quotes, no semicolons
- Always run tests after modifying code
```

### 🔧 Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (UTF-8) |
| `write_file` | Create or overwrite files (auto-creates directories) |
| `replace_in_file` | Precise string replacement (unique match required) |
| `list_directory` | List directory structure |
| `bash` | Execute shell commands (30s timeout) |
| `search` | Recursive regex search in files |
| `fetch_url` | Fetch web page content (10s timeout) |

## Commands

| Command | Description |
|---------|-------------|
| `mako` | Start interactive chat |
| `mako config` | Configure model (API Key, base URL, model name) |
| `mako trace` | Analyze execution history with AI |
| `mako --help` | Show help |
| `mako --version` | Show version |

## Configuration

### Config file (`.mako/config.json`)

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

### Environment variables (override config file)

| Variable | Description |
|----------|-------------|
| `MAKO_API_KEY` | API Key (required) |
| `MAKO_BASE_URL` | Model endpoint (default: `https://api.openai.com/v1`) |
| `MAKO_MODEL` | Model name (default: `gpt-4o`) |

## Architecture

```
packages/core   — Agent ReAct loop, LLM adapter, context manager, tool registry
packages/tools  — 7 built-in tools
packages/cli    — Terminal interface, config, steering, trace
```

See [docs/architecture.md](./docs/architecture.md) for the full design.

## Roadmap

See [docs/vision.md](./docs/vision.md) for differentiation strategy and roadmap.

## Contributing

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
