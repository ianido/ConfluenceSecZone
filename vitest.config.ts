import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'backend',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
        },
      },
      './static/macro-ui/vitest.config.ts',
    ],
    coverage: { provider: 'v8', include: ['src/**', 'packages/shared/src/**'] },
  },
});
