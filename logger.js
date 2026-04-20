/**
 * Lightweight Debug Logger
 * Loaded via <script> tag on cards.html, library.html, quiz.html, index.html.
 *
 * `logger.debug` / `logger.log` / `logger.info` are no-ops in production and
 * forward to the matching console method when debug is enabled. `warn`/`error`
 * always go through the underlying console.
 *
 * Debug is enabled when ANY of:
 *   - `localStorage.debug === '1'`
 *   - hostname is 'localhost' or '127.0.0.1' or ends with '.local'
 *   - URL has `?debug=1`
 *
 * Exposed on `globalThis.logger` so cards.js, quiz.js, library.js can use it
 * without an import (consistent with sanitize.js).
 */

(function initLogger() {
    function isDebugEnabled() {
        try {
            if (globalThis.localStorage && localStorage.getItem('debug') === '1') return true;
        } catch {
            // localStorage may be unavailable (e.g., privacy modes) — fall through.
        }
        try {
            const url = new URL(globalThis.location.href);
            if (url.searchParams.get('debug') === '1') return true;
            const host = url.hostname;
            if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
                return true;
            }
        } catch {
            // location may be unavailable in non-browser contexts.
        }
        return false;
    }

    const enabled = isDebugEnabled();
    const noop = () => {};

    /* eslint-disable no-console -- logger.js is the one place that's allowed to bind to console.* */
    globalThis.logger = {
        debug: enabled ? console.debug.bind(console) : noop,
        log: enabled ? console.log.bind(console) : noop,
        info: enabled ? console.info.bind(console) : noop,
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        enabled,
    };
    /* eslint-enable no-console */
})();
