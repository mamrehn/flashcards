'use strict';

/**
 * Shared fixtures for the end-to-end tests.
 *
 * - `relay`: a fresh relay server (server/server.js) per test on a free port,
 *   with `restart()` to simulate a deploy / crash mid-lesson.
 * - `device(label, options)`: opens a page in its own browser context — one
 *   context per student phone or teacher laptop, so localStorage (saved
 *   sessions) is per device like in a real classroom. Page errors, console
 *   errors and native dialogs (an `alert` from injected script) fail the test.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');

const REPO = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.join(REPO, 'server');

// Expected noise: audio for themes that aren't shipped, and refused sockets
// while a test deliberately restarts the relay.
const IGNORED_CONSOLE = /favicon|404|ERR_CONNECTION_REFUSED|WebSocket connection to/;

/**
 * @param {number} port - 0 for any free port
 * @returns {Promise<{proc: import('node:child_process').ChildProcess, port: number}>}
 */
function startRelay(port) {
    const proc = spawn(process.execPath, ['server.js'], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error(`relay did not start: ${out}`)), 10_000);
        proc.stdout.on('data', (d) => {
            out += d;
            const m = /listening on port (\d+)/.exec(out);
            if (m) {
                clearTimeout(timer);
                resolve({ proc, port: Number(m[1]) });
            }
        });
        proc.stderr.on('data', (d) => (out += d));
        proc.on('error', reject);
    });
}

/**
 * @param {import('node:child_process').ChildProcess} proc
 * @param {NodeJS.Signals} signal
 */
function stop(proc, signal) {
    if (proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        proc.once('exit', resolve);
        proc.kill(signal);
    });
}

const test = base.extend({
    // eslint-disable-next-line no-empty-pattern
    relay: async ({}, use) => {
        let current = await startRelay(0);
        await use({
            get url() {
                return `ws://127.0.0.1:${current.port}`;
            },
            /** Stop the relay the way a deploy does, then bring it back on the same port. */
            async restart() {
                await stop(current.proc, 'SIGINT');
                current = await startRelay(current.port);
            },
        });
        await stop(current.proc, 'SIGKILL');
    },

    device: async ({ browser, relay }, use) => {
        const errors = [];
        const contexts = [];
        /**
         * @param {string} label
         * @param {{enforceCsp?: boolean, serviceWorkers?: 'allow'|'block'}} [options]
         *   Quiz/poll pages need CSP bypassed to reach the local ws:// relay
         *   (production CSP only allows the Fly.io host); static pages keep it.
         * @returns {Promise<import('@playwright/test').Page>}
         */
        async function open(label, { enforceCsp = false, serviceWorkers = 'block' } = {}) {
            const context = await browser.newContext({ bypassCSP: !enforceCsp, serviceWorkers });
            contexts.push(context);
            await context.addInitScript((url) => {
                globalThis.WS_URL = url;
            }, relay.url);
            const page = await context.newPage();
            page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
            page.on('console', (m) => {
                if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) {
                    errors.push(`${label} console: ${m.text()}`);
                }
            });
            page.on('dialog', (d) => {
                errors.push(`${label}: unexpected dialog "${d.message()}"`);
                d.dismiss().catch(() => {});
            });
            return page;
        }
        await use(open);
        for (const context of contexts) await context.close().catch(() => {});
        expect(errors, 'pages must not log errors or open native dialogs').toEqual([]);
    },
});

module.exports = { test, expect, REPO };
