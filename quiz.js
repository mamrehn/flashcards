/**
 * WebSocket Server Configuration
 *
 * This placeholder is replaced during build/deployment with the actual server URL.
 */
// During build, '__WS_URL__' is replaced. In dev, it remains.
const RAW_URL = '__WS_URL__';
const FALLBACK_WS_URL = RAW_URL === '__WS_URL__' ? 'wss://qlash-server.fly.dev' : RAW_URL;
const HAS_RUNTIME_WS_URL =
    globalThis.window !== undefined && globalThis.WS_URL && globalThis.WS_URL !== '__WS_URL__';
const WS_URL = HAS_RUNTIME_WS_URL ? globalThis.WS_URL : FALLBACK_WS_URL;

// --- Utility functions ---
/**
 * Displays a simple message to the user.
 * @param {string} message - The message to display.
 * @param {string} type - 'error' or 'info'.
 */
function showMessage(message, type = 'info') {
    // logger.log(`Message (${type}): ${message}`);

    // Remove existing toast if present
    const existing = document.querySelector('#toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    document.body.append(toast);

    // Trigger show animation
    requestAnimationFrame(() => toast.classList.add('show'));

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 4000);
}

/**
 * Shows a specific view and hides all other views.
 * @param {string} viewToShowId - The ID of the view element to show.
 */
function showView(viewToShowId) {
    for (const view of document.querySelectorAll('.view')) view.classList.remove('active');
    const viewElement = document.querySelector(`#${CSS.escape(viewToShowId)}`);
    if (viewElement) viewElement.classList.add('active');
    else console.error('View not found:', viewToShowId);

    // Hide role selection buttons once a role is chosen
    if (viewToShowId === 'host-view' || viewToShowId === 'player-view') {
        document.querySelector('#role-selection').classList.add('hidden');
    }
}

// --- Lobby cosmetics ---
// Curated avatar set: RGI ZWJ professions on the gender-neutral 🧑 base, plus
// single-codepoint fantasy/activity emojis. Player names stay separate; the
// avatar prefixes the name. Old emoji fonts will fall back to side-by-side
// glyphs for the ZWJ entries — accepted as a known limitation.
const LOBBY_ZWJ = '‍';
const LOBBY_AVATAR_BASES = [
    { id: 'woman', emoji: '👩', label: 'Frau' },
    { id: 'person', emoji: '🧑', label: 'Person' },
    { id: 'man', emoji: '👨', label: 'Mann' },
];
const LOBBY_AVATAR_BASE_DEFAULT = 'person';
// Every accessory below is an RGI ZWJ partner for all three bases above.
const LOBBY_AVATAR_ACCESSORIES = [
    { id: 'rocket',     emoji: '🚀',  label: 'Astronaut*in' },
    { id: 'firetruck',  emoji: '🚒',  label: 'Feuerwehr' },
    { id: 'plane',      emoji: '✈️',  label: 'Pilot*in' },
    { id: 'microscope', emoji: '🔬',  label: 'Forscher*in' },
    { id: 'palette',    emoji: '🎨',  label: 'Kunst' },
    { id: 'mic',        emoji: '🎤',  label: 'Gesang' },
    { id: 'cooking',    emoji: '🍳',  label: 'Kochen' },
    { id: 'medical',    emoji: '⚕️',  label: 'Medizin' },
    { id: 'justice',    emoji: '⚖️',  label: 'Justiz' },
    { id: 'farm',       emoji: '🌾',  label: 'Landwirtschaft' },
    { id: 'wrench',     emoji: '🔧',  label: 'Mechanik' },
    { id: 'computer',   emoji: '💻',  label: 'Computer' },
    { id: 'factory',    emoji: '🏭',  label: 'Fabrik' },
    { id: 'office',     emoji: '💼',  label: 'Büro' },
    { id: 'baby',       emoji: '🍼',  label: 'Pflege' },
];
const LOBBY_AVATAR_BASE_SET = new Set(LOBBY_AVATAR_BASES.map((b) => b.id));
const LOBBY_AVATAR_ACCESSORY_SET = new Set(LOBBY_AVATAR_ACCESSORIES.map((a) => a.id));
const LOBBY_AVATAR_STORAGE_KEY = 'quiz_lobby_avatar_v2';

/**
 * Composes the avatar string from a base id + optional accessory id. Returns
 * the bare base emoji when no accessory is selected.
 * @param {string} baseId
 * @param {string|null} accessoryId
 * @returns {string}
 */
function composeAvatar(baseId, accessoryId) {
    const base = LOBBY_AVATAR_BASES.find((b) => b.id === baseId);
    if (!base) return '';
    if (!accessoryId) return base.emoji;
    const acc = LOBBY_AVATAR_ACCESSORIES.find((a) => a.id === accessoryId);
    if (!acc) return base.emoji;
    return base.emoji + LOBBY_ZWJ + acc.emoji;
}

/**
 * Parses an avatar string back into base/accessory ids so a server-sent
 * avatar (e.g. on reconnect) can rehydrate the picker state.
 * @param {string} str
 * @returns {{base: string, accessory: (string|null)} | null}
 */
function parseAvatarString(str) {
    if (typeof str !== 'string' || !str) return null;
    const parts = str.split(LOBBY_ZWJ);
    const base = LOBBY_AVATAR_BASES.find((b) => b.emoji === parts[0]);
    if (!base) return null;
    if (parts.length === 1) return { base: base.id, accessory: null };
    if (parts.length === 2) {
        const acc = LOBBY_AVATAR_ACCESSORIES.find((a) => a.emoji === parts[1]);
        if (acc) return { base: base.id, accessory: acc.id };
    }
    return null;
}

/**
 * Recomposes the avatar from the current base/accessory, persists it to
 * localStorage, and notifies the server. Module-level so the picker
 * functions can stay light.
 */
function commitAvatar() {
    playerAvatar = composeAvatar(playerAvatarBase, playerAvatarAccessory);
    try {
        localStorage.setItem(
            LOBBY_AVATAR_STORAGE_KEY,
            JSON.stringify({ base: playerAvatarBase, accessory: playerAvatarAccessory })
        );
    } catch { /* private mode */ }
    if (playerWs && playerWs.readyState === WebSocket.OPEN) {
        playerWs.send(JSON.stringify({ type: 'update_avatar', avatar: playerAvatar }));
    }
}

// Themes mirror audio/themes/<id>/ folders. Keep ids in sync with the server.
const LOBBY_MUSIC_THEMES = [
    { id: 'arcade',         label: 'Arcade',    icon: '🕹️', tagline: 'Schnell & spielerisch' },
    { id: 'cinematic',      label: 'Cinematic', icon: '🎬', tagline: 'Episch & dramatisch' },
    { id: 'modern_minimal', label: 'Minimal',   icon: '📱', tagline: 'Klar & ruhig' },
    { id: 'classical',      label: 'Klassik',   icon: '🎻', tagline: 'Elegant & akademisch' },
];
const LOBBY_HOST_MUSIC_DEFAULT = 'modern_minimal';
const LOBBY_HOST_MUSIC_STORAGE_KEY = 'quiz_host_lobby_music';
const LOBBY_MUSIC_THEME_LABELS = {
    arcade: 'Arcade',
    cinematic: 'Cinematic',
    modern_minimal: 'Minimal',
    classical: 'Klassik',
    none: 'Keine Musik',
};
const LOBBY_MUSIC_VOTE_OPTIONS = [
    ...LOBBY_MUSIC_THEMES,
    { id: 'none', label: 'Keine Musik', icon: '🔇', tagline: 'Stille fürs Lernen' },
];
const LOBBY_MUSIC_VOTE_IDS = new Set(LOBBY_MUSIC_VOTE_OPTIONS.map((o) => o.id));

// Host-side audio split into seamless loops vs. one-shot stingers.
// See audio/themes/README.md for the full spec.
const HOST_AUDIO_LOOPS = new Set(['lobby', 'question', 'leaderboard']);
const HOST_AUDIO_STINGERS = new Set(['time_up', 'new_question']);
// Universal one-shot played on the final results screen — same file for all
// themes (and even when the chosen theme is "none").
const HOST_AUDIO_FINAL_PATH = 'audio/final.aac';

/**
 * Builds the audio file URL for a (theme, track) pair.
 * @param {string} theme
 * @param {string} track
 * @returns {string}
 */
function audioFilePath(theme, track) {
    return `audio/themes/${theme}/${track}.aac`;
}

/**
 * Generates a random alphanumeric ID of a specified length.
 * @param {number} length - The desired length of the ID.
 * @returns {string} The generated alphanumeric ID.
 */
function generateAlphanumericId(length) {
    // Excludes 0/O and 1/I to avoid confusion when read aloud or copied.
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Shuffles an array in place using the Fisher-Yates (Knuth) algorithm.
 * @param {Array} array - The array to shuffle.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Creates a WebSocket connection with retry logic for Fly.io cold starts.
 * Retries up to maxRetries times with increasing delays if the connection fails immediately.
 * @param {string} url - The WebSocket URL.
 * @param {number} maxRetries - Max retry attempts for initial connection.
 * @returns {Promise<WebSocket>} A connected WebSocket.
 */
function connectWithRetry(url, maxRetries = 3) {
    return new Promise((resolve, reject) => {
        let attempt = 0;
        /**
         *
         */
        function tryConnect() {
            attempt++;
            const ws = new WebSocket(url);
            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                ws.close();
                if (attempt < maxRetries) {
                    logger.log(`WebSocket connection attempt ${attempt} timed out, retrying...`);
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
                    logger.log(`WebSocket connection attempt ${attempt} failed, retrying...`);
                    setTimeout(tryConnect, 2000 * attempt);
                } else {
                    reject(new Error('WebSocket connection failed after retries'));
                }
            });
        }
        tryConnect();
    });
}

// --- App initialization ---
// QR Code Modal elements (declared globally for early access)
let qrModalOverlay = null;
let qrModalCloseBtn = null;
let largeQrcodeContainer = null;
let modalRoomIdSpan = null;

document.addEventListener('DOMContentLoaded', () => {
    // Verify WebSocket URL is configured
    if (!WS_URL || !WS_URL.startsWith('ws')) {
        console.error('WebSocket server URL not configured or invalid:', WS_URL);
        showMessage('Server-URL nicht konfiguriert. Bitte überprüfe die Konfiguration.', 'error');
        return;
    }

    // Initialize QR modal elements as soon as DOM is ready
    qrModalOverlay = document.querySelector('#qr-modal-overlay');
    qrModalCloseBtn = document.querySelector('#qr-modal-close');
    largeQrcodeContainer = document.querySelector('#large-qrcode');
    modalRoomIdSpan = document.querySelector('#modal-room-id');

    // Event listener for closing the QR code modal when clicking the close button
    if (qrModalCloseBtn) {
        qrModalCloseBtn.addEventListener('click', () => {
            if (qrModalOverlay) {
                qrModalOverlay.classList.add('hidden');
            }
        });
    }

    // Event listener for closing the QR code modal when clicking the overlay itself
    if (qrModalOverlay) {
        qrModalOverlay.addEventListener('click', (event) => {
            // Only close if the click target is the overlay itself, not its children
            if (event.target === qrModalOverlay) {
                qrModalOverlay.classList.add('hidden');
            }
        });
    }

    // Event listener for "Host a Quiz" button
    document.querySelector('#host-btn').addEventListener('click', () => {
        showView('host-view');
        initializeHostFeatures();
    });
    // Event listener for "Join a Quiz" button
    document.querySelector('#player-btn').addEventListener('click', () => {
        showView('player-view');
        initializePlayerFeatures();
    });

    // Determine initial view: URL params or role selection
    const urlParams = new URLSearchParams(globalThis.location.search);
    const hostIdFromUrl = urlParams.get('host');

    if (hostIdFromUrl) {
        // URL param: navigate directly to player view and pre-fill room code
        showView('player-view');
        initializePlayerFeatures();
        document.querySelector('#room-code-input').value = hostIdFromUrl;
    } else {
        showView('role-selection');
    }

    // Show reconnect buttons if a saved session exists in localStorage
    const reconnectHostBtn = document.querySelector('#reconnect-host-btn');
    const reconnectPlayerBtn = document.querySelector('#reconnect-player-btn');
    const savedSession = getActiveSession();

    if (savedSession && savedSession.role === 'host') {
        reconnectHostBtn.classList.remove('hidden');
    } else if (savedSession && savedSession.role === 'player') {
        reconnectPlayerBtn.classList.remove('hidden');
        reconnectPlayerBtn.classList.add('pulse-cta');
    }

    reconnectHostBtn.addEventListener('click', () => {
        const session = getActiveSession();
        if (!session || session.role !== 'host') {
            showMessage('Keine aktive Host-Sitzung gefunden.', 'error');
            reconnectHostBtn.classList.add('hidden');
            return;
        }
        showView('host-view');
        initializeHostFeatures({ roomId: session.roomId, sessionId: session.sessionId });
    });

    reconnectPlayerBtn.addEventListener('click', () => {
        reconnectPlayerBtn.classList.remove('pulse-cta');
        const session = getActiveSession();
        if (!session || session.role !== 'player') {
            showMessage('Keine aktive Spieler-Sitzung gefunden.', 'error');
            reconnectPlayerBtn.classList.add('hidden');
            return;
        }
        showView('player-view');
        initializePlayerFeatures({
            roomId: session.roomId,
            sessionId: session.sessionId,
            playerName: session.playerName,
        });
    });

    // Reconnect WebSocket when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        // logger.log('Tab became visible, checking connections...');

        if (hostWs && hostWs.readyState !== WebSocket.OPEN && hostRoomId) {
            reconnectHostWs();
        }
        if (playerWs && playerWs.readyState !== WebSocket.OPEN && playerRoomId) {
            reconnectPlayerWs();
        }
    });
});

// --- Host State & Initialization Flag ---
// reconnectHostWs is defined inside initializeHostFeatures (it closes over
// the locally-scoped handleHostMessage), but the visibilitychange handler
// in DOMContentLoaded needs to call it from the outer scope. We expose it
// via this module-level binding, assigned when initializeHostFeatures runs.
let reconnectHostWs = null;
let hostGlobalQuizState = null;
let hostWs = null;
let hostSessionId = null;
let isHostInitialized = false;
let hostTimerInterval = null;
let hostQuestionStartTime = null;
let hostRoomId = null;
let hostViewHeading = null;
let hostBeforeUnloadHandler = null;
let hostWsReconnectAttempts = 0;
let hostPendingQuestion = null;
let suppressHostReconnect = false;
const HOST_MAX_RECONNECT_ATTEMPTS = 30;
const RECONNECT_DELAY_MS = 10_000;

/**
 * Reconnect backoff: 1s → 2s → 4s → 10s (then steady). A typical WS blip
 * (phone screen off, brief Wi-Fi hiccup) recovers on the first retry instead
 * of waiting the full 10 s, while sustained failures still throttle.
 * @param {number} attempt 1-indexed
 * @returns {number} ms before the next retry
 */
function reconnectBackoffMs(attempt) {
    if (attempt <= 1) return 1000;
    if (attempt === 2) return 2000;
    if (attempt === 3) return 4000;
    return RECONNECT_DELAY_MS;
}

/**
 * Minimal host-side audio engine. One looping `<audio>` element re-pointed at
 * the chosen theme's track files. Empty/missing files fail silently — the
 * placeholder `.aac` files in audio/themes are intentionally empty until the
 * host records over them.
 *
 * @returns {{setTheme:Function, play:Function, stop:Function, getTheme:Function}}
 */
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// --- Phase veil + fly-in helpers ---
// One persistent #phase-veil overlay in the document; we just toggle the
// `up` class to fade it in/out and set data-theme for the per-theme tint.
let phaseVeilEl = null;
function getPhaseVeil() {
    if (!phaseVeilEl) phaseVeilEl = document.querySelector('#phase-veil');
    return phaseVeilEl;
}

/**
 * Raise the phase veil with the given theme tint. Idempotent.
 * @param {string} themeId
 */
function raisePhaseVeil(themeId) {
    const el = getPhaseVeil();
    if (!el) return;
    el.dataset.theme = themeId || 'none';
    el.classList.add('up');
}

function lowerPhaseVeil() {
    const el = getPhaseVeil();
    if (el) el.classList.remove('up');
}

/**
 * Restart the `phase-fly-up` animation on `el`. Removing then re-adding the
 * class on the same frame is a no-op, so we wait one frame between toggles.
 * @param {HTMLElement} el
 */
function flyInElement(el) {
    if (!el) return;
    el.classList.remove('phase-fly-up');
    requestAnimationFrame(() => el.classList.add('phase-fly-up'));
}

/**
 * Warm the HTTP cache with every audio file the engine might play, so the
 * first time a stinger is set as `audio.src` the browser already has the
 * bytes locally. Without this, the very first `new_question.aac` (or any
 * other stinger) would incur a download round-trip and miss its cue.
 */
function preloadAudioCache() {
    const themes = LOBBY_MUSIC_THEMES.map((t) => t.id);
    const tracks = [...HOST_AUDIO_LOOPS, ...HOST_AUDIO_STINGERS];
    const urls = [];
    for (const theme of themes) {
        for (const track of tracks) urls.push(audioFilePath(theme, track));
    }
    urls.push(HOST_AUDIO_FINAL_PATH);
    for (const url of urls) {
        // Same-origin → no CORS. `force-cache` serves from cache if already
        // present, otherwise the request still populates it for later loads.
        fetch(url, { cache: 'force-cache' }).catch(() => { /* ignore */ });
    }
}

function createMusicEngine() {
    // Prefetch on engine creation so by the time the host clicks
    // "Quiz hosten" → "Fragen starten", every track is already cached.
    preloadAudioCache();

    // Crossfade tunables. 250 ms per the user's preference; the same
    // machinery handles both track transitions (lobby → question) and
    // same-track loop wraps (lobby's last 250 ms overlaps its restart).
    const FADE_MS = 250;
    const FADE_TICK_MS = 20;
    const LOOP_VOLUME = 0.7;
    const STINGER_VOLUME = 0.85;

    function makeLoopAudio() {
        const a = new Audio();
        a.loop = false; // manual loop management with crossfade
        a.preload = 'auto';
        a.volume = 0;
        a.addEventListener('error', () => { /* silent fallback */ });
        return a;
    }

    // Ping-pong pair of loop elements: while one fades out, the other fades in.
    const loops = [makeLoopAudio(), makeLoopAudio()];

    const stinger = new Audio();
    stinger.loop = false;
    stinger.preload = 'auto';
    stinger.volume = STINGER_VOLUME;

    let theme = 'none';
    let activeIdx = 0;
    let activeTrack = null;
    let pendingLoop = null;
    const fadeIntervals = new WeakMap();
    const wrapHandlers = new WeakMap();

    function cancelFade(audio) {
        const id = fadeIntervals.get(audio);
        if (id !== undefined) {
            clearInterval(id);
            fadeIntervals.delete(audio);
        }
    }

    /**
     * Linearly ramp `audio.volume` from its current value to `to` over
     * `durationMs`. Cancels any ramp already in progress on this element.
     * @param {HTMLAudioElement} audio
     * @param {number} to
     * @param {number} durationMs
     * @param {Function} [onDone]
     */
    function rampVolume(audio, to, durationMs, onDone) {
        cancelFade(audio);
        if (durationMs <= 0) {
            audio.volume = clamp01(to);
            if (onDone) onDone();
            return;
        }
        const from = audio.volume;
        const steps = Math.max(1, Math.round(durationMs / FADE_TICK_MS));
        let step = 0;
        const id = setInterval(() => {
            step++;
            const t = step / steps;
            audio.volume = clamp01(from + (to - from) * t);
            if (step >= steps) {
                audio.volume = clamp01(to);
                clearInterval(id);
                fadeIntervals.delete(audio);
                if (onDone) onDone();
            }
        }, FADE_TICK_MS);
        fadeIntervals.set(audio, id);
    }

    function detachWrap(audio) {
        const h = wrapHandlers.get(audio);
        if (h) {
            audio.removeEventListener('timeupdate', h);
            wrapHandlers.delete(audio);
        }
    }

    /**
     * Schedule the loop wrap: when the active element reaches its last
     * `FADE_MS`, kick off a crossfade into a fresh playback of the same
     * track on the other element. Skips when duration is unknown / zero
     * (empty stub files), so the engine stays silent rather than thrashing.
     * @param {HTMLAudioElement} audio
     * @param {string} track
     */
    function attachWrap(audio, track) {
        detachWrap(audio);
        const handler = () => {
            if (!audio.duration || !Number.isFinite(audio.duration)) return;
            if (audio.duration <= FADE_MS / 1000) return; // too short to wrap
            const remaining = audio.duration - audio.currentTime;
            if (remaining > FADE_MS / 1000) return;
            detachWrap(audio);
            crossfadeToTrack(track);
        };
        audio.addEventListener('timeupdate', handler);
        wrapHandlers.set(audio, handler);
    }

    /**
     * Start `track` on the inactive element with a fade-in, while fading
     * out the currently-active element. Used for both new-track transitions
     * and same-track loop wraps.
     * @param {string} track
     */
    function crossfadeToTrack(track) {
        if (theme === 'none' || !HOST_AUDIO_LOOPS.has(track)) return;
        const next = (activeIdx + 1) % 2;
        const incoming = loops[next];
        const outgoing = loops[activeIdx];

        cancelFade(incoming);
        detachWrap(incoming);
        incoming.src = audioFilePath(theme, track);
        incoming.currentTime = 0;
        incoming.volume = 0;
        const p = incoming.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => { /* autoplay blocked or empty file */ });
        }

        rampVolume(incoming, LOOP_VOLUME, FADE_MS);
        if (!outgoing.paused) {
            const tail = outgoing;
            rampVolume(tail, 0, FADE_MS, () => tail.pause());
        }

        activeIdx = next;
        activeTrack = track;
        attachWrap(incoming, track);
    }

    let pendingOnEnd = null;
    let stingerStartedAt = 0;
    let stingerSafetyTimer = null;
    // Minimum visible-transition duration so empty stub files (which fire
    // 'error' immediately, or never) still give the veil time to read on
    // screen. Real stingers (2-4 s) far exceed this and fire onEnd at
    // their natural end.
    const MIN_STINGER_HOLD_MS = 700;
    // Hard ceiling: if neither 'ended' nor 'error' fires by this point we
    // assume the file is unplayable and proceed anyway. Set well above the
    // README's "2-4 second" stinger spec.
    const MAX_STINGER_WAIT_MS = 6000;

    function flushPending() {
        // Idempotent — multiple events ('ended', 'error', play().catch(),
        // safety timer) can race; only the first call does work.
        if (stingerSafetyTimer) {
            clearTimeout(stingerSafetyTimer);
            stingerSafetyTimer = null;
        }
        const cb = pendingOnEnd;
        const next = pendingLoop;
        if (!cb && !next) return;
        pendingOnEnd = null;
        pendingLoop = null;
        const elapsed = Date.now() - stingerStartedAt;
        const remaining = Math.max(0, MIN_STINGER_HOLD_MS - elapsed);
        const finish = () => {
            if (cb) {
                try { cb(); } catch { /* swallow */ }
            }
            if (next) crossfadeToTrack(next);
        };
        if (remaining > 0) setTimeout(finish, remaining);
        else finish();
    }

    stinger.addEventListener('ended', flushPending);
    stinger.addEventListener('error', flushPending);

    return {
        getTheme() { return theme; },
        getCurrentTrack() { return activeTrack; },
        setTheme(newTheme) {
            if (newTheme === theme) return;
            theme = newTheme;
            // Clear activeTrack so the next playLoop call crossfades into
            // the new theme's source even if the track id is the same.
            // The element keeps playing the old-theme audio in the
            // meantime; the upcoming crossfade fades it out.
            activeTrack = null;
        },
        playLoop(track) {
            if (theme === 'none' || !HOST_AUDIO_LOOPS.has(track)) return;
            if (activeTrack === track && !loops[activeIdx].paused) return;
            pendingLoop = null;
            crossfadeToTrack(track);
        },
        /**
         * Plays a stinger (one-shot) in isolation. Optional `followLoop` is
         * crossfaded in when the stinger ends; optional `onEnd` fires at the
         * same moment, *before* the loop's crossfade starts — this is the
         * sync point for a visual reveal (e.g. veil drop + question fly-in).
         *
         * 'final' is a universal one-shot played from `audio/final.aac`
         * regardless of the current theme; it never has a follow-up.
         * @param {string} track
         * @param {string|null} [followLoop]
         * @param {Function} [onEnd]
         */
        playStinger(track, followLoop, onEnd) {
            const isUniversal = track === 'final';
            if (!isUniversal && theme === 'none') {
                // No audio path — but still fire onEnd so visual transitions
                // proceed even when the host picked "Keine Musik".
                pendingOnEnd = onEnd || null;
                pendingLoop = null;
                stingerStartedAt = Date.now();
                flushPending();
                return;
            }
            if (!isUniversal && !HOST_AUDIO_STINGERS.has(track)) return;
            // Quick fade-out on whichever loop is playing so the stinger
            // doesn't fight it. 250 ms is short enough to feel like a
            // hand-off rather than a pause.
            for (const a of loops) {
                detachWrap(a);
                if (a.paused) {
                    cancelFade(a);
                    a.volume = 0;
                } else {
                    rampVolume(a, 0, FADE_MS, () => a.pause());
                }
            }
            activeTrack = null;
            stinger.src = isUniversal
                ? HOST_AUDIO_FINAL_PATH
                : audioFilePath(theme, track);
            stinger.currentTime = 0;
            stinger.volume = STINGER_VOLUME;
            pendingLoop = followLoop || null;
            pendingOnEnd = onEnd || null;
            stingerStartedAt = Date.now();
            const p = stinger.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => flushPending());
            }
        },
        stop() {
            pendingLoop = null;
            activeTrack = null;
            for (const a of loops) {
                cancelFade(a);
                detachWrap(a);
                a.pause();
                a.volume = 0;
            }
            cancelFade(stinger);
            stinger.pause();
        },
    };
}

let hostMusicEngine = null;
let hostMusicVoteTally = {
    arcade: 0, cinematic: 0, modern_minimal: 0, classical: 0, none: 0,
};
let hostMusicLocked = false;
let hostMusicWinner = null;
// Lobby music is host-controlled (separate from the in-game vote). The teacher
// can switch themes in class to glimpse each, including "Keine".
let hostLobbyMusicTheme = LOBBY_HOST_MUSIC_DEFAULT;

/**
 * Returns an array of non-host players from quizState.
 * @returns {Array<object>} Array of player objects excluding the host.
 */
function getNonHostPlayers() {
    if (!hostGlobalQuizState) return [];
    return Object.values(hostGlobalQuizState.players);
}

/**
 * Returns only connected players (for answer counting).
 * @returns {Array<object>} Array of connected player objects.
 */
function getConnectedNonHostPlayers() {
    return getNonHostPlayers().filter((p) => p.isConnected !== false);
}

/**
 * Retrieves and sorts player data for the leaderboard (descending by score).
 * @returns {Array<object>} Sorted array of player objects with name and score.
 */
function getLeaderboardData() {
    return getNonHostPlayers()
        .map((p) => ({ name: p.name, avatar: p.avatar || '', score: p.score }))
        .toSorted((a, b) => b.score - a.score);
}

/**
 * Returns the count of connected players.
 * @returns {number} Number of connected players.
 */
function getNonHostPlayerCount() {
    return getConnectedNonHostPlayers().length;
}

/**
 * Initializes all features and event listeners for the host role.
 * @param reconnectInfo
 */
async function initializeHostFeatures(reconnectInfo) {
    // logger.log("Initializing Host Features. Initialized flag:", isHostInitialized);
    // Initialize quiz state if not already set
    if (!hostGlobalQuizState) {
        hostGlobalQuizState = {
            currentQuestionIndex: 0,
            questions: [], // Stores original questions
            shuffledQuestions: [], // Stores shuffled questions for the current quiz session
            players: {}, // Player structure includes score and answer time
            answersReceived: 0,
            isQuestionActive: false,
            roomId: null, // This will be the 4-digit alphanumeric code
            durationMin: 20, // Minimum question duration in seconds
            durationMax: 40, // Maximum question duration in seconds
            questionDurations: [], // Per-question durations (computed at quiz start)
        };
    }
    if (!hostMusicEngine) hostMusicEngine = createMusicEngine();

    const quizState = hostGlobalQuizState;
    // Cache DOM elements for performance
    const jsonFileInput = document.querySelector('#json-file');
    const fileStatus = document.querySelector('#file-status');
    const questionForm = document.querySelector('#question-form');
    const questionText = document.querySelector('#question-text');
    const addOptionBtn = document.querySelector('#add-option-btn');
    const questionsContainer = document.querySelector('#questions-container');
    const durationMinInput = document.querySelector('#question-duration-min');
    const durationMaxInput = document.querySelector('#question-duration-max');
    const startQuizBtn = document.querySelector('#start-quiz-btn');
    const qrContainer = document.querySelector('#qr-container');
    const hostSetup = document.querySelector('#host-setup');
    const qrcodeElement = document.querySelector('#qrcode');
    const roomIdElement = document.querySelector('#room-id');
    const joinLinkElement = document.querySelector('#join-link');
    const joinLinkModalElement = document.querySelector('#join-link-modal');
    const playerCountElement = document.querySelector('#player-count');
    const playersList = document.querySelector('#players-list');
    const startQuestionsBtn = document.querySelector('#start-questions-btn');
    const hostQuestionDisplay = document.querySelector('#host-question-display');
    const currentQuestionTextEl = document.querySelector('#current-question-text');
    const hostCurrentOptionsEl = document.querySelector('#host-current-options');
    const questionCounterEl = document.querySelector('#question-counter');
    const timerBar = document.querySelector('#timer-bar');
    const answersCount = document.querySelector('#answers-count');
    const totalPlayers = document.querySelector('#total-players');
    const hostScoreboardEl = document.querySelector('#host-scoreboard');
    const scoreboardListEl = document.querySelector('#scoreboard-list');
    const showNextBtn = document.querySelector('#show-next-btn');
    const showResultsBtn = document.querySelector('#show-results-btn');
    const hostResults = document.querySelector('#host-results');
    const leaderboard = document.querySelector('#leaderboard');
    const newQuizBtn = document.querySelector('#new-quiz-btn');
    hostViewHeading = document.querySelector('#host-view-heading'); // Cache the heading

    // Set default duration input values
    durationMinInput.value = quizState.durationMin;
    durationMaxInput.value = quizState.durationMax;

    // Only set up event listeners once
    if (!isHostInitialized) {
        // logger.log("Setting up host event listeners for the first time.");

        // Validates a single MC question; freetext (no options/correct) is filtered out
        const isValidMCQuestion = (q) =>
            q &&
            typeof q.question === 'string' &&
            q.question.trim().length > 0 &&
            Array.isArray(q.options) &&
            q.options.length > 0 &&
            q.options.every((o) => typeof o === 'string') &&
            Array.isArray(q.correct) &&
            q.correct.length > 0 &&
            q.correct.every((idx) => Number.isInteger(idx) && idx >= 0 && idx < q.options.length);

        // Pulls the candidate-card array from a parsed deck blob, regardless of
        // whether it's a bare array, `{cards:[...]}`, or `{questions:[...]}`.
        const getCandidates = (data) => {
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.cards)) return data.cards;
            if (data && Array.isArray(data.questions)) return data.questions;
            return [];
        };

        // Extracts MC questions from a parsed JSON blob (array or {cards:[...]})
        const extractMCQuestions = (data) => getCandidates(data).filter((q) => isValidMCQuestion(q));

        // Reads a single File as text
        const readFileText = (file) => file.text();

        // Reads a single File as ArrayBuffer
        const readFileBuffer = (file) => file.arrayBuffer();

        // Processes a list of Files (JSON or ZIP), aggregates MC questions
        const importFiles = async (files) => {
            if (!files || files.length === 0) return;
            const collected = [];
            let processedFiles = 0;
            let skippedFreetext = 0;
            let failedFiles = 0;

            for (const file of files) {
                const isJson =
                    file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
                const isZip =
                    file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip');
                if (!isJson && !isZip) {
                    failedFiles++;
                    continue;
                }

                try {
                    if (isZip) {
                        if (typeof JSZip === 'undefined') {
                            fileStatus.textContent =
                                'ZIP-Unterstützung nicht verfügbar (JSZip nicht geladen).';
                            return;
                        }
                        const buffer = await readFileBuffer(file);
                        const zip = await JSZip.loadAsync(buffer);
                        const entries = [];
                        for (const [relPath, entry] of Object.entries(zip.files)) {
                            if (!entry.dir && relPath.toLowerCase().endsWith('.json')) {
                                entries.push(entry);
                            }
                        }
                        for (const entry of entries) {
                            try {
                                const content = await entry.async('string');
                                const data = JSON.parse(content);
                                const mc = extractMCQuestions(data);
                                const total = getCandidates(data).length;
                                skippedFreetext += Math.max(0, total - mc.length);
                                collected.push(...mc);
                                processedFiles++;
                            } catch {
                                failedFiles++;
                            }
                        }
                    } else {
                        const text = await readFileText(file);
                        const data = JSON.parse(text);
                        const mc = extractMCQuestions(data);
                        const total = getCandidates(data).length;
                        skippedFreetext += Math.max(0, total - mc.length);
                        collected.push(...mc);
                        processedFiles++;
                    }
                } catch (error) {
                    console.error('Import error:', error);
                    failedFiles++;
                }
            }

            if (collected.length > 0) {
                quizState.questions = collected;
                const parts = [
                    `Importiert: ${collected.length} MC-Fragen aus ${processedFiles} Datei(en).`,
                ];
                if (skippedFreetext > 0)
                    parts.push(`${skippedFreetext} Freitext-Frage(n) übersprungen.`);
                if (failedFiles > 0) parts.push(`${failedFiles} Datei(en) fehlgeschlagen.`);
                fileStatus.textContent = parts.join(' ');
            } else {
                quizState.questions = [];
                fileStatus.textContent =
                    'Keine gültigen MC-Fragen gefunden. Nur Multiple-Choice-Fragen werden importiert.';
            }
            sendCategoriesToServer();
            renderQuestionsList();
        };

        // File input change
        jsonFileInput.addEventListener('change', (event) => {
            importFiles([...(event.target.files || [])]);
            event.target.value = '';
        });

        // Drag-and-drop on the drop zone
        const quizDropZone = document.querySelector('#quiz-drop-zone');
        if (quizDropZone) {
            quizDropZone.addEventListener('click', () => jsonFileInput.click());

            quizDropZone.addEventListener('dragenter', (e) => {
                e.preventDefault();
                quizDropZone.classList.add('drag-over');
            });
            quizDropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                quizDropZone.classList.add('drag-over');
            });
            quizDropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                if (!quizDropZone.contains(e.relatedTarget)) {
                    quizDropZone.classList.remove('drag-over');
                }
            });
            quizDropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                quizDropZone.classList.remove('drag-over');
                const files = e.dataTransfer && e.dataTransfer.files;
                if (files && files.length > 0) {
                    importFiles([...files]);
                }
            });
        }

        // Event listener for adding new option input fields
        addOptionBtn.addEventListener('click', () => {
            const optionGroups = questionForm.querySelectorAll('.option-group');
            const newIndex = optionGroups.length + 1;
            const optionGroup = document.createElement('div');
            optionGroup.className = 'option-group';
            optionGroup.innerHTML = `<input type="text" class="option-input" placeholder="Option ${newIndex}"><input type="checkbox" class="correct-checkbox"><label>Richtig</label>`;
            addOptionBtn.before(optionGroup);
        });

        // Event listener for submitting a new question
        questionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const question = questionText.value.trim();
            if (!question) {
                showMessage('Bitte gebe eine Frage ein', 'error');
                return;
            }

            const optionInputs = questionForm.querySelectorAll('.option-input');
            const options = [];
            const correct = [];

            for (const inputEl of optionInputs) {
                const optionText = inputEl.value.trim();
                if (optionText) {
                    const currentIndex = options.length;
                    options.push(optionText);
                    const checkbox = inputEl.parentElement.querySelector('.correct-checkbox');
                    if (checkbox && checkbox.checked) {
                        correct.push(currentIndex);
                    }
                }
            }

            if (options.length < 2) {
                showMessage('Bitte füge mindestens zwei gültige Optionen hinzu', 'error');
                return;
            }
            if (correct.length === 0) {
                showMessage('Bitte wähle mindestens eine richtige Antwort aus', 'error');
                return;
            }

            quizState.questions.push({ question, options, correct });
            questionText.value = '';
            for (const [index, group] of questionForm.querySelectorAll('.option-group').entries()) {
                const input = group.querySelector('.option-input');
                const checkbox = group.querySelector('.correct-checkbox');
                if (index < 2) {
                    if (input) input.value = '';
                    if (checkbox) checkbox.checked = false;
                } else {
                    group.remove();
                }
            }
            renderQuestionsList();
        });

        // Event listener for starting the quiz
        startQuizBtn.addEventListener('click', async () => {
            if (quizState.questions.length === 0) {
                showMessage('Bitte füge mindestens eine Frage hinzu.', 'error');
                return;
            }
            const dMin = Number.parseInt(durationMinInput.value, 10);
            const dMax = Number.parseInt(durationMaxInput.value, 10);
            if (Number.isNaN(dMin) || Number.isNaN(dMax) || dMin < 5 || dMax > 80 || dMin > dMax) {
                showMessage('Bitte gültige Fragedauer eingeben: Min 5-80, Max >= Min.', 'error');
                return;
            }
            // Validate question and option lengths against server limits
            const MAX_QUESTION_LENGTH = 4000;
            const MAX_OPTION_LENGTH = 500;
            const MAX_OPTIONS = 20;
            for (let i = 0; i < quizState.questions.length; i++) {
                const q = quizState.questions[i];
                if (q.question.length > MAX_QUESTION_LENGTH) {
                    showMessage(
                        `Frage ${i + 1} ist zu lang (${q.question.length}/${MAX_QUESTION_LENGTH} Zeichen).`,
                        'error'
                    );
                    return;
                }
                if (q.options.length > MAX_OPTIONS) {
                    showMessage(
                        `Frage ${i + 1} hat zu viele Optionen (${q.options.length}/${MAX_OPTIONS}).`,
                        'error'
                    );
                    return;
                }
                const longOption = q.options.findIndex((o) => o.length > MAX_OPTION_LENGTH);
                if (longOption !== -1) {
                    showMessage(
                        `Frage ${i + 1}, Option ${longOption + 1} ist zu lang (${q.options[longOption].length}/${MAX_OPTION_LENGTH} Zeichen).`,
                        'error'
                    );
                    return;
                }
            }

            quizState.durationMin = dMin;
            quizState.durationMax = dMax;

            // Shuffle questions once when quiz starts
            quizState.shuffledQuestions = [...quizState.questions]; // Create a copy
            shuffleArray(quizState.shuffledQuestions);

            // Pre-compute per-question durations based on character count
            const charCounts = quizState.shuffledQuestions.map(
                (q) => q.question.length + q.options.reduce((sum, o) => sum + o.length, 0)
            );
            const minChars = Math.min(...charCounts);
            const maxChars = Math.max(...charCounts);
            const charRange = maxChars - minChars;
            quizState.questionDurations = charCounts.map((count) => {
                if (charRange === 0) return Math.round((dMin + dMax) / 2);
                const t = (count - minChars) / charRange;
                return Math.round(dMin + t * (dMax - dMin));
            });

            await initHostConnection();
        });

        // Event listener for starting questions (after players join)
        startQuestionsBtn.addEventListener('click', async () => {
            if (getNonHostPlayerCount() === 0) {
                showMessage('Es sind noch keine Spieler beigetreten!', 'info');
                return;
            }
            // Lock the music vote at start. The server replies with the
            // winning theme; the dispatch handler wires the engine accordingly.
            if (hostWs && hostWs.readyState === WebSocket.OPEN) {
                hostWs.send(JSON.stringify({ type: 'lock_music_vote' }));
            }
            // The actual hide-qr / show-question swap happens inside
            // startQuestion's reveal callback (after the new_question
            // stinger ends), not here, so the veil can cover the swap.
            quizState.currentQuestionIndex = 0;
            await startQuestion();
        });

        // Event listener for moving to the next question
        showNextBtn.addEventListener('click', async () => {
            quizState.currentQuestionIndex++;
            await startQuestion();
        });

        // Event listener for showing final results
        showResultsBtn.addEventListener('click', showFinalResults);

        // Event listener for starting a new quiz
        newQuizBtn.addEventListener('click', async () => {
            if (hostMusicEngine) hostMusicEngine.stop();
            // Terminate room on server and close WebSocket
            clearActiveSession();
            if (hostWs && hostWs.readyState === WebSocket.OPEN) {
                hostWs.send(JSON.stringify({ type: 'terminate' }));
            } else if (hostRoomId && hostSessionId) {
                // Host is disconnected — open one-shot connection to terminate
                try {
                    const savedRoomId = hostRoomId;
                    const savedSessionId = hostSessionId;
                    const tempWs = new WebSocket(WS_URL);
                    tempWs.addEventListener('open', () => {
                        tempWs.send(
                            JSON.stringify({
                                type: 'reconnect_host',
                                roomId: savedRoomId,
                                sessionId: savedSessionId,
                            })
                        );
                    });
                    tempWs.addEventListener(
                        'message',
                        () => {
                            tempWs.send(JSON.stringify({ type: 'terminate' }));
                            tempWs.close();
                        },
                        { once: true }
                    );
                    tempWs.addEventListener('error', () => tempWs.close());
                } catch {
                    // Server's 5-minute timeout will handle cleanup
                }
            }
            if (hostWs) {
                suppressHostReconnect = true;
                hostWs.close();
                hostWs = null;
            }

            hostRoomId = null;
            hostSessionId = null;
            hostGlobalQuizState = null;
            hostPendingQuestion = null;
            isHostInitialized = false;
            fileStatus.textContent = '';
            if (jsonFileInput) jsonFileInput.value = '';
            hostResults.classList.add('hidden');
            hostQuestionDisplay.classList.add('hidden');
            qrContainer.classList.add('hidden');
            hostSetup.classList.remove('hidden');
            document.querySelector('#role-selection').classList.remove('hidden');
            if (hostViewHeading) hostViewHeading.classList.remove('hidden');
            initializeHostFeatures();
        });

        // Clean up on window unload
        if (hostBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', hostBeforeUnloadHandler);
        }
        hostBeforeUnloadHandler = () => {
            if (hostWs) hostWs.close();
        };
        window.addEventListener('beforeunload', hostBeforeUnloadHandler);

        // Event listener for opening the QR code modal
        qrcodeElement.addEventListener('click', () => {
            if (qrModalOverlay && largeQrcodeContainer && hostRoomId) {
                qrModalOverlay.classList.remove('hidden');
                largeQrcodeContainer.innerHTML = ''; // Clear previous QR
                // QRCode renders into the container as a side effect of construction.
                // eslint-disable-next-line sonarjs/constructor-for-side-effects
                new QRCode(largeQrcodeContainer, {
                    text: joinLinkElement.href,
                    width: 300,
                    height: 300,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H,
                });
                modalRoomIdSpan.textContent = quizState.roomId;
            }
        });

        isHostInitialized = true;
    }

    renderQuestionsList();
    refreshPlayerDisplay();

    // Logic to determine which host section to display on initialization/re-entry
    if (hostRoomId) {
        // Check if a room is already established
        if (
            quizState.isQuestionActive ||
            quizState.currentQuestionIndex < quizState.shuffledQuestions.length
        ) {
            hostSetup.classList.add('hidden');
            qrContainer.classList.add('hidden');
            hostResults.classList.add('hidden');
            hostQuestionDisplay.classList.remove('hidden');
            if (hostViewHeading) hostViewHeading.classList.add('hidden'); // Hide "Quiz hosten" heading
            // Re-render current question details if returning to view
            const currentQuestion = quizState.shuffledQuestions[quizState.currentQuestionIndex];
            currentQuestionTextEl.textContent = currentQuestion.question;
            // Options are displayed without correct indicators while question is active
            displayHostOptions(currentQuestion.shuffledOptions || currentQuestion.options, []); // Use shuffled if available
            questionCounterEl.textContent = `Frage ${quizState.currentQuestionIndex + 1} von ${quizState.shuffledQuestions.length}`;
            answersCount.textContent = quizState.answersReceived.toString();
            totalPlayers.textContent = getNonHostPlayerCount().toString();
            if (quizState.currentQuestionIndex < quizState.shuffledQuestions.length - 1)
                showNextBtn.classList.remove('hidden');
            else showResultsBtn.classList.remove('hidden');
        } else if (hostResults.classList.contains('active')) {
            hostSetup.classList.add('hidden');
            qrContainer.classList.add('hidden');
            hostQuestionDisplay.classList.add('hidden');
            hostResults.classList.remove('hidden');
            if (hostViewHeading) hostViewHeading.classList.remove('hidden'); // Show "Quiz hosten" heading
            displayLeaderboard();
        } else {
            // Room is open, but quiz not active, show QR container
            hostSetup.classList.add('hidden');
            qrContainer.classList.remove('hidden');
            if (hostViewHeading) hostViewHeading.classList.remove('hidden'); // Show "Quiz hosten" heading
            const currentJoinUrl = updateJoinLink(hostRoomId); // Get the current join URL
            generateQRCode(currentJoinUrl); // Generate QR with the full URL
            roomIdElement.textContent = quizState.roomId || 'N/A';
            startHostLobbyMusic();
        }
    } else {
        // Default: show setup if no room instance
        hostSetup.classList.remove('hidden');
        qrContainer.classList.add('hidden');
        hostQuestionDisplay.classList.add('hidden');
        hostResults.classList.add('hidden');
        if (hostViewHeading) hostViewHeading.classList.remove('hidden'); // Show "Quiz hosten" heading
    }

    // Auto-reconnect host if called with reconnectInfo (page reload scenario)
    if (reconnectInfo && reconnectInfo.roomId && reconnectInfo.sessionId) {
        initHostReconnection(reconnectInfo);
    }

    /**
     * Renders the list of added questions in the host setup view.
     */
    function renderQuestionsList() {
        questionsContainer.innerHTML = '';
        if (quizState.questions.length === 0) {
            questionsContainer.innerHTML = '<p>Noch keine Fragen hinzugefügt</p>';
            startQuizBtn.classList.add('hidden');
            return;
        }

        for (const [index, q] of quizState.questions.entries()) {
            const item = document.createElement('div');
            item.className = 'question-item';
            const correctIndices = q.correct.map((i) => i + 1).join(', ');
            item.innerHTML = `
                        <p><strong>F${index + 1}:</strong> ${sanitizeHTML(q.question)}</p>
                        <p><strong>Optionen:</strong> ${q.options.map((o) => sanitizeHTML(o)).join('; ')}</p>
                        <p><strong>Richtige Option(en):</strong> ${correctIndices}</p>
                        <button class="btn remove-question" data-index="${index}">Entfernen</button>
                    `;
            questionsContainer.append(item);
        }

        for (const button of document.querySelectorAll('.remove-question')) {
            button.addEventListener('click', (e) => {
                const index = Number.parseInt(e.target.dataset.index);
                quizState.questions.splice(index, 1);
                renderQuestionsList();
            });
        }

        startQuizBtn.classList.remove('hidden');
    }

    /**
     * Central handler for all host-side WebSocket messages.
     * Shared between initHostConnection, initHostReconnection, and reconnectHostWs.
     * @param msg
     */
    function handleHostMessage(msg) {
        switch (msg.type) {
            case 'room_created': {
                hostRoomId = msg.roomId;
                hostSessionId = msg.sessionId;
                quizState.roomId = msg.roomId.slice(0, 2) + ' ' + msg.roomId.slice(2, 4);
                hostSetup.classList.add('hidden');
                qrContainer.classList.remove('hidden');
                roomIdElement.textContent = quizState.roomId;
                const currentJoinUrl = updateJoinLink(hostRoomId);
                generateQRCode(currentJoinUrl);
                if (hostViewHeading) hostViewHeading.classList.remove('hidden');
                saveActiveSession('host', hostRoomId, hostSessionId);
                startHostLobbyMusic();
                break;
            }

            case 'host_reconnected': {
                logger.log('Host reconnected, restoring player state');
                if (msg.players) {
                    for (const p of msg.players) {
                        if (quizState.players[p.sessionId]) {
                            quizState.players[p.sessionId].isConnected = p.isConnected;
                            quizState.players[p.sessionId].score = p.score;
                            if (p.avatar) quizState.players[p.sessionId].avatar = p.avatar;
                        } else {
                            quizState.players[p.sessionId] = {
                                id: p.sessionId,
                                name: p.name,
                                avatar: p.avatar || '',
                                score: p.score,
                                currentAnswer: [],
                                answerTime: null,
                                isConnected: p.isConnected,
                            };
                        }
                    }
                }
                if (msg.musicTally) hostMusicVoteTally = msg.musicTally;
                hostMusicLocked = !!msg.musicLocked;
                if (msg.musicWinner) {
                    hostMusicWinner = msg.musicWinner;
                    if (hostMusicLocked && hostMusicEngine) {
                        hostMusicEngine.setTheme(hostMusicWinner);
                    }
                }
                renderHostMusicStatus();
                // Push categories again in case server lost them (e.g. restored room).
                sendCategoriesToServer();
                refreshPlayerDisplay();
                // Do NOT auto-restart the active question on reconnect: the
                // host's local state (timer, options, players' submissions)
                // is intact, and re-calling startQuestion would replay the
                // new_question stinger and reset the timer for everyone.
                // We just resume in place; the server kept relaying answers
                // through the brief disconnect window.
                if (hostPendingQuestion) {
                    // Resend question that failed to send before disconnect
                    logger.log('Resending pending question after reconnect');
                    if (hostWs && hostWs.readyState === WebSocket.OPEN) {
                        hostWs.send(JSON.stringify(hostPendingQuestion));
                        hostPendingQuestion = null;
                    }
                }
                break;
            }

            case 'player_joined': {
                const joinedName =
                    sanitizePlayerName(msg.name) || `Spieler ${msg.sessionId.slice(0, 4)}`;
                quizState.players[msg.sessionId] = {
                    id: msg.sessionId,
                    name: joinedName,
                    avatar: typeof msg.avatar === 'string' ? msg.avatar : '',
                    score: 0,
                    currentAnswer: [],
                    answerTime: null,
                    isConnected: true,
                };
                refreshPlayerDisplay();
                // Late joiners need the current category list pushed to them
                // via the server (which has it cached). Nothing to do here.
                break;
            }

            case 'player_avatar': {
                if (quizState.players[msg.sessionId]) {
                    quizState.players[msg.sessionId].avatar =
                        typeof msg.avatar === 'string' ? msg.avatar : '';
                    refreshPlayerDisplay();
                }
                break;
            }

            case 'music_vote_update': {
                if (msg.tally) hostMusicVoteTally = msg.tally;
                hostMusicLocked = !!msg.locked;
                if (msg.winner) hostMusicWinner = msg.winner;
                renderHostMusicStatus();
                if (hostMusicLocked && hostMusicEngine) {
                    const prevTrack = hostMusicEngine.getCurrentTrack();
                    hostMusicEngine.setTheme(hostMusicWinner || 'none');
                    if (prevTrack && hostMusicWinner && hostMusicWinner !== 'none') {
                        hostMusicEngine.playLoop(prevTrack);
                    }
                }
                if (hostMusicLocked) renderHostLobbyMusicOptions();
                break;
            }

            case 'player_left': {
                if (quizState.players[msg.sessionId]) {
                    quizState.players[msg.sessionId].isConnected = false;
                    refreshPlayerDisplay();
                    if (
                        quizState.isQuestionActive &&
                        quizState.answersReceived >= getNonHostPlayerCount()
                    ) {
                        endQuestion();
                    }
                }
                break;
            }

            case 'player_reconnected': {
                const reconnectedName =
                    sanitizePlayerName(msg.name) || `Spieler ${msg.sessionId.slice(0, 4)}`;
                const reconnectedAvatar = typeof msg.avatar === 'string' ? msg.avatar : '';
                if (quizState.players[msg.sessionId]) {
                    quizState.players[msg.sessionId].isConnected = true;
                    quizState.players[msg.sessionId].score = msg.score;
                    quizState.players[msg.sessionId].name = reconnectedName;
                    if (reconnectedAvatar) {
                        quizState.players[msg.sessionId].avatar = reconnectedAvatar;
                    }
                } else {
                    quizState.players[msg.sessionId] = {
                        id: msg.sessionId,
                        name: reconnectedName,
                        avatar: reconnectedAvatar,
                        score: msg.score,
                        currentAnswer: [],
                        answerTime: null,
                        isConnected: true,
                    };
                }
                refreshPlayerDisplay();
                break;
            }

            case 'player_answered': {
                handlePlayerAnswer(msg);
                break;
            }

            case 'error': {
                showMessage(msg.message, 'error');
                break;
            }
        }
    }

    /**
     * Initializes WebSocket connection for the host, creates a room, and sets up message handlers.
     */
    async function initHostConnection() {
        hostWsReconnectAttempts = 0;
        suppressHostReconnect = false;

        try {
            hostWs = await connectWithRetry(WS_URL);
        } catch {
            showMessage('Server nicht erreichbar. Bitte versuche es später erneut.', 'error');
            return;
        }

        logger.log('Host WebSocket connected');
        hostWs.send(JSON.stringify({ type: 'create_room' }));

        hostWs.addEventListener('message', (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }
            handleHostMessage(msg);
        });

        hostWs.addEventListener('close', () => {
            logger.log('Host WebSocket closed');
            if (suppressHostReconnect) return;
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                const delay = reconnectBackoffMs(hostWsReconnectAttempts);
                showMessage(
                    `Verbindung unterbrochen. Reconnect ${hostWsReconnectAttempts}/${HOST_MAX_RECONNECT_ATTEMPTS}…`,
                    'info'
                );
                setTimeout(reconnectHostWs, delay);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        hostWs.addEventListener('error', (err) => {
            console.error('Host WebSocket error:', err);
        });
    }

    /**
     * Reconnects the host to an existing room after a full page reload.
     * Uses saved session info to restore the connection without re-entering room code.
     * @param {object} info - { roomId, sessionId }
     */
    async function initHostReconnection(info) {
        hostWsReconnectAttempts = 0;
        suppressHostReconnect = false;
        hostRoomId = info.roomId;
        hostSessionId = info.sessionId;
        quizState.roomId = info.roomId.slice(0, 2) + ' ' + info.roomId.slice(2, 4);

        try {
            hostWs = await connectWithRetry(WS_URL);
        } catch {
            showMessage('Server nicht erreichbar. Bitte versuche es später erneut.', 'error');
            clearActiveSession();
            hostRoomId = null;
            hostSessionId = null;
            document.querySelector('#role-selection').classList.remove('hidden');
            showView('role-selection');
            return;
        }

        hostWs.send(
            JSON.stringify({ type: 'reconnect_host', roomId: hostRoomId, sessionId: hostSessionId })
        );

        hostWs.addEventListener('message', (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (msg.type === 'room_not_found_try_restore') {
                // Room expired on server — no quiz state to restore after page reload
                showMessage('Der Raum ist abgelaufen. Bitte starte ein neues Quiz.', 'error');
                clearActiveSession();
                hostRoomId = null;
                hostSessionId = null;
                document.querySelector('#role-selection').classList.remove('hidden');
                showView('role-selection');
                return;
            }

            if (msg.type === 'error') {
                showMessage(msg.message, 'error');
                clearActiveSession();
                hostRoomId = null;
                hostSessionId = null;
                document.querySelector('#role-selection').classList.remove('hidden');
                showView('role-selection');
                return;
            }

            // For host_reconnected: show the QR/waiting view
            if (msg.type === 'host_reconnected') {
                hostSetup.classList.add('hidden');
                qrContainer.classList.remove('hidden');
                roomIdElement.textContent = quizState.roomId;
                const currentJoinUrl = updateJoinLink(hostRoomId);
                generateQRCode(currentJoinUrl);
                if (hostViewHeading) hostViewHeading.classList.remove('hidden');
                startHostLobbyMusic();
            }

            // Delegate to the standard host message handler
            handleHostMessage(msg);
        });

        hostWs.addEventListener('close', () => {
            logger.log('Host WebSocket closed');
            if (suppressHostReconnect) return;
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                const delay = reconnectBackoffMs(hostWsReconnectAttempts);
                showMessage(
                    `Verbindung unterbrochen. Reconnect ${hostWsReconnectAttempts}/${HOST_MAX_RECONNECT_ATTEMPTS}…`,
                    'info'
                );
                setTimeout(reconnectHostWs, delay);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        hostWs.addEventListener('error', (err) => {
            console.error('Host WebSocket error:', err);
        });
    }

    reconnectHostWs = function reconnectHostWs() {
        suppressHostReconnect = false;
        const ws = new WebSocket(WS_URL);

        ws.addEventListener('open', () => {
            logger.log('Host WebSocket reconnected');
            hostWsReconnectAttempts = 0;
            ws.send(
                JSON.stringify({
                    type: 'reconnect_host',
                    roomId: hostRoomId,
                    sessionId: hostSessionId,
                })
            );
        });

        ws.addEventListener('message', (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (msg.type === 'room_not_found_try_restore') {
                logger.log('Room needs restoration. Sending state...');
                const playersToRestore = [];
                if (hostGlobalQuizState && hostGlobalQuizState.players) {
                    for (const p of Object.values(hostGlobalQuizState.players)) {
                        playersToRestore.push({
                            id: p.id,
                            name: p.name,
                            score: p.score,
                        });
                    }
                }

                ws.send(
                    JSON.stringify({
                        type: 'restore_room',
                        roomId: hostRoomId,
                        sessionId: hostSessionId,
                        players: playersToRestore,
                    })
                );
                return;
            }

            handleHostMessage(msg);
        });

        ws.addEventListener('close', () => {
            logger.log('Host WebSocket closed');
            if (suppressHostReconnect) return;
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                const delay = reconnectBackoffMs(hostWsReconnectAttempts);
                showMessage(
                    `Verbindung unterbrochen. Reconnect ${hostWsReconnectAttempts}/${HOST_MAX_RECONNECT_ATTEMPTS}…`,
                    'info'
                );
                setTimeout(reconnectHostWs, delay);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        ws.addEventListener('error', (err) => {
            console.error('Host WebSocket error:', err);
        });

        hostWs = ws;
    };

    /**
     * Handles a player answer received via WebSocket.
     * @param {object} msg - The answer message from the server.
     */
    function handlePlayerAnswer(msg) {
        const playerId = msg.sessionId;
        if (!quizState.players[playerId] || !quizState.isQuestionActive) return;

        const p = quizState.players[playerId];
        // Gate by explicit flag so a timeout-empty answer can't be followed by
        // a second, non-empty submission from the same player (double-count).
        if (p.hasAnswered) return;
        p.hasAnswered = true;

        quizState.answersReceived++;
        // Use server-measured elapsed time for fair scoring (immune to client clock manipulation)
        const timeTaken =
            msg.elapsedMs === null || msg.elapsedMs === undefined
                ? (Date.now() - hostQuestionStartTime) / 1000
                : msg.elapsedMs / 1000;
        p.answerTime = timeTaken;
        p.currentAnswer = msg.answerData;
        answersCount.textContent = quizState.answersReceived.toString();

        if (quizState.answersReceived >= getNonHostPlayerCount()) {
            endQuestion();
        }
    }

    /**
     * Renders the host's music-vote status line below the player list. Shows
     * the live tally before the vote locks; once locked, shows the chosen
     * theme so the host knows what's about to play.
     */
    /**
     * Renders the host's lobby music selector buttons. Click switches theme +
     * starts/stops playback. Independent from the player vote.
     */
    function renderHostLobbyMusicOptions() {
        const section = document.querySelector('.host-lobby-music');
        if (section) section.classList.toggle('hidden', hostMusicLocked);
        const el = document.querySelector('#host-lobby-music-options');
        if (!el) return;
        el.innerHTML = '';
        const options = [
            { id: 'none', label: 'Keine' },
            ...LOBBY_MUSIC_THEMES,
        ];
        for (const opt of options) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'host-music-option';
            btn.dataset.theme = opt.id;
            btn.textContent = opt.label;
            if (opt.id === hostLobbyMusicTheme) btn.classList.add('selected');
            btn.addEventListener('click', () => setHostLobbyMusic(opt.id));
            el.append(btn);
        }
    }

    /**
     * Switches the lobby music theme (host-side only) and persists it. After
     * the music vote locks, this no-ops because in-game music takes over.
     * @param {string} themeId
     */
    function setHostLobbyMusic(themeId) {
        if (hostMusicLocked) return;
        if (themeId !== 'none' && !LOBBY_MUSIC_THEMES.some((t) => t.id === themeId)) return;
        hostLobbyMusicTheme = themeId;
        try { localStorage.setItem(LOBBY_HOST_MUSIC_STORAGE_KEY, themeId); } catch { /* private mode */ }
        if (hostMusicEngine) {
            hostMusicEngine.setTheme(themeId);
            if (themeId === 'none') hostMusicEngine.stop();
            else hostMusicEngine.playLoop('lobby');
        }
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
            hostWs.send(JSON.stringify({ type: 'set_lobby_music', theme: themeId }));
        }
        renderHostLobbyMusicOptions();
    }

    /**
     * Called when the host enters the lobby/QR view. Restores the saved theme
     * (or default Lofi) and starts the lobby loop.
     */
    function startHostLobbyMusic() {
        if (hostMusicLocked) return;
        let saved = null;
        try { saved = localStorage.getItem(LOBBY_HOST_MUSIC_STORAGE_KEY); } catch { /* private mode */ }
        if (saved && (saved === 'none' || LOBBY_MUSIC_THEMES.some((t) => t.id === saved))) {
            hostLobbyMusicTheme = saved;
        }
        if (hostMusicEngine) {
            hostMusicEngine.setTheme(hostLobbyMusicTheme);
            if (hostLobbyMusicTheme !== 'none') hostMusicEngine.playLoop('lobby');
        }
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
            hostWs.send(JSON.stringify({ type: 'set_lobby_music', theme: hostLobbyMusicTheme }));
        }
        renderHostLobbyMusicOptions();
    }

    function renderHostMusicStatus() {
        const el = document.querySelector('#host-music-status');
        if (!el) return;
        const total = Object.values(hostMusicVoteTally).reduce((a, n) => a + (n || 0), 0);
        if (hostMusicLocked) {
            el.classList.remove('hidden');
            const label = LOBBY_MUSIC_THEME_LABELS[hostMusicWinner] || 'Keine Musik';
            el.textContent = `Musik-Theme: ${label}`;
            return;
        }
        if (total === 0) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        el.classList.remove('hidden');
        const parts = [];
        for (const theme of LOBBY_MUSIC_VOTE_OPTIONS) {
            parts.push(`${theme.label}: ${hostMusicVoteTally[theme.id] || 0}`);
        }
        el.textContent = `Musik-Stimmen — ${parts.join(' · ')}`;
    }

    /**
     * Collects the unique category labels across all imported MC questions
     * and pushes them to the server so joining players can see the topic
     * preview. Sent every time the question pool changes.
     */
    function sendCategoriesToServer() {
        if (!hostWs || hostWs.readyState !== WebSocket.OPEN) return;
        const seen = new Set();
        const ordered = [];
        for (const q of quizState.questions || []) {
            const cats = Array.isArray(q.categories) ? q.categories : [];
            for (const c of cats) {
                if (typeof c !== 'string') continue;
                const cleaned = c.trim();
                if (!cleaned || seen.has(cleaned)) continue;
                seen.add(cleaned);
                ordered.push(cleaned);
            }
        }
        hostWs.send(JSON.stringify({ type: 'set_categories', categories: ordered }));
    }

    /**
     * Refreshes the displayed list of players from local state (no DB query needed).
     */
    function refreshPlayerDisplay() {
        const allPlayers = getNonHostPlayers();
        const connectedCount = getConnectedNonHostPlayers().length;

        playerCountElement.textContent = connectedCount.toString();
        totalPlayers.textContent = connectedCount.toString();

        playersList.innerHTML = '';
        for (const p of allPlayers) {
            const i = document.createElement('div');
            i.className = 'player-item';
            if (p.isConnected === false) i.classList.add('disconnected');
            const avatarHtml = p.avatar
                ? `<span class="player-avatar" aria-hidden="true">${sanitizeHTML(p.avatar)}</span>`
                : '';
            const offlineSuffix = p.isConnected === false ? ' (getrennt)' : '';
            i.innerHTML = `${avatarHtml}<span class="player-name">${sanitizeHTML(p.name)}${sanitizeHTML(offlineSuffix)}</span>`;
            playersList.append(i);
        }

        startQuestionsBtn.classList.toggle('hidden', connectedCount === 0);
    }

    /**
     * Generates and displays a QR code for the given URL.
     * @param {string} url - The URL to encode in the QR code.
     */
    function generateQRCode(url) {
        qrcodeElement.innerHTML = ''; // Clear previous QR code
        if (typeof QRCode === 'undefined') {
            console.error('QR-Code-Bibliothek nicht geladen.');
            qrcodeElement.innerHTML = `<p class="qr-error">QR-Code-Bibliothek nicht geladen. URL: ${sanitizeHTML(url)}</p>`;
            return;
        }
        try {
            new QRCode(qrcodeElement, {
                text: url, // Encode the full URL
                width: 240, // Increased size for initial display
                height: 240,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H, // High error correction for complex URLs
            });
        } catch (error) {
            console.error('QR Code generation error:', error);
            qrcodeElement.innerHTML = `<p class="qr-error">Fehler beim Generieren des QR-Codes. URL: ${sanitizeHTML(url)}</p>`;
        }
    }

    /**
     * Updates the join link to include the room code as a URL parameter.
     * @param {string} roomId - The room ID (4-digit alphanumeric code).
     * @returns {string} The full join URL.
     */
    function updateJoinLink(roomId) {
        // Correctly construct the URL by taking the base path and appending the query parameter
        const baseUrl = globalThis.location.origin + globalThis.location.pathname.split('?')[0];
        const joinUrl = `${baseUrl}?host=${roomId}`;
        joinLinkElement.href = joinUrl;
        // Display the short URL for easy typing
        const shortUrl = 'bycs.link/karten';
        joinLinkElement.textContent = shortUrl;

        joinLinkModalElement.href = joinUrl;
        joinLinkModalElement.textContent = shortUrl;

        return joinUrl; // Return the URL for QR code generation
    }

    /**
     * Starts a new question round on the host side.
     */
    async function startQuestion() {
        if (quizState.currentQuestionIndex >= quizState.shuffledQuestions.length) {
            showFinalResults();
            return;
        }

        const currentQuestion = quizState.shuffledQuestions[quizState.currentQuestionIndex];
        quizState.answersReceived = 0;
        quizState.isQuestionActive = true;

        // Prepare shuffled options and correct indices for this question
        const optionObjects = currentQuestion.options.map((text, index) => ({
            text,
            originalIndex: index,
        }));
        shuffleArray(optionObjects); // Shuffle the options
        const shuffledOptions = optionObjects.map((obj) => obj.text);
        const shuffledCorrectIndices = currentQuestion.correct.map((originalIdx) =>
            optionObjects.findIndex((obj) => obj.originalIndex === originalIdx)
        );

        // Store shuffled options and correct indices in the current question object
        currentQuestion.shuffledOptions = shuffledOptions;
        currentQuestion.shuffledCorrect = shuffledCorrectIndices;

        // Reset player answers for the new question in local state
        for (const p of Object.values(quizState.players)) {
            p.currentAnswer = [];
            p.answerTime = null;
            p.hasAnswered = false;
        }

        // Phase 1: raise the veil and play the new_question stinger. The
        // question is *not* visible to host or players yet — the veil covers
        // the host screen and players still see the previous view.
        const veilTheme = hostMusicWinner || hostLobbyMusicTheme || 'none';
        raisePhaseVeil(veilTheme);

        // Phase 2: when the stinger ends, the reveal callback fires the
        // simultaneous DOM swap on host + sends start_question to players.
        const reveal = () => {
            // Make sure the right host containers are visible (covers both
            // first-question case and between-question case).
            qrContainer.classList.add('hidden');
            hostResults.classList.add('hidden');
            hostQuestionDisplay.classList.remove('hidden');

            // Populate the question UI.
            currentQuestionTextEl.textContent = currentQuestion.question;
            displayHostOptions(shuffledOptions, []);
            questionCounterEl.textContent = `Frage ${quizState.currentQuestionIndex + 1} von ${quizState.shuffledQuestions.length}`;
            answersCount.textContent = '0';
            totalPlayers.textContent = getNonHostPlayerCount().toString();

            showNextBtn.classList.add('hidden');
            showResultsBtn.classList.add('hidden');
            hostScoreboardEl.classList.add('hidden');
            if (hostViewHeading) hostViewHeading.classList.add('hidden');

            // Anchor the timer's wall-clock at the actual reveal moment,
            // not when the stinger started — fair scoring.
            hostQuestionStartTime = Date.now();
            const currentDuration = quizState.questionDurations[quizState.currentQuestionIndex];
            startTimer(currentDuration);

            // Fire the question to players now (server timestamps it for fair
            // timing). They'll see it land at almost exactly the same moment.
            sendQuestionToPlayers(currentQuestion);

            // Lower the veil and animate the question content sliding up.
            lowerPhaseVeil();
            flyInElement(hostQuestionDisplay);
        };

        if (hostMusicEngine) {
            // Engine fires `reveal` at stinger end (or immediately when the
            // theme is "none" / file is empty, padded to MIN_STINGER_HOLD_MS).
            hostMusicEngine.playStinger('new_question', 'question', reveal);
        } else {
            // Engine not initialised — keep the veil tiny then reveal.
            setTimeout(reveal, 250);
        }
    }

    /**
     * Displays the question options on the host side.
     * @param {string[]} options - An array of option strings (already shuffled if applicable).
     * @param {number[]} [correctIndices] - An optional array of indices for correct answers (already re-mapped if applicable).
     * @param {number[]} [optionCounts] - An optional array of counts for each option selected by players.
     */
    function displayHostOptions(options, correctIndices = [], optionCounts = []) {
        hostCurrentOptionsEl.innerHTML = '';
        const correctSet = new Set(correctIndices);
        for (const [index, option] of options.entries()) {
            const li = document.createElement('li');
            let optionText = option;
            if (optionCounts && optionCounts[index] !== undefined) {
                optionText += ` (${optionCounts[index]}x gewählt)`;
            }
            li.textContent = optionText;
            if (correctSet.has(index)) {
                li.classList.add('correct');
            }
            hostCurrentOptionsEl.append(li);
        }
    }

    /**
     * Sends question data to all connected players via WebSocket server.
     * @param {object} question - The question object to send (contains shuffled options and correct indices).
     */
    async function sendQuestionToPlayers(question) {
        const questionPayload = {
            type: 'start_question',
            question: question.question,
            options: question.shuffledOptions,
            index: quizState.currentQuestionIndex,
            total: quizState.shuffledQuestions.length,
            startTime: hostQuestionStartTime,
            duration: quizState.questionDurations[quizState.currentQuestionIndex],
        };

        if (!hostWs || hostWs.readyState !== WebSocket.OPEN) {
            showMessage(
                'Keine Verbindung zum Server. Frage wird nach Reconnect gesendet.',
                'error'
            );
            hostPendingQuestion = questionPayload;
            return;
        }
        hostPendingQuestion = null;
        hostWs.send(JSON.stringify(questionPayload));
    }

    /**
     * Starts the timer for the current question.
     * @param {number} durationSeconds - The total duration of the timer in seconds.
     */
    function startTimer(durationSeconds) {
        timerBar.style.width = '100%';
        if (hostTimerInterval) clearInterval(hostTimerInterval);

        const totalDurationMs = durationSeconds * 1000;
        const timerStartTime = Date.now();

        hostTimerInterval = setInterval(() => {
            const elapsed = Date.now() - timerStartTime;
            const remaining = Math.max(0, totalDurationMs - elapsed);
            timerBar.style.width = `${(remaining / totalDurationMs) * 100}%`;

            if (remaining <= 0) {
                // Wait a grace period for client auto-submits to arrive
                clearInterval(hostTimerInterval);
                hostTimerInterval = null;
                setTimeout(() => endQuestion(), 2000);
            }
        }, 100); // Update every 100ms
    }

    /**
     * Ends the current question round, calculates scores, and displays results.
     */
    async function endQuestion() {
        if (!quizState.isQuestionActive) return;

        if (hostTimerInterval) {
            clearInterval(hostTimerInterval);
            hostTimerInterval = null;
        }

        quizState.isQuestionActive = false;

        // Phase 1 (no veil yet): reveal correct answers in-place on the
        // question display so the audience can see what was right while the
        // time_up stinger plays.
        const currentQuestion = quizState.shuffledQuestions[quizState.currentQuestionIndex];
        const optionCounts = Array.from({ length: currentQuestion.shuffledOptions.length }).fill(0);
        for (const p of getNonHostPlayers()) {
            if (p.currentAnswer && Array.isArray(p.currentAnswer)) {
                for (const ansIndex of p.currentAnswer) {
                    if (optionCounts[ansIndex] !== undefined) {
                        optionCounts[ansIndex]++;
                    }
                }
            }
        }
        displayHostOptions(
            currentQuestion.shuffledOptions,
            currentQuestion.shuffledCorrect,
            optionCounts
        );

        calculateScores();
        await sendResultsToPlayers();

        // Phase 2: play the time_up stinger. On its end, raise the veil over
        // the question display, swap to the leaderboard, then drop the veil
        // with the scoreboard flying in. The leaderboard loop crossfades in
        // right after, queued via the stinger's followLoop.
        const veilTheme = hostMusicWinner || hostLobbyMusicTheme || 'none';
        const isFinal =
            quizState.currentQuestionIndex >= quizState.shuffledQuestions.length - 1;

        const goToLeaderboard = () => {
            raisePhaseVeil(veilTheme);
            // Hold a beat (~180 ms — the veil's fade-in) before swapping the
            // DOM under the cover of full-opacity veil, then drop the veil
            // and fly-in the scoreboard.
            setTimeout(() => {
                displayCurrentScoreboard();
                if (isFinal) {
                    showNextBtn.classList.add('hidden');
                    showResultsBtn.classList.remove('hidden');
                } else {
                    showNextBtn.classList.remove('hidden');
                    showResultsBtn.classList.add('hidden');
                }
                lowerPhaseVeil();
                flyInElement(hostScoreboardEl);
            }, 200);
        };

        if (hostMusicEngine) {
            hostMusicEngine.playStinger('time_up', 'leaderboard', goToLeaderboard);
        } else {
            setTimeout(goToLeaderboard, 250);
        }
    }

    /**
     * Calculates scores for the current question based on correctness and time taken.
     */
    function calculateScores() {
        const currentQ = quizState.shuffledQuestions[quizState.currentQuestionIndex]; // Use shuffled questions
        const correctSet = new Set(currentQ.shuffledCorrect); // Use shuffled correct indices
        const totalQuestionTime = quizState.questionDurations[quizState.currentQuestionIndex];
        const numQuestions = quizState.shuffledQuestions.length;
        const totalOptions = currentQ.shuffledOptions.length;
        const totalWrong = totalOptions - correctSet.size;

        const basePointsFirst = 100;
        const basePointsLast = 300;
        let currentQuestionBasePoints = basePointsFirst;

        if (numQuestions > 1) {
            const pointsIncreasePerQuestion =
                (basePointsLast - basePointsFirst) / (numQuestions - 1);
            currentQuestionBasePoints =
                basePointsFirst + quizState.currentQuestionIndex * pointsIncreasePerQuestion;
        }

        for (const p of getNonHostPlayers()) {
            if (p.currentAnswer && p.currentAnswer.length > 0) {
                const playerAnsSet = new Set(p.currentAnswer);

                const correctHits = [...playerAnsSet].filter((item) => correctSet.has(item)).length;
                const wrongHits = [...playerAnsSet].filter((item) => !correctSet.has(item)).length;

                // Proportional penalty: subtract wrong ratio from correct ratio
                const correctRatio = correctHits / correctSet.size;
                const wrongPenalty = totalWrong > 0 ? wrongHits / totalWrong : 0;
                const adjustedRatio = Math.max(0, correctRatio - wrongPenalty);

                if (adjustedRatio > 0) {
                    let timeTaken = p.answerTime === null ? totalQuestionTime : p.answerTime;
                    // Clamp timeTaken to avoid negative or excessive values
                    timeTaken = Math.max(0, Math.min(timeTaken, totalQuestionTime));

                    const timeRemaining = Math.max(0, totalQuestionTime - timeTaken);
                    const timeBonus =
                        (timeRemaining / totalQuestionTime) * (currentQuestionBasePoints * 0.5);

                    p.score += adjustedRatio * (currentQuestionBasePoints + timeBonus);
                }
            }
        }
    }

    /**
     * Sends results of the current question to all players via WebSocket server.
     */
    async function sendResultsToPlayers() {
        if (!hostWs || hostWs.readyState !== WebSocket.OPEN) return;

        const currentQ = quizState.shuffledQuestions[quizState.currentQuestionIndex];
        const isFinalQ = quizState.currentQuestionIndex === quizState.shuffledQuestions.length - 1;
        // Optimize: Only send leaderboard on final question
        const leaderboardData = isFinalQ ? getLeaderboardData() : null;

        // Build playerScores map so server can store scores for reconnection
        const playerScores = {};
        for (const p of getNonHostPlayers()) {
            playerScores[p.id] = p.score;
        }

        hostWs.send(
            JSON.stringify({
                type: 'send_results',
                correct: currentQ.shuffledCorrect,
                isFinal: isFinalQ,
                // options: currentQ.shuffledOptions, // Removed: Players use local copy
                leaderboard: leaderboardData,
                playerScores: playerScores,
            })
        );
        // logger.log('Results sent via WebSocket');
    }

    /**
     * Displays the current scoreboard (top 10) on the host side.
     */
    function displayCurrentScoreboard() {
        const sortedPlayers = getLeaderboardData(); // This function already filters out the host
        scoreboardListEl.innerHTML = '';
        hostScoreboardEl.classList.remove('hidden');
        // No music call here: the leaderboard loop is queued by `endQuestion`
        // (after the time_up stinger) and starts itself once the stinger ends.

        const topPlayers = sortedPlayers.slice(0, 10);

        if (topPlayers.length === 0) {
            scoreboardListEl.innerHTML = '<li>Noch keine Spieler.</li>';
            return;
        }

        for (const [idx, p] of topPlayers.entries()) {
            const li = document.createElement('li');
            li.className = 'scoreboard-item';
            switch (idx) {
                case 0: {
                    li.classList.add('rank-1');
                    break;
                }
                case 1: {
                    li.classList.add('rank-2');
                    break;
                }
                case 2: {
                    li.classList.add('rank-3');
                    break;
                }
            }
            const avatarHtml = p.avatar
                ? `<span class="player-avatar" aria-hidden="true">${sanitizeHTML(p.avatar)}</span>`
                : '';
            li.innerHTML = `<span class="player-row"><span class="player-rank">${idx + 1}.</span>${avatarHtml}<span class="player-name">${sanitizeHTML(p.name)}</span></span><span class="player-score">${Math.round(p.score)} Punkte</span>`;
            scoreboardListEl.append(li);
        }
    }

    /**
     * Shows the final results leaderboard on the host side.
     */
    function showFinalResults() {
        hostQuestionDisplay.classList.add('hidden');
        hostResults.classList.remove('hidden'); // Ensure host results view is shown
        if (hostViewHeading) hostViewHeading.classList.remove('hidden'); // Show "Quiz hosten" heading

        displayLeaderboard();
        flyInElement(hostResults);
        // Universal `audio/final.aac` (theme-agnostic applause / ovation).
        // No follow-up loop: the final screen sits in silence after the
        // ovation finishes, which matches the README's "palate cleanser" goal.
        if (hostMusicEngine) hostMusicEngine.playStinger('final');

        // No need to send 'final' broadcast here, it's already sent with the last 'result'
        // This function just handles the host UI transition
    }

    /**
     * Displays the final leaderboard on the host side.
     */
    function displayLeaderboard() {
        const sortedPlayers = getLeaderboardData(); // This function already filters out the host
        leaderboard.innerHTML = '';

        if (sortedPlayers.length === 0) {
            leaderboard.innerHTML = '<p>Noch keine Spieler in der Rangliste.</p>';
            return;
        }

        for (const [idx, p] of sortedPlayers.entries()) {
            const i = document.createElement('div');
            i.className = 'leaderboard-item';
            switch (idx) {
                case 0: { i.classList.add('rank-1'); break; }
                case 1: { i.classList.add('rank-2'); break; }
                case 2: { i.classList.add('rank-3'); break; }
            }
            const avatarHtml = p.avatar
                ? `<span class="player-avatar" aria-hidden="true">${sanitizeHTML(p.avatar)}</span>`
                : '';
            i.innerHTML = `<span class="player-row"><span class="player-rank">${idx + 1}.</span>${avatarHtml}<span class="player-name">${sanitizeHTML(p.name)}</span></span><span class="player-score">${Math.round(p.score)} Punkte</span>`;
            leaderboard.append(i);
        }
    }
}

// --- Player State & Initialization Flag ---
let playerWs = null;
let playerRoomId = null;
let playerCurrentId = null;
let isPlayerInitialized = false;
let playerTimerInterval = null;
let playerCurrentQuestionOptions = [];
let selectedAnswers = [];
let playerHasSubmitted = false;
let playerWasAutoSubmitted = false;
let playerScore = 0;
// Lobby-only state (cosmetic; resets on a fresh join):
let playerAvatarBase = LOBBY_AVATAR_BASE_DEFAULT;
let playerAvatarAccessory = null; // null = bare base
let playerAvatar = composeAvatar(playerAvatarBase, playerAvatarAccessory);
let playerVote = null; // theme id ('arcade' | 'cinematic' | 'modern_minimal' | 'classical' | 'none') or null
let playerLobbyTally = {
    arcade: 0, cinematic: 0, modern_minimal: 0, classical: 0, none: 0,
};
let playerLobbyMusicLocked = false;
let playerLobbyMusicWinner = null;
let playerLobbyHostMusic = 'modern_minimal'; // host's currently-playing lobby theme
let playerLobbyCategories = [];
let playerLobbyAvatarRendered = false;
let playerCurrentQuestionIndex = -1;
let playerBeforeUnloadHandler = null;
let suppressPlayerReconnect = false;
// Assigned inside initPlayerConnection so the visibilitychange handler at the
// module scope can re-trigger the same connection setup (handlers, retry logic).
let playerConnectFn = null;

/**
 * Reconnects the player WebSocket (called from visibilitychange).
 */
function reconnectPlayerWs() {
    if (playerWs) {
        suppressPlayerReconnect = true;
        playerWs.close();
        playerWs = null;
    }
    if (playerConnectFn) {
        suppressPlayerReconnect = false;
        playerConnectFn();
    }
}

// --- Player Persistence Helpers ---
/**
 * Gets the localStorage key for storing player ID for a specific room.
 * @param {string} roomId - The room ID.
 * @returns {string} The localStorage key.
 */
function getPlayerStorageKey(roomId) {
    return `quiz_player_${roomId}`;
}

/**
 * Log player-side WebSocket errors. Module-scope so the inline `addEventListener`
 * callback inside connectPlayerWs doesn't push nesting past 4 levels.
 * @param {Event} err
 */
function onPlayerWsError(err) {
    console.error('Player WebSocket error:', err);
}

/**
 * Saves player session data to localStorage.
 * @param {string} roomId - The room ID.
 * @param {string} playerId - The player's unique ID.
 * @param {string} playerName - The player's name.
 */
function savePlayerSession(roomId, playerId, playerName) {
    const sessionData = {
        playerId: playerId,
        playerName: playerName,
        timestamp: Date.now(),
    };
    localStorage.setItem(getPlayerStorageKey(roomId), JSON.stringify(sessionData));
}

/**
 * Retrieves player session data from localStorage.
 * @param {string} roomId - The room ID.
 * @returns {object | null} The session data or null if not found/expired.
 */
function getPlayerSession(roomId) {
    const key = getPlayerStorageKey(roomId);
    const data = localStorage.getItem(key);
    if (!data) return null;

    try {
        const sessionData = JSON.parse(data);
        const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - sessionData.timestamp > SESSION_EXPIRY_MS) {
            localStorage.removeItem(key);
            return null;
        }
        return sessionData;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
}

// --- Active Session Helpers (for auto-reconnect on page load) ---
const ACTIVE_SESSION_KEY = 'quiz_active_session';

/**
 * Saves the active session info so the user can auto-reconnect after page refresh.
 * @param {string} role - 'host' or 'player'
 * @param {string} roomId - The room ID
 * @param {string} sessionId - The session ID from the server
 * @param {string} [playerName] - Player name (only for player role)
 */
function saveActiveSession(role, roomId, sessionId, playerName) {
    localStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify({
            role,
            roomId,
            sessionId,
            playerName: playerName || null,
            timestamp: Date.now(),
        })
    );
}

/**
 * Retrieves the active session info from localStorage.
 * @returns {object | null} Session data or null if not found/expired (2h expiry).
 */
function getActiveSession() {
    const data = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!data) return null;
    try {
        const session = JSON.parse(data);
        if (Date.now() - session.timestamp > 2 * 60 * 60 * 1000) {
            localStorage.removeItem(ACTIVE_SESSION_KEY);
            return null;
        }
        return session;
    } catch {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        return null;
    }
}

/**
 * Clears the active session info from localStorage.
 */
function clearActiveSession() {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    // Hide reconnect buttons since session is no longer valid
    const rHost = document.querySelector('#reconnect-host-btn');
    const rPlayer = document.querySelector('#reconnect-player-btn');
    if (rHost) rHost.classList.add('hidden');
    if (rPlayer) rPlayer.classList.add('hidden');
}

/**
 * Triggers confetti animation for correct answers.
 */
function triggerConfetti() {
    const confettiContainer = document.querySelector('#confetti-container');
    if (!confettiContainer) {
        console.warn('Confetti-Container nicht gefunden.');
        return;
    }

    const colors = [
        '#f44336',
        '#e91e63',
        '#9c27b0',
        '#673ab7',
        '#3f51b5',
        '#2196f3',
        '#03a9f4',
        '#00bcd4',
        '#009688',
        '#4CAF50',
        '#8bc34a',
        '#cddc39',
        '#ffeb3b',
        '#ffc107',
        '#ff9800',
        '#ff5722',
    ];
    const numConfetti = 50;

    for (let i = 0; i < numConfetti; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.top = `${-20 - Math.random() * 100}px`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;

        confettiContainer.append(piece);

        piece.addEventListener('animationend', () => {
            piece.remove();
        });
    }
}

/**
 * Initializes all features and event listeners for the player role.
 * @param reconnectInfo
 */
function initializePlayerFeatures(reconnectInfo) {
    // logger.log("Initializing Player Features. Initialized flag:", isPlayerInitialized);

    // Cache DOM elements for performance
    const roomCodeInput = document.querySelector('#room-code-input');
    const playerNameInput = document.querySelector('#player-name-input');
    const joinBtn = document.querySelector('#join-btn');
    const joinForm = document.querySelector('#join-form');
    const waitingRoom = document.querySelector('#waiting-room');
    const waitingMessage = document.querySelector('#waiting-message');
    const lobbyCategoriesEl = document.querySelector('#lobby-categories');
    const lobbyCategoriesListEl = document.querySelector('#lobby-categories-list');
    const lobbyMusicOptionsEl = document.querySelector('#lobby-music-options');
    const lobbyMusicStatusEl = document.querySelector('#lobby-music-status');
    const lobbyAvatarBaseEl = document.querySelector('#lobby-avatar-base');
    const lobbyAvatarBasePickerEl = document.querySelector('#lobby-avatar-base-picker');
    const lobbyAvatarAccessoriesEl = document.querySelector('#lobby-avatar-accessories');
    const playerQuestionView = document.querySelector('#player-question');
    const playerQuestionTextEl = document.querySelector('#player-question-text');
    const playerQuestionCounterEl = document.querySelector('#player-question-counter');
    const playerTimerBar = document.querySelector('#player-timer-bar');
    const optionsContainer = document.querySelector('#options-container');
    const submitAnswerBtn = document.querySelector('#submit-answer-btn');
    const playerResultView = document.querySelector('#player-result');
    const resultDisplay = document.querySelector('#result-display');
    const playerScoreEl = document.querySelector('#player-score');
    const waitingForNext = document.querySelector('#waiting-for-next');
    const playerFinalResultView = document.querySelector('#player-final-result');
    const finalScoreEl = document.querySelector('#final-score');
    const playAgainBtn = document.querySelector('#play-again-btn');
    const playerLeaderboardContainer = document.querySelector('#player-leaderboard-container');

    /**
     * Renders the radial avatar picker:
     *   - center: the chosen base (👩/🧑/👨), clickable to swap
     *   - around: the raw accessory glyphs on a ring; clicking one composes
     *     `base + ZWJ + accessory` and commits it
     * The base picker bubble is rendered into a sibling node and toggled.
     */
    function renderAvatarBuilder() {
        if (lobbyAvatarBaseEl) {
            // Center shows the composed result: base alone if no accessory,
            // or `base + ZWJ + accessory` (e.g. man + rocket = 👨‍🚀).
            lobbyAvatarBaseEl.textContent =
                composeAvatar(playerAvatarBase, playerAvatarAccessory);
            lobbyAvatarBaseEl.dataset.baseId = playerAvatarBase;
        }
        if (lobbyAvatarBasePickerEl) {
            lobbyAvatarBasePickerEl.innerHTML = '';
            for (const b of LOBBY_AVATAR_BASES) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'avatar-base-option';
                btn.dataset.baseId = b.id;
                btn.textContent = b.emoji;
                btn.setAttribute('role', 'menuitemradio');
                btn.setAttribute('aria-checked', String(b.id === playerAvatarBase));
                btn.setAttribute('aria-label', b.label);
                btn.title = b.label;
                if (b.id === playerAvatarBase) btn.classList.add('selected');
                btn.addEventListener('click', () => {
                    selectBase(b.id);
                    closeBasePicker();
                });
                lobbyAvatarBasePickerEl.append(btn);
            }
        }
        if (lobbyAvatarAccessoriesEl) {
            lobbyAvatarAccessoriesEl.innerHTML = '';
            // 15 accessories evenly distributed at 24° increments, starting at top.
            const step = 360 / LOBBY_AVATAR_ACCESSORIES.length;
            const startDeg = -90; // top of the circle
            for (const [i, acc] of LOBBY_AVATAR_ACCESSORIES.entries()) {
                const angle = startDeg + i * step;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'avatar-accessory-tile';
                btn.dataset.accessoryId = acc.id;
                btn.textContent = acc.emoji; // raw glyph, not composed
                btn.title = acc.label;
                btn.setAttribute('role', 'radio');
                btn.setAttribute('aria-checked', String(acc.id === playerAvatarAccessory));
                btn.setAttribute('aria-label', acc.label);
                btn.style.setProperty('--angle', `${angle}deg`);
                if (acc.id === playerAvatarAccessory) btn.classList.add('selected');
                btn.addEventListener('click', () => selectAccessory(acc.id));
                lobbyAvatarAccessoriesEl.append(btn);
            }
        }
        playerLobbyAvatarRendered = true;
    }

    /**
     * @param {string} baseId
     */
    function selectBase(baseId) {
        if (!LOBBY_AVATAR_BASE_SET.has(baseId)) return;
        if (baseId === playerAvatarBase) return;
        playerAvatarBase = baseId;
        commitAvatar();
        // Center shows the composed avatar, so a base swap also rebuilds the
        // center glyph (e.g. switching man → woman with rocket selected
        // recomposes 👩‍🚀 instead of leaving the center on a bare 👨).
        if (lobbyAvatarBaseEl) {
            lobbyAvatarBaseEl.textContent =
                composeAvatar(playerAvatarBase, playerAvatarAccessory);
            lobbyAvatarBaseEl.dataset.baseId = playerAvatarBase;
        }
        if (lobbyAvatarBasePickerEl) {
            for (const el of lobbyAvatarBasePickerEl.querySelectorAll('.avatar-base-option')) {
                const matches = el.dataset.baseId === baseId;
                el.classList.toggle('selected', matches);
                el.setAttribute('aria-checked', String(matches));
            }
        }
    }

    /**
     * @param {string|null} accessoryId
     */
    function selectAccessory(accessoryId) {
        // Click the same accessory again to clear it (familiar toggle UX).
        if (accessoryId === playerAvatarAccessory) accessoryId = null;
        if (accessoryId !== null && !LOBBY_AVATAR_ACCESSORY_SET.has(accessoryId)) return;
        playerAvatarAccessory = accessoryId;
        commitAvatar();
        if (lobbyAvatarBaseEl) {
            lobbyAvatarBaseEl.textContent =
                composeAvatar(playerAvatarBase, playerAvatarAccessory);
        }
        if (lobbyAvatarAccessoriesEl) {
            for (const el of lobbyAvatarAccessoriesEl.querySelectorAll('.avatar-accessory-tile')) {
                const matches = el.dataset.accessoryId === accessoryId;
                el.classList.toggle('selected', matches);
                el.setAttribute('aria-checked', String(matches));
            }
        }
    }

    /**
     * Toggles the base-swap popover that overlaps the center.
     * @param {boolean} [forceState]
     */
    function toggleBasePicker(forceState) {
        if (!lobbyAvatarBasePickerEl || !lobbyAvatarBaseEl) return;
        const wantOpen =
            typeof forceState === 'boolean'
                ? forceState
                : lobbyAvatarBasePickerEl.classList.contains('hidden');
        lobbyAvatarBasePickerEl.classList.toggle('hidden', !wantOpen);
        lobbyAvatarBaseEl.setAttribute('aria-expanded', String(wantOpen));
    }

    /**
     */
    function closeBasePicker() {
        toggleBasePicker(false);
    }

    /**
     * Rich music-vote poll: each theme is a card with an icon, name,
     * tagline, animated tally bar, and live count. Cards inherit a per-theme
     * accent color via the `data-theme` attribute (see CSS). On lock, the
     * winner card glows; the rest fade into a quiet "decided" state.
     */
    function renderMusicVote() {
        if (!lobbyMusicOptionsEl) return;
        const total = Object.values(playerLobbyTally).reduce((a, n) => a + (n || 0), 0);
        lobbyMusicOptionsEl.innerHTML = '';
        for (const opt of LOBBY_MUSIC_VOTE_OPTIONS) {
            const count = playerLobbyTally[opt.id] || 0;
            const share = total > 0 ? Math.round((count / total) * 100) : 0;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'music-poll-card';
            btn.dataset.choice = opt.id;
            btn.dataset.theme = opt.id;
            btn.setAttribute('aria-pressed', String(opt.id === playerVote));
            if (opt.id === playerVote) btn.classList.add('selected');
            if (playerLobbyMusicLocked) {
                btn.disabled = true;
                btn.classList.add('locked');
                if (opt.id === playerLobbyMusicWinner) btn.classList.add('winner');
            }
            // The "now playing" pill marks whichever card matches the host's
            // current lobby theme — but only when that theme actually plays
            // (i.e. not 'none', and not after the in-game vote is locked).
            const isNowPlaying =
                !playerLobbyMusicLocked &&
                playerLobbyHostMusic &&
                playerLobbyHostMusic !== 'none' &&
                opt.id === playerLobbyHostMusic;
            const nowBadge = isNowPlaying
                ? '<span class="music-poll-now" aria-label="Spielt gerade in der Lobby" title="Spielt gerade">🔊</span>'
                : '';
            btn.innerHTML = `
                ${nowBadge}
                <div class="music-poll-card-head">
                    <span class="music-poll-icon" aria-hidden="true">${sanitizeHTML(opt.icon)}</span>
                    <div class="music-poll-titles">
                        <span class="music-poll-name">${sanitizeHTML(opt.label)}</span>
                        <span class="music-poll-tag">${sanitizeHTML(opt.tagline || '')}</span>
                    </div>
                    <span class="music-poll-check" aria-hidden="true">✓</span>
                </div>
                <div class="music-poll-bar" role="presentation">
                    <div class="music-poll-bar-fill" style="width: ${share}%"></div>
                </div>
                <div class="music-poll-meta">
                    <span class="music-poll-count">${count} ${count === 1 ? 'Stimme' : 'Stimmen'}</span>
                    <span class="music-poll-share">${share}%</span>
                </div>
            `;
            btn.addEventListener('click', () => castMusicVote(opt.id));
            lobbyMusicOptionsEl.append(btn);
        }
        if (lobbyMusicStatusEl) {
            if (playerLobbyMusicLocked) {
                const winner = LOBBY_MUSIC_VOTE_OPTIONS.find(
                    (o) => o.id === playerLobbyMusicWinner
                );
                lobbyMusicStatusEl.innerHTML = winner
                    ? `Spielmusik: <strong>${sanitizeHTML(winner.icon)} ${sanitizeHTML(winner.label)}</strong>`
                    : 'Spielmusik: <strong>Keine Musik</strong>';
            } else {
                lobbyMusicStatusEl.textContent =
                    'Mehrheit entscheidet · Gleichstand → Keine Musik';
            }
        }
    }

    /**
     * Sends a music vote to the server (idempotent — re-clicks just resend).
     * @param {string} choice
     */
    function castMusicVote(choice) {
        if (playerLobbyMusicLocked) return;
        if (!LOBBY_MUSIC_VOTE_IDS.has(choice)) return;
        playerVote = choice;
        if (playerWs && playerWs.readyState === WebSocket.OPEN) {
            playerWs.send(JSON.stringify({ type: 'cast_music_vote', choice }));
        }
        renderMusicVote();
    }

    /**
     * Renders the topic chips. Hidden entirely when no categories present.
     */
    function renderCategoryChips() {
        if (!lobbyCategoriesEl || !lobbyCategoriesListEl) return;
        lobbyCategoriesListEl.innerHTML = '';
        if (!playerLobbyCategories || playerLobbyCategories.length === 0) {
            lobbyCategoriesEl.classList.add('hidden');
            return;
        }
        lobbyCategoriesEl.classList.remove('hidden');
        for (const cat of playerLobbyCategories) {
            const chip = document.createElement('span');
            chip.className = 'topic-chip';
            chip.textContent = cat;
            lobbyCategoriesListEl.append(chip);
        }
    }

    /**
     * One-time renders + timebox start when the waiting room first appears.
     * Idempotent — reentry on reconnect is fine.
     */
    function enterLobbyUI() {
        if (!playerLobbyAvatarRendered) renderAvatarBuilder();
        renderMusicVote();
        renderCategoryChips();
    }

    if (!isPlayerInitialized) {
        // logger.log("Setting up player event listeners for the first time.");

        if (lobbyAvatarBaseEl) {
            lobbyAvatarBaseEl.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBasePicker();
            });
        }
        // Click outside the base picker to dismiss.
        document.addEventListener('click', (e) => {
            if (!lobbyAvatarBasePickerEl || lobbyAvatarBasePickerEl.classList.contains('hidden')) return;
            if (lobbyAvatarBasePickerEl.contains(e.target)) return;
            if (lobbyAvatarBaseEl && lobbyAvatarBaseEl.contains(e.target)) return;
            closeBasePicker();
        });

        // Restore previously chosen avatar (if any) so returning players don't redo it.
        try {
            const stored = localStorage.getItem(LOBBY_AVATAR_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && LOBBY_AVATAR_BASE_SET.has(parsed.base)) {
                    playerAvatarBase = parsed.base;
                    playerAvatarAccessory =
                        parsed.accessory && LOBBY_AVATAR_ACCESSORY_SET.has(parsed.accessory)
                            ? parsed.accessory
                            : null;
                    playerAvatar = composeAvatar(playerAvatarBase, playerAvatarAccessory);
                }
            }
        } catch { /* private mode or stale schema */ }

        joinBtn.addEventListener('click', async () => {
            const roomCode = roomCodeInput.value.trim().replaceAll(/\s/g, ''); // Remove spaces
            const playerName = playerNameInput.value.trim();
            // Use a default name if player doesn't provide one
            const finalPlayerName = playerName || 'Spieler ' + generateAlphanumericId(4);

            if (!roomCode) {
                showMessage('Bitte gib einen Raum-Code ein.', 'error');
                return;
            }
            initPlayerConnection(roomCode, finalPlayerName);
        });

        submitAnswerBtn.addEventListener('click', async () => {
            if (playerHasSubmitted) return;
            if (selectedAnswers.length === 0) {
                showMessage('Bitte wähle mindestens eine Antwort aus.', 'info');
                return;
            }

            playerHasSubmitted = true;
            submitAnswerBtn.disabled = true;
            submitAnswerBtn.classList.remove('pulse-cta');
            for (const btn of optionsContainer.querySelectorAll('button.option-btn')) {
                btn.disabled = true;
            }

            if (playerTimerInterval) {
                clearInterval(playerTimerInterval);
                playerTimerInterval = null;
            }

            // Send answer via WebSocket
            if (playerWs && playerWs.readyState === WebSocket.OPEN) {
                playerWs.send(
                    JSON.stringify({
                        type: 'submit_answer',
                        answerData: selectedAnswers,
                        answerTime: new Date().toISOString(),
                    })
                );
            } else {
                showMessage(
                    'Verbindung unterbrochen. Antwort konnte nicht gesendet werden.',
                    'error'
                );
            }
        });

        playAgainBtn.addEventListener('click', () => {
            resetPlayerStateAndUI();
            isPlayerInitialized = false;
            showView('role-selection');
        });

        // Clean up on window unload using fetch+keepalive for reliable delivery
        if (playerBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', playerBeforeUnloadHandler);
        }
        playerBeforeUnloadHandler = () => {
            if (playerWs) playerWs.close();
        };
        window.addEventListener('beforeunload', playerBeforeUnloadHandler);

        isPlayerInitialized = true;
    }

    roomCodeInput.value = '';
    playerNameInput.value = '';
    joinForm.classList.remove('hidden');
    waitingRoom.classList.add('hidden');
    playerQuestionView.classList.add('hidden');
    playerResultView.classList.add('hidden');
    playerFinalResultView.classList.add('hidden');

    // Auto-reconnect player if called with reconnectInfo (page reload scenario)
    if (reconnectInfo && reconnectInfo.roomId && reconnectInfo.sessionId) {
        playerCurrentId = reconnectInfo.sessionId;
        const name = reconnectInfo.playerName || 'Spieler';
        initPlayerConnection(reconnectInfo.roomId, name);
    }

    /**
     * Initializes WebSocket connection for the player and joins a room.
     * @param {string} roomCode - The room code to join.
     * @param {string} pName - The player's name.
     */
    async function initPlayerConnection(roomCode, pName) {
        playerRoomId = roomCode;
        suppressPlayerReconnect = false;
        let playerWsReconnectAttempts = 0;
        const MAX_RECONNECT_ATTEMPTS = 30;

        joinForm.classList.add('hidden');
        waitingRoom.classList.remove('hidden');
        waitingMessage.textContent = `Verbinde mit Raum ${playerRoomId}...`;
        enterLobbyUI();

        // Check for existing session (reconnection)
        const existingSession = getPlayerSession(playerRoomId);
        const existingSessionId = existingSession ? existingSession.playerId : null;

        /**
         * Forward a WebSocket 'message' event to the parsing/dispatch helpers.
         * Top-level (relative to initPlayerConnection) so the inline callback in
         * `.then((ws) => ...)` doesn't push us past 4 levels of nesting.
         * @param {MessageEvent} event
         */
        function onPlayerWsMessage(event) {
            handlePlayerMessage(event.data);
        }

        /**
         * Handle a single player-side message (defined here so it closes over
         * `roomCode`, `pName`, etc. without bumping the inline-callback nesting
         * past 4 levels — sonarjs/no-nested-functions).
         * @param {string} data - Raw WebSocket message payload.
         */
        function handlePlayerMessage(data) {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch {
                return;
            }
            dispatchPlayerMessage(msg);
        }

        /**
         * Dispatch a parsed player-side message to the appropriate handler.
         * @param {object} msg
         */
        function dispatchPlayerMessage(msg) {
            switch (msg.type) {
                case 'joined': {
                    playerCurrentId = msg.sessionId;
                    playerScore = msg.score || 0;
                    savePlayerSession(roomCode, msg.sessionId, msg.playerName || pName);
                    saveActiveSession(
                        'player',
                        roomCode,
                        msg.sessionId,
                        msg.playerName || pName
                    );
                    {
                        const parsed = parseAvatarString(msg.avatar);
                        if (parsed) {
                            playerAvatarBase = parsed.base;
                            playerAvatarAccessory = parsed.accessory;
                            playerAvatar = composeAvatar(playerAvatarBase, playerAvatarAccessory);
                            if (playerLobbyAvatarRendered) renderAvatarBuilder();
                        }
                    }
                    if (Array.isArray(msg.categories)) playerLobbyCategories = msg.categories;
                    if (msg.musicTally) playerLobbyTally = msg.musicTally;
                    playerLobbyMusicLocked = !!msg.musicLocked;
                    playerLobbyMusicWinner = msg.musicWinner || null;
                    if (typeof msg.lobbyMusic === 'string') playerLobbyHostMusic = msg.lobbyMusic;

                    // Phase-aware view selection. The lobby UI only makes
                    // sense while the room is in 'lobby'; for any other phase
                    // a 'question' or 'result' message will follow this one
                    // and complete the transition.
                    const phase = typeof msg.phase === 'string' ? msg.phase : 'lobby';
                    if (phase === 'lobby') {
                        waitingMessage.textContent = msg.isReconnect
                            ? 'Wieder drin — wir warten auf den Host.'
                            : 'Du bist drin — wir warten auf den Host.';
                        waitingRoom.classList.remove('in-game');
                        enterLobbyUI();
                    } else if (phase === 'result') {
                        // Between questions: no replay payload, so park them
                        // in a slim "quiz running" view until the next
                        // question arrives.
                        waitingMessage.textContent = 'Quiz läuft — warte auf die nächste Frage.';
                        waitingRoom.classList.add('in-game');
                        waitingRoom.classList.remove('hidden');
                        playerQuestionView.classList.add('hidden');
                        playerResultView.classList.add('hidden');
                        playerFinalResultView.classList.add('hidden');
                    } else {
                        // 'question' or 'final': the next replay message
                        // takes over the view. Park briefly to avoid flicker.
                        waitingRoom.classList.add('in-game');
                    }
                    break;
                }

                case 'lobby_music': {
                    if (typeof msg.theme === 'string') {
                        playerLobbyHostMusic = msg.theme;
                        renderMusicVote();
                    }
                    break;
                }

                case 'categories': {
                    playerLobbyCategories = Array.isArray(msg.categories) ? msg.categories : [];
                    renderCategoryChips();
                    break;
                }

                case 'music_vote_update': {
                    if (msg.tally) playerLobbyTally = msg.tally;
                    playerLobbyMusicLocked = !!msg.locked;
                    if (msg.winner) playerLobbyMusicWinner = msg.winner;
                    renderMusicVote();
                    break;
                }

                case 'question': {
                    playerCurrentQuestionOptions = msg.options;
                    selectedAnswers = [];
                    playerCurrentQuestionIndex = msg.index;
                    displayQuestion(msg);
                    // Reconnect path: server-supplied startTime lets us show
                    // the right remaining time instead of restarting the full
                    // duration. For the normal broadcast, startTime ≈ now.
                    let remaining = msg.duration;
                    if (typeof msg.startTime === 'number') {
                        const elapsedSec = (Date.now() - msg.startTime) / 1000;
                        remaining = Math.max(0, msg.duration - elapsedSec);
                    }
                    startPlayerTimer(remaining);
                    if (msg.alreadySubmitted) {
                        // Player had submitted before disconnecting. Server
                        // still has their answer; the host won't accept a
                        // second submission, so freeze the UI accordingly.
                        playerHasSubmitted = true;
                        submitAnswerBtn.disabled = true;
                        submitAnswerBtn.classList.add('hidden');
                        submitAnswerBtn.classList.remove('pulse-cta');
                        for (const btn of optionsContainer.querySelectorAll('button.option-btn')) {
                            btn.disabled = true;
                        }
                        showMessage('Antwort wurde bereits gesendet.', 'info');
                    }
                    break;
                }

                case 'result': {
                    if (
                        msg.questionIndex !== undefined &&
                        msg.questionIndex !== playerCurrentQuestionIndex
                    ) {
                        logger.log(
                            `Ignoring stale result for question ${msg.questionIndex}, current is ${playerCurrentQuestionIndex}`
                        );
                        break;
                    }
                    const oldScore = playerScore;
                    playerScore = msg.playerScore || playerScore;
                    const gainedPoints = playerScore - oldScore;
                    displayResult(msg, selectedAnswers, playerScore, gainedPoints, oldScore);
                    waitingForNext.textContent = msg.isFinal
                        ? 'Warten auf Endergebnisse...'
                        : 'Warten auf nächste Frage...';
                    if (msg.isFinal) displayFinalResult(msg);
                    break;
                }

                case 'quiz_terminated': {
                    showMessage('Der Host hat das Quiz beendet.', 'info');
                    resetPlayerStateAndUI();
                    showView('role-selection');
                    break;
                }

                case 'error': {
                    showMessage(msg.message, 'error');
                    resetPlayerStateAndUI();
                    document.querySelector('#role-selection').classList.remove('hidden');
                    showView('role-selection');
                    break;
                }
            }
        }

        /**
         * Handle WebSocket close on the player side: schedule a reconnect or
         * surface an error after enough failures.
         */
        function handlePlayerClose() {
            logger.log('Player WebSocket closed');
            if (suppressPlayerReconnect) return;
            if (
                playerRoomId &&
                playerCurrentId &&
                playerWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS
            ) {
                playerWsReconnectAttempts++;
                const delay = reconnectBackoffMs(playerWsReconnectAttempts);
                const msg = `Verbindung unterbrochen. Reconnect ${playerWsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}…`;
                waitingMessage.textContent = msg;
                // Toast banner — visible on top of question / result / final
                // views, where the waiting-room message is hidden.
                showMessage(msg, 'info');
                setTimeout(connectPlayerWs, delay);
            } else if (playerWsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                showMessage(
                    'Verbindung zum Quiz-Raum verloren. Bitte lade die Seite neu.',
                    'error'
                );
                resetPlayerStateAndUI();
            }
        }

        /**
         *
         */
        function connectPlayerWs() {
            // Use retry helper for initial connection (handles Fly.io cold starts)
            connectWithRetry(WS_URL)
                .then((ws) => {
                    playerWs = ws;
                    logger.log('Player WebSocket connected');
                    playerWsReconnectAttempts = 0;
                    playerWs.send(
                        JSON.stringify({
                            type: 'join',
                            roomCode: roomCode,
                            playerName: pName,
                            sessionId: existingSessionId || playerCurrentId,
                            avatar: playerAvatar || '',
                        })
                    );

                    playerWs.addEventListener('message', onPlayerWsMessage);
                    playerWs.addEventListener('close', handlePlayerClose);
                    playerWs.addEventListener('error', onPlayerWsError);
                })
                .catch(() => {
                    showMessage(
                        'Server nicht erreichbar. Bitte versuche es später erneut.',
                        'error'
                    );
                    resetPlayerStateAndUI();
                    document.querySelector('#role-selection').classList.remove('hidden');
                    showView('role-selection');
                });
        }

        playerConnectFn = connectPlayerWs;
        connectPlayerWs();
    }

    /**
     * Starts the player's timer for the current question.
     * @param {number} durationSeconds - The total duration of the timer in seconds.
     */
    function startPlayerTimer(durationSeconds) {
        playerTimerBar.style.width = '100%';
        if (playerTimerInterval) clearInterval(playerTimerInterval);
        submitAnswerBtn.classList.remove('pulse-cta');

        const totalDurationMs = durationSeconds * 1000;
        const timerStartTime = Date.now();

        playerTimerInterval = setInterval(() => {
            const elapsed = Date.now() - timerStartTime;
            const remaining = Math.max(0, totalDurationMs - elapsed);
            playerTimerBar.style.width = `${(remaining / totalDurationMs) * 100}%`;

            if (!playerHasSubmitted && remaining > 0 && remaining <= 3000) {
                submitAnswerBtn.classList.add('pulse-cta');
            }

            if (remaining <= 0) {
                clearInterval(playerTimerInterval);
                playerTimerInterval = null;
                // Auto-submit current selections if player hasn't already submitted
                if (!playerHasSubmitted) {
                    playerHasSubmitted = true;
                    playerWasAutoSubmitted = selectedAnswers.length > 0;
                    submitAnswerBtn.disabled = true;
                    if (playerWs && playerWs.readyState === WebSocket.OPEN) {
                        playerWs.send(
                            JSON.stringify({
                                type: 'submit_answer',
                                answerData: selectedAnswers,
                                answerTime: new Date().toISOString(),
                            })
                        );
                    } else {
                        showMessage(
                            'Verbindung unterbrochen. Antwort konnte nicht gesendet werden.',
                            'error'
                        );
                    }
                }
                submitAnswerBtn.classList.add('hidden');
                submitAnswerBtn.classList.remove('pulse-cta');
                for (const btn of optionsContainer.querySelectorAll('button.option-btn')) {
                    btn.disabled = true;
                }
            }
        }, 100); // Update every 100ms
    }

    /**
     * Displays the question and options for the player.
     * @param {object} qData - The question data received from the host.
     */
    function displayQuestion(qData) {
        waitingRoom.classList.add('hidden');
        playerResultView.classList.add('hidden');
        playerQuestionView.classList.remove('hidden');
        flyInElement(playerQuestionView);

        playerQuestionTextEl.textContent = qData.question;
        playerQuestionCounterEl.textContent = `Frage ${qData.index + 1} von ${qData.total}`;

        optionsContainer.innerHTML = '';
        selectedAnswers = []; // Ensure selectedAnswers is reset for a new question

        // qData.options are already shuffled from the host
        for (const [index, option] of qData.options.entries()) {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = option;
            btn.dataset.index = index;

            btn.addEventListener('click', () => {
                const optIdx = Number.parseInt(btn.dataset.index);
                const pos = selectedAnswers.indexOf(optIdx);

                if (pos === -1) {
                    selectedAnswers.push(optIdx);
                    btn.classList.add('selected');
                } else {
                    selectedAnswers.splice(pos, 1);
                    btn.classList.remove('selected');
                }

                submitAnswerBtn.classList.toggle('hidden', selectedAnswers.length === 0);
            });

            optionsContainer.append(btn);
        }

        submitAnswerBtn.classList.add('hidden');
        submitAnswerBtn.classList.remove('pulse-cta');
        submitAnswerBtn.disabled = false;
        playerHasSubmitted = false;
        playerWasAutoSubmitted = false;
        for (const btn of optionsContainer.querySelectorAll('button.option-btn')) {
            btn.disabled = false;
            btn.classList.remove('correct-answer', 'incorrect-answer', 'selected'); // Clean up previous result styles
        }
    }

    /**
     * Displays the result of the just-answered question for the player.
     * @param {object} rData - The result data received from the host.
     * @param {Array<number>} playerAnswer - The player's actual answer for this question.
     * @param {number} currentScore - The player's current score (total).
     * @param {number} gainedPoints - Points gained in this round.
     * @param {number} oldScore - The previous score.
     */
    function displayResult(rData, playerAnswer, currentScore, gainedPoints = 0, oldScore = 0) {
        playerQuestionView.classList.add('hidden');
        playerResultView.classList.remove('hidden');
        flyInElement(playerResultView);

        let resultHtml = 'Deine Antwort war ';
        // Use the actual playerAnswer passed to the function
        const playerAnsSet = new Set(playerAnswer || []);
        const correctSet = new Set(rData.correct);
        // Use local options if not in payload
        const options = playerCurrentQuestionOptions; // Use locally stored options instead of network payload

        const correctHits = [...playerAnsSet].filter((item) => correctSet.has(item)).length;
        const isCompletelyCorrect =
            correctHits === correctSet.size && playerAnsSet.size === correctSet.size;

        if (!playerAnswer || playerAnswer.length === 0) {
            resultHtml = 'Du hast nicht geantwortet. ';
        } else if (isCompletelyCorrect) {
            resultHtml += '<strong class="correct">RICHTIG!</strong> ';
            triggerConfetti();
        } else if (correctHits > 0) {
            resultHtml += `<strong class="correct">TEILWEISE RICHTIG (${correctHits}/${correctSet.size})</strong> `;
        } else {
            resultHtml += '<strong class="incorrect">FALSCH.</strong> ';
        }

        if (playerWasAutoSubmitted && playerAnswer && playerAnswer.length > 0) {
            resultHtml +=
                '<br><span class="auto-submit-note">Automatisch bei Zeitablauf gesendet – kein Geschwindigkeitsbonus.</span>';
        }

        resultHtml += '<br>Richtige Antwort(en): ';

        for (const [index, option] of options.entries()) {
            // Always show correct answers
            if (correctSet.has(index)) {
                const cls = playerAnsSet.has(index) ? 'correct player-selected' : 'correct-not-selected';
                resultHtml += `<span class="${cls}">"${sanitizeHTML(option)}"</span> `;
            } else if (playerAnsSet.has(index)) {
                // Per instruction: "Do not show the falsely selected answers of the player anymore."
                // This means we don't add special classes or text for them.
                // The original text for the option will still be there, but no specific highlight.
            }
        }

        resultDisplay.innerHTML = resultHtml;

        // Display score breakdown: Old + Gained = New
        if (gainedPoints > 0) {
            playerScoreEl.innerHTML = `${Math.round(oldScore)} + <span class="score-gained">${Math.round(gainedPoints)}</span> = <strong>${Math.round(currentScore)}</strong>`;
        } else {
            playerScoreEl.textContent = Math.round(currentScore);
        }

        // Update player option buttons to show correct/incorrect after result
        for (const btn of optionsContainer.querySelectorAll('button.option-btn')) {
            const index = Number.parseInt(btn.dataset.index);
            btn.disabled = true; // Ensure buttons are disabled
            btn.classList.remove('selected'); // Remove selected class from active state

            if (correctSet.has(index)) {
                btn.classList.add('correct-answer'); // Highlight correct answer
            }
            // If the player selected a correct answer, re-apply 'selected' to show they chose it.
            if (playerAnsSet.has(index) && correctSet.has(index)) {
                btn.classList.add('selected'); // Re-apply selected style if it was correct and selected
            }
        }
    }

    /**
     * Displays the final results and leaderboard for the player.
     * @param {object} frData - The final results data received from the host.
     */
    function displayFinalResult(frData) {
        // logger.log("Displaying final results for player:", frData); // Debug log
        playerQuestionView.classList.add('hidden');
        playerResultView.classList.add('hidden');
        waitingRoom.classList.add('hidden');
        playerFinalResultView.classList.remove('hidden'); // Ensure this view is shown
        flyInElement(playerFinalResultView);

        finalScoreEl.textContent = Math.round(playerScore); // Use the global playerScore for final display

        playerLeaderboardContainer.innerHTML = '';

        if (frData.leaderboard) {
            const lbDiv = document.createElement('div');
            lbDiv.innerHTML = '<h4>Endgültige Rangliste:</h4>';
            const ol = document.createElement('ol');
            if (frData.leaderboard.length === 0) {
                ol.innerHTML = '<li>Keine Spieler in der Rangliste.</li>';
            } else {
                for (const [idx, p] of frData.leaderboard.entries()) {
                    const li = document.createElement('li');
                    switch (idx) {
                        case 0: { li.classList.add('rank-1'); break; }
                        case 1: { li.classList.add('rank-2'); break; }
                        case 2: { li.classList.add('rank-3'); break; }
                    }
                    li.textContent = `${idx + 1}. ${p.name}: ${Math.round(p.score)} Punkte`;
                    ol.append(li);
                }
            }
            lbDiv.append(ol);
            playerLeaderboardContainer.append(lbDiv);
        } else {
            playerLeaderboardContainer.innerHTML = '<p>Keine Ranglistendaten verfügbar.</p>'; // Fallback
        }
    }

    /**
     * Resets the player's state and UI to the initial join form.
     */
    function resetPlayerStateAndUI() {
        clearActiveSession();
        if (playerWs) {
            suppressPlayerReconnect = true;
            playerWs.close();
            playerWs = null;
        }
        playerConnectFn = null;

        playerScore = 0;
        selectedAnswers = [];
        playerCurrentQuestionOptions = [];
        playerCurrentQuestionIndex = -1;
        playerRoomId = null;
        playerCurrentId = null;

        roomCodeInput.value = '';
        playerNameInput.value = '';
        joinForm.classList.remove('hidden');
        waitingRoom.classList.add('hidden');
        playerQuestionView.classList.add('hidden');
        playerResultView.classList.add('hidden');
        playerFinalResultView.classList.add('hidden');
        optionsContainer.innerHTML = '';
        resultDisplay.innerHTML = '';
        playerLeaderboardContainer.innerHTML = '';
        playerScoreEl.textContent = '0';
        finalScoreEl.textContent = '0';
    }
}
