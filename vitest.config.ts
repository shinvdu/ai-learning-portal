import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const workspaceAliases = {
  '@portal/domain': fromRoot('./packages/domain/src/index.ts'),
  '@portal/contracts': fromRoot('./packages/contracts/src/index.ts'),
  '@portal/config': fromRoot('./packages/config/src/index.ts'),
  '@portal/content': fromRoot('./packages/content/src/index.ts'),
  '@portal/db': fromRoot('./packages/db/src/index.ts'),
};

export default defineConfig({
  resolve: {
    // Tests resolve workspace packages from source so `npm test` works on a clean checkout
    // without a prior build. Production/types resolution goes through each package's dist.
    alias: workspaceAliases,
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});