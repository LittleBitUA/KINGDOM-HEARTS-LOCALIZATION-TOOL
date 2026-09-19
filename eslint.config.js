'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['renderer/i18n.js', 'renderer/error-capture.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } }
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**']
  },
  {
    files: ['main.js', 'main/**/*.js', 'scripts/**/*.js', 'preload.js', 'shared/**/*.js', 'tools/**/*.js', 'workers/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off'
    }
  },
  {
    files: ['renderer/**/*.js'],
    ignores: ['renderer/i18n.js', 'renderer/error-capture.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off'
    }
  }
];
