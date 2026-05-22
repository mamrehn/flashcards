/**
 * Standalone live polling app.
 *
 * Lives next to quiz.js but never imports from it. Uses the same WebSocket
 * server protocol (create_room / join / start_question / submit_answer /
 * send_results / terminate) so the server stays untouched. Poll-specific
 * metadata that the server's whitelist would otherwise drop (picksPerVoter,
 * revealCount, source) is smuggled as the first element of `options` — a
 * sentinel string `__POLL_META__:{...}` that players strip before display.
 *
 * Two poll variants share one flow:
 *   - source: "players" — options are current room players' names (snapshotted
 *     at vote-start). For Klassensprecher elections, party feedback polls.
 *   - source: "fixed"   — options are host-typed strings. For surveys,
 *     excursion-location votes, etc.
 *
 * Both use ranked Borda aggregation. No points awarded. Top-`revealCount`
 * podium reveal (scales from 3-slot up to a full ranked list).
 */

/* ============================================================================
 * WebSocket URL — same convention as quiz.js (build-time placeholder,
 * runtime override, production fallback).
 * ============================================================================ */
const RAW_URL = '__WS_URL__';
const FALLBACK_WS_URL = RAW_URL === '__WS_URL__' ? 'wss://qlash-server.fly.dev' : RAW_URL;
const HAS_RUNTIME_WS_URL =
    globalThis.window !== undefined && globalThis.WS_URL && globalThis.WS_URL !== '__WS_URL__';
const WS_URL = HAS_RUNTIME_WS_URL ? globalThis.WS_URL : FALLBACK_WS_URL;

/* ============================================================================
 * Constants
 * ============================================================================ */
// First options[] slot carries this prefixed JSON; server's per-option 500-char
// validation gives us plenty of headroom for {picksPerVoter, revealCount, source}.
const POLL_META_PREFIX = '__POLL_META__:';
// Server caps options.length at 20. Slot 0 is metadata, so 19 real options max.
const MAX_REAL_OPTIONS = 19;
const MAX_PICKS_PER_VOTER = 20;
const MIN_DURATION_SEC = 5;
const MAX_DURATION_SEC = 80;
const SESSION_STORAGE_KEY = 'poll_active_session';
const PICKS_STORAGE_KEY = 'poll_last_picks';
const MAX_RECONNECT_ATTEMPTS = 30;
// Application-level keepalive interval (ms). The server pings every 30 s at the
// WebSocket protocol level and the browser auto-pongs, but some intermediate
// proxies (carrier NAT, corporate firewalls) only see app-layer frames as
// "activity" and drop the TCP socket after ~60 s of silence. We send a small
// JSON frame every 25 s to keep the path warm. The payload must parse as JSON
// (or the server replies with an "Ungültiges Nachrichtenformat" error toast);
// using an unknown `type` makes the server's switch fall through to its
// default branch, which just console.warns and otherwise no-ops.
const KEEPALIVE_INTERVAL_MS = 25_000;
const KEEPALIVE_PAYLOAD = JSON.stringify({ type: 'poll_keepalive' });

/* ============================================================================
 * Tiny helpers
 * ============================================================================ */

/**
 * Toast notification. Same visual pattern as quiz.js so the two apps feel
 * kindred; duplicated here per the no-touch-quiz directive.
 * @param {string} message
 * @param {'info'|'error'} [type]
 */
function showMessage(message, type = 'info') {
    const existing = document.querySelector('#toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.append(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 4000);
}

/**
 * Show a top-level view (role-selection / host-view / player-view) and hide
 * the others. View IDs match the markup in poll.html.
 * @param {string} id
 */
function showTopView(id) {
    for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
    const el = document.querySelector(`#${CSS.escape(id)}`);
    if (el) el.classList.add('active');
}

/**
 * Within host-view or player-view, show one sub-section and hide its siblings.
 * @param {string[]} allIds
 * @param {string} showId
 */
function showOnly(allIds, showId) {
    for (const id of allIds) {
        const el = document.querySelector(`#${CSS.escape(id)}`);
        if (!el) continue;
        el.classList.toggle('hidden', id !== showId);
    }
}

/**
 * WebSocket connect with retry — mirrors quiz.js's connectWithRetry to handle
 * Fly.io cold starts.
 * @param {string} url
 * @param {number} [maxRetries]
 * @returns {Promise<WebSocket>}
 */
function connectWithRetry(url, maxRetries = 3) {
    return new Promise((resolve, reject) => {
        let attempt = 0;
        function tryConnect() {
            attempt++;
            const ws = new WebSocket(url);
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                ws.close();
                if (attempt < maxRetries) {
                    setTimeout(tryConnect, 2000 * attempt);
                } else {
                    reject(new Error('WebSocket connection failed after retries'));
                }
            }, 10_000);
            ws.addEventListener('open', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(ws);
            });
            ws.addEventListener('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (attempt < maxRetries) {
                    setTimeout(tryConnect, 2000 * attempt);
                } else {
                    reject(new Error('WebSocket connection failed after retries'));
                }
            });
        }
        tryConnect();
    });
}

/**
 * 1 s → 2 s → 4 s → 10 s steady — same backoff as quiz.js.
 * @param {number} attempt
 * @returns {number}
 */
function reconnectBackoffMs(attempt) {
    if (attempt <= 1) return 1000;
    if (attempt === 2) return 2000;
    if (attempt === 3) return 4000;
    return 10_000;
}

/**
 * Start a keepalive interval that fires `KEEPALIVE_PAYLOAD` over the given WS
 * every `KEEPALIVE_INTERVAL_MS`. The payload is non-JSON so the server's
 * JSON.parse fails silently and no business logic runs. Returns the interval
 * id so the caller can cancel it on close.
 * @param {WebSocket} ws
 * @returns {number}
 */
function startKeepalive(ws) {
    return setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(KEEPALIVE_PAYLOAD);
        } catch (error) {
            logger.error('Keepalive send failed:', error);
        }
    }, KEEPALIVE_INTERVAL_MS);
}

/**
 * @param {number|null} id
 * @returns {null}
 */
function stopKeepalive(id) {
    if (id !== null) clearInterval(id);
    return null;
}

/**
 * Session save/load/clear so a page reload mid-poll can re-attach without
 * re-entering a code.
 * @param role
 * @param roomId
 * @param sessionId
 * @param extra
 */
function saveActiveSession(role, roomId, sessionId, extra = {}) {
    try {
        sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            JSON.stringify({ role, roomId, sessionId, ...extra })
        );
    } catch {
        /* private mode */
    }
}
function loadActiveSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.role || !parsed.roomId || !parsed.sessionId) return null;
        return parsed;
    } catch {
        return null;
    }
}
function clearActiveSession() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
        /* private mode */
    }
}

/**
 * Last-submitted picks: keep them across reconnect so the player can still
 * see their own ballot on the reveal even if they were disconnected when the
 * server replayed `alreadySubmitted: true`.
 * @param roomId
 * @param questionKey
 * @param picks
 */
function saveLastPicks(roomId, questionKey, picks) {
    try {
        sessionStorage.setItem(
            PICKS_STORAGE_KEY,
            JSON.stringify({ roomId, questionKey, picks })
        );
    } catch {
        /* private mode */
    }
}
function loadLastPicks(roomId, questionKey) {
    try {
        const raw = sessionStorage.getItem(PICKS_STORAGE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p && p.roomId === roomId && p.questionKey === questionKey) return p.picks;
        return null;
    } catch {
        return null;
    }
}
function clearLastPicks() {
    try {
        sessionStorage.removeItem(PICKS_STORAGE_KEY);
    } catch {
        /* private mode */
    }
}

/* ============================================================================
 * Metadata encoding
 *
 * options[0] = '__POLL_META__:' + JSON.stringify({picksPerVoter, revealCount,
 * source}); options[1..N] are the displayable choices. Players strip slot 0
 * before rendering; their submitted indices refer to slot positions in the
 * full options array (so a "first real option" submission is index 1, not 0).
 * The host computes Borda over those same indices.
 * ============================================================================ */

/**
 * @param {{picksPerVoter:number, revealCount:number|'all', source:'players'|'fixed'}} meta
 * @returns {string}
 */
function encodeMeta(meta) {
    return POLL_META_PREFIX + JSON.stringify(meta);
}

/**
 * @param {string} optionZero
 * @returns {{picksPerVoter:number, revealCount:number|'all', source:string}|null}
 */
function decodeMeta(optionZero) {
    if (typeof optionZero !== 'string' || !optionZero.startsWith(POLL_META_PREFIX)) {
        return null;
    }
    try {
        const obj = JSON.parse(optionZero.slice(POLL_META_PREFIX.length));
        if (!obj || typeof obj !== 'object') return null;
        const picks = Number(obj.picksPerVoter);
        const reveal = obj.revealCount === 'all' ? 'all' : Number(obj.revealCount);
        const source = obj.source === 'fixed' ? 'fixed' : 'players';
        if (!Number.isFinite(picks) || picks < 1) return null;
        if (reveal !== 'all' && (!Number.isFinite(reveal) || reveal < 1)) return null;
        return { picksPerVoter: picks, revealCount: reveal, source };
    } catch {
        return null;
    }
}

/* ============================================================================
 * Shared module state
 * ============================================================================ */

// Host state
let hostWs = null;
let hostRoomId = null;
let hostSessionId = null;
let hostWsReconnectAttempts = 0;
let hostSuppressReconnect = false;
let hostKeepaliveInterval = null;
// players keyed by sessionId; value: { name, isConnected }
const hostPlayers = new Map();
// During an active poll: snapshot of the broadcast question payload + answers.
let hostActivePoll = null; // {question, options, picksPerVoter, revealCount, source, duration}
// Guard so endVote() can be triggered from multiple sources (timer, auto-end,
// host click) without re-sending results.
let hostPollEnding = false;
const hostAnswers = new Map(); // sessionId -> {ranks: number[], name}
let hostTimerInterval = null;
// Pending question to send once a fresh hostWs is open after a transient drop.
let hostPendingQuestion = null;

// Player state
let playerWs = null;
let playerRoomCode = null;
let playerSessionId = null;
let playerName = null;
let playerWsReconnectAttempts = 0;
let playerSuppressReconnect = false;
let playerKeepaliveInterval = null;
let playerCurrentMeta = null;
let playerDisplayOptions = []; // options[1..N] (sliced)
let playerOptionIndexBase = 1; // index of the first displayable option in raw options
let playerCurrentQuestion = ''; // raw question text
let playerSelectedRanks = []; // indices into raw options
let playerHasSubmitted = false;
let playerTimerInterval = null;
let playerCurrentQuestionKey = ''; // stable identifier for "this question"

// Composer state for fixed source
const composerFixedOptions = ['', ''];

// Built-in question suggestions for the host — class-rep-style "Wer …" awards.
// All are source: "players" polls (voting for someone in the room). The host
// can always type their own question instead; suggestions are unobtrusive.
const POLL_SUGGESTIONS = [
    { title: 'Mebis-Sherpa',                       question: 'Mebis-Sherpa: Wer hat die eigene Gruppe durch die tiefsten Mebis-Kapitel gecarried und alle mit Lösungen versorgt?' },
    { title: 'Koffein-Reaktor',                    question: 'Koffein-Reaktor: Wer besteht nach drei Jahren eigentlich zu 80 % aus Energydrinks und Mate statt aus Wasser?' },
    { title: 'Linux-Prediger*in',                  question: 'Linux-Prediger*in: Wer lässt keine Gelegenheit aus zu betonen, dass Windows Müll ist und Arch das einzig Wahre ist? (I use Arch, btw)' },
    { title: 'Git-Poet*in',                        question: 'Git-Poet*in: Wer schreibt die wildesten Commit-Messages? (z. B. "update", "fix", "asdasd", "jetzt gehts")' },
    { title: 'Stealth-Gamer*in',                   question: 'Stealth-Gamer*in: Wer hat im Unterricht völlig unbemerkt hunderte Stunden in Games versenkt?' },
    { title: 'Zukünftige*r Start-up-Milliardär*in', question: 'Zukünftige*r Start-up-Milliardär*in: Wer gründet als Erstes ein Start-up für ein überkomplexes Gadget, das absolut niemand braucht?' },
    { title: 'Chief Hydration Officer (CHO)',      question: 'Chief Hydration Officer (CHO): Wer hat heldenhaft die Klasse am Wasserspender versorgt und vor dem Dehydrieren bewahrt?' },
    { title: 'ChatGPT-Magier*in',                  question: 'ChatGPT-Magier*in: Wer hat die gesamte schulische Existenz aus perfekten Prompts zusammengeklebt – und es hat funktioniert?' },
    { title: 'Bullshit-Bingo-Legende',             question: 'Bullshit-Bingo-Legende: Schlecht gelernt, perfekt verkauft: Wer referiert souverän über Themen, die erst 5 Minuten vorher gegoogelt wurden?' },
    { title: 'Heimliche*r 1st-Level-Support',      question: 'Heimliche*r 1st-Level-Support: Wer ist die unfreiwillige Dauer-Hotline für die ByCS- und WLAN-Probleme der kompletten Klasse?' },
    { title: 'Berichtsheft-Pedant*in',             question: 'Berichtsheft-Pedant*in: Wer führt das Berichtsheft wie ein Git-Repo – mit fix:-Einträgen und einem Branch pro Quartal?' },
    { title: 'IHK-Stoiker*in',                     question: 'IHK-Stoiker*in: Wer hat in der Abschlussprüfung eiskalt vier Sekunden vor Abgabe das letzte Kreuz gesetzt?' },
    { title: 'Hardware-Jünger*in',                 question: 'Hardware-Jünger*in: Wer investiert das allererste richtige Gehalt sofort in eine RTX 5090?' },
    { title: 'Meme-Beauftragte*r',                 question: 'Meme-Beauftragte*r: Wer postet im Klassenchat deutlich mehr Memes und :wq-Jokes als ernsthafte Nachrichten?' },
    { title: 'Open-Source-Philanthrop*in',         question: 'Open-Source-Philanthrop*in: Wer hat während des Unterrichts heimlich Bug-Bounties gesammelt oder Pull Requests eingereicht?' },
];

// Indices already used in this session (consumed when the host actually starts
// a vote with the suggested question). Suggestions are picked at random from
// the unused set so each appears at most once until the session ends.
const usedSuggestionIndices = new Set();
let currentSuggestionIdx = null;

/* ============================================================================
 * DOM references — populated on DOMContentLoaded.
 * ============================================================================ */

let dom = {};

/**
 *
 */
function collectDom() {
    dom = {
        roleSelection: document.querySelector('#role-selection'),
        hostBtn: document.querySelector('#host-btn'),
        playerBtn: document.querySelector('#player-btn'),
        reconnectHostBtn: document.querySelector('#reconnect-host-btn'),
        reconnectPlayerBtn: document.querySelector('#reconnect-player-btn'),

        hostView: document.querySelector('#host-view'),
        hostLobby: document.querySelector('#host-lobby'),
        hostComposer: document.querySelector('#host-composer'),
        hostVoting: document.querySelector('#host-voting'),
        hostReveal: document.querySelector('#host-reveal'),

        playerView: document.querySelector('#player-view'),
        joinForm: document.querySelector('#join-form'),
        playerWaiting: document.querySelector('#player-waiting'),
        playerVote: document.querySelector('#player-vote'),
        playerSubmitted: document.querySelector('#player-submitted'),
        playerReveal: document.querySelector('#player-reveal'),

        // Lobby
        qrcodeEl: document.querySelector('#qrcode'),
        joinLink: document.querySelector('#join-link'),
        roomIdEl: document.querySelector('#room-id'),
        playerCountEl: document.querySelector('#player-count'),
        playersListEl: document.querySelector('#players-list'),
        showComposerBtn: document.querySelector('#show-composer-btn'),

        // Composer
        composerQuestion: document.querySelector('#composer-question'),
        suggestionBox: document.querySelector('#suggestion-box'),
        suggestionTitle: document.querySelector('#suggestion-title'),
        suggestionText: document.querySelector('#suggestion-text'),
        applySuggestionBtn: document.querySelector('#apply-suggestion-btn'),
        cycleSuggestionBtn: document.querySelector('#cycle-suggestion-btn'),
        sourceRadios: document.querySelectorAll('input[name="poll-source"]'),
        fixedOptionsSection: document.querySelector('#fixed-options-section'),
        composerOptionsList: document.querySelector('#composer-options'),
        addOptionBtn: document.querySelector('#add-option-btn'),
        composerPicks: document.querySelector('#composer-picks'),
        composerReveal: document.querySelector('#composer-reveal'),
        composerRevealAll: document.querySelector('#composer-reveal-all'),
        composerDuration: document.querySelector('#composer-duration'),
        startVoteBtn: document.querySelector('#start-vote-btn'),
        backToLobbyBtn: document.querySelector('#back-to-lobby-btn'),

        // Voting (host)
        hostQuestionDisplay: document.querySelector('#host-question-display'),
        hostTimerBar: document.querySelector('#host-timer-bar'),
        hostAnswersCount: document.querySelector('#host-answers-count'),
        hostTotalPlayers: document.querySelector('#host-total-players'),
        hostLiveOptions: document.querySelector('#host-live-options'),
        endVoteBtn: document.querySelector('#end-vote-btn'),

        // Reveal (host)
        hostRevealQuestion: document.querySelector('#host-reveal-question'),
        hostPodiumList: document.querySelector('#host-podium-list'),
        hostRevealMeta: document.querySelector('#host-reveal-meta'),
        nextQuestionBtn: document.querySelector('#next-question-btn'),
        endSessionBtn: document.querySelector('#end-session-btn'),

        // Player
        roomCodeInput: document.querySelector('#room-code-input'),
        playerNameInput: document.querySelector('#player-name-input'),
        joinBtn: document.querySelector('#join-btn'),
        playerWaitingStatus: document.querySelector('#player-waiting-status'),
        playerNameDisplay: document.querySelector('#player-name-display'),
        playerQuestionText: document.querySelector('#player-question-text'),
        playerTimerBar: document.querySelector('#player-timer-bar'),
        playerVoteHint: document.querySelector('#player-vote-hint'),
        rankList: document.querySelector('#rank-list'),
        rankListEmpty: document.querySelector('#rank-list-empty'),
        rankOptions: document.querySelector('#rank-options'),
        submitVoteBtn: document.querySelector('#submit-vote-btn'),
        submittedPicksEcho: document.querySelector('#submitted-picks-echo'),
        playerRevealQuestion: document.querySelector('#player-reveal-question'),
        playerPodiumList: document.querySelector('#player-podium-list'),
        playerPicksEcho: document.querySelector('#player-picks-echo'),
        playerRevealStatus: document.querySelector('#player-reveal-status'),

        // QR modal
        qrModalOverlay: document.querySelector('#qr-modal-overlay'),
        qrModalClose: document.querySelector('#qr-modal-close'),
        largeQrcode: document.querySelector('#large-qrcode'),
        joinLinkModal: document.querySelector('#join-link-modal'),
        modalRoomIdSpan: document.querySelector('#modal-room-id'),
    };
}

/* ============================================================================
 * QR code rendering
 * ============================================================================ */

/**
 * @param {string} roomId
 * @returns {string}
 */
function buildJoinUrl(roomId) {
    const loc = globalThis.location;
    const base = `${loc.protocol}//${loc.host}${loc.pathname}`;
    return `${base}?room=${encodeURIComponent(roomId)}`;
}

/**
 * @param {string} url
 */
function renderQrCode(url) {
    if (!dom.qrcodeEl) return;
    dom.qrcodeEl.innerHTML = '';
    if (typeof QRCode === 'undefined') return;
    try {
        new QRCode(dom.qrcodeEl, {
            text: url,
            width: 180,
            height: 180,
            correctLevel: QRCode.CorrectLevel.H,
        });
    } catch (error) {
        logger.error('QR generation failed:', error);
    }
}

/**
 * @param {string} url
 */
function renderLargeQrCode(url) {
    if (!dom.largeQrcode) return;
    dom.largeQrcode.innerHTML = '';
    if (typeof QRCode === 'undefined') return;
    try {
        new QRCode(dom.largeQrcode, {
            text: url,
            width: 360,
            height: 360,
            correctLevel: QRCode.CorrectLevel.H,
        });
    } catch (error) {
        logger.error('QR generation failed:', error);
    }
}

/* ============================================================================
 * Host: lifecycle
 * ============================================================================ */

/**
 * Open a fresh room. Called when user clicks "Umfrage hosten".
 */
async function initHost() {
    showTopView('host-view');
    showOnly(['host-lobby', 'host-composer', 'host-voting', 'host-reveal'], 'host-lobby');

    hostWsReconnectAttempts = 0;
    hostSuppressReconnect = false;

    try {
        hostWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar. Bitte versuche es später erneut.', 'error');
        return;
    }

    attachHostWsHandlers(hostWs);
    hostWs.send(JSON.stringify({ type: 'create_room' }));
}

/**
 * Re-attach a previous host session after a page reload.
 * @param {{roomId:string, sessionId:string}} info
 */
async function initHostReconnect(info) {
    hostRoomId = info.roomId;
    hostSessionId = info.sessionId;
    showTopView('host-view');
    showOnly(['host-lobby', 'host-composer', 'host-voting', 'host-reveal'], 'host-lobby');

    hostWsReconnectAttempts = 0;
    hostSuppressReconnect = false;

    try {
        hostWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar. Bitte versuche es später erneut.', 'error');
        clearActiveSession();
        hostRoomId = null;
        hostSessionId = null;
        showTopView('role-selection');
        return;
    }

    attachHostWsHandlers(hostWs);
    hostWs.send(
        JSON.stringify({ type: 'reconnect_host', roomId: hostRoomId, sessionId: hostSessionId })
    );
}

/**
 * @param {WebSocket} ws
 */
function attachHostWsHandlers(ws) {
    ws.addEventListener('message', (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return;
        }
        handleHostMessage(msg);
    });

    hostKeepaliveInterval = stopKeepalive(hostKeepaliveInterval);
    hostKeepaliveInterval = startKeepalive(ws);

    ws.addEventListener('close', () => {
        logger.log('Host WS closed');
        hostKeepaliveInterval = stopKeepalive(hostKeepaliveInterval);
        if (hostSuppressReconnect) return;
        if (hostRoomId && hostWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            hostWsReconnectAttempts++;
            const delay = reconnectBackoffMs(hostWsReconnectAttempts);
            showMessage(
                `Verbindung unterbrochen. Reconnect ${hostWsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}…`,
                'info'
            );
            setTimeout(reconnectHostWs, delay);
        } else if (hostWsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
        }
    });

    ws.addEventListener('error', (err) => {
        logger.error('Host WS error:', err);
    });
}

/**
 *
 */
async function reconnectHostWs() {
    if (!hostRoomId || !hostSessionId) return;
    try {
        hostWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar.', 'error');
        return;
    }
    attachHostWsHandlers(hostWs);
    hostWs.send(
        JSON.stringify({ type: 'reconnect_host', roomId: hostRoomId, sessionId: hostSessionId })
    );
    // Resend any pending question that wasn't acknowledged across the gap.
    if (hostPendingQuestion) {
        hostWs.send(JSON.stringify(hostPendingQuestion));
        hostPendingQuestion = null;
    }
}

/**
 * @param {object} msg
 */
function handleHostPlayerUpdate(msg) {
    switch (msg.type) {
    case 'player_joined': {
        hostPlayers.set(msg.sessionId, { name: msg.name, isConnected: true });
    
    break;
    }
    case 'player_reconnected': {
        const existing = hostPlayers.get(msg.sessionId);
        if (existing) {
            existing.isConnected = true;
            existing.name = msg.name || existing.name;
        } else {
            hostPlayers.set(msg.sessionId, { name: msg.name, isConnected: true });
        }
    
    break;
    }
    case 'player_left': {
        const existing = hostPlayers.get(msg.sessionId);
        if (existing) existing.isConnected = false;

    break;
    }
    // No default
    }
    refreshPlayersUI();
    // Voting view: the count denominator changes too; refresh and check if
    // the disconnect left the remaining connected players all-voted.
    if (hostActivePoll) {
        refreshHostVotingProgress();
        maybeAutoEndVote();
    }
}

/**
 * @param {object} msg
 */
function handleHostAnswer(msg) {
    if (!hostActivePoll) return;
    if (!Array.isArray(msg.answerData)) return;
    hostAnswers.set(msg.sessionId, {
        ranks: [...msg.answerData],
        name: msg.name || (hostPlayers.get(msg.sessionId) || {}).name || 'Spieler',
    });
    refreshHostVotingProgress();
    maybeAutoEndVote();
}

/**
 * Auto-end the vote when every currently-connected player has submitted —
 * there's nothing more to wait for. Idempotent: the hostPollEnding guard
 * prevents double-firing across this, the timer setTimeout, and a manual
 * "Umfrage jetzt beenden" click.
 */
function maybeAutoEndVote() {
    if (!hostActivePoll || hostPollEnding) return;
    const connectedIds = [];
    for (const [sid, p] of hostPlayers.entries()) {
        if (p.isConnected) connectedIds.push(sid);
    }
    if (connectedIds.length === 0) return;
    const allVoted = connectedIds.every((sid) => hostAnswers.has(sid));
    if (!allVoted) return;
    endVote();
}

const HOST_PLAYER_UPDATE_TYPES = new Set([
    'player_joined',
    'player_reconnected',
    'player_left',
]);

/**
 * Host-side message dispatcher.
 * @param {object} msg
 */
function handleHostMessage(msg) {
    if (HOST_PLAYER_UPDATE_TYPES.has(msg.type)) {
        handleHostPlayerUpdate(msg);
        return;
    }
    switch (msg.type) {
        case 'room_created': {
            hostRoomId = msg.roomId;
            hostSessionId = msg.sessionId;
            saveActiveSession('host', hostRoomId, hostSessionId);
            renderHostLobby();
            break;
        }
        case 'host_reconnected': {
            renderHostLobby();
            break;
        }
        case 'room_not_found_try_restore': {
            // Poll sessions are short-lived; we don't attempt full restoration.
            showMessage('Der Raum ist abgelaufen. Bitte starte eine neue Umfrage.', 'error');
            clearActiveSession();
            hostRoomId = null;
            hostSessionId = null;
            showTopView('role-selection');
            break;
        }
        case 'player_answered': {
            handleHostAnswer(msg);
            break;
        }
        case 'quiz_terminated': {
            showMessage('Sitzung wurde beendet.', 'info');
            hardResetHost();
            break;
        }
        case 'error': {
            showMessage(msg.message || 'Unbekannter Fehler', 'error');
            break;
        }
        // player_avatar / music / categories — irrelevant for poll, ignored.
        default: {
            break;
        }
    }
}

/**
 *
 */
function renderHostLobby() {
    const displayCode = hostRoomId.slice(0, 2) + ' ' + hostRoomId.slice(2, 4);
    dom.roomIdEl.textContent = displayCode;
    if (dom.modalRoomIdSpan) dom.modalRoomIdSpan.textContent = displayCode;
    const url = buildJoinUrl(hostRoomId);
    const shortUrl = 'bycs.link/wer-hat';
    dom.joinLink.textContent = shortUrl;
    dom.joinLink.href = url;
    if (dom.joinLinkModal) {
        dom.joinLinkModal.textContent = shortUrl;
        dom.joinLinkModal.href = url;
    }
    renderQrCode(url);
    renderLargeQrCode(url);
    refreshPlayersUI();
}

/**
 *
 */
function refreshPlayersUI() {
    const connected = [...hostPlayers.values()].filter((p) => p.isConnected);
    dom.playerCountEl.textContent = String(connected.length);

    dom.playersListEl.innerHTML = '';
    for (const [, p] of hostPlayers) {
        const chip = document.createElement('span');
        chip.className = 'player-chip' + (p.isConnected ? '' : ' disconnected');
        chip.textContent = p.name;
        dom.playersListEl.append(chip);
    }
}

/* ============================================================================
 * Host: composer (live-typed questions)
 * ============================================================================ */

/**
 * Switch from the lobby into the question composer.
 */
function openComposer() {
    showOnly(
        ['host-lobby', 'host-composer', 'host-voting', 'host-reveal'],
        'host-composer'
    );
    // Default to player-source on a fresh composer (typical use case is voting
    // on people in the room); preserve choice on subsequent openings.
    renderComposerOptionsList();
    updateFixedSectionVisibility();
    if (currentSuggestionIdx === null) pickNextSuggestion();
    renderSuggestionBox();
    dom.composerQuestion.focus();
}

/**
 * Pick a random unused suggestion. Sets currentSuggestionIdx to null if no
 * suggestions remain. When `excludeCurrent` is true, the currently-shown
 * suggestion is also excluded so the "another suggestion" button actually
 * cycles to a different one (rather than possibly re-rolling the same).
 * @param {boolean} [excludeCurrent]
 */
function pickNextSuggestion(excludeCurrent = false) {
    const candidates = [];
    for (let i = 0; i < POLL_SUGGESTIONS.length; i++) {
        if (usedSuggestionIndices.has(i)) continue;
        if (excludeCurrent && i === currentSuggestionIdx) continue;
        candidates.push(i);
    }
    if (candidates.length === 0) {
        // Fall back to the current one if cycling found no alternatives —
        // beats clearing the box mid-session.
        if (!excludeCurrent || currentSuggestionIdx === null) {
            currentSuggestionIdx = null;
        }
        return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    currentSuggestionIdx = pick;
}

/**
 * Render the suggestion box. Hidden entirely when no unused suggestions
 * remain — the host can still type a custom question, but nothing nags them.
 */
function renderSuggestionBox() {
    if (!dom.suggestionBox) return;
    if (currentSuggestionIdx === null) {
        dom.suggestionBox.classList.add('hidden');
        return;
    }
    const s = POLL_SUGGESTIONS[currentSuggestionIdx];
    dom.suggestionBox.classList.remove('hidden');
    dom.suggestionTitle.textContent = s.title;
    dom.suggestionText.textContent = s.question;
}

/**
 * Fill the composer with the currently-shown suggestion. Always sets
 * source=players because every built-in suggestion is a "Wer …" question.
 */
function applyCurrentSuggestion() {
    if (currentSuggestionIdx === null) return;
    const s = POLL_SUGGESTIONS[currentSuggestionIdx];
    dom.composerQuestion.value = s.question;
    for (const r of dom.sourceRadios) {
        r.checked = r.value === 'players';
    }
    updateFixedSectionVisibility();
    dom.composerQuestion.focus();
}

/**
 * Roll to a different unused suggestion. No-op when only one is left.
 */
function cycleSuggestion() {
    pickNextSuggestion(true);
    renderSuggestionBox();
}

/**
 *
 */
function updateFixedSectionVisibility() {
    const sourceVal = currentSourceValue();
    dom.fixedOptionsSection.classList.toggle('hidden', sourceVal !== 'fixed');
}

/**
 * @returns {'players'|'fixed'}
 */
function currentSourceValue() {
    for (const r of dom.sourceRadios) {
        if (r.checked) return r.value === 'fixed' ? 'fixed' : 'players';
    }
    return 'players';
}

/**
 *
 */
function renderComposerOptionsList() {
    dom.composerOptionsList.innerHTML = '';
    for (const [idx, val] of composerFixedOptions.entries()) {
        const row = document.createElement('div');
        row.className = 'composer-option-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `Option ${idx + 1}`;
        input.value = val;
        input.maxLength = 400;
        input.addEventListener('input', () => {
            composerFixedOptions[idx] = input.value;
        });
        row.append(input);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'composer-option-remove';
        rm.textContent = '×';
        rm.title = 'Option entfernen';
        rm.addEventListener('click', () => {
            composerFixedOptions.splice(idx, 1);
            if (composerFixedOptions.length < 2) {
                while (composerFixedOptions.length < 2) composerFixedOptions.push('');
            }
            renderComposerOptionsList();
        });
        row.append(rm);
        dom.composerOptionsList.append(row);
    }
}

/**
 *
 */
function addComposerOption() {
    if (composerFixedOptions.length >= MAX_REAL_OPTIONS) {
        showMessage(`Maximal ${MAX_REAL_OPTIONS} Optionen.`, 'info');
        return;
    }
    composerFixedOptions.push('');
    renderComposerOptionsList();
}

/**
 * Build a unique, display-friendly snapshot of currently-connected players for
 * source: "players". Duplicate names get " (2)" / " (3)" suffixes so the host
 * can disambiguate when computing Borda.
 * @returns {string[]}
 */
function snapshotPlayerOptions() {
    const taken = new Map();
    const result = [];
    const connected = [...hostPlayers.values()].filter((p) => p.isConnected);
    for (const p of connected) {
        const baseName = (p.name || 'Spieler').trim() || 'Spieler';
        const seen = taken.get(baseName) || 0;
        const label = seen === 0 ? baseName : `${baseName} (${seen + 1})`;
        taken.set(baseName, seen + 1);
        result.push(label);
    }
    return result;
}

/**
 * @param {'players'|'fixed'} source
 * @returns {string[]|null} the real options, or null on validation failure.
 */
function collectRealOptions(source) {
    if (source === 'players') {
        const opts = snapshotPlayerOptions();
        if (opts.length < 2) {
            showMessage(
                'Mindestens 2 verbundene Spieler nötig, um über sie abzustimmen.',
                'error'
            );
            return null;
        }
        return opts;
    }
    const opts = composerFixedOptions
        .map((s) => (s || '').trim())
        .filter((s) => s.length > 0)
        .slice(0, MAX_REAL_OPTIONS);
    if (opts.length < 2) {
        showMessage('Mindestens 2 Optionen sind nötig.', 'error');
        return null;
    }
    return opts;
}

/**
 * Pull and clamp picksPerVoter / revealCount / duration from the composer.
 * @param {number} optionCount
 * @returns {{picks:number, revealCount:number|'all', duration:number}}
 */
function readComposerNumericInputs(optionCount) {
    let picks = Number.parseInt(dom.composerPicks.value, 10);
    if (!Number.isFinite(picks) || picks < 1) picks = 1;
    picks = Math.min(picks, MAX_PICKS_PER_VOTER, optionCount);

    let revealCount;
    if (dom.composerRevealAll.checked) {
        revealCount = 'all';
    } else {
        revealCount = Number.parseInt(dom.composerReveal.value, 10);
        if (!Number.isFinite(revealCount) || revealCount < 1) revealCount = 3;
        revealCount = Math.min(revealCount, optionCount);
    }

    let duration = Number.parseInt(dom.composerDuration.value, 10);
    if (!Number.isFinite(duration)) duration = 45;
    duration = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, duration));

    return { picks, revealCount, duration };
}

/**
 * Validate composer inputs, build start_question payload, send it, and
 * transition the host into the live-voting view.
 */
function startVote() {
    const question = (dom.composerQuestion.value || '').trim();
    if (!question) {
        showMessage('Bitte gib eine Frage ein.', 'error');
        dom.composerQuestion.focus();
        return;
    }
    if (question.length > 3000) {
        showMessage('Frage ist zu lang (max. 3000 Zeichen).', 'error');
        return;
    }

    const source = currentSourceValue();
    const realOptions = collectRealOptions(source);
    if (!realOptions) return;

    const { picks, revealCount, duration } = readComposerNumericInputs(realOptions.length);

    const meta = { picksPerVoter: picks, revealCount, source };
    const options = [encodeMeta(meta), ...realOptions];

    // Per-option validation matches what the server will enforce — fail fast
    // here so the user gets a useful message instead of a silent drop.
    if (options.some((opt) => opt.length > 500)) {
        showMessage('Eine Option ist zu lang (max. 500 Zeichen).', 'error');
        return;
    }

    const payload = {
        type: 'start_question',
        question,
        options,
        index: 0,
        total: 1,
        duration,
    };

    if (!hostWs || hostWs.readyState !== WebSocket.OPEN) {
        showMessage('Keine Verbindung. Versuche erneut zu verbinden…', 'error');
        hostPendingQuestion = payload;
        return;
    }

    hostActivePoll = {
        question,
        options, // full array including meta sentinel at [0]
        realOptions,
        picksPerVoter: picks,
        revealCount,
        source,
        duration,
    };
    hostPollEnding = false;
    hostAnswers.clear();

    hostWs.send(JSON.stringify(payload));

    // Consume the suggestion only if the host actually started a vote whose
    // question text still matches the suggestion. If they edited it, treat it
    // as a custom question and leave the suggestion available for next time.
    if (
        currentSuggestionIdx !== null &&
        POLL_SUGGESTIONS[currentSuggestionIdx].question === question
    ) {
        usedSuggestionIndices.add(currentSuggestionIdx);
        currentSuggestionIdx = null;
    }

    showOnly(
        ['host-lobby', 'host-composer', 'host-voting', 'host-reveal'],
        'host-voting'
    );
    renderHostVotingView();
    startHostTimer(duration);
}

/**
 *
 */
function renderHostVotingView() {
    if (!hostActivePoll) return;
    dom.hostQuestionDisplay.textContent = hostActivePoll.question;
    // No live tally during voting — would bias late voters and undermine
    // anonymity. The host sees only the submission count and the options
    // (without counts), and gets the full Borda ranking on reveal.
    dom.hostLiveOptions.innerHTML = '';
    for (const opt of hostActivePoll.realOptions) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = opt;
        li.append(name);
        dom.hostLiveOptions.append(li);
    }
    refreshHostVotingProgress();
}

/**
 *
 */
function refreshHostVotingProgress() {
    if (!hostActivePoll) return;
    const connected = [...hostPlayers.values()].filter((p) => p.isConnected).length;
    const submitted = hostAnswers.size;
    dom.hostAnswersCount.textContent = String(submitted);
    dom.hostTotalPlayers.textContent = String(connected);
}

/**
 * @param {number} seconds
 */
function startHostTimer(seconds) {
    if (hostTimerInterval) clearInterval(hostTimerInterval);
    dom.hostTimerBar.style.width = '100%';
    const totalMs = seconds * 1000;
    const start = Date.now();
    hostTimerInterval = setInterval(() => {
        const remaining = Math.max(0, totalMs - (Date.now() - start));
        dom.hostTimerBar.style.width = `${(remaining / totalMs) * 100}%`;
        if (remaining <= 0) {
            clearInterval(hostTimerInterval);
            hostTimerInterval = null;
            // Grace period for last-second submissions to arrive. endVote()'s
            // own guard makes this a no-op if the vote was already auto-ended
            // by the last submission landing.
            setTimeout(endVote, 2000);
        }
    }, 100);
}

/**
 * Stop the vote, compute Borda results, send `send_results` so players see
 * the same podium, then move the host into the reveal view.
 */
function endVote() {
    if (!hostActivePoll || hostPollEnding) return;
    hostPollEnding = true;
    if (hostTimerInterval) {
        clearInterval(hostTimerInterval);
        hostTimerInterval = null;
    }

    const podium = computeBordaPodium(hostActivePoll);

    // Pack the podium into the `leaderboard` field — it's the only whitelisted
    // slot in send_results that can carry [{name, score}] pairs through the
    // server's relay. The server will replay this to reconnecting players via
    // its `final` snapshot, so we set isFinal: true on every poll result.
    const leaderboard = podium.map((p) => ({ name: p.label, score: p.points }));

    if (hostWs && hostWs.readyState === WebSocket.OPEN) {
        hostWs.send(
            JSON.stringify({
                type: 'send_results',
                correct: [],
                isFinal: true,
                leaderboard,
            })
        );
    } else {
        showMessage('Keine Verbindung — Ergebnisse konnten nicht versendet werden.', 'error');
    }

    renderHostReveal(podium);
    showOnly(
        ['host-lobby', 'host-composer', 'host-voting', 'host-reveal'],
        'host-reveal'
    );
}

/**
 * Borda count over the active poll's submitted ballots. Each ballot is a
 * ranked list of raw option indices; we map back to real options (index-1)
 * and award `picksPerVoter - rank` points to each pick from rank 0 to
 * min(ballotLength, picksPerVoter) - 1. Duplicates within a single ballot
 * (rare; player UI prevents them) are de-duped — only the first occurrence
 * of a given pick scores.
 * @param {object} poll
 * @returns {Array<{label:string, points:number, mentions:number, rank:number}>}
 */
function computeBordaPodium(poll) {
    const realOpts = poll.realOptions;
    const N = poll.picksPerVoter;
    const scores = Array.from({length: realOpts.length}).fill(0);
    const mentions = Array.from({length: realOpts.length}).fill(0);

    for (const ans of hostAnswers.values()) {
        const seen = new Set();
        const ranks = ans.ranks.slice(0, N);
        for (const [rank, rawIdx] of ranks.entries()) {
            const realIdx = rawIdx - 1;
            if (realIdx < 0 || realIdx >= realOpts.length) continue;
            if (seen.has(realIdx)) continue;
            seen.add(realIdx);
            // Borda weight: rank-1 = N points, rank-N = 1 point.
            scores[realIdx] += N - rank;
            mentions[realIdx]++;
        }
    }

    const ranked = realOpts.map((label, i) => ({
        label,
        points: scores[i],
        mentions: mentions[i],
    }));
    // Sort by points desc, breaking remaining order ties alphabetically. Mentions
    // alone aren't a tiebreaker for the *rank* — entries with the same Borda
    // points share a rank even if mention counts differ.
    ranked.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.label.localeCompare(b.label, 'de');
    });
    assignCompetitionRanks(ranked);

    // Tie-respecting cutoff: include every entry whose competition rank is
    // <= revealCount. For revealCount=3 with [10,10,8] the result is [1,1,3]
    // (3 entries); with [10,8,8,8] it's [1,2,2,2] (all 4 entries, since the
    // tied trio all carry rank 2 ≤ 3).
    if (poll.revealCount === 'all') return ranked;
    return ranked.filter((e) => e.rank <= poll.revealCount);
}

/**
 * Walk a points-sorted array and assign competition-style ranks (1, 1, 3, 4, 4, 6).
 * Mutates each entry to add a `rank` field.
 * @param {Array<{points:number, rank?:number}>} sorted
 */
function assignCompetitionRanks(sorted) {
    let currentRank = 0;
    let lastPoints = null;
    for (const [i, entry] of sorted.entries()) {
        if (lastPoints === null || entry.points !== lastPoints) {
            currentRank = i + 1;
            lastPoints = entry.points;
        }
        entry.rank = currentRank;
    }
}

/**
 * @param {Array<{label:string, points:number, mentions:number, rank:number}>} podium
 */
function renderHostReveal(podium) {
    if (!hostActivePoll) return;
    dom.hostRevealQuestion.textContent = hostActivePoll.question;
    dom.hostPodiumList.innerHTML = '';
    // When the config asks for a single result, hide the redundant "1." prefix —
    // there's no second place to number against. Ties still show all winners,
    // just without a leading number on any of them.
    dom.hostPodiumList.classList.toggle('single-result', hostActivePoll.revealCount === 1);
    for (const entry of podium) {
        dom.hostPodiumList.append(
            buildPodiumItem(entry.rank, entry.label, `${entry.points} Pkt · ${entry.mentions}× genannt`)
        );
    }

    const totalBallots = hostAnswers.size;
    const connected = [...hostPlayers.values()].filter((p) => p.isConnected).length;
    const revealTxt = hostActivePoll.revealCount === 'all' ? 'alle' : hostActivePoll.revealCount;
    const metaTxt =
        `${totalBallots} von ${connected} Stimmen · ` +
        `Auswahlen pro Person: ${hostActivePoll.picksPerVoter} · ` +
        `Ergebnisse: ${revealTxt} · ` +
        `Quelle: ${hostActivePoll.source === 'players' ? 'Spielernamen' : 'eigene Optionen'}`;
    dom.hostRevealMeta.textContent = metaTxt;
}

/**
 * From reveal → back to composer for the next question.
 */
function nextQuestion() {
    hostActivePoll = null;
    hostPollEnding = false;
    hostAnswers.clear();
    // Clear the just-used question text so the next suggestion can shine
    // through cleanly. picksPerVoter / revealCount / duration stay so the
    // host can iterate quickly with the same parameters.
    dom.composerQuestion.value = '';
    openComposer();
}

/**
 * Host terminates the session entirely.
 */
function endSession() {
    if (!confirm('Sitzung wirklich beenden?')) return;
    hostSuppressReconnect = true;
    if (hostWs && hostWs.readyState === WebSocket.OPEN) {
        hostWs.send(JSON.stringify({ type: 'terminate' }));
    }
    hardResetHost();
}

/**
 *
 */
function hardResetHost() {
    hostSuppressReconnect = true;
    if (hostTimerInterval) {
        clearInterval(hostTimerInterval);
        hostTimerInterval = null;
    }
    hostKeepaliveInterval = stopKeepalive(hostKeepaliveInterval);
    if (hostWs) {
        try {
            hostWs.close();
        } catch {
            /* ignore */
        }
    }
    hostWs = null;
    hostRoomId = null;
    hostSessionId = null;
    hostActivePoll = null;
    hostPollEnding = false;
    hostPlayers.clear();
    hostAnswers.clear();
    usedSuggestionIndices.clear();
    currentSuggestionIdx = null;
    clearActiveSession();
    showTopView('role-selection');
    refreshReconnectButtons();
}

/* ============================================================================
 * Player: lifecycle
 * ============================================================================ */

/**
 * Open the join view (used when the user clicks "Umfrage beitreten").
 */
function openPlayerJoin() {
    showTopView('player-view');
    showOnly(
        ['join-form', 'player-waiting', 'player-vote', 'player-submitted', 'player-reveal'],
        'join-form'
    );
    // Auto-fill room code from ?room= if present.
    const params = new URLSearchParams(globalThis.location.search);
    const roomParam = (params.get('room') || '').toUpperCase();
    if (roomParam && dom.roomCodeInput) {
        dom.roomCodeInput.value = roomParam;
    }
    dom.playerNameInput.focus();
}

/**
 * Player submits the join form.
 */
async function submitJoin() {
    const code = (dom.roomCodeInput.value || '').replaceAll(/\s/g, '').toUpperCase();
    const name = sanitizePlayerName(dom.playerNameInput.value || '');
    if (code.length < 3) {
        showMessage('Bitte gib einen gültigen Raum-Code ein.', 'error');
        return;
    }
    if (!name) {
        showMessage('Bitte gib einen Namen ein.', 'error');
        return;
    }
    playerRoomCode = code;
    playerName = name;
    playerWsReconnectAttempts = 0;
    playerSuppressReconnect = false;

    try {
        playerWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar.', 'error');
        return;
    }
    attachPlayerWsHandlers(playerWs);
    playerWs.send(
        JSON.stringify({
            type: 'join',
            roomCode: playerRoomCode,
            playerName: playerName,
        })
    );
}

/**
 * Reconnect a player after a page reload using saved session.
 * @param {{roomId:string, sessionId:string, name?:string}} info
 */
async function initPlayerReconnect(info) {
    playerRoomCode = info.roomId;
    playerSessionId = info.sessionId;
    playerName = info.name || 'Spieler';
    showTopView('player-view');
    showOnly(
        ['join-form', 'player-waiting', 'player-vote', 'player-submitted', 'player-reveal'],
        'player-waiting'
    );
    dom.playerWaitingStatus.textContent = 'Wiederverbindung läuft…';

    try {
        playerWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar.', 'error');
        clearActiveSession();
        playerSessionId = null;
        showTopView('role-selection');
        return;
    }
    attachPlayerWsHandlers(playerWs);
    playerWs.send(
        JSON.stringify({
            type: 'join',
            roomCode: playerRoomCode,
            playerName: playerName,
            sessionId: playerSessionId,
        })
    );
}

/**
 * @param {WebSocket} ws
 */
function attachPlayerWsHandlers(ws) {
    ws.addEventListener('message', (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return;
        }
        handlePlayerMessage(msg);
    });

    playerKeepaliveInterval = stopKeepalive(playerKeepaliveInterval);
    playerKeepaliveInterval = startKeepalive(ws);

    ws.addEventListener('close', () => {
        logger.log('Player WS closed');
        playerKeepaliveInterval = stopKeepalive(playerKeepaliveInterval);
        if (playerSuppressReconnect) return;
        if (
            playerRoomCode &&
            playerSessionId &&
            playerWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS
        ) {
            playerWsReconnectAttempts++;
            const delay = reconnectBackoffMs(playerWsReconnectAttempts);
            showMessage(
                `Verbindung unterbrochen. Reconnect ${playerWsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}…`,
                'info'
            );
            setTimeout(reconnectPlayerWs, delay);
        } else if (playerWsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showMessage(
                'Verbindung zur Umfrage verloren. Bitte lade die Seite neu.',
                'error'
            );
        }
    });

    ws.addEventListener('error', (err) => {
        logger.error('Player WS error:', err);
    });
}

/**
 *
 */
async function reconnectPlayerWs() {
    if (!playerRoomCode || !playerSessionId) return;
    try {
        playerWs = await connectWithRetry(WS_URL);
    } catch {
        showMessage('Server nicht erreichbar.', 'error');
        return;
    }
    attachPlayerWsHandlers(playerWs);
    playerWs.send(
        JSON.stringify({
            type: 'join',
            roomCode: playerRoomCode,
            playerName: playerName,
            sessionId: playerSessionId,
        })
    );
}

/**
 * Player-side message dispatcher.
 * @param {object} msg
 */
function handlePlayerMessage(msg) {
    switch (msg.type) {
        case 'joined': {
            playerSessionId = msg.sessionId;
            if (typeof msg.playerName === 'string') playerName = msg.playerName;
            saveActiveSession('player', playerRoomCode, playerSessionId, { name: playerName });

            // If the server replayed an active question via the join response,
            // the next message will be the question payload itself; we just
            // need to land on the waiting view in the meantime.
            showOnly(
                [
                    'join-form',
                    'player-waiting',
                    'player-vote',
                    'player-submitted',
                    'player-reveal',
                ],
                'player-waiting'
            );
            dom.playerWaitingStatus.textContent = msg.isReconnect
                ? 'Wiederverbunden — warte auf nächste Umfrage.'
                : 'Du bist drin — wir warten auf die nächste Umfrage.';
            dom.playerNameDisplay.textContent = `Eingeloggt als ${playerName}`;
            break;
        }
        case 'question': {
            onQuestionReceived(msg);
            break;
        }
        case 'result': {
            onResultReceived(msg);
            break;
        }
        case 'quiz_terminated': {
            showMessage('Der Host hat die Sitzung beendet.', 'info');
            hardResetPlayer();
            break;
        }
        case 'error': {
            showMessage(msg.message || 'Unbekannter Fehler', 'error');
            // Join failure → kick back to role selection.
            if (
                msg.message === 'Raum nicht gefunden.' ||
                msg.message === 'Raum ist voll (max. 240 Spieler).' ||
                msg.message === 'Raum nicht mehr aktiv.'
            ) {
                hardResetPlayer();
            }
            break;
        }
        // Lobby music / categories / etc. — ignored.
        default: {
            break;
        }
    }
}

/**
 * @param {object} msg
 */
function onQuestionReceived(msg) {
    const options = Array.isArray(msg.options) ? msg.options : [];
    if (options.length < 2) {
        showMessage('Ungültige Umfrage-Daten empfangen.', 'error');
        return;
    }
    const meta = decodeMeta(options[0]);
    if (!meta) {
        // This room is running a quiz, not a poll. Refuse loudly rather than
        // silently render a malformed picker.
        showMessage(
            'Dieser Raum ist keine Umfrage. Bitte tritt über quiz.html bei.',
            'error'
        );
        return;
    }
    playerCurrentMeta = meta;
    playerOptionIndexBase = 1;
    playerDisplayOptions = options.slice(1);
    playerCurrentQuestion = msg.question || '';
    playerCurrentQuestionKey = `${playerRoomCode}|${msg.index || 0}|${playerCurrentQuestion.slice(0, 64)}`;

    if (msg.alreadySubmitted) {
        playerHasSubmitted = true;
        playerSelectedRanks = loadLastPicks(playerRoomCode, playerCurrentQuestionKey) || [];
        renderSubmittedView();
        return;
    }

    playerHasSubmitted = false;
    playerSelectedRanks = [];
    renderVoteView();
    const remaining =
        typeof msg.remaining === 'number'
            ? Math.max(0, msg.remaining)
            : Number(msg.duration) || 45;
    startPlayerTimer(remaining);
}

/**
 *
 */
function renderVoteView() {
    showOnly(
        ['join-form', 'player-waiting', 'player-vote', 'player-submitted', 'player-reveal'],
        'player-vote'
    );
    dom.playerQuestionText.textContent = playerCurrentQuestion;
    const picks = playerCurrentMeta.picksPerVoter;
    const cap = Math.min(picks, playerDisplayOptions.length);
    dom.playerVoteHint.textContent =
        cap === 1
            ? 'Wähle deinen Favoriten.'
            : `Wähle bis zu ${cap} in Reihenfolge deiner Präferenz (1 = höchste).`;
    renderRankPicker();
}

/**
 *
 */
function renderRankPicker() {
    // Ranked picks list (top): shows current 1., 2., 3., ... selection. Tap to
    // remove from the ranking. When the host configured a single pick, the
    // "1." prefix is redundant — `single-pick` hides it via CSS.
    dom.rankList.innerHTML = '';
    dom.rankList.classList.toggle(
        'single-pick',
        playerCurrentMeta && playerCurrentMeta.picksPerVoter === 1
    );
    if (playerSelectedRanks.length === 0) {
        if (dom.rankListEmpty) dom.rankListEmpty.hidden = false;
    } else {
        if (dom.rankListEmpty) dom.rankListEmpty.hidden = true;
        for (const [rank, rawIdx] of playerSelectedRanks.entries()) {
            const li = document.createElement('li');
            const realIdx = rawIdx - playerOptionIndexBase;
            li.textContent = playerDisplayOptions[realIdx] || '?';
            li.title = 'Tippen, um aus der Rangfolge zu entfernen';
            li.addEventListener('click', () => {
                playerSelectedRanks.splice(rank, 1);
                renderRankPicker();
            });
            dom.rankList.append(li);
        }
    }

    // Option chips (bottom): tap to append to the ranking. Disabled when
    // already picked or when picksPerVoter cap is reached.
    dom.rankOptions.innerHTML = '';
    const cap = Math.min(playerCurrentMeta.picksPerVoter, playerDisplayOptions.length);
    const picked = new Set(playerSelectedRanks);
    for (const [i, label] of playerDisplayOptions.entries()) {
        const rawIdx = i + playerOptionIndexBase;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        if (picked.has(rawIdx)) {
            btn.classList.add('picked');
            btn.disabled = true;
        } else if (playerSelectedRanks.length >= cap) {
            btn.disabled = true;
            btn.title = `Du hast bereits ${cap} ausgewählt — entferne erst eine Wahl.`;
        }
        btn.addEventListener('click', () => {
            if (playerSelectedRanks.length >= cap) return;
            if (picked.has(rawIdx)) return;
            playerSelectedRanks.push(rawIdx);
            renderRankPicker();
        });
        dom.rankOptions.append(btn);
    }

    dom.submitVoteBtn.disabled = playerSelectedRanks.length === 0;
}

/**
 *
 */
function submitVote() {
    if (playerHasSubmitted) return;
    if (!playerWs || playerWs.readyState !== WebSocket.OPEN) {
        showMessage('Keine Verbindung. Versuche es erneut.', 'error');
        return;
    }
    if (playerSelectedRanks.length === 0) {
        showMessage('Wähle mindestens eine Option.', 'error');
        return;
    }
    playerWs.send(
        JSON.stringify({
            type: 'submit_answer',
            answerData: [...playerSelectedRanks],
        })
    );
    playerHasSubmitted = true;
    saveLastPicks(playerRoomCode, playerCurrentQuestionKey, [...playerSelectedRanks]);
    renderSubmittedView();
    stopPlayerTimer();
}

/**
 *
 */
function renderSubmittedView() {
    showOnly(
        ['join-form', 'player-waiting', 'player-vote', 'player-submitted', 'player-reveal'],
        'player-submitted'
    );
    renderPicksEcho(dom.submittedPicksEcho, playerSelectedRanks);
}

/**
 * @param {object} msg
 */
function onResultReceived(msg) {
    stopPlayerTimer();
    showOnly(
        ['join-form', 'player-waiting', 'player-vote', 'player-submitted', 'player-reveal'],
        'player-reveal'
    );
    dom.playerRevealQuestion.textContent = playerCurrentQuestion;
    dom.playerPodiumList.innerHTML = '';
    const leaderboard = Array.isArray(msg.leaderboard) ? msg.leaderboard : [];
    // The server's whitelist drops anything beyond {name, score} on each entry,
    // so the host can't ship pre-computed ranks. Recompute them client-side
    // from the score values — the leaderboard arrives already sorted desc.
    const withPoints = leaderboard.map((entry) => ({
        label: entry.name || '?',
        points: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
    }));
    assignCompetitionRanks(withPoints);
    const singleResult = playerCurrentMeta && playerCurrentMeta.revealCount === 1;
    dom.playerPodiumList.classList.toggle('single-result', !!singleResult);
    for (const entry of withPoints) {
        const scoreTxt = `${entry.points} Pkt`;
        dom.playerPodiumList.append(buildPodiumItem(entry.rank, entry.label, scoreTxt));
    }
    renderPicksEcho(dom.playerPicksEcho, playerSelectedRanks);
    dom.playerRevealStatus.textContent = 'Warten auf nächste Umfrage…';
}

/**
 * Build a single <li> for a podium list. Used by both the host's full reveal
 * and the player's reveal so the visual treatment stays in lockstep.
 * @param {number} rank — 1-based competition rank.
 * @param {string} label
 * @param {string} scoreText
 * @returns {HTMLLIElement}
 */
function buildPodiumItem(rank, label, scoreText) {
    const li = document.createElement('li');
    li.className = `rank-${rank}`;
    const rankEl = document.createElement('span');
    rankEl.className = 'podium-rank';
    rankEl.textContent = `${rank}.`;
    const name = document.createElement('span');
    name.className = 'podium-name';
    name.textContent = label;
    const score = document.createElement('span');
    score.className = 'podium-score';
    score.textContent = scoreText;
    li.append(rankEl, name, score);
    return li;
}

/**
 * @param {HTMLElement} target
 * @param {number[]} picks
 */
function renderPicksEcho(target, picks) {
    if (!target) return;
    target.innerHTML = '';
    if (!picks || picks.length === 0) {
        const p = document.createElement('p');
        p.className = 'player-hint';
        p.textContent = 'Du hast keine Stimme abgegeben.';
        target.append(p);
        return;
    }
    const heading = document.createElement('h4');
    heading.textContent = 'Deine Wahl:';
    target.append(heading);
    const ol = document.createElement('ol');
    for (const rawIdx of picks) {
        const realIdx = rawIdx - playerOptionIndexBase;
        const label = playerDisplayOptions[realIdx] || '?';
        const li = document.createElement('li');
        li.textContent = label;
        ol.append(li);
    }
    target.append(ol);
}

/**
 * @param {number} seconds
 */
function startPlayerTimer(seconds) {
    if (playerTimerInterval) clearInterval(playerTimerInterval);
    if (!dom.playerTimerBar) return;
    dom.playerTimerBar.style.width = '100%';
    const totalMs = Math.max(1, seconds * 1000);
    const start = Date.now();
    playerTimerInterval = setInterval(() => {
        const remaining = Math.max(0, totalMs - (Date.now() - start));
        dom.playerTimerBar.style.width = `${(remaining / totalMs) * 100}%`;
        if (remaining <= 0) {
            clearInterval(playerTimerInterval);
            playerTimerInterval = null;
            // Auto-submit whatever the player has ranked (could be empty). The
            // host's grace period gives this a couple of seconds to arrive.
            if (!playerHasSubmitted && playerSelectedRanks.length > 0) {
                submitVote();
            }
        }
    }, 100);
}

/**
 *
 */
function stopPlayerTimer() {
    if (playerTimerInterval) {
        clearInterval(playerTimerInterval);
        playerTimerInterval = null;
    }
    if (dom.playerTimerBar) dom.playerTimerBar.style.width = '0%';
}

/**
 *
 */
function hardResetPlayer() {
    playerSuppressReconnect = true;
    stopPlayerTimer();
    playerKeepaliveInterval = stopKeepalive(playerKeepaliveInterval);
    if (playerWs) {
        try {
            playerWs.close();
        } catch {
            /* ignore */
        }
    }
    playerWs = null;
    playerRoomCode = null;
    playerSessionId = null;
    playerName = null;
    playerCurrentMeta = null;
    playerDisplayOptions = [];
    playerSelectedRanks = [];
    playerHasSubmitted = false;
    clearActiveSession();
    clearLastPicks();
    showTopView('role-selection');
    refreshReconnectButtons();
}

/* ============================================================================
 * Reconnect-button visibility
 * ============================================================================ */

/**
 * Show "Reconnect" CTAs in role-selection when an unfinished session exists.
 */
function refreshReconnectButtons() {
    const sess = loadActiveSession();
    if (!sess) {
        dom.reconnectHostBtn.classList.add('hidden');
        dom.reconnectPlayerBtn.classList.add('hidden');
        return;
    }
    if (sess.role === 'host') {
        dom.reconnectHostBtn.classList.remove('hidden');
        dom.reconnectPlayerBtn.classList.add('hidden');
    } else if (sess.role === 'player') {
        dom.reconnectPlayerBtn.classList.remove('hidden');
        dom.reconnectHostBtn.classList.add('hidden');
    }
}

/* ============================================================================
 * Boot
 * ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
    collectDom();

    dom.hostBtn.addEventListener('click', initHost);
    dom.playerBtn.addEventListener('click', openPlayerJoin);
    dom.reconnectHostBtn.addEventListener('click', () => {
        const sess = loadActiveSession();
        if (sess && sess.role === 'host') initHostReconnect(sess);
    });
    dom.reconnectPlayerBtn.addEventListener('click', () => {
        const sess = loadActiveSession();
        if (sess && sess.role === 'player') initPlayerReconnect(sess);
    });

    dom.showComposerBtn.addEventListener('click', openComposer);
    for (const r of dom.sourceRadios) {
        r.addEventListener('change', updateFixedSectionVisibility);
    }
    dom.addOptionBtn.addEventListener('click', addComposerOption);
    if (dom.applySuggestionBtn) {
        dom.applySuggestionBtn.addEventListener('click', applyCurrentSuggestion);
    }
    if (dom.cycleSuggestionBtn) {
        dom.cycleSuggestionBtn.addEventListener('click', cycleSuggestion);
    }
    dom.composerRevealAll.addEventListener('change', () => {
        dom.composerReveal.disabled = dom.composerRevealAll.checked;
    });
    dom.startVoteBtn.addEventListener('click', startVote);
    dom.backToLobbyBtn.addEventListener('click', () => {
        showOnly(
            ['host-lobby', 'host-composer', 'host-voting', 'host-reveal'],
            'host-lobby'
        );
    });
    dom.endVoteBtn.addEventListener('click', endVote);
    dom.nextQuestionBtn.addEventListener('click', nextQuestion);
    dom.endSessionBtn.addEventListener('click', endSession);

    dom.joinBtn.addEventListener('click', submitJoin);
    dom.roomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitJoin();
    });
    dom.playerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitJoin();
    });
    dom.submitVoteBtn.addEventListener('click', submitVote);

    // QR modal: clicking the small QR enlarges it for the room.
    if (dom.qrcodeEl) {
        dom.qrcodeEl.addEventListener('click', () => {
            if (!hostRoomId) return;
            dom.qrModalOverlay.classList.remove('hidden');
        });
    }
    if (dom.qrModalClose) {
        dom.qrModalClose.addEventListener('click', () => {
            dom.qrModalOverlay.classList.add('hidden');
        });
    }
    if (dom.qrModalOverlay) {
        dom.qrModalOverlay.addEventListener('click', (e) => {
            if (e.target === dom.qrModalOverlay) {
                dom.qrModalOverlay.classList.add('hidden');
            }
        });
    }

    renderComposerOptionsList();
    refreshReconnectButtons();

    // If the URL carries ?room=XXXX (typical: QR scan or shared invite link),
    // skip role selection and land on the player join form directly — the
    // user clearly came to join, not to host.
    const initialParams = new URLSearchParams(globalThis.location.search);
    if (initialParams.get('room')) {
        openPlayerJoin();
    }

    // When a backgrounded tab comes back to foreground, setInterval-based
    // keepalives may have been throttled (browsers commonly clamp to 1/min
    // in hidden tabs) — long enough for a proxy idle timeout to bite.
    // Fire an immediate keepalive on each foreground transition to refresh
    // the path before the 25 s tick.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        for (const ws of [hostWs, playerWs]) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(KEEPALIVE_PAYLOAD);
                } catch {
                    /* swallow — close handler will reconnect if the path is dead */
                }
            }
        }
    });
});
