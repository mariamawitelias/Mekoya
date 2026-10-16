import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    env: dotenv.parse(readFileSync('.env.test')),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});