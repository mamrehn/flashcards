import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import prettierPlugin from 'eslint-config-prettier';

// Globals provided to browser bundles via <script> tags rather than imports:
//   - JSZip / QRCode are self-hosted in vendor/
//   - sanitize.js exposes sanitizeHTML/sanitizeParsedJSON/sanitizePlayerName
//   - logger.js exposes a no-op-in-prod debug logger
//   - ui-dialog.js exposes uiDialog/uiConfirm/uiPrompt
//   - ws-client.js exposes wsClient (quiz.js, poll.js)
const browserScriptTagGlobals = {
    JSZip: 'readonly',
    QRCode: 'readonly',
    sanitizeHTML: 'readonly',
    sanitizeParsedJSON: 'readonly',
    sanitizePlayerName: 'readonly',
    logger: 'readonly',
    uiDialog: 'readonly',
    uiConfirm: 'readonly',
    uiPrompt: 'readonly',
    wsClient: 'readonly',
};

export default [
    {
        // Third-party code (byte-identical to the upstream releases) and
        // installed dependencies are not ours to lint.
        ignores: [
            'vendor/**',
            '**/node_modules/**',
            'TMP/**',
            'test-results/**',
            'playwright-report/**',
        ],
    },
    js.configs.recommended,
    sonarjs.configs.recommended,
    // unicorn 50 ships its flat config under 'flat/recommended'; the plain
    // 'recommended' entry is the legacy eslintrc format (with `env`), which
    // made every `npm run lint` crash.
    unicorn.configs['flat/recommended'],
    jsdoc.configs['flat/recommended'],
    prettierPlugin,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...browserScriptTagGlobals,
            },
        },
        rules: {
            // Errors and warnings should remain visible in production builds —
            // diagnostic chatter (`log`/`debug`/`info`) goes through `logger.*`
            // (see logger.js), which is gated by env / localStorage.
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            eqeqeq: 'error',
            complexity: ['warn', { max: 15 }],
            'unicorn/prevent-abbreviations': 'off',
            // Crashes on ESLint 9 in unicorn 50 ("reading 'decoration'").
            'unicorn/expiring-todo-comments': 'off',
            'unicorn/prefer-module': 'off',
            'unicorn/no-null': 'off',
            'unicorn/filename-case': 'off',
            // Math.random() is used for shuffling and cosmetic IDs only;
            // no crypto context in this app.
            'sonarjs/pseudo-random': 'off',
            // The codebase intentionally keeps comments rare ("WHY only").
            // Auto-stub JSDoc blocks (`@param ws` with no description/type)
            // add noise without value — let them stay missing rather than
            // be filled with placeholder types.
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-type': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'sonarjs/cognitive-complexity': ['warn', 15],
        },
    },
    {
        // Server and build scripts: console IS the logging mechanism, and the
        // server is a CLI process that exits after a graceful shutdown.
        files: ['server/**/*.js', 'scripts/**/*.js'],
        rules: {
            'no-console': 'off',
            'unicorn/no-process-exit': 'off',
        },
    },
    {
        // Tests read `(await client.next('x')).field` and nest callbacks in
        // harness code; both are idiomatic there.
        files: ['tests/**/*.js'],
        rules: {
            'unicorn/no-await-expression-member': 'off',
            'sonarjs/no-nested-functions': 'off',
            'no-console': 'off',
        },
    },
    {
        // Service worker has its own globals (self, clients, caches).
        files: ['sw.js'],
        languageOptions: {
            globals: {
                ...globals.serviceworker,
            },
        },
    },
];
