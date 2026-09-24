/**
 * Shared WebSocket client plumbing for quiz.js and poll.js.
 * Loaded via <script> tag before either app script and exposed as
 * `globalThis.wsClient` (same pattern as sanitize.js / logger.js). Keeping one
 * copy matters: reconnect and heartbeat fixes used to land in only one app.
 */

(function initWsClient() {
    // The deploy workflow replaces this single placeholder literal with the
    // WS_URL secret. Only compare by shape below — a second copy of the
    // placeholder anywhere in this file would be rewritten too.
    const INJECTED_WS_URL = '__WS_URL__';
    const PRODUCTION_WS_URL = 'wss://qlash-server.fly.dev';

    /** @returns {string} */
    function resolveWsUrl() {
        // Local dev override (gitignored quiz-config.js may set window.WS_URL).
        const runtime = globalThis.WS_URL;
        if (typeof runtime === 'string' && runtime.startsWith('ws')) return runtime;
        if (INJECTED_WS_URL.startsWith('ws')) return INJECTED_WS_URL;
        return PRODUCTION_WS_URL;
    }

    // Close code the server uses when a newer connection took over this
    // session (second tab / device). Never auto-reconnect on it, or two tabs
    // would keep stealing the session from each other.
    const CLOSE_SESSION_REPLACED = 4000;

    // Join failures after which retrying the same join is pointless.
    const FATAL_JOIN_CODES = new Set([
        'ROOM_FULL',
        'ROOM_INACTIVE',
        'JOIN_DENIED',
        'JOIN_QUEUE_FULL',
        'INVALID_SESSION',
    ]);

    /**
     * One connection attempt: resolves with the open socket, rejects on error
     * or after 10 s. Listeners are detached on settle so an abandoned socket
     * isn't kept alive by them.
     * @param {string} url
     * @returns {Promise<WebSocket>}
     */
    function openSocket(url) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                cleanup();
                ws.close();
                reject(new Error('timed out'));
            }, 10_000);
            function cleanup() {
                clearTimeout(timeout);
                ws.removeEventListener('open', onOpen);
                ws.removeEventListener('error', onError);
            }
            function onOpen() {
                cleanup();
                resolve(ws);
            }
            function onError() {
                cleanup();
                reject(new Error('failed'));
            }
            ws.addEventListener('open', onOpen);
            ws.addEventListener('error', onError);
        });
    }

    /**
     * Creates a WebSocket connection with retry logic for Fly.io cold starts.
     * Retries up to maxRetries times with increasing delays if the connection
     * fails immediately.
     * @param {string} url
     * @param {number} [maxRetries]
     * @returns {Promise<WebSocket>} A connected WebSocket.
     */
    async function connectWithRetry(url, maxRetries = 3) {
        for (let attempt = 1; ; attempt++) {
            try {
                return await openSocket(url);
            } catch (error) {
                if (attempt >= maxRetries) {
                    throw new Error('WebSocket connection failed after retries');
                }
                logger.log(`WebSocket connection attempt ${attempt} ${error.message}, retrying...`);
                await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
            }
        }
    }

    /**
     * Reconnect backoff: ~1s → ~2s → ~4s → ~10s (then steady). A typical WS
     * blip (phone screen off, brief Wi-Fi hiccup) recovers on the first retry
     * instead of waiting the full 10 s, while sustained failures still
     * throttle. ±25% jitter keeps a cascade event (router restart dropping
     * every client at once) from producing a thundering herd.
     * @param {number} attempt 1-indexed
     * @returns {number} ms before the next retry
     */
    function reconnectBackoffMs(attempt) {
        let base;
        if (attempt <= 1) base = 1000;
        else if (attempt === 2) base = 2000;
        else if (attempt === 3) base = 4000;
        else base = 10_000;
        const jitter = 0.75 + Math.random() * 0.5;
        return Math.round(base * jitter);
    }

    // Application-level heartbeat. The server pings every 30 s at the WebSocket
    // protocol level and the browser auto-pongs, but (a) some intermediate
    // proxies (carrier NAT, corporate firewalls) only see app-layer frames as
    // "activity" and drop the TCP socket after ~60 s of silence, and (b) if the
    // server's network silently goes dark without closing the TCP connection,
    // the browser may keep the socket in OPEN state for many seconds before
    // noticing. We send `{type:'heartbeat'}` every 25 s; the server replies
    // with `{type:'heartbeat_ack'}`. A watchdog checks how long ago we last
    // heard *anything* from the server and force-closes the socket past
    // HEARTBEAT_TIMEOUT_MS, letting the reconnect logic take over.
    const HEARTBEAT_INTERVAL_MS = 25_000;
    const HEARTBEAT_TIMEOUT_MS = 60_000;
    const HEARTBEAT_WATCHDOG_INTERVAL_MS = 10_000;
    const HEARTBEAT_PAYLOAD = JSON.stringify({ type: 'heartbeat' });

    /**
     * Start the bidirectional heartbeat for a WebSocket. The returned state is
     * also bound to the socket (`ws.__heartbeatState`): message handlers must
     * credit liveness via `markAlive(ws)` so that, during a reconnect, a late
     * frame on the outgoing socket never vouches for the incoming one.
     *
     * `ws.send` is wrapped so that *any* outbound frame reschedules the next
     * heartbeat for exactly HEARTBEAT_INTERVAL_MS from now, so the gap between
     * outbound frames never exceeds the interval.
     *
     * The watchdog stands down when its own ticks were throttled or frozen (a
     * locked phone or background tab): silence only proves the socket is dead
     * if we were awake to listen. Force-closing on that dropped students the
     * moment they came back to the tab.
     * @param {WebSocket} ws
     * @returns {{heartbeatTimer:number|null, watchdog:number, lastMsgTime:number, lastSendTime:number, lastTickTime:number}}
     */
    function startHeartbeat(ws) {
        const now = Date.now();
        const state = {
            lastMsgTime: now,
            lastSendTime: now,
            heartbeatTimer: null,
            lastTickTime: now,
        };
        ws.__heartbeatState = state;

        function scheduleNextHeartbeat() {
            if (state.heartbeatTimer !== null) clearTimeout(state.heartbeatTimer);
            state.heartbeatTimer = setTimeout(() => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                try {
                    // Goes through the wrapped send, which itself reschedules.
                    ws.send(HEARTBEAT_PAYLOAD);
                } catch (error) {
                    logger.error('Heartbeat send failed:', error);
                }
            }, HEARTBEAT_INTERVAL_MS);
        }

        // Stash the native bound send on the socket so a second startHeartbeat
        // call doesn't capture the previous wrapper as "original" and stack
        // wrappers.
        if (!ws.__heartbeatNativeSend) {
            ws.__heartbeatNativeSend = ws.send.bind(ws);
        }
        const originalSend = ws.__heartbeatNativeSend;
        ws.send = (...args) => {
            state.lastSendTime = Date.now();
            scheduleNextHeartbeat();
            return originalSend(...args);
        };

        scheduleNextHeartbeat();

        state.watchdog = setInterval(() => {
            const tickNow = Date.now();
            const tickGap = tickNow - state.lastTickTime;
            state.lastTickTime = tickNow;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const wasThrottled =
                tickGap > HEARTBEAT_WATCHDOG_INTERVAL_MS * 2 ||
                document.visibilityState !== 'visible';
            if (wasThrottled) {
                // Re-arm the window and probe instead. If the socket really is
                // dead, the probe goes unanswered and the next unthrottled
                // tick closes it ~10 s later.
                state.lastMsgTime = tickNow;
                if (document.visibilityState === 'visible') {
                    try {
                        ws.send(HEARTBEAT_PAYLOAD);
                    } catch {
                        /* close handler will reconnect if the path is dead */
                    }
                }
                return;
            }

            const silentMs = tickNow - state.lastMsgTime;
            if (silentMs > HEARTBEAT_TIMEOUT_MS) {
                logger.warn(
                    `No server activity for ${Math.round(silentMs / 1000)}s — forcing reconnect.`
                );
                try {
                    ws.close();
                } catch {
                    /* close already in progress */
                }
            }
        }, HEARTBEAT_WATCHDOG_INTERVAL_MS);

        return state;
    }

    /**
     * Cancel a heartbeat state's timers; returns null for assignment back to
     * the caller's state slot.
     * @param {{heartbeatTimer:number|null, watchdog:number}|null} state
     * @returns {null}
     */
    function stopHeartbeat(state) {
        if (state) {
            if (state.heartbeatTimer !== null) clearTimeout(state.heartbeatTimer);
            clearInterval(state.watchdog);
        }
        return null;
    }

    /**
     * Credit server liveness to the socket that actually received a frame.
     * @param {WebSocket} ws
     */
    function markAlive(ws) {
        if (ws && ws.__heartbeatState) ws.__heartbeatState.lastMsgTime = Date.now();
    }

    /**
     * Fire an immediate keepalive on an open socket — used when a tab returns
     * to the foreground, where throttled timers may have let the path idle.
     * @param {WebSocket|null} ws
     */
    function pingNow(ws) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(HEARTBEAT_PAYLOAD);
            } catch {
                /* close handler will reconnect if the path is dead */
            }
        }
    }

    globalThis.wsClient = {
        WS_URL: resolveWsUrl(),
        CLOSE_SESSION_REPLACED,
        FATAL_JOIN_CODES,
        connectWithRetry,
        reconnectBackoffMs,
        startHeartbeat,
        stopHeartbeat,
        markAlive,
        pingNow,
    };
})();
