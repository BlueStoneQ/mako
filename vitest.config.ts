import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/__tests__/**/*.test.ts', 'packages/**/__tests__/**/*.property.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
    },
  },
});
