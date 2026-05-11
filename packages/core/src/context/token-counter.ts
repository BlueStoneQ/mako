import { encode } from 'gpt-tokenizer';
import type { Message } from '../types.js';

/** 计算文本的 token 数量 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/** 计算消息数组的总 token 数量 */
export function countMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.content) {
      total += countTokens(msg.content);
    }
    if (msg.toolCalls) {
      total += countTokens(JSON.stringify(msg.toolCalls));
    }
    // 每条消息有约 4 token 的格式开销
    total += 4;
  }
  return total;
}
