const { WebSocketServer } = require('ws');
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 8080;

// In-memory state: roomId -> room data
const rooms = new Map();

// --- Error codes ---
// Machine-readable companion to the German `message`. Clients decide what is
// fatal by code, never by matching the display text.
const ERR = {
    BAD_MESSAGE: 'BAD_MESSAGE',
    RATE_LIMITED: 'RATE_LIMITED',
    SERVER_BUSY: 'SERVER_BUSY',
    ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
    ROOM_FULL: 'ROOM_FULL',
    ROOM_INACTIVE: 'ROOM_INACTIVE',
    PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
    INVALID_SESSION: 'INVALID_SESSION',
    ALREADY_JOINED: 'ALREADY_JOINED',
    JOIN_DENIED: 'JOIN_DENIED',
    JOIN_QUEUE_FULL: 'JOIN_QUEUE_FULL',
    REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
    SEAT_TAKEN: 'SEAT_TAKEN',
    RESTORE_THROTTLED: 'RESTORE_THROTTLED',
    RESTORE_INVALID: 'RESTORE_INVALID',
    QUESTION_INVALID: 'QUESTION_INVALID',
    OPTION_INVALID: 'OPTION_INVALID',
    OPTIONS_LIMIT: 'OPTIONS_LIMIT',
    NO_ACTIVE_QUESTION: 'NO_ACTIVE_QUESTION',
    // Distinct from the start_question codes above: a rejected late-joiner
    // append says nothing about whether the running vote is still valid.
    APPEND_REJECTED: 'APPEND_REJECTED',
    NAME_INVALID: 'NAME_INVALID',
    RENAME_NOT_ALLOWED: 'RENAME_NOT_ALLOWED',
};

// Close code sent to a socket whose session was taken over by a newer
// connection (second tab / device). Clients must not auto-reconnect on it,
// otherwise two tabs would keep stealing the session from each other.
const CLOSE_SESSION_REPLACED = 4000;

// --- Input helpers ---

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @param {number} [maxLen]
 * @returns {string}
 */
function asString(v, maxLen = 200) {
    return typeof v === 'string' ? v.slice(0, maxLen) : '';
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function asRoomCode(v) {
    return asString(v, 20).replaceAll(/\s/g, '').toUpperCase();
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function asSessionId(v) {
    return typeof v === 'string' && v.startsWith('sess-') && v.length <= 64 ? v : null;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function asScore(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// --- Utility ---

function generateRoomId() {
    // Excludes 0/O and 1/I to avoid mis-keying the room code.
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const MAX_ATTEMPTS = 100;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let id = '';
        for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
        if (!rooms.has(id)) return id;
    }
    return null;
}

function generateSessionId() {
    return 'sess-' + crypto.randomUUID();
}

// Lobby cosmetic state — server stays a relay; clients enforce the curated set.
// Themes mirror audio/themes/<id>/ folder names. See audio/themes/README.md.
const MUSIC_THEME_IDS = ['arcade', 'cinematic', 'modern_minimal', 'classical'];
const VALID_MUSIC_VOTES = new Set([...MUSIC_THEME_IDS, 'none']);
const VALID_LOBBY_MUSIC = new Set([...MUSIC_THEME_IDS, 'none']);
const LOBBY_MUSIC_DEFAULT = 'modern_minimal';

// Avatar whitelist — mirrors LOBBY_AVATAR_BASES / LOBBY_AVATAR_ACCESSORIES in
// quiz.js. Free-form avatars would be an 8-character side channel around the
// teacher's name censoring, so anything outside the curated grid is dropped.
const AVATAR_BASES = ['\u{1F469}', '\u{1F9D1}', '\u{1F468}'];
const AVATAR_ACCESSORIES = [
    '\u{1F680}',
    '\u{1F692}',
    '\u{2708}\u{FE0F}',
    '\u{1F52C}',
    '\u{1F3A8}',
    '\u{1F3A4}',
    '\u{1F373}',
    '\u{2695}\u{FE0F}',
    '\u{2696}\u{FE0F}',
    '\u{1F33E}',
    '\u{1F527}',
    '\u{1F4BB}',
    '\u{1F3ED}',
    '\u{1F4BC}',
    '\u{1F37C}',
];
const VALID_AVATARS = new Set(AVATAR_BASES);
for (const base of AVATAR_BASES) {
    for (const acc of AVATAR_ACCESSORIES) VALID_AVATARS.add(`${base}\u{200D}${acc}`);
}

/**
 * @param {unknown} avatar
 * @returns {string} a curated avatar, or '' for anything else
 */
function sanitizeAvatar(avatar) {
    return typeof avatar === 'string' && VALID_AVATARS.has(avatar) ? avatar : '';
}

// Emoji and their glue characters (ZWJ, variation selectors, skin tones, flags,
// keycaps, tag sequences). Names are plain text; emoji live in the avatar.
const EMOJI_RE =
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{200D}|\u{FE0E}|\u{FE0F}|\u{20E3}|[\u{E0020}-\u{E007F}]/gu;
const NAME_MAX_CHARS = 50;

/**
 * Letters and digits of any script (so "Ayşe", "Łukasz", "Nguyễn" survive),
 * plus spaces and `' ’ - _ .`. Emoji, symbols, control and bidi characters
 * are removed; runs of stacked combining marks ("Zalgo") are capped.
 * Mirrors sanitizePlayerName in sanitize.js.
 * @param {unknown} name
 * @returns {string} the cleaned name, '' when nothing usable is left
 */
function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    const cleaned = name
        .slice(0, 500)
        .normalize('NFC')
        .replaceAll(EMOJI_RE, '')
        .replaceAll(/[^\p{L}\p{M}\p{N}\s'’\-_.]/gu, '')
        .replaceAll(/(\p{M}{2})\p{M}+/gu, '$1')
        .replaceAll(/\s+/g, ' ')
        .trim();
    return [...cleaned].slice(0, NAME_MAX_CHARS).join('').trim();
}

function sanitizeCategories(categories) {
    if (!Array.isArray(categories)) return [];
    const seen = new Set();
    const out = [];
    for (const c of categories) {
        if (typeof c !== 'string') continue;
        const cleaned = c.trim().slice(0, 60);
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        out.push(cleaned);
        if (out.length >= 30) break;
    }
    return out;
}

function tallyMusicVotes(room) {
    const tally = { none: 0 };
    for (const id of MUSIC_THEME_IDS) tally[id] = 0;
    const votes = room.musicVotes;
    if (votes) {
        for (const choice of votes.values()) {
            if (tally[choice] !== undefined) tally[choice]++;
        }
    }
    return tally;
}

function broadcastMusicTally(room) {
    const tally = tallyMusicVotes(room);
    const payload = { type: 'music_vote_update', tally, locked: !!room.musicLocked };
    if (room.musicLocked && room.musicWinner) payload.winner = room.musicWinner;
    broadcastToPlayers(room, payload);
    sendToHost(room, payload);
}

/**
 * Tie-breaker is 'none' (no music).
 * @param room
 */
function decideMusicWinner(room) {
    const tally = tallyMusicVotes(room);
    const themeMax = Math.max(...MUSIC_THEME_IDS.map((t) => tally[t]));
    // 'none' wins outright if it has at least as many votes as the leading theme.
    if (tally.none >= themeMax) return 'none';
    // A theme only wins if it's the *unique* leader — multi-way ties go to 'none'.
    const leaders = MUSIC_THEME_IDS.filter((t) => tally[t] === themeMax);
    return leaders.length === 1 ? leaders[0] : 'none';
}

function send(ws, data) {
    if (ws && ws.readyState === 1) {
        // A socket can transition to CLOSING between the readyState check and
        // the write, in which case `ws` emits an error. Swallow it here: an
        // exception escaping a message handler would take down the whole
        // process (and with it every room on this machine).
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.warn('send failed:', error.message);
        }
    }
}

function sendError(ws, code, message) {
    send(ws, { type: 'error', code, message });
}

function sendToHost(room, data) {
    if (room.hostWs && room.hostWs.readyState === 1) send(room.hostWs, data);
}

function broadcastToPlayers(room, data) {
    const msg = JSON.stringify(data);
    for (const player of room.players.values()) {
        if (player.ws && player.ws.readyState === 1) {
            // Per-socket try/catch: one player whose socket died mid-broadcast
            // must not stop the question/result from reaching the rest of the
            // class.
            try {
                player.ws.send(msg);
            } catch (error) {
                console.warn('broadcast failed:', error.message);
            }
        }
    }
}

function getConnectedPlayerCount(room) {
    let count = 0;
    for (const p of room.players.values()) {
        if (p.isConnected) count++;
    }
    return count;
}

/**
 * The room this socket currently hosts, or null. Authority is bound to the
 * live host connection, not to knowledge of the session id: after a host
 * reconnects, the superseded socket (old tab, stale connection) loses all
 * host powers.
 * @param ws
 * @returns {object|null}
 */
function getHostedRoom(ws) {
    const room = rooms.get(ws.roomId);
    return room && room.hostWs === ws ? room : null;
}

// --- HTTP Server (health check) ---

const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(404);
    res.end();
});

// --- WebSocket Server ---

const MAX_PLAYERS_PER_ROOM = 240;
// Token bucket: RATE_LIMIT_PER_SECOND sustained, RATE_LIMIT_BURST instantaneous.
// The burst headroom is what makes a legitimate classroom work. A poll host
// reconciling after a reconnect emits one `append_option` per player
// back-to-back; under the old flat per-second cliff those options were silently
// dropped, and past 3x the cliff the host's socket was terminated outright —
// disconnecting the whole room mid-lesson.
const RATE_LIMIT_PER_SECOND = 20;
const RATE_LIMIT_BURST = 60;
// Only a client still hammering long after its bucket ran dry is abusive;
// legitimate clients back off as soon as their queue drains.
const RATE_LIMIT_MAX_DROPPED = 200;
// Per-question options ceiling. Quiz questions use ~4 options; polls in
// "source: players" mode encode every connected name as an option (plus a
// metadata sentinel in slot 0), so this must cover MAX_PLAYERS_PER_ROOM + 1.
const MAX_OPTIONS_PER_QUESTION = 250;
// Question duration ceiling in seconds. Quizzes stay within 5–80 s (host-side
// validation); polls may run longer, and `0` means "no timer — the host ends
// the vote manually".
const MAX_DURATION_SEC = 600;
// Knock requests waiting on the host while a room is locked.
const MAX_PENDING_JOINS = 50;

const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Exact-origin allow-list. Production is the GitHub Pages host; local dev is
// any port on localhost / 127.0.0.1. Matching is on the parsed origin/hostname,
// never a prefix — `startsWith('https://mamrehn.github.io')` would also accept
// `https://mamrehn.github.io.evil.com`, so we compare the full origin instead.
const ALLOWED_ORIGINS = new Set(['https://mamrehn.github.io']);
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * @param {string} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
    // Non-browser clients (and same-origin requests) may omit Origin entirely.
    if (!origin) return true;
    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (ALLOWED_ORIGINS.has(url.origin)) return true;
    return LOCAL_DEV_HOSTS.has(url.hostname);
}

const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024, // 64KB max message
    perMessageDeflate: { clientNoContextTakeover: true },
});

httpServer.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin || '';
    const isAllowed = isAllowedOrigin(origin);

    if (!isAllowed) {
        console.warn(`Rejected WebSocket from origin: ${origin.slice(0, 100)}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

const HANDLERS = {
    // Application-level heartbeat. The client uses our ack to confirm the
    // server is still responsive (separate from the WS-protocol ping/pong,
    // which the browser handles automatically and we never see at app level).
    heartbeat: (ws) => send(ws, { type: 'heartbeat_ack' }),
    create_room: (ws) => handleCreateRoom(ws),
    reconnect_host: (ws, msg) => handleReconnectHost(ws, msg),
    restore_room: (ws, msg) => handleRestoreRoom(ws, msg),
    join: (ws, msg) => handleJoin(ws, msg),
    submit_answer: (ws, msg) => handleSubmitAnswer(ws, msg),
    start_question: (ws, msg) => handleStartQuestion(ws, msg),
    collect_ballots: (ws) => handleCollectBallots(ws),
    send_results: (ws, msg) => handleSendResults(ws, msg),
    reveal_final: (ws) => handleRevealFinal(ws),
    terminate: (ws) => handleTerminate(ws),
    set_categories: (ws, msg) => handleSetCategories(ws, msg),
    cast_music_vote: (ws, msg) => handleCastMusicVote(ws, msg),
    lock_music_vote: (ws) => handleLockMusicVote(ws),
    update_avatar: (ws, msg) => handleUpdateAvatar(ws, msg),
    set_lobby_music: (ws, msg) => handleSetLobbyMusic(ws, msg),
    append_option: (ws, msg) => handleAppendOption(ws, msg),
    set_room_lock: (ws, msg) => handleSetRoomLock(ws, msg),
    resolve_join: (ws, msg) => handleResolveJoin(ws, msg),
    rename_player: (ws, msg) => handleRenamePlayer(ws, msg),
};

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.missedPongs = 0;
    ws.on('pong', () => {
        ws.isAlive = true;
        ws.missedPongs = 0;
    });

    // Rate limiting: token bucket, refilled lazily on each message so there is
    // no per-connection timer to leak.
    ws._tokens = RATE_LIMIT_BURST;
    ws._tokensAt = Date.now();
    ws._droppedMsgs = 0;
    ws._lastRateWarn = 0;

    ws.on('message', (raw) => {
        // Rate limit check
        const nowMs = Date.now();
        ws._tokens = Math.min(
            RATE_LIMIT_BURST,
            ws._tokens + ((nowMs - ws._tokensAt) * RATE_LIMIT_PER_SECOND) / 1000
        );
        ws._tokensAt = nowMs;
        if (ws._tokens < 1) {
            // At most one warning per second. Replying to every dropped frame
            // is its own amplification, and on the client each reply pops a
            // toast — and on the poll host it used to abort the running vote.
            if (nowMs - ws._lastRateWarn > 1000) {
                ws._lastRateWarn = nowMs;
                sendError(ws, ERR.RATE_LIMITED, 'Zu viele Nachrichten. Bitte warte einen Moment.');
            }
            if (++ws._droppedMsgs > RATE_LIMIT_MAX_DROPPED) ws.terminate();
            return;
        }
        ws._tokens--;

        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            sendError(ws, ERR.BAD_MESSAGE, 'Ungültiges Nachrichtenformat.');
            return;
        }
        // Everything below assumes an object with a string `type`. `null`,
        // numbers, arrays and strings are all valid JSON and used to crash
        // the process on the first property access.
        if (!isPlainObject(msg) || typeof msg.type !== 'string') {
            sendError(ws, ERR.BAD_MESSAGE, 'Ungültiges Nachrichtenformat.');
            return;
        }

        // Any incoming app-level message is proof the client is alive —
        // counts the same as a WS-protocol pong for the heartbeat. Without
        // this, a client sending submit_answer / start_question every second
        // could still be terminated for "missed pongs" if their browser
        // happened to throttle the auto-pong.
        ws.isAlive = true;
        ws.missedPongs = 0;

        const handler = Object.hasOwn(HANDLERS, msg.type) ? HANDLERS[msg.type] : null;
        if (!handler) {
            console.warn(`Unknown message type: ${msg.type.slice(0, 40)}`);
            return;
        }
        // Last line of defence: a handler bug must cost one message, never
        // the process (and with it every room on this machine).
        try {
            handler(ws, msg);
        } catch (error) {
            console.error(`Handler "${msg.type}" failed:`, error);
        }
    });

    ws.on('close', () => {
        try {
            handleDisconnect(ws);
        } catch (error) {
            console.error('Disconnect handling failed:', error);
        }
    });
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
});

// --- Room lifecycle ---

/**
 * @param ws - the host socket
 * @param {string} hostSessionId
 * @returns {object}
 */
function createRoomState(ws, hostSessionId) {
    return {
        hostWs: ws,
        hostSessionId,
        players: new Map(),
        createdAt: Date.now(),
        hostDisconnectTimer: null,
        expiryTimer: null,
        categories: [],
        musicVotes: new Map(),
        musicLocked: false,
        musicWinner: null,
        lobbyMusic: LOBBY_MUSIC_DEFAULT,
        // Quiz phase tracking — lets the server replay the current state
        // (active question / final results) to a reconnecting player.
        // 'lobby' | 'question' | 'closed' | 'result' | 'final'
        phase: 'lobby',
        activeQuestion: null,
        questionStartTime: null,
        currentQuestionIndex: 0,
        finalSnapshot: null,
        // Whether the host has triggered the podium reveal. Players withhold the
        // final ranking until this flips, so phones can't spoil the reveal.
        finalRevealed: false,
        // Locked rooms admit known sessions (reconnects) directly; everyone
        // else knocks and waits for the host's decision.
        locked: false,
        pendingJoins: new Map(),
        // Anonymous questions: ballots are stored here without any link to
        // the voter and only handed to the host, shuffled, on collect.
        ballots: [],
    };
}

function destroyRoom(roomId, room) {
    if (room.expiryTimer) clearTimeout(room.expiryTimer);
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    for (const req of room.pendingJoins.values()) req.ws.pendingJoin = null;
    room.pendingJoins.clear();
    if (rooms.get(roomId) === room) rooms.delete(roomId);
}

function registerRoom(roomId, room) {
    rooms.set(roomId, room);
    room.expiryTimer = setTimeout(() => {
        broadcastToPlayers(room, { type: 'quiz_terminated' });
        destroyRoom(roomId, room);
        console.log(`Room ${roomId} cleaned up (expired)`);
    }, ROOM_MAX_AGE_MS);
}

/**
 * Tear down any room this connection currently owns as host. Called before a
 * host creates or restores a (new) room so a single connection can never
 * accumulate more than one room. This both bounds create/restore spam (no
 * unbounded room growth from one socket) and cleanly ends the previous game
 * when a host deliberately starts a fresh one.
 * @param ws
 */
function closeOwnedRoom(ws) {
    const room = getHostedRoom(ws);
    if (room) {
        broadcastToPlayers(room, { type: 'quiz_terminated' });
        destroyRoom(ws.roomId, room);
        console.log(`Room ${ws.roomId} closed (host opened a new room)`);
    }
    ws.roomId = null;
    ws.role = null;
}

function handleCreateRoom(ws) {
    if (ws.role === 'player' || ws.pendingJoin) {
        sendError(ws, ERR.ALREADY_JOINED, 'Diese Verbindung ist bereits einem Raum beigetreten.');
        return;
    }
    // One active room per host connection: opening a new room ends the
    // previous one this socket owned (rather than rejecting the request).
    closeOwnedRoom(ws);

    const roomId = generateRoomId();
    if (!roomId) {
        sendError(ws, ERR.SERVER_BUSY, 'Server überlastet. Bitte versuche es später erneut.');
        return;
    }
    const hostSessionId = generateSessionId();
    registerRoom(roomId, createRoomState(ws, hostSessionId));

    ws.roomId = roomId;
    ws.sessionId = hostSessionId;
    ws.role = 'host';

    send(ws, { type: 'room_created', roomId, sessionId: hostSessionId });
    console.log(`Room ${roomId} created`);
}

/**
 * Point the room at a new host socket. A superseded socket that is still open
 * (second tab, stale connection) is closed with CLOSE_SESSION_REPLACED so its
 * client stops reconnecting instead of stealing the session back.
 * @param room
 * @param ws
 */
function bindHostSocket(room, ws) {
    const previous = room.hostWs;
    room.hostWs = ws;
    if (previous && previous !== ws) {
        previous.role = null;
        previous.roomId = null;
        if (previous.readyState === 1) {
            previous.close(CLOSE_SESSION_REPLACED, 'session replaced');
        }
    }
}

/**
 * @param room
 * @returns {Array<object>} per-player state for the host
 */
function hostPlayerList(room) {
    const playerList = [];
    for (const [sid, p] of room.players) {
        playerList.push({
            sessionId: sid,
            name: p.name,
            avatar: p.avatar || '',
            score: p.score,
            isConnected: p.isConnected,
            hasAnswered: !!p.hasAnswered,
            // Never set for anonymous questions (see handleSubmitAnswer).
            currentAnswer:
                p.hasAnswered && Array.isArray(p.currentAnswer) ? [...p.currentAnswer] : null,
        });
    }
    return playerList;
}

function pendingJoinList(room) {
    return [...room.pendingJoins.entries()].map(([requestId, req]) => ({
        requestId,
        name: req.name,
        avatar: req.avatar,
    }));
}

function handleReconnectHost(ws, msg) {
    const roomId = asRoomCode(msg.roomId);
    const sessionId = asSessionId(msg.sessionId);
    if (ws.role === 'player' || ws.pendingJoin) {
        sendError(ws, ERR.ALREADY_JOINED, 'Diese Verbindung ist bereits einem Raum beigetreten.');
        return;
    }
    const room = rooms.get(roomId);

    // If room not found but host sends a session ID, they might be able to restore it
    if (!room) {
        if (sessionId) {
            send(ws, { type: 'room_not_found_try_restore', roomId, sessionId });
            console.log(
                `Host tried to reconnect to missing room ${roomId}, suggesting restoration`
            );
        } else {
            sendError(ws, ERR.ROOM_NOT_FOUND, 'Raum nicht gefunden.');
        }
        return;
    }

    if (!sessionId || room.hostSessionId !== sessionId) {
        sendError(ws, ERR.INVALID_SESSION, 'Ungültige Session-ID für diesen Raum.');
        return;
    }

    // Clear disconnect timer if pending
    if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
    }

    bindHostSocket(room, ws);
    ws.roomId = roomId;
    ws.sessionId = sessionId;
    ws.role = 'host';

    // Send current room state back to host. Includes per-player answer state
    // so a host whose WS briefly dropped during voting can rebuild its local
    // `hostAnswers` map — otherwise submissions made during the host's blip
    // are server-recorded but invisible to the host, and the auto-end check
    // ("all connected players have voted") stalls forever.
    send(ws, {
        type: 'host_reconnected',
        roomId,
        players: hostPlayerList(room),
        categories: room.categories,
        musicTally: tallyMusicVotes(room),
        musicLocked: !!room.musicLocked,
        musicWinner: room.musicWinner || null,
        lobbyMusic: room.lobbyMusic || LOBBY_MUSIC_DEFAULT,
        phase: room.phase || 'lobby',
        locked: room.locked,
        pendingJoins: pendingJoinList(room),
    });
    console.log(`Host reconnected to room ${roomId}`);
}

const RESTORABLE_PHASES = new Set(['lobby', 'result', 'final']);

function handleRestoreRoom(ws, msg) {
    // Rate limit: max once per 5 seconds per connection
    const now = Date.now();
    if (ws._lastRestore && now - ws._lastRestore < 5000) {
        sendError(
            ws,
            ERR.RESTORE_THROTTLED,
            'Bitte warte einen Moment vor der nächsten Wiederherstellung.'
        );
        return;
    }
    ws._lastRestore = now;

    let roomId = asRoomCode(msg.roomId);
    const hostSessionId = asSessionId(msg.sessionId);

    if (!roomId || !hostSessionId) {
        sendError(ws, ERR.RESTORE_INVALID, 'Wiederherstellung fehlgeschlagen: Fehlende Daten.');
        return;
    }
    if (ws.role === 'player' || ws.pendingJoin) {
        sendError(ws, ERR.ALREADY_JOINED, 'Diese Verbindung ist bereits einem Raum beigetreten.');
        return;
    }

    if (rooms.has(roomId)) {
        const existingRoom = rooms.get(roomId);
        if (existingRoom.hostSessionId === hostSessionId) {
            // It's this host's room, just reconnect normally
            handleReconnectHost(ws, msg);
            return;
        }
        // Room ID taken by someone else — generate a new one for restoration
        roomId = generateRoomId();
        if (!roomId) {
            sendError(ws, ERR.SERVER_BUSY, 'Server überlastet. Bitte versuche es später erneut.');
            return;
        }
    }

    // One active room per connection: if this socket already restored/created
    // a room earlier, close it before standing up the new one.
    closeOwnedRoom(ws);

    const room = createRoomState(ws, hostSessionId);

    // Restore players if provided (limit to MAX_PLAYERS_PER_ROOM). Only the
    // server-built, sanitized copy is ever stored or echoed back.
    if (Array.isArray(msg.players)) {
        for (const p of msg.players.slice(0, MAX_PLAYERS_PER_ROOM)) {
            if (!isPlainObject(p)) continue;
            const id = asSessionId(p.id);
            if (!id) continue;
            room.players.set(id, {
                name: sanitizeName(p.name) || 'Spieler',
                avatar: sanitizeAvatar(p.avatar),
                score: asScore(p.score),
                ws: null,
                isConnected: false,
                // Lets a reconnecting player see "already answered" once the
                // host resumes the interrupted question.
                hasAnswered: p.hasAnswered === true,
                currentAnswer: null,
            });
        }
    }

    // Phase the game was in when the server went away, so reconnecting players
    // land on the right screen. An interrupted *question* is resumed by the
    // host re-sending `start_question` with `resume: true`.
    if (RESTORABLE_PHASES.has(msg.phase)) room.phase = msg.phase;
    if (typeof msg.questionIndex === 'number' && msg.questionIndex >= 0) {
        room.currentQuestionIndex = Math.min(Math.floor(msg.questionIndex), 10_000);
    }
    if (room.phase === 'final') {
        room.finalSnapshot = {
            correct: sanitizeIndexList(msg.correct),
            leaderboard: sanitizeLeaderboard(msg.leaderboard),
            questionIndex: room.currentQuestionIndex,
        };
        room.finalRevealed = msg.finalRevealed === true;
    }
    room.locked = msg.locked === true;

    registerRoom(roomId, room);

    ws.roomId = roomId;
    ws.sessionId = hostSessionId;
    ws.role = 'host';

    send(ws, {
        type: 'host_reconnected',
        roomId,
        players: hostPlayerList(room),
        phase: room.phase,
        locked: room.locked,
        pendingJoins: [],
        isRestored: true,
    });
    console.log(`Room ${roomId} restored`);
}

/**
 * Remaining seconds for the active question, or null for an untimed one.
 * Computed server-side so a client's clock is never compared against ours.
 * @param room
 * @returns {number|null}
 */
function remainingSeconds(room) {
    const q = room.activeQuestion;
    if (!q || !q.duration) return null;
    const elapsedSec = room.questionStartTime ? (Date.now() - room.questionStartTime) / 1000 : 0;
    return Math.max(0, q.duration - elapsedSec);
}

/**
 * Replay the current phase to a (re)joining player so they see what everyone
 * else sees instead of landing in the lobby.
 * @param room
 * @param ws
 * @param player
 */
function replayState(room, ws, player) {
    if (room.phase === 'question' && room.activeQuestion) {
        send(ws, {
            ...room.activeQuestion,
            remaining: remainingSeconds(room),
            alreadySubmitted: !!player.hasAnswered,
        });
    } else if (room.phase === 'final' && room.finalSnapshot) {
        send(ws, {
            type: 'result',
            correct: room.finalSnapshot.correct,
            isFinal: true,
            questionIndex: room.finalSnapshot.questionIndex,
            leaderboard: room.finalSnapshot.leaderboard,
            playerScore: player.score,
            // Show the ranking on arrival only if the podium is already out.
            revealed: !!room.finalRevealed,
            isReplay: true,
        });
    }
}

function joinedPayload(room, sessionId, player, isReconnect) {
    return {
        type: 'joined',
        sessionId,
        score: player.score,
        playerName: player.name,
        avatar: player.avatar || '',
        isReconnect,
        categories: room.categories,
        musicTally: tallyMusicVotes(room),
        musicLocked: !!room.musicLocked,
        musicWinner: room.musicWinner || null,
        lobbyMusic: room.lobbyMusic || LOBBY_MUSIC_DEFAULT,
        phase: room.phase || 'lobby',
    };
}

/**
 * Bind `ws` to an existing player seat (reconnect, or a knock the host
 * assigned to a dropped-out player). Keeps the seat's name, score and vote.
 * @param room
 * @param {string} roomCode
 * @param {string} sessionId
 * @param player
 * @param ws
 * @param {string} incomingAvatar - already sanitized
 */
function attachPlayerSocket(room, roomCode, sessionId, player, ws, incomingAvatar) {
    const previous = player.ws;
    if (previous && previous !== ws) {
        // Same session opened elsewhere (second tab / device): the older
        // connection loses the seat and is told not to reconnect.
        previous.role = null;
        previous.sessionId = null;
        previous.roomId = null;
        if (previous.readyState === 1) {
            previous.close(CLOSE_SESSION_REPLACED, 'session replaced');
        }
    }
    player.ws = ws;
    player.isConnected = true;
    ws.sessionId = sessionId;
    ws.roomId = roomCode;
    ws.role = 'player';

    // Allow players to refresh their avatar on reconnect.
    if (incomingAvatar) player.avatar = incomingAvatar;

    send(ws, joinedPayload(room, sessionId, player, true));
    replayState(room, ws, player);

    sendToHost(room, {
        type: 'player_reconnected',
        sessionId,
        name: player.name,
        avatar: player.avatar || '',
        score: player.score,
        playerCount: getConnectedPlayerCount(room),
    });
    console.log(`Player reconnected to room ${roomCode}`);
}

/**
 * Create a brand-new player seat for `ws`.
 * @param room
 * @param {string} roomCode
 * @param ws
 * @param {string} name - already sanitized
 * @param {string} avatar - already sanitized
 */
function admitNewPlayer(room, roomCode, ws, name, avatar) {
    // Enforce max player limit on *connected* players. Entries are kept
    // after disconnect so players can reconnect with their score, so
    // room.players.size counts everyone who ever joined — using it here
    // would wrongly report "full" in a room with lots of join/leave churn
    // even when far fewer than the cap are actually present.
    if (getConnectedPlayerCount(room) >= MAX_PLAYERS_PER_ROOM) {
        sendError(ws, ERR.ROOM_FULL, `Raum ist voll (max. ${MAX_PLAYERS_PER_ROOM} Spieler).`);
        return;
    }

    // New player. Seed their starting score with the average of all
    // existing players' scores so a late-joiner who comes in after a few
    // quiz questions can still credibly compete (a player who joined at
    // question 5 of 10 starting at 0 has no realistic shot otherwise).
    // For polls this field is unused in game logic — Borda totals are
    // tracked per-option, not per-player — so the seeding is harmless.
    let initialScore = 0;
    if (room.players.size > 0) {
        let sum = 0;
        for (const p of room.players.values()) sum += p.score;
        initialScore = Math.round(sum / room.players.size);
    }
    const sessionId = generateSessionId();
    const player = {
        name,
        avatar,
        score: initialScore,
        ws,
        isConnected: true,
        hasAnswered: false,
        currentAnswer: null,
    };
    room.players.set(sessionId, player);

    ws.sessionId = sessionId;
    ws.roomId = roomCode;
    ws.role = 'player';

    send(ws, joinedPayload(room, sessionId, player, false));
    // Replay current quiz state so a player who joined *after* the host
    // started a question still gets to see and answer it. Previously
    // late-joiners landed on the waiting view and the host's "all voted"
    // auto-end logic stalled because their non-voting presence kept the
    // count short of complete.
    replayState(room, ws, player);

    sendToHost(room, {
        type: 'player_joined',
        sessionId,
        name,
        avatar,
        score: initialScore,
        playerCount: getConnectedPlayerCount(room),
    });
    console.log(`Player joined room ${roomCode} (${getConnectedPlayerCount(room)} players)`);
}

function handleJoin(ws, msg) {
    // One seat per connection. A second `join` on the same socket used to
    // create another player bound to this socket, and on close only the last
    // one was marked disconnected — the rest stayed "connected" forever,
    // stalling "everyone answered" and filling the room with ghosts.
    if (ws.role || ws.pendingJoin) {
        sendError(ws, ERR.ALREADY_JOINED, 'Diese Verbindung ist bereits einem Raum beigetreten.');
        return;
    }

    const roomCode = asRoomCode(msg.roomCode);
    const room = rooms.get(roomCode);
    if (!room) {
        sendError(ws, ERR.ROOM_NOT_FOUND, 'Raum nicht gefunden.');
        return;
    }

    const sessionId = asSessionId(msg.sessionId);
    const existing = sessionId ? room.players.get(sessionId) : null;
    const avatar = sanitizeAvatar(msg.avatar);

    // Known seat → reconnect. Works in locked rooms too: a page reload, a
    // network drop or a restarted laptop keeps its session in localStorage.
    if (existing) {
        attachPlayerSocket(room, roomCode, sessionId, existing, ws, avatar);
        return;
    }

    const name = sanitizeName(msg.playerName) || 'Spieler';

    if (room.locked) {
        // Knock: park the connection until the host admits it (as a new
        // player, or onto a dropped-out player's seat) or turns it away.
        if (room.pendingJoins.size >= MAX_PENDING_JOINS) {
            sendError(
                ws,
                ERR.JOIN_QUEUE_FULL,
                'Zu viele offene Beitrittsanfragen. Bitte später erneut versuchen.'
            );
            return;
        }
        const requestId = 'req-' + crypto.randomUUID();
        room.pendingJoins.set(requestId, { ws, name, avatar, requestedAt: Date.now() });
        ws.pendingJoin = { roomId: roomCode, requestId };
        send(ws, { type: 'join_pending', requestId, playerName: name });
        sendToHost(room, { type: 'join_request', requestId, name, avatar });
        return;
    }

    admitNewPlayer(room, roomCode, ws, name, avatar);
}

function handleSetRoomLock(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;
    room.locked = msg.locked === true;
    send(ws, { type: 'room_lock', locked: room.locked });
    // Unlocking opens the door for everyone who was knocking.
    if (!room.locked && room.pendingJoins.size > 0) {
        const waiting = [...room.pendingJoins.entries()];
        room.pendingJoins.clear();
        for (const [requestId, req] of waiting) {
            req.ws.pendingJoin = null;
            send(ws, { type: 'join_request_resolved', requestId });
            if (req.ws.readyState === 1) {
                admitNewPlayer(room, ws.roomId, req.ws, req.name, req.avatar);
            }
        }
    }
}

/**
 * Host answers a knock: `admit` (new seat), `assign` (take over the seat of a
 * dropped-out player — keeps their name, score and vote, so re-admitting
 * someone after e.g. a laptop restart can never create a second ballot) or
 * `deny`.
 * @param ws
 * @param msg
 */
function handleResolveJoin(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;
    const requestId = asString(msg.requestId, 64);
    const req = room.pendingJoins.get(requestId);
    if (!req) {
        sendError(ws, ERR.REQUEST_NOT_FOUND, 'Diese Beitrittsanfrage ist nicht mehr offen.');
        return;
    }

    if (msg.decision === 'assign') {
        const targetId = asSessionId(msg.sessionId);
        const target = targetId ? room.players.get(targetId) : null;
        if (!target || target.isConnected) {
            sendError(ws, ERR.SEAT_TAKEN, 'Dieser Platz ist nicht frei.');
            return;
        }
        room.pendingJoins.delete(requestId);
        req.ws.pendingJoin = null;
        send(ws, { type: 'join_request_resolved', requestId });
        if (req.ws.readyState === 1) {
            attachPlayerSocket(room, ws.roomId, targetId, target, req.ws, req.avatar);
        }
        return;
    }

    room.pendingJoins.delete(requestId);
    req.ws.pendingJoin = null;
    send(ws, { type: 'join_request_resolved', requestId });
    if (req.ws.readyState !== 1) return;
    if (msg.decision === 'admit') {
        admitNewPlayer(room, ws.roomId, req.ws, req.name, req.avatar);
    } else {
        sendError(req.ws, ERR.JOIN_DENIED, 'Die Lehrkraft hat den Beitritt nicht zugelassen.');
    }
}

/**
 * Host overrides a player's display name (censoring). The player is told and
 * cannot change it back: reconnects keep the server-side name.
 * @param ws
 * @param msg
 */
function handleRenamePlayer(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;
    if (room.phase === 'question') {
        sendError(
            ws,
            ERR.RENAME_NOT_ALLOWED,
            'Namen können während einer laufenden Frage nicht geändert werden.'
        );
        return;
    }
    const sessionId = asSessionId(msg.sessionId);
    const player = sessionId ? room.players.get(sessionId) : null;
    if (!player) {
        sendError(ws, ERR.PLAYER_NOT_FOUND, 'Spieler nicht gefunden.');
        return;
    }
    const name = sanitizeName(msg.name);
    if (!name) {
        sendError(ws, ERR.NAME_INVALID, 'Der Name muss Buchstaben oder Ziffern enthalten.');
        return;
    }
    player.name = name;
    send(player.ws, { type: 'name_changed', name });
    send(ws, { type: 'player_renamed', sessionId, name });
}

/**
 * @param {unknown} list
 * @returns {number[]} up to MAX_OPTIONS_PER_QUESTION integer option indices
 */
function sanitizeIndexList(list) {
    if (!Array.isArray(list)) return [];
    return list
        .slice(0, MAX_OPTIONS_PER_QUESTION)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < MAX_OPTIONS_PER_QUESTION);
}

/**
 * @param {unknown} list
 * @returns {Array<{name:string, score:number}>|null}
 */
function sanitizeLeaderboard(list) {
    if (!Array.isArray(list)) return null;
    return list.slice(0, MAX_OPTIONS_PER_QUESTION).map((entry) => {
        const obj = isPlainObject(entry) ? entry : {};
        return {
            // Poll results carry option labels here (up to 500 chars).
            name: asString(obj.name, 500) || 'Spieler',
            score: typeof obj.score === 'number' && Number.isFinite(obj.score) ? obj.score : 0,
        };
    });
}

function handleSubmitAnswer(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.role !== 'player') {
        sendError(ws, ERR.ROOM_INACTIVE, 'Raum nicht mehr aktiv.');
        return;
    }

    const player = room.players.get(ws.sessionId);
    if (!player) {
        sendError(ws, ERR.PLAYER_NOT_FOUND, 'Spieler nicht gefunden.');
        return;
    }

    // Only accept answers while a question is actually live. Outside the
    // 'question' phase (lobby / results) there is nothing to answer, and the
    // host already ignores such frames — drop them server-side too.
    if (room.phase !== 'question' || !room.activeQuestion) return;
    // First answer wins — the host scores the first one it sees, and an
    // anonymous ballot must never be cast twice.
    if (player.hasAnswered) return;

    // Validate answerData: an array of at most 20 integer indices into the
    // active question's options. Anything else can't score on the host anyway.
    const optionCount = room.activeQuestion.options.length;
    if (!Array.isArray(msg.answerData) || msg.answerData.length > 20) return;
    if (!msg.answerData.every((i) => Number.isInteger(i) && i >= 0 && i < optionCount)) return;
    const answer = [...msg.answerData];

    player.hasAnswered = true;

    if (room.activeQuestion.anonymous) {
        // Store the ballot without the voter; the host only learns *that*
        // this player voted (for the "X von Y" counter and auto-end).
        room.ballots.push(answer);
        player.currentAnswer = null;
        sendToHost(room, { type: 'player_answered', sessionId: ws.sessionId, anonymous: true });
        return;
    }

    // Persist on the player object so a reconnect can show "already answered".
    player.currentAnswer = answer;
    // Compute elapsed time on server for fair scoring
    const serverNow = Date.now();
    sendToHost(room, {
        type: 'player_answered',
        sessionId: ws.sessionId,
        name: player.name,
        answerData: answer,
        answerTime: serverNow,
        elapsedMs: room.questionStartTime ? serverNow - room.questionStartTime : null,
    });
}

function handleStartQuestion(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;

    // Validate question and options content size. Reply with an error rather
    // than silently dropping so the host UI can show a useful message instead
    // of advancing into a "voting" state nobody else sees.
    if (typeof msg.question !== 'string' || msg.question.length > 4000) {
        sendError(ws, ERR.QUESTION_INVALID, 'Frage ist zu lang oder ungültig.');
        return;
    }
    if (!Array.isArray(msg.options) || msg.options.length > MAX_OPTIONS_PER_QUESTION) {
        sendError(ws, ERR.OPTIONS_LIMIT, `Zu viele Optionen (max. ${MAX_OPTIONS_PER_QUESTION}).`);
        return;
    }
    if (msg.options.some((o) => typeof o !== 'string' || o.length > 500)) {
        sendError(ws, ERR.OPTION_INVALID, 'Eine Option ist zu lang oder ungültig.');
        return;
    }

    // Validate relay fields
    const questionIndex =
        typeof msg.index === 'number' && msg.index >= 0 ? Math.min(msg.index, 10_000) : 0;
    const questionTotal =
        typeof msg.total === 'number' && msg.total > 0 ? Math.min(msg.total, 10_000) : 1;
    const duration =
        typeof msg.duration === 'number' &&
        Number.isFinite(msg.duration) &&
        msg.duration >= 0 &&
        msg.duration <= MAX_DURATION_SEC
            ? msg.duration
            : 30;
    // `resume`: the host re-sends the question it was running when the server
    // restarted. Keep the per-player "already answered" flags restored from
    // `restore_room` instead of wiping them.
    const isResume = msg.resume === true;

    // Record server-side question start time for fair timing
    room.questionStartTime = Date.now();
    room.currentQuestionIndex = questionIndex;
    room.ballots = [];

    if (!isResume) {
        // Reset per-player answer state so reconnecting players see a fresh slate.
        for (const player of room.players.values()) {
            player.hasAnswered = false;
            player.currentAnswer = null;
        }
    }

    const payload = {
        type: 'question',
        question: msg.question,
        options: [...msg.options],
        index: questionIndex,
        total: questionTotal,
        duration: duration,
        // Relay-only flag: drives the "double points" badge on the player
        // card. Scoring itself is computed host-side, so this is purely
        // cosmetic — coerce to a strict boolean and never trust the value.
        doublePoints: msg.doublePoints === true,
        // Anonymous (secret) ballot: the host never receives who voted what.
        anonymous: msg.anonymous === true,
    };
    // Snapshot for replay on reconnect.
    room.phase = 'question';
    room.activeQuestion = payload;
    room.finalSnapshot = null;

    // Relay to all players. Send server-computed remaining seconds (= full
    // duration here since the question just started) so clients never need to
    // compare clocks across machines. Players who already answered before a
    // resume get the locked view straight away.
    for (const player of room.players.values()) {
        send(player.ws, {
            ...payload,
            remaining: duration || null,
            alreadySubmitted: isResume && !!player.hasAnswered,
        });
    }
}

/**
 * Close an anonymous vote and hand the host the ballots, shuffled so their
 * order says nothing about who submitted when. Idempotent until the next
 * question, so a host that drops mid-collect can simply ask again.
 * @param ws
 */
function handleCollectBallots(ws) {
    const room = getHostedRoom(ws);
    if (!room) return;
    if (!room.activeQuestion || !room.activeQuestion.anonymous) {
        sendError(ws, ERR.NO_ACTIVE_QUESTION, 'Keine aktive geheime Abstimmung.');
        return;
    }
    if (room.phase === 'question') {
        room.phase = 'closed';
        const ballots = room.ballots;
        for (let i = ballots.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [ballots[i], ballots[j]] = [ballots[j], ballots[i]];
        }
    }
    send(ws, { type: 'ballots', ballots: room.ballots });
}

function handleSendResults(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;

    // Update stored scores from host (with validation)
    if (isPlainObject(msg.playerScores)) {
        for (const [sid, score] of Object.entries(msg.playerScores)) {
            const player = room.players.get(sid);
            if (player && typeof score === 'number' && Number.isFinite(score) && score >= 0) {
                player.score = score;
            }
        }
    }

    const leaderboard = sanitizeLeaderboard(msg.leaderboard);
    const correct = sanitizeIndexList(msg.correct);
    const isFinal = msg.isFinal === true;

    // Phase transition: question → result (or final). Snapshot for reconnect
    // replay; no longer in an active question.
    room.phase = isFinal ? 'final' : 'result';
    room.activeQuestion = null;
    room.ballots = [];
    if (isFinal) {
        room.finalSnapshot = {
            correct,
            leaderboard,
            questionIndex: room.currentQuestionIndex,
        };
        // Ranking is sent now but stays hidden on players' phones until the
        // host triggers the podium (`reveal_final`).
        room.finalRevealed = false;
    }

    // Send personalized results to each player
    for (const player of room.players.values()) {
        send(player.ws, {
            type: 'result',
            correct,
            isFinal,
            questionIndex: room.currentQuestionIndex,
            leaderboard,
            playerScore: player.score,
        });
    }
}

/**
 * Host triggered the podium. Flag the room as revealed (so reconnecting players
 * get the ranking right away) and tell connected players to unveil it now.
 * @param ws
 */
function handleRevealFinal(ws) {
    const room = getHostedRoom(ws);
    if (!room) return;

    room.finalRevealed = true;
    broadcastToPlayers(room, { type: 'reveal_final' });
}

function handleTerminate(ws) {
    const room = getHostedRoom(ws);
    if (!room) return;

    const roomId = ws.roomId;
    broadcastToPlayers(room, { type: 'quiz_terminated' });
    for (const req of room.pendingJoins.values()) send(req.ws, { type: 'quiz_terminated' });
    destroyRoom(roomId, room);
    console.log(`Room ${roomId} terminated by host`);
}

/**
 * Host pushes the deduplicated category list after importing MC questions.
 * @param ws
 * @param msg
 */
function handleSetCategories(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;

    room.categories = sanitizeCategories(msg.categories);
    broadcastToPlayers(room, { type: 'categories', categories: room.categories });
}

/**
 * Player casts (or changes) their music vote. One vote per player.
 * @param ws
 * @param msg
 */
function handleCastMusicVote(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.role !== 'player' || !room.players.has(ws.sessionId)) return;
    if (room.musicLocked) return;
    if (typeof msg.choice !== 'string' || !VALID_MUSIC_VOTES.has(msg.choice)) return;

    room.musicVotes.set(ws.sessionId, msg.choice);
    broadcastMusicTally(room);
}

/**
 * Host locks the vote at quiz start; tie goes to 'none'.
 * @param ws
 */
function handleLockMusicVote(ws) {
    const room = getHostedRoom(ws);
    if (!room || room.musicLocked) return;

    room.musicLocked = true;
    room.musicWinner = decideMusicWinner(room);
    broadcastMusicTally(room);
}

/**
 * Player changes their avatar from the lobby grid.
 * @param ws
 * @param msg
 */
function handleUpdateAvatar(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.role !== 'player') return;
    const player = room.players.get(ws.sessionId);
    if (!player) return;

    const avatar = sanitizeAvatar(msg.avatar);
    player.avatar = avatar;
    sendToHost(room, { type: 'player_avatar', sessionId: ws.sessionId, avatar });
}

/**
 * Host's lobby music preference. Players display a 🔊 pill on the matching
 * vote card so they know which theme they're hearing right now.
 * @param ws
 * @param msg
 */
function handleSetLobbyMusic(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;
    if (typeof msg.theme !== 'string' || !VALID_LOBBY_MUSIC.has(msg.theme)) return;
    if (room.lobbyMusic === msg.theme) return;

    room.lobbyMusic = msg.theme;
    broadcastToPlayers(room, { type: 'lobby_music', theme: room.lobbyMusic });
}

/**
 * Append a single option to the active question's option list and broadcast
 * the new option to all connected players. Used by polls in `source:
 * 'players'` mode when a late-joiner arrives during an active vote — their
 * name is added to the options so other voters can rank them too. Existing
 * submitted ballots are unaffected because we only append (never insert or
 * reorder), so previously-submitted indices remain valid.
 * @param ws
 * @param msg
 */
function handleAppendOption(ws, msg) {
    const room = getHostedRoom(ws);
    if (!room) return;
    if (typeof msg.option !== 'string' || msg.option.length === 0 || msg.option.length > 500) {
        sendError(ws, ERR.APPEND_REJECTED, 'Ungültige Option.');
        return;
    }
    if (room.phase !== 'question' || !room.activeQuestion) {
        sendError(ws, ERR.APPEND_REJECTED, 'Keine aktive Frage.');
        return;
    }
    if (room.activeQuestion.options.length >= MAX_OPTIONS_PER_QUESTION) {
        sendError(
            ws,
            ERR.APPEND_REJECTED,
            `Maximale Anzahl Optionen (${MAX_OPTIONS_PER_QUESTION}) erreicht.`
        );
        return;
    }
    // Mutate the snapshot so a player who reconnects mid-vote gets the
    // current option list, not the stale original.
    room.activeQuestion.options.push(msg.option);
    broadcastToPlayers(room, { type: 'option_appended', option: msg.option });
}

function handleDisconnect(ws) {
    // A knock that gives up (tab closed) disappears from the host's list.
    if (ws.pendingJoin) {
        const room = rooms.get(ws.pendingJoin.roomId);
        const { requestId } = ws.pendingJoin;
        ws.pendingJoin = null;
        if (room && room.pendingJoins.delete(requestId)) {
            sendToHost(room, { type: 'join_request_cancelled', requestId });
        }
        return;
    }

    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (ws.role === 'host') {
        // Stale-close guard: the old host socket may close after a new one
        // has already taken its place (page reload, fast reconnect). Acting
        // on it would null out the active host connection and start a bogus
        // 5-minute termination countdown.
        if (room.hostWs !== ws) return;
        room.hostWs = null;
        console.log(`Host disconnected from room ${ws.roomId}, grace period started`);

        // Grace period: terminate room if host doesn't reconnect within 5 minutes
        const disconnectedRoomId = ws.roomId;
        room.hostDisconnectTimer = setTimeout(
            () => {
                // Verify room still exists in Map and host is still disconnected
                if (!room.hostWs && rooms.get(disconnectedRoomId) === room) {
                    broadcastToPlayers(room, { type: 'quiz_terminated' });
                    destroyRoom(disconnectedRoomId, room);
                    console.log(`Room ${disconnectedRoomId} terminated (host timeout)`);
                }
            },
            5 * 60 * 1000
        );
    } else if (ws.role === 'player') {
        const player = room.players.get(ws.sessionId);
        if (player) {
            // Stale-close guard: if the player has already reconnected with
            // a different socket (page reload races the old socket's FIN —
            // or the old socket only times out via heartbeat ~60s later),
            // this close event is for a socket we already replaced. Acting
            // on it would flip an active player to disconnected and emit a
            // spurious player_left to the host.
            if (player.ws !== ws) return;
            player.isConnected = false;
            player.ws = null;

            sendToHost(room, {
                type: 'player_left',
                sessionId: ws.sessionId,
                name: player.name,
                playerCount: getConnectedPlayerCount(room),
            });
            console.log(`Player disconnected from room ${ws.roomId}`);
        }
    }
}

// --- Heartbeat: detect dead connections ---

// Heartbeat: ping every 30s, but only terminate after 2 consecutive misses
// (~60s grace). Mobile browsers commonly throttle backgrounded WebSocket
// traffic, so a single missed pong is too aggressive — players were getting
// terminated mid-session whenever their phone briefly slept.
const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
        // Each socket is isolated: `ping()` on a socket that just entered
        // CLOSING throws, and an exception escaping a setInterval callback is
        // an uncaught exception — it would crash the process and drop every
        // room on this machine, which is exactly the "everyone got kicked at
        // once" failure we are trying to eliminate.
        try {
            if (!ws.isAlive) {
                ws.missedPongs = (ws.missedPongs || 0) + 1;
                if (ws.missedPongs >= 2) {
                    ws.terminate();
                    continue;
                }
            }
            ws.isAlive = false;
            ws.ping();
        } catch (error) {
            console.warn('heartbeat ping failed:', error.message);
        }
    }
}, 30_000);

// Room cleanup is handled per-room via expiryTimer (set on creation/restore)

// --- Graceful shutdown ---

// Deploys and machine restarts end the process, not the lessons: clients are
// told a restart is coming and reconnect on their own; the host then restores
// its room (`restore_room`) with the same code and players. Fly sends SIGINT by
// default (no `kill_signal` in fly.toml); SIGTERM covers other hosts.
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, closing connections for restart...`);
    clearInterval(heartbeatInterval);
    for (const ws of wss.clients) {
        send(ws, { type: 'server_restarting' });
        try {
            ws.close(1012, 'server restart');
        } catch {
            /* already closing */
        }
    }
    for (const [roomId, room] of rooms) destroyRoom(roomId, room);

    wss.close(() => {
        httpServer.close(() => {
            console.log('Server shut down gracefully');
            process.exit(0);
        });
    });
    // Don't hang on sockets that never finish their close handshake.
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start ---

httpServer.listen(PORT, () => {
    // Log the bound port (not PORT) so tests can start on port 0.
    console.log(`Quiz WebSocket server listening on port ${httpServer.address().port}`);
});
