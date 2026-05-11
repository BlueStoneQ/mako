import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, LLMConfig, ContextConfig } from '@mako/core';
import { DEFAULT_SYSTEM_PROMPT } from './system-prompt.js';

export interface MakoConfig {
  llm: LLMConfig;
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

  const llm: LLMConfig = {
    apiKey: process.env.MAKO_API_KEY || (llmFile.apiKey as string) || '',
    baseUrl: process.env.MAKO_BASE_URL || (llmFile.baseUrl as string) || 'https://api.openai.com/v1',
    model: process.env.MAKO_MODEL || (llmFile.model as string) || 'gpt-4o',
  };

  if (!llm.apiKey) {
    throw new Error(
      '缺少 API Key 配置。请设置环境变量 MAKO_API_KEY 或在 .mako/config.json 中配置 llm.apiKey'
    );
  }

  const contextConfig: ContextConfig = {
    maxTokens: (contextFile.maxTokens as number) || 128000,
    compressThreshold: (contextFile.compressThreshold as number) || 100000,
    sessionDir: (contextFile.sessionDir as string) || join(process.cwd(), '.mako', 'sessions'),
  };

  return {
    llm,
    agent: {
      maxIterations: (agentFile.maxIterations as number) || 20,
      systemPrompt: (agentFile.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT,
      contextConfig,
    },
  };
}
