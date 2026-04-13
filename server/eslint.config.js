const js = require('@eslint/js');
const globals = require('globals');

const nodeGlobals = { ...globals.node };
// Allow `const crypto = require('crypto')` without clashing with Node's global `crypto`.
delete nodeGlobals.crypto;
// Mongoose model is commonly imported as `Request`; Node also exposes Fetch API `Request`.
delete nodeGlobals.Request;

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'uploads/**',
      'backups/**',
      'storage/**',
      'logs/**',
      'tmp/**',
      'dist/**',
      'coverage/**'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...nodeGlobals
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      'no-console': 'off'
    }
  }
];
