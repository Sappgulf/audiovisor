import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist', 'node_modules', '.superdesign'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-debugger': 'error',
    },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      /* the asset scripts drive headless browsers and embed page.evaluate
         snippets that run in the DOM, not in node */
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
