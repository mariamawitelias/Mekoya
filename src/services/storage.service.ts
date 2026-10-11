import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

export interface StorageDriver {
  save(data: Buffer, extension: string): Promise<string>; // returns the storage key
  open(key: string): Promise<{ stream: ReadStream; size: number } | null>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|pdf)$/;

class LocalStorage implements StorageDriver {
  private readonly baseDir = path.resolve(env.UPLOAD_DIR);

  private resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    const fullPath = path.join(this.baseDir, key);
    if (!fullPath.startsWith(this.baseDir + path.sep)) throw new Error('Invalid storage key');
    return fullPath;
  }

  async save(data: Buffer, extension: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const key = `${randomUUID()}.${extension}`;
    await writeFile(this.resolveKey(key), data, { flag: 'wx' }); // fails instead of overwriting
    return key;
  }

  async open(key: string): Promise<{ stream: ReadStream; size: number } | null> {
    const fullPath = this.resolveKey(key);
    try {
      const info = await stat(fullPath);
      return { stream: createReadStream(fullPath), size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export const storage: StorageDriver = new LocalStorage();