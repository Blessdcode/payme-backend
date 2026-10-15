import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'src/generated/**',
      'node_modules/**',
      '.pnpm-store/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['test/**/*.cjs', 'scripts/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
