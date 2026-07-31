'use strict';

/**
 * Integration tests for the relay server's per-connection rate limiter.
 *
 * These cover the failure that disconnected poll hosts mid-session: a poll host
 * reconciling a full classroom after a reconnect emits one `append_option` per
 * player in a single synchronous loop, and the old flat per-second limiter
 * dropped those options and then terminated the socket outright.
 *
 * Spawns `server/server.js` on an ephemeral port. Requires `ws`, which lives in
 * `server/node_modules` — the suite skips itself if that install is missing so
 * `npm test` stays green in a fresh clone.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER_DIR = path.join(__dirname, '..', 'server');

let WebSocket;
try {
    WebSocket = require(path.join(SERVER_DIR, 'node_modules', 'ws'));
} catch {
    WebSocket = null;
}

const PORT = 8100 + (process.pid % 400);
const URL = `ws://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:1234';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
function startServer() {
    const proc = spawn(process.execPath, ['server.js'], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
        const onData = (d) => {
            if (String(d).includes('listening')) {
                proc.stdout.off('data', onData);
                resolve(proc);
            }
        };
        proc.stdout.on('data', onData);
        proc.on('error', reject);
        setTimeout(() => reject(new Error('server did not start')), 8000);
    });
}

/**
 * @returns {Promise<WebSocket>}
 */
function open() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL, { origin: ORIGIN });
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}

/**
 * Open a host socket and take it all the way to an active `source: 'players'`
 * poll, which is the state in which `append_option` is legal.
 * @returns {Promise<{host: WebSocket, errors: string[]}>}
 */
async function hostWithActivePoll() {
    const host = await open();
    const errors = [];
    let roomId = null;
    host.on('message', (d) => {
        const m = JSON.parse(d);
        if (m.type === 'room_created') roomId = m.roomId;
        if (m.type === 'error') errors.push(m.message);
    });
    host.on('error', () => {});

    host.send(JSON.stringify({ type: 'create_room' }));
    for (let i = 0; i < 40 && !roomId; i++) await sleep(25);
    assert.ok(roomId, 'host should receive room_created');

    const player = await open();
    player.on('error', () => {});
    player.send(JSON.stringify({ type: 'join', roomCode: roomId, playerName: 'Anna' }));
    await sleep(150);

    const meta =
        '__POLL_META__:' + JSON.stringify({ picksPerVoter: 3, revealCount: 3, source: 'players' });
    host.send(
        JSON.stringify({
            type: 'start_question',
            question: 'Wer hat die Klasse gerettet?',
            options: [meta, 'Anna'],
            index: 0,
            total: 1,
            duration: 60,
        })
    );
    await sleep(150);
    return { host, errors };
}

test(
    'server rate limiter',
    { skip: WebSocket ? false : 'server/node_modules/ws not installed' },
    async (t) => {
        const proc = await startServer();
        t.after(() => proc.kill('SIGKILL'));

        await t.test('survives a full-classroom append_option burst', async () => {
            const { host } = await hostWithActivePoll();

            // 65 appends in one tick — a 65-student reconcile. This used to
            // terminate the socket (code 1006) partway through, taking the
            // host out of their own lesson.
            for (let i = 0; i < 65; i++) {
                host.send(JSON.stringify({ type: 'append_option', option: `Nachzuegler${i}` }));
            }
            await sleep(1200);

            assert.equal(host.readyState, WebSocket.OPEN, 'host socket must survive the burst');
            host.close();
        });

        // The burst above may still shed a few options once the bucket empties;
        // surviving it is the server's job, delivering every option is the
        // client's. poll.js paces `append_option` through hostAppendQueue at
        // HOST_APPEND_BATCH per HOST_APPEND_INTERVAL_MS. This pins those two
        // constants against the server's refill rate — if either side is
        // retuned without the other, late-joiners start vanishing from ballots.
        await t.test('accepts every option when paced like the host queue', async () => {
            const HOST_APPEND_BATCH = 8;
            const HOST_APPEND_INTERVAL_MS = 500;
            const { host, errors } = await hostWithActivePoll();

            for (let sent = 0; sent < 65; sent += HOST_APPEND_BATCH) {
                for (let i = 0; i < HOST_APPEND_BATCH && sent + i < 65; i++) {
                    host.send(
                        JSON.stringify({ type: 'append_option', option: `Paced${sent + i}` })
                    );
                }
                await sleep(HOST_APPEND_INTERVAL_MS);
            }
            await sleep(300);

            assert.equal(host.readyState, WebSocket.OPEN, 'host socket must stay open');
            assert.deepEqual(errors, [], 'a paced host must never be rate limited');
            host.close();
        });

        await t.test('still cuts off a sustained flood', async () => {
            const ws = await open();
            let closed = false;
            ws.on('close', () => (closed = true));
            ws.on('error', () => {});

            const timer = setInterval(() => {
                for (let i = 0; i < 50; i++) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'heartbeat' }));
                    }
                }
            }, 10);
            await sleep(2500);
            clearInterval(timer);

            assert.equal(closed, true, 'a client flooding at ~5000 msg/s must be terminated');
        });

        await t.test('leaves a normal client alone', async () => {
            const ws = await open();
            let closed = false;
            ws.on('close', () => (closed = true));
            ws.on('error', () => {});

            for (let i = 0; i < 12; i++) {
                ws.send(JSON.stringify({ type: 'heartbeat' }));
                await sleep(150);
            }
            await sleep(300);

            assert.equal(closed, false, 'normal cadence must never be throttled');
            ws.close();
        });
    }
);
