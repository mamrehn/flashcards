import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import prettierPlugin from 'eslint-config-prettier';

// Globals provided to browser bundles via <script> tags rather than imports:
//   - JSZip / QRCode load from CDN
//   - sanitize.js exposes sanitizeHTML/sanitizeParsedJSON/sanitizePlayerName
//   - logger.js exposes a no-op-in-prod debug logger
//     to cards.js, quiz.js, library.js, index.js
const browserScriptTagGlobals = {
    JSZip: 'readonly',
    QRCode: 'readonly',
    sanitizeHTML: 'readonly',
    sanitizeParsedJSON: 'readonly',
    sanitizePlayerName: 'readonly',
    logger: 'readonly',
};

export default [
    js.configs.recommended,
    sonarjs.configs.recommended,
    unicorn.configs.recommended,
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
        // Server and build scripts: console IS the logging mechanism.
        files: ['server/**/*.js', 'scripts/**/*.js'],
        rules: {
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
