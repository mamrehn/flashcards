'use strict';

/**
 * End-to-end tests (tests/e2e/*.spec.js): real browsers against the static
 * site and a local relay server. Run with `npm run test:e2e`.
 * First time locally: `npx playwright install chromium`.
 */

const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
    testDir: 'tests/e2e',
    testMatch: '*.spec.js',
    // A quiz round includes stinger holds and a relay restart; give it room.
    timeout: 120_000,
    expect: { timeout: 15_000 },
    // Scenarios within a file build on shared setup helpers but are
    // independent; files may run in parallel (each test starts its own relay).
    fullyParallel: false,
    workers: isCI ? 2 : undefined,
    retries: isCI ? 2 : 0,
    forbidOnly: isCI,
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    projects: [{ name: 'chromium' }],
    webServer: {
        command: `node tests/e2e/static-server.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !isCI,
    },
});
