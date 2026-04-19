/**
 * WebSocket Server Configuration
 *
 * This placeholder is replaced during build/deployment with the actual server URL.
 */
// During build, '__WS_URL__' is replaced. In dev, it remains.
const RAW_URL = '__WS_URL__';
const WS_URL =
    globalThis.window !== undefined && globalThis.WS_URL && globalThis.WS_URL !== '__WS_URL__'
        ? globalThis.WS_URL
        : RAW_URL === '__WS_URL__'
          ? 'wss://qlash-server.fly.dev'
          : RAW_URL;

// --- Utility functions ---
/**
 * Displays a simple message to the user.
 * @param {string} message - The message to display.
 * @param {string} type - 'error' or 'info'.
 */
function showMessage(message, type = 'info') {
    // console.log(`Message (${type}): ${message}`);

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

/**
 * Generates a random alphanumeric ID of a specified length.
 * @param {number} length - The desired length of the ID.
 * @returns {string} The generated alphanumeric ID.
 */
function generateAlphanumericId(length) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
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
            const timeout = setTimeout(() => {
                ws.onopen = null;
                ws.onerror = null;
                ws.close();
                if (attempt < maxRetries) {
                    console.log(`WebSocket connection attempt ${attempt} timed out, retrying...`);
                    setTimeout(tryConnect, 2000 * attempt);
                } else {
                    reject(new Error('WebSocket connection failed after retries'));
                }
            }, 10_000); // 10s timeout per attempt

            ws.addEventListener('open', () => {
                clearTimeout(timeout);
                resolve(ws);
            });
            ws.onerror = () => {
                clearTimeout(timeout);
                ws.onopen = null;
                if (attempt < maxRetries) {
                    console.log(`WebSocket connection attempt ${attempt} failed, retrying...`);
                    setTimeout(tryConnect, 2000 * attempt);
                } else {
                    reject(new Error('WebSocket connection failed after retries'));
                }
            };
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
        // console.log('Tab became visible, checking connections...');

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
const HOST_MAX_RECONNECT_ATTEMPTS = 30;
const RECONNECT_DELAY_MS = 10_000;

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
    // console.log("Initializing Host Features. Initialized flag:", isHostInitialized);
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
        // console.log("Setting up host event listeners for the first time.");

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

        // Extracts MC questions from a parsed JSON blob (array or {cards:[...]})
        const extractMCQuestions = (data) => {
            let candidates = [];
            if (Array.isArray(data)) {
                candidates = data;
            } else if (data && Array.isArray(data.cards)) {
                candidates = data.cards;
            } else if (data && Array.isArray(data.questions)) {
                candidates = data.questions;
            }
            return candidates.filter((q) => isValidMCQuestion(q));
        };

        // Reads a single File as text
        const readFileText = (file) =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener('load', (e) => resolve(e.target.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            });

        // Reads a single File as ArrayBuffer
        const readFileBuffer = (file) =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener('load', (e) => resolve(e.target.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(file);
            });

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
                                const total = Array.isArray(data)
                                    ? data.length
                                    : data && Array.isArray(data.cards)
                                      ? data.cards.length
                                      : data && Array.isArray(data.questions)
                                        ? data.questions.length
                                        : 0;
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
                        const total = Array.isArray(data)
                            ? data.length
                            : data && Array.isArray(data.cards)
                              ? data.cards.length
                              : data && Array.isArray(data.questions)
                                ? data.questions.length
                                : 0;
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
            qrContainer.classList.add('hidden');
            hostQuestionDisplay.classList.remove('hidden');
            if (hostViewHeading) hostViewHeading.classList.add('hidden'); // Hide "Quiz hosten" heading
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
                        tempWs.onmessage = () => {
                            tempWs.send(JSON.stringify({ type: 'terminate' }));
                            tempWs.close();
                        };
                    });
                    tempWs.onerror = () => tempWs.close();
                } catch {
                    // Server's 5-minute timeout will handle cleanup
                }
            }
            if (hostWs) {
                hostWs.onclose = null; // Prevent reconnect on intentional close
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
                new QRCode(largeQrcodeContainer, {
                    text: joinLinkElement.href, // Use the full join link
                    width: 300, // Larger size for modal
                    height: 300,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H,
                });
                modalRoomIdSpan.textContent = quizState.roomId; // Display the 4-digit room code in modal
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
                break;
            }

            case 'host_reconnected': {
                console.log('Host reconnected, restoring player state');
                if (msg.players) {
                    for (const p of msg.players) {
                        if (quizState.players[p.sessionId]) {
                            quizState.players[p.sessionId].isConnected = p.isConnected;
                            quizState.players[p.sessionId].score = p.score;
                        } else {
                            quizState.players[p.sessionId] = {
                                id: p.sessionId,
                                name: p.name,
                                score: p.score,
                                currentAnswer: [],
                                answerTime: null,
                                isConnected: p.isConnected,
                            };
                        }
                    }
                }
                refreshPlayerDisplay();
                // If a question was active when we disconnected, restart it
                // so players get a fresh copy and answers reset
                if (quizState.isQuestionActive) {
                    console.log('Restarting active question after reconnect');
                    startQuestion();
                } else if (hostPendingQuestion) {
                    // Resend question that failed to send before disconnect
                    console.log('Resending pending question after reconnect');
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
                    score: 0,
                    currentAnswer: [],
                    answerTime: null,
                    isConnected: true,
                };
                refreshPlayerDisplay();
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
                if (quizState.players[msg.sessionId]) {
                    quizState.players[msg.sessionId].isConnected = true;
                    quizState.players[msg.sessionId].score = msg.score;
                    quizState.players[msg.sessionId].name = reconnectedName;
                } else {
                    quizState.players[msg.sessionId] = {
                        id: msg.sessionId,
                        name: reconnectedName,
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

        try {
            hostWs = await connectWithRetry(WS_URL);
        } catch {
            showMessage('Server nicht erreichbar. Bitte versuche es später erneut.', 'error');
            return;
        }

        console.log('Host WebSocket connected');
        hostWs.send(JSON.stringify({ type: 'create_room' }));

        hostWs.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }
            handleHostMessage(msg);
        };

        hostWs.addEventListener('close', () => {
            console.log('Host WebSocket closed');
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                console.log(
                    `Host reconnecting (${hostWsReconnectAttempts}/${HOST_MAX_RECONNECT_ATTEMPTS})...`
                );
                setTimeout(reconnectHostWs, RECONNECT_DELAY_MS);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        hostWs.onerror = (err) => {
            console.error('Host WebSocket error:', err);
        };
    }

    /**
     * Reconnects the host to an existing room after a full page reload.
     * Uses saved session info to restore the connection without re-entering room code.
     * @param {object} info - { roomId, sessionId }
     */
    async function initHostReconnection(info) {
        hostWsReconnectAttempts = 0;
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

        hostWs.onmessage = (event) => {
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
            }

            // Delegate to the standard host message handler
            handleHostMessage(msg);
        };

        hostWs.addEventListener('close', () => {
            console.log('Host WebSocket closed');
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                setTimeout(reconnectHostWs, RECONNECT_DELAY_MS);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        hostWs.onerror = (err) => {
            console.error('Host WebSocket error:', err);
        };
    }

    reconnectHostWs = function reconnectHostWs() {
        const ws = new WebSocket(WS_URL);

        ws.addEventListener('open', () => {
            console.log('Host WebSocket reconnected');
            hostWsReconnectAttempts = 0;
            ws.send(
                JSON.stringify({
                    type: 'reconnect_host',
                    roomId: hostRoomId,
                    sessionId: hostSessionId,
                })
            );
        });

        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (msg.type === 'room_not_found_try_restore') {
                console.log('Room needs restoration. Sending state...');
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
        };

        ws.addEventListener('close', () => {
            console.log('Host WebSocket closed');
            if (hostRoomId && hostWsReconnectAttempts < HOST_MAX_RECONNECT_ATTEMPTS) {
                hostWsReconnectAttempts++;
                setTimeout(reconnectHostWs, RECONNECT_DELAY_MS);
            } else if (hostWsReconnectAttempts >= HOST_MAX_RECONNECT_ATTEMPTS) {
                showMessage('Verbindung zum Server verloren. Bitte lade die Seite neu.', 'error');
            }
        });

        ws.onerror = (err) => {
            console.error('Host WebSocket error:', err);
        };

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
            i.textContent = p.name + (p.isConnected === false ? ' (getrennt)' : '');
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
        hostQuestionStartTime = Date.now();

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

        currentQuestionTextEl.textContent = currentQuestion.question;
        // Display options on host side WITHOUT correct indicators initially
        displayHostOptions(shuffledOptions, []); // Use shuffled options for display
        questionCounterEl.textContent = `Frage ${quizState.currentQuestionIndex + 1} von ${quizState.shuffledQuestions.length}`;
        answersCount.textContent = '0';
        totalPlayers.textContent = getNonHostPlayerCount().toString();

        showNextBtn.classList.add('hidden');
        showResultsBtn.classList.add('hidden');
        hostScoreboardEl.classList.add('hidden'); // Hide scoreboard while question is active
        if (hostViewHeading) hostViewHeading.classList.add('hidden'); // Hide "Quiz hosten" heading

        const currentDuration = quizState.questionDurations[quizState.currentQuestionIndex];
        startTimer(currentDuration);
        await sendQuestionToPlayers(currentQuestion); // Pass the question object which now contains shuffled data
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

        // Calculate option counts for display on host side
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

        // Display correct answers and counts on the host side
        displayHostOptions(
            currentQuestion.shuffledOptions,
            currentQuestion.shuffledCorrect,
            optionCounts
        );

        calculateScores();
        await sendResultsToPlayers();

        displayCurrentScoreboard(); // Display the scoreboard

        if (quizState.currentQuestionIndex < quizState.shuffledQuestions.length - 1) {
            showNextBtn.classList.remove('hidden');
            showResultsBtn.classList.add('hidden');
        } else {
            showNextBtn.classList.add('hidden');
            showResultsBtn.classList.remove('hidden');
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
        // console.log('Results sent via WebSocket');
    }

    /**
     * Displays the current scoreboard (top 10) on the host side.
     */
    function displayCurrentScoreboard() {
        const sortedPlayers = getLeaderboardData(); // This function already filters out the host
        scoreboardListEl.innerHTML = '';
        hostScoreboardEl.classList.remove('hidden');

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
            li.innerHTML = `<span>${idx + 1}. ${sanitizeHTML(p.name)}</span><span>${Math.round(p.score)} Punkte</span>`;
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

        // No need to send 'final' broadcast here, it's already sent with the last 'result'
        // This function just handles the host UI transition
    }

    /**
     * Retrieves and sorts player data for the leaderboard.
     * @returns {Array<object>} Sorted array of player objects with name and score.
     */
    function getLeaderboardData() {
        return getNonHostPlayers()
            .map((p) => ({ name: p.name, score: p.score }))
            .toSorted((a, b) => b.score - a.score);
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
            if (idx === 0) i.classList.add('rank-1');
            else if (idx === 1) i.classList.add('rank-2');
            else if (idx === 2) i.classList.add('rank-3');
            i.innerHTML = `<span>${idx + 1}. ${sanitizeHTML(p.name)}</span><span>${Math.round(p.score)} Punkte</span>`;
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
let playerScore = 0;
let playerCurrentQuestionIndex = -1;
let playerBeforeUnloadHandler = null;

/**
 * Reconnects the player WebSocket (called from visibilitychange).
 */
function reconnectPlayerWs() {
    // Capture handlers BEFORE nulling onclose, to avoid losing them
    const originalOnMessage = playerWs ? playerWs.onmessage : null;
    const originalOnClose = playerWs ? playerWs.onclose : null;
    const originalOnError = playerWs ? playerWs.onerror : null;

    if (playerWs) {
        playerWs.onclose = null; // Prevent reconnect loop from old socket closing
        playerWs.close();
    }
    const session = getPlayerSession(playerRoomId);
    const name = session ? session.playerName : 'Spieler';
    const ws = new WebSocket(WS_URL);
    ws.addEventListener('open', () => {
        ws.send(
            JSON.stringify({
                type: 'join',
                roomCode: playerRoomId,
                playerName: name,
                sessionId: playerCurrentId,
            })
        );
    });
    ws.onmessage = originalOnMessage;
    ws.addEventListener('close', originalOnClose);
    ws.onerror = originalOnError;
    playerWs = ws;
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
    // console.log("Initializing Player Features. Initialized flag:", isPlayerInitialized);

    // Cache DOM elements for performance
    const roomCodeInput = document.querySelector('#room-code-input');
    const playerNameInput = document.querySelector('#player-name-input');
    const joinBtn = document.querySelector('#join-btn');
    const joinForm = document.querySelector('#join-form');
    const waitingRoom = document.querySelector('#waiting-room');
    const waitingMessage = document.querySelector('#waiting-message');
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

    if (!isPlayerInitialized) {
        // console.log("Setting up player event listeners for the first time.");

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
        let playerWsReconnectAttempts = 0;
        const MAX_RECONNECT_ATTEMPTS = 30;

        joinForm.classList.add('hidden');
        waitingRoom.classList.remove('hidden');
        waitingMessage.textContent = `Verbinde mit Raum ${playerRoomId}...`;

        // Check for existing session (reconnection)
        const existingSession = getPlayerSession(playerRoomId);
        const existingSessionId = existingSession ? existingSession.playerId : null;

        /**
         *
         */
        function connectPlayerWs() {
            // Use retry helper for initial connection (handles Fly.io cold starts)
            connectWithRetry(WS_URL)
                .then((ws) => {
                    playerWs = ws;
                    console.log('Player WebSocket connected');
                    playerWsReconnectAttempts = 0;
                    playerWs.send(
                        JSON.stringify({
                            type: 'join',
                            roomCode: roomCode,
                            playerName: pName,
                            sessionId: existingSessionId || playerCurrentId,
                        })
                    );

                    playerWs.onmessage = (event) => {
                        let msg;
                        try {
                            msg = JSON.parse(event.data);
                        } catch {
                            return;
                        }

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
                                waitingMessage.textContent = msg.isReconnect
                                    ? 'Wieder verbunden! Warte auf Host...'
                                    : 'Verbunden! Warte auf Host...';
                                break;
                            }

                            case 'question': {
                                playerCurrentQuestionOptions = msg.options;
                                selectedAnswers = [];
                                playerCurrentQuestionIndex = msg.index;
                                displayQuestion(msg);
                                startPlayerTimer(msg.duration);
                                break;
                            }

                            case 'result': {
                                // Ignore stale results from a previous question
                                if (
                                    msg.questionIndex !== undefined &&
                                    msg.questionIndex !== playerCurrentQuestionIndex
                                ) {
                                    console.log(
                                        `Ignoring stale result for question ${msg.questionIndex}, current is ${playerCurrentQuestionIndex}`
                                    );
                                    break;
                                }
                                const oldScore = playerScore;
                                playerScore = msg.playerScore || playerScore;
                                const gainedPoints = playerScore - oldScore;
                                displayResult(
                                    msg,
                                    selectedAnswers,
                                    playerScore,
                                    gainedPoints,
                                    oldScore
                                );
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
                                document
                                    .querySelector('#role-selection')
                                    .classList.remove('hidden');
                                showView('role-selection');
                                break;
                            }
                        }
                    };

                    playerWs.addEventListener('close', () => {
                        console.log('Player WebSocket closed');
                        if (
                            playerRoomId &&
                            playerCurrentId &&
                            playerWsReconnectAttempts < MAX_RECONNECT_ATTEMPTS
                        ) {
                            playerWsReconnectAttempts++;
                            waitingMessage.textContent = `Verbindung unterbrochen. Reconnect ${playerWsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`;
                            setTimeout(connectPlayerWs, RECONNECT_DELAY_MS);
                        } else if (playerWsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                            showMessage(
                                'Verbindung zum Quiz-Raum verloren. Bitte lade die Seite neu.',
                                'error'
                            );
                            resetPlayerStateAndUI();
                        }
                    });

                    playerWs.onerror = (err) => {
                        console.error('Player WebSocket error:', err);
                    };
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

        connectPlayerWs();
    }

    /**
     * Starts the player's timer for the current question.
     * @param {number} durationSeconds - The total duration of the timer in seconds.
     */
    function startPlayerTimer(durationSeconds) {
        playerTimerBar.style.width = '100%';
        if (playerTimerInterval) clearInterval(playerTimerInterval);

        const totalDurationMs = durationSeconds * 1000;
        const timerStartTime = Date.now();

        playerTimerInterval = setInterval(() => {
            const elapsed = Date.now() - timerStartTime;
            const remaining = Math.max(0, totalDurationMs - elapsed);
            playerTimerBar.style.width = `${(remaining / totalDurationMs) * 100}%`;

            if (remaining <= 0) {
                clearInterval(playerTimerInterval);
                playerTimerInterval = null;
                // Auto-submit current selections if player hasn't already submitted
                if (!playerHasSubmitted) {
                    playerHasSubmitted = true;
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
        submitAnswerBtn.disabled = false;
        playerHasSubmitted = false;
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

        resultHtml += '<br>Richtige Antwort(en): ';

        for (const [index, option] of options.entries()) {
            // Always show correct answers
            if (correctSet.has(index)) {
                if (playerAnsSet.has(index)) {
                    resultHtml += `<span class="correct player-selected">"${sanitizeHTML(option)}"</span> `; // Correct and selected by player
                } else {
                    resultHtml += `<span class="correct-not-selected">"${sanitizeHTML(option)}"</span> `; // Correct but not selected by player
                }
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
        // console.log("Displaying final results for player:", frData); // Debug log
        playerQuestionView.classList.add('hidden');
        playerResultView.classList.add('hidden');
        waitingRoom.classList.add('hidden');
        playerFinalResultView.classList.remove('hidden'); // Ensure this view is shown

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
                    if (idx === 0) li.classList.add('rank-1');
                    else if (idx === 1) li.classList.add('rank-2');
                    else if (idx === 2) li.classList.add('rank-3');
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
            playerWs.onclose = null; // Prevent reconnect
            playerWs.close();
            playerWs = null;
        }

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
