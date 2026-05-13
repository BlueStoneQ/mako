import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * 溢出内容磁盘存储
 * 当工具结果过大时，完整内容保存到磁盘，上下文中只保留预览
 */
export class OverflowStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 保存溢出内容到磁盘
   * @returns 保存的文件路径
   */
  async save(toolCallId: string, toolName: string, content: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${toolCallId}.txt`;
    const filePath = join(this.baseDir, filename);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      return filePath;
    } catch (error) {
      // 磁盘写入失败时降级：记录警告，返回空路径
      console.warn(`[OverflowStore] Failed to save overflow: ${(error as Error).message}`);
      return '';
    }
  }

  /**
   * 读取溢出内容
   */
  async read(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }
}
