import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignored = [
  'node_modules/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  'playwright-report/**',
  'test-results/**',
  '**/*.tsbuildinfo',
  // v1 reference implementation
  'server.js',
  'src/**',
  'public/**',
  'scripts/**',
  'data/**',
];

export default tseslint.config(
  { ignores: ignored },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);