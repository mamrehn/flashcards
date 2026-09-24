'use strict';

/**
 * Test harness for the relay server: spawns `server/server.js` on an ephemeral
 * port and wraps `ws` clients with a small "wait for message type" API.
 *
 * Requires `ws`, which lives in `server/node_modules`; `WebSocket` is null when
 * that install is missing so suites can skip themselves.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER_DIR = path.join(__dirname, '..', '..', 'server');
const ORIGIN = 'http://localhost:1234';

let WebSocket;
try {
    WebSocket = require(path.join(SERVER_DIR, 'node_modules', 'ws'));
} catch {
    WebSocket = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @returns {Promise<{proc: import('node:child_process').ChildProcess, url: string, exited: () => number|null}>}
 */
function startServer() {
    const proc = spawn(process.execPath, ['server.js'], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let exitCode = null;
    proc.on('exit', (code) => {
        exitCode = code;
    });
    return new Promise((resolve, reject) => {
        const onData = (d) => {
            const m = /listening on port (\d+)/.exec(String(d));
            if (m) {
                proc.stdout.off('data', onData);
                resolve({ proc, url: `ws://127.0.0.1:${m[1]}`, exited: () => exitCode });
            }
        };
        proc.stdout.on('data', onData);
        proc.on('error', reject);
        setTimeout(() => reject(new Error('server did not start')), 8000);
    });
}

/**
 * Open a client socket.
 * @param {string} url
 * @returns {Promise<object>}
 */
function connect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { origin: ORIGIN });
        const client = {
            ws,
            messages: [],
            closeCode: null,
            waiters: [],
            send(obj) {
                ws.send(JSON.stringify(obj));
            },
            sendRaw(str) {
                ws.send(str);
            },
            /**
             * Resolve with the next message of `type` (including ones already
             * received and not yet consumed).
             * @param {string} type
             * @param {number} [timeoutMs]
             */
            next(type, timeoutMs = 2000) {
                const idx = client.messages.findIndex((m) => m.type === type && !m.__consumed);
                if (idx !== -1) {
                    client.messages[idx].__consumed = true;
                    return Promise.resolve(client.messages[idx]);
                }
                return new Promise((res, rej) => {
                    const timer = setTimeout(
                        () => rej(new Error(`timed out waiting for "${type}"`)),
                        timeoutMs
                    );
                    client.waiters.push({ type, res, timer });
                });
            },
            /**
             * All messages of `type` received so far.
             * @param type
             */
            all(type) {
                return client.messages.filter((m) => m.type === type);
            },
            close() {
                ws.close();
            },
        };
        ws.on('message', (d) => {
            const msg = JSON.parse(d);
            const w = client.waiters.findIndex((x) => x.type === msg.type);
            if (w === -1) {
                client.messages.push(msg);
            } else {
                const [waiter] = client.waiters.splice(w, 1);
                clearTimeout(waiter.timer);
                msg.__consumed = true;
                client.messages.push(msg);
                waiter.res(msg);
            }
        });
        ws.on('close', (code) => {
            client.closeCode = code;
        });
        ws.on('error', () => {});
        ws.on('open', () => resolve(client));
        ws.once('error', reject);
    });
}

/**
 * Host a fresh room.
 * @param {string} url
 * @returns {Promise<{host: object, roomId: string, sessionId: string}>}
 */
async function hostRoom(url) {
    const host = await connect(url);
    host.send({ type: 'create_room' });
    const created = await host.next('room_created');
    return { host, roomId: created.roomId, sessionId: created.sessionId };
}

/**
 * Join `roomId` as a new player.
 * @param {string} url
 * @param {string} roomId
 * @param {object} [extra] - extra join fields (playerName, avatar, sessionId)
 * @returns {Promise<{player: object, joined: object}>}
 */
async function joinRoom(url, roomId, extra = {}) {
    const player = await connect(url);
    player.send({ type: 'join', roomCode: roomId, playerName: 'Anna', ...extra });
    const joined = await player.next('joined');
    return { player, joined };
}

module.exports = { WebSocket, startServer, connect, hostRoom, joinRoom, sleep };
