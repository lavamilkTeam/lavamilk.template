import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  { ignores: ['dist/**', '**/node_modules/**', 'pocketbase/pb_data/**', 'pocketbase/pb_migrations/**', 'test-results/**', 'playwright-report/**', 'ops/**'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['**/*.{js,mjs,cjs,vue}'], languageOptions: { globals: globals.node }, rules: {
    'vue/multi-word-component-names': ['error', { ignores: ['Lavamilk'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  } },
  { files: ['src/**/*.{js,vue}', 'tests/e2e/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['pocketbase/pb_hooks/*.pb.js'], languageOptions: { globals: {
    routerAdd: 'readonly', __hooks: 'readonly', $os: 'readonly', $http: 'readonly', $apis: 'readonly', Record: 'readonly',
  } } },
];
