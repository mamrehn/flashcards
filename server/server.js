const { WebSocketServer } = require('ws');
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 8080;

// In-memory state: roomId -> room data
const rooms = new Map();

// --- Utility ---

/**
 *
 */
function generateRoomId() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const MAX_ATTEMPTS = 100;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let id = '';
        for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
        if (!rooms.has(id)) return id;
    }
    return null;
}

/**
 *
 */
function generateSessionId() {
    return 'sess-' + crypto.randomUUID();
}

/**
 *
 * @param name
 */
function sanitizeName(name) {
    if (typeof name !== 'string') return 'Spieler';
    // Whitelist: letters, digits, German umlauts, spaces, hyphens, underscores, dots
    return (
        name
            .replaceAll(/[^a-zA-Z0-9\u00E4\u00F6\u00FC\u00C4\u00D6\u00DC\u00DF\s\-_.]/g, '')
            .trim()
            .slice(0, 50) || 'Spieler'
    );
}

/**
 *
 * @param ws
 * @param data
 */
function send(ws, data) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

/**
 *
 * @param room
 * @param data
 */
function broadcastToPlayers(room, data) {
    const msg = JSON.stringify(data);
    for (const player of room.players.values()) {
        if (player.ws && player.ws.readyState === 1) {
            player.ws.send(msg);
        }
    }
}

/**
 *
 * @param room
 */
function getConnectedPlayerCount(room) {
    let count = 0;
    for (const p of room.players.values()) {
        if (p.isConnected) count++;
    }
    return count;
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
const RATE_LIMIT_PER_SECOND = 20;

const ROOM_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

const ALLOWED_ORIGINS = ['https://mamrehn.github.io', 'http://localhost', 'http://127.0.0.1'];

const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024, // 64KB max message
    perMessageDeflate: { clientNoContextTakeover: true },
});

httpServer.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin || '';
    const isAllowed = !origin || ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));

    if (!isAllowed) {
        console.warn(`Rejected WebSocket from origin: ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Rate limiting: track messages per second
    ws._msgCount = 0;
    ws._msgResetTimer = setInterval(() => {
        ws._msgCount = 0;
    }, 1000);

    ws.on('message', (raw) => {
        // Rate limit check
        if (++ws._msgCount > RATE_LIMIT_PER_SECOND) {
            send(ws, { type: 'error', message: 'Zu viele Nachrichten. Bitte warte einen Moment.' });
            if (ws._msgCount > RATE_LIMIT_PER_SECOND * 3) {
                clearInterval(ws._msgResetTimer);
                ws.terminate();
            }
            return;
        }

        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            send(ws, { type: 'error', message: 'Ungültiges Nachrichtenformat.' });
            return;
        }

        switch (msg.type) {
            case 'create_room': {
                handleCreateRoom(ws, msg);
                break;
            }
            case 'reconnect_host': {
                handleReconnectHost(ws, msg);
                break;
            }
            case 'restore_room': {
                handleRestoreRoom(ws, msg);
                break;
            }
            case 'join': {
                handleJoin(ws, msg);
                break;
            }
            case 'submit_answer': {
                handleSubmitAnswer(ws, msg);
                break;
            }
            case 'start_question': {
                handleStartQuestion(ws, msg);
                break;
            }
            case 'send_results': {
                handleSendResults(ws, msg);
                break;
            }
            case 'terminate': {
                handleTerminate(ws, msg);
                break;
            }
            default: {
                console.warn(`Unknown message type: ${msg.type}`);
                break;
            }
        }
    });

    ws.on('close', () => {
        clearInterval(ws._msgResetTimer);
        handleDisconnect(ws);
    });
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        clearInterval(ws._msgResetTimer);
    });
});

// --- Handlers ---

/**
 *
 * @param ws
 */
function handleCreateRoom(ws) {
    // Limit: one room per host connection
    if (ws._hasRoom) {
        send(ws, { type: 'error', message: 'Du hast bereits einen Raum erstellt.' });
        return;
    }

    const roomId = generateRoomId();
    if (!roomId) {
        send(ws, { type: 'error', message: 'Server überlastet. Bitte versuche es später erneut.' });
        return;
    }
    const hostSessionId = generateSessionId();

    const room = {
        hostWs: ws,
        hostSessionId: hostSessionId,
        players: new Map(),
        createdAt: Date.now(),
        hostDisconnectTimer: null,
        expiryTimer: null,
    };
    rooms.set(roomId, room);

    ws.roomId = roomId;
    ws.sessionId = hostSessionId;
    ws.role = 'host';

    ws._hasRoom = true;

    // Set per-room expiry timer
    room.expiryTimer = setTimeout(() => {
        broadcastToPlayers(room, { type: 'quiz_terminated' });
        if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
        rooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up (expired)`);
    }, ROOM_MAX_AGE_MS);

    send(ws, { type: 'room_created', roomId, sessionId: hostSessionId });
    console.log(`Room ${roomId} created by host ${hostSessionId}`);
}

/**
 *
 * @param ws
 * @param msg
 */
function handleReconnectHost(ws, msg) {
    const roomId = (msg.roomId || '').toUpperCase();
    const room = rooms.get(roomId);

    // If room not found but host sends a session ID, they might be able to restore it
    if (!room) {
        if (msg.sessionId) {
            send(ws, { type: 'room_not_found_try_restore', roomId, sessionId: msg.sessionId });
            console.log(
                `Host tried to reconnect to missing room ${roomId}, suggesting restoration`
            );
        } else {
            send(ws, { type: 'error', message: 'Raum nicht gefunden.' });
        }
        return;
    }

    if (room.hostSessionId !== msg.sessionId) {
        send(ws, { type: 'error', message: 'Ungültige Session-ID für diesen Raum.' });
        return;
    }

    // Clear disconnect timer if pending
    if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
    }

    room.hostWs = ws;
    ws.roomId = roomId;
    ws.sessionId = msg.sessionId;
    ws.role = 'host';

    // Send current room state back to host
    const playerList = [];
    for (const [sid, p] of room.players) {
        // Only send what's necessary
        playerList.push({
            sessionId: sid,
            name: p.name,
            score: p.score,
            isConnected: p.isConnected,
        });
    }

    send(ws, { type: 'host_reconnected', roomId, players: playerList });
    console.log(`Host reconnected to room ${roomId}`);
}

/**
 *
 * @param ws
 * @param msg
 */
function handleRestoreRoom(ws, msg) {
    // Rate limit: max once per 5 seconds per connection
    const now = Date.now();
    if (ws._lastRestore && now - ws._lastRestore < 5000) {
        send(ws, {
            type: 'error',
            message: 'Bitte warte einen Moment vor der nächsten Wiederherstellung.',
        });
        return;
    }
    ws._lastRestore = now;

    let roomId = (msg.roomId || '').toUpperCase();
    const hostSessionId = msg.sessionId;

    if (!roomId || !hostSessionId) {
        send(ws, { type: 'error', message: 'Wiederherstellung fehlgeschlagen: Fehlende Daten.' });
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
            send(ws, {
                type: 'error',
                message: 'Server überlastet. Bitte versuche es später erneut.',
            });
            return;
        }
    }

    // Re-create the room
    const room = {
        hostWs: ws,
        hostSessionId: hostSessionId,
        players: new Map(),
        createdAt: Date.now(),
        hostDisconnectTimer: null,
        expiryTimer: null,
    };

    // Restore players if provided (limit to MAX_PLAYERS_PER_ROOM)
    if (msg.players && Array.isArray(msg.players)) {
        const playersToRestore = msg.players.slice(0, MAX_PLAYERS_PER_ROOM);
        for (const p of playersToRestore) {
            // Validate player ID format
            if (typeof p.id === 'string' && p.id.startsWith('sess-') && p.name) {
                room.players.set(p.id, {
                    name: sanitizeName(p.name),
                    score:
                        typeof p.score === 'number' && isFinite(p.score) && p.score >= 0
                            ? p.score
                            : 0,
                    ws: null,
                    isConnected: false,
                });
            }
        }
    }

    rooms.set(roomId, room);

    ws.roomId = roomId;
    ws.sessionId = hostSessionId;
    ws.role = 'host';

    // Set per-room expiry timer
    room.expiryTimer = setTimeout(() => {
        broadcastToPlayers(room, { type: 'quiz_terminated' });
        if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
        rooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up (expired)`);
    }, ROOM_MAX_AGE_MS);

    // Send back sanitized player data from the server-built Map, not raw client input
    const playerList = [];
    for (const [sid, p] of room.players) {
        playerList.push({
            sessionId: sid,
            name: p.name,
            score: p.score,
            isConnected: p.isConnected,
        });
    }
    send(ws, { type: 'host_reconnected', roomId, players: playerList, isRestored: true });
    console.log(`Room ${roomId} RESTORED by host ${hostSessionId}`);
}

/**
 *
 * @param ws
 * @param msg
 */
function handleJoin(ws, msg) {
    const roomCode = (msg.roomCode || '').replaceAll(/\s/g, '').toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
        send(ws, { type: 'error', message: 'Raum nicht gefunden.' });
        return;
    }

    let sessionId = msg.sessionId;
    // Validate session ID format — ignore invalid ones
    if (sessionId && (typeof sessionId !== 'string' || !sessionId.startsWith('sess-'))) {
        sessionId = null;
    }
    let player = sessionId ? room.players.get(sessionId) : null;

    if (player) {
        // Reconnecting existing player
        player.ws = ws;
        player.isConnected = true;
        ws.sessionId = sessionId;
        ws.roomId = roomCode;
        ws.role = 'player';

        send(ws, {
            type: 'joined',
            sessionId,
            score: player.score,
            playerName: player.name,
            isReconnect: true,
        });

        if (room.hostWs && room.hostWs.readyState === 1) {
            send(room.hostWs, {
                type: 'player_reconnected',
                sessionId,
                name: player.name,
                score: player.score,
                playerCount: getConnectedPlayerCount(room),
            });
        }
        console.log(`Player "${player.name}" reconnected to room ${roomCode}`);
    } else {
        // Enforce max player limit
        if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
            send(ws, { type: 'error', message: 'Raum ist voll (max. 240 Spieler).' });
            return;
        }

        // New player
        sessionId = generateSessionId();
        const name = sanitizeName(msg.playerName);
        player = { name, score: 0, ws, isConnected: true };
        room.players.set(sessionId, player);

        ws.sessionId = sessionId;
        ws.roomId = roomCode;
        ws.role = 'player';

        send(ws, { type: 'joined', sessionId, score: 0, playerName: name, isReconnect: false });

        if (room.hostWs && room.hostWs.readyState === 1) {
            send(room.hostWs, {
                type: 'player_joined',
                sessionId,
                name,
                playerCount: getConnectedPlayerCount(room),
            });
        }
        console.log(
            `Player "${name}" joined room ${roomCode} (${getConnectedPlayerCount(room)} players)`
        );
    }
}

/**
 *
 * @param ws
 * @param msg
 */
function handleSubmitAnswer(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room) {
        send(ws, { type: 'error', message: 'Raum nicht mehr aktiv.' });
        return;
    }

    const player = room.players.get(ws.sessionId);
    if (!player) {
        send(ws, { type: 'error', message: 'Spieler nicht gefunden.' });
        return;
    }

    // Validate answerData: must be an array of at most 20 indices
    if (!Array.isArray(msg.answerData) || msg.answerData.length > 20) return;

    if (room.hostWs && room.hostWs.readyState === 1) {
        // Compute elapsed time on server for fair scoring
        const serverNow = Date.now();
        const elapsedMs = room.questionStartTime ? serverNow - room.questionStartTime : null;

        send(room.hostWs, {
            type: 'player_answered',
            sessionId: ws.sessionId,
            name: player.name,
            answerData: msg.answerData,
            answerTime: serverNow,
            elapsedMs: elapsedMs,
        });
    }
}

/**
 *
 * @param ws
 * @param msg
 */
function handleStartQuestion(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.sessionId !== room.hostSessionId) return;

    // Validate question and options content size
    if (typeof msg.question !== 'string' || msg.question.length > 4000) return;
    if (!Array.isArray(msg.options) || msg.options.length > 20) return;
    if (msg.options.some((o) => typeof o !== 'string' || o.length > 500)) return;

    // Validate relay fields
    const questionIndex =
        typeof msg.index === 'number' && msg.index >= 0 ? Math.min(msg.index, 10_000) : 0;
    const questionTotal =
        typeof msg.total === 'number' && msg.total > 0 ? Math.min(msg.total, 10_000) : 1;
    const duration =
        typeof msg.duration === 'number' && msg.duration > 0 && msg.duration <= 80
            ? msg.duration
            : 30;

    // Record server-side question start time for fair timing
    room.questionStartTime = Date.now();
    room.currentQuestionIndex = questionIndex;

    // Relay to all players, using server timestamp
    broadcastToPlayers(room, {
        type: 'question',
        question: msg.question,
        options: msg.options,
        index: questionIndex,
        total: questionTotal,
        startTime: room.questionStartTime,
        duration: duration,
    });
}

/**
 *
 * @param ws
 * @param msg
 */
function handleSendResults(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.sessionId !== room.hostSessionId) return;

    // Update stored scores from host (with validation)
    if (msg.playerScores) {
        for (const [sid, score] of Object.entries(msg.playerScores)) {
            const player = room.players.get(sid);
            if (player && typeof score === 'number' && isFinite(score) && score >= 0) {
                player.score = score;
            }
        }
    }

    // Validate leaderboard structure if present
    let leaderboard = null;
    if (Array.isArray(msg.leaderboard)) {
        leaderboard = msg.leaderboard.slice(0, MAX_PLAYERS_PER_ROOM).map((entry) => ({
            name: typeof entry.name === 'string' ? entry.name.slice(0, 50) : 'Spieler',
            score: typeof entry.score === 'number' && isFinite(entry.score) ? entry.score : 0,
        }));
    }

    // Send personalized results to each player
    for (const player of room.players.values()) {
        if (player.ws && player.ws.readyState === 1) {
            send(player.ws, {
                type: 'result',
                correct: msg.correct,
                isFinal: msg.isFinal,
                questionIndex: room.currentQuestionIndex,
                leaderboard: leaderboard,
                playerScore: player.score,
            });
        }
    }
}

/**
 *
 * @param ws
 */
function handleTerminate(ws) {
    const room = rooms.get(ws.roomId);
    if (!room || ws.sessionId !== room.hostSessionId) return;

    broadcastToPlayers(room, { type: 'quiz_terminated' });
    if (room.expiryTimer) clearTimeout(room.expiryTimer);
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    rooms.delete(ws.roomId);
    console.log(`Room ${ws.roomId} terminated by host`);
}

/**
 *
 * @param ws
 */
function handleDisconnect(ws) {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (!room) return;

    if (ws.role === 'host') {
        room.hostWs = null;
        console.log(`Host disconnected from room ${ws.roomId}, grace period started`);

        // Grace period: terminate room if host doesn't reconnect within 5 minutes
        const disconnectedRoomId = ws.roomId;
        room.hostDisconnectTimer = setTimeout(
            () => {
                // Verify room still exists in Map and host is still disconnected
                if (!room.hostWs && rooms.get(disconnectedRoomId) === room) {
                    broadcastToPlayers(room, { type: 'quiz_terminated' });
                    if (room.expiryTimer) clearTimeout(room.expiryTimer);
                    rooms.delete(disconnectedRoomId);
                    console.log(`Room ${disconnectedRoomId} terminated (host timeout)`);
                }
            },
            5 * 60 * 1000
        );
    } else if (ws.role === 'player') {
        const player = room.players.get(ws.sessionId);
        if (player) {
            player.isConnected = false;
            player.ws = null;

            if (room.hostWs && room.hostWs.readyState === 1) {
                send(room.hostWs, {
                    type: 'player_left',
                    sessionId: ws.sessionId,
                    name: player.name,
                    playerCount: getConnectedPlayerCount(room),
                });
            }
            console.log(`Player "${player.name}" disconnected from room ${ws.roomId}`);
        }
    }
}

// --- Heartbeat: detect dead connections ---

const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive)  { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
    }
}, 30_000);

// Room cleanup is now handled per-room via expiryTimer (set on creation/restore)

// --- Graceful shutdown ---

process.on('SIGTERM', () => {
    console.log('SIGTERM received, notifying all rooms...');
    // Notify all players before shutting down
    for (const [, room] of rooms) {
        broadcastToPlayers(room, { type: 'quiz_terminated' });
        if (room.hostWs && room.hostWs.readyState === 1) {
            send(room.hostWs, { type: 'quiz_terminated' });
        }
        if (room.expiryTimer) clearTimeout(room.expiryTimer);
        if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    }
    rooms.clear();

    clearInterval(heartbeatInterval);
    wss.close(() => {
        httpServer.close(() => {
            console.log('Server shut down gracefully');
            process.exit(0);
        });
    });
});

// --- Start ---

httpServer.listen(PORT, () => {
    console.log(`Quiz WebSocket server listening on port ${PORT}`);
});
