import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@sem/source'] },
  test: { include: ['src/**/*.test.ts'] },
});
