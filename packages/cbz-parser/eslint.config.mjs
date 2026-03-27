import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  { files: ['src/**/*.ts'], extends: [js.configs.recommended, tseslint.configs.recommended] },
]);
