import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, LLMConfig, ContextConfig } from '@mako-agent/core';
import { DEFAULT_SYSTEM_PROMPT } from './system-prompt.js';

export interface MakoConfig {
  llm: LLMConfig;
  models: Record<string, LLMConfig>;
  agent: Omit<AgentConfig, 'llm'>;
}

export function loadConfig(): MakoConfig {
  const configPath = join(process.cwd(), '.mako', 'config.json');

  let fileConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  }

  const llmFile = (fileConfig.llm || {}) as Record<string, unknown>;
  const agentFile = (fileConfig.agent || {}) as Record<string, unknown>;
  const contextFile = (fileConfig.context || {}) as Record<string, unknown>;
  const modelsFile = (fileConfig.models || {}) as Record<string, Record<string, unknown>>;

  // 默认 LLM 配置（环境变量 > 配置文件 > 默认值）
  const defaultLlm: LLMConfig = {
    apiKey: process.env.MAKO_API_KEY || (llmFile.apiKey as string) || '',
    baseUrl: process.env.MAKO_BASE_URL || (llmFile.baseUrl as string) || 'https://api.openai.com/v1',
    model: process.env.MAKO_MODEL || (llmFile.model as string) || 'gpt-4o',
  };

  if (!defaultLlm.apiKey) {
    throw new Error(
      '缺少 API Key 配置。请设置环境变量 MAKO_API_KEY 或在 .mako/config.json 中配置 llm.apiKey'
    );
  }

  // 解析多模型预设
  const models: Record<string, LLMConfig> = { default: defaultLlm };
  for (const [name, cfg] of Object.entries(modelsFile)) {
    models[name] = {
      apiKey: (cfg.apiKey as string) || defaultLlm.apiKey,
      baseUrl: (cfg.baseUrl as string) || defaultLlm.baseUrl,
      model: (cfg.model as string) || 'gpt-4o',
    };
  }

  const contextConfig: ContextConfig = {
    maxTokens: (contextFile.maxTokens as number) || 128000,
    compressThreshold: (contextFile.compressThreshold as number) || 100000,
    sessionDir: (contextFile.sessionDir as string) || join(process.cwd(), '.mako', 'sessions'),
  };

  return {
    llm: defaultLlm,
    models,
    agent: {
      maxIterations: (agentFile.maxIterations as number) || 20,
      systemPrompt: (agentFile.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT,
      contextConfig,
    },
  };
}
