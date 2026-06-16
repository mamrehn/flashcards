/**
 * Flashcards Learning App - Main JavaScript Module
 * Manages flashcard decks, quiz logic, and user interactions
 */

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Debounce function - delays execution until after wait time has elapsed
 * @param {(...args: unknown[]) => void} func - Function to debounce
 * @param {number} wait - Delay in milliseconds
 * @returns {(...args: unknown[]) => void} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - ensures function is called at most once per interval
 * @param {(...args: unknown[]) => void} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {(...args: unknown[]) => void} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

// ============================================================================
// Global State Management
// ============================================================================

/** @type {Array<object>} Current set of cards being studied */
let cards = [];

/** @type {number} Index of the currently displayed card */
let currentCardIndex = 0;

/** @type {number} Count of correctly answered cards */
let correctCount = 0;

/** @type {number} Count of incorrectly answered cards */
let incorrectCount = 0;

/** @type {Array<number|null>} Per-card answer score 0..1 (1=correct, partial allowed; null=not answered) */
let answeredCards = [];

/** @type {boolean} Flag to prevent double-marking answers */
let isAnswered = false;

/** @type {Array<string>} Names of currently active decks */
let activeDecks = [];

/** @type {{[deckName: string]: {cards: Array}}} Saved decks from localStorage */
let savedDecks = {};

// ── Deck-picker selection model ─────────────────────────────────────────────
// The picker's selection (which categories, which card types) is the source of
// truth here rather than in the DOM, so it survives a full re-render — e.g. when
// the user types in the search box, which rebuilds the list. Keys use a NUL
// separator that cannot appear in topic/category names.
const SEL_SEP = '\u0000';
/** @type {Set<string>} Checked categories, keyed `topicKey\0category`. */
let selectedCategories = new Set();
/** @type {Set<string>} Type chips turned OFF (default is on), keyed `topicKey\0category\0type`. */
let deselectedChips = new Set();
/**
 * @param {string} topicKey
 * @param {string} category
 * @returns {string}
 */
const catKey = (topicKey, category) => `${topicKey}${SEL_SEP}${category}`;
/**
 * @param {string} topicKey
 * @param {string} category
 * @param {'mc'|'text'|'matching'} type
 * @returns {string}
 */
const chipKey = (topicKey, category, type) => `${topicKey}${SEL_SEP}${category}${SEL_SEP}${type}`;

/** @type {Array<number>} Selected option indices for multiple choice questions */
let selectedOptionIndices = [];

/** @type {Array<[number, number]>} Matching pairs: array of [leftIndex, shuffledRightIndex] tuples */
let matchingPairs = [];

/** @type {Array<{original: number, text: string}>} Shuffled right column items for matching */
let shuffledRightItems = [];

/** @type {number|null} Currently selected left item index for matching (null if none) */
let selectedLeftIndex = null;

/** @type {number|null} Currently selected right item index for matching (null if none) */
let selectedRightIndex = null;

/** @type {HTMLElement[]} DOM element references for left column items, indexed by leftIndex */
let leftItemEls = [];

/** @type {HTMLElement[]} DOM element references for right column items, indexed by shuffledRightIndex */
let rightItemEls = [];

/** @type {number[]} Display order of unpaired left indices (restored to original slot on unlink) */
let unpairedLeftOrder = [];

/** @type {number[]} Display order of unpaired right shuffled indices */
let unpairedRightOrder = [];

/** @type {number[]} Required pairing count per shuffled right item (0 for distractors; effectiveCapacity = max(count, 1)) */
let rightRequiredCount = [];

/** @type {number[]} Required pairing count per left item (defaults to 1) */
let leftRequiredCount = [];

/** @type {number} Total required pairings for the current matching card */
let matchingRequiredCount = 0;

/** @type {boolean} True when any right item can accept more than one left item */
let isMultiRight = false;

/** @type {boolean} True when any left item can pair with more than one right item */
let isMultiLeft = false;

/** @type {boolean} True when multi-pairing is possible in either direction */
let isMultiCard = false;

/** @type {{[deckName: string]: {correct: number, incorrect: number, total: number}}} Statistics per deck */
let deckStats = {};

/** @type {string} Current study mode: 'spaced-repetition' (quiz) or 'read-through' (book view) */
let studyMode = 'spaced-repetition';

/**
 * Cram-oriented repetition ladder. Students typically repeat decks intensively
 * over the few days before an exam, so the steps expand from minutes to days
 * instead of the classic SM-2 day/week/month scale.
 */
const SR_STEP_MINUTES = [10, 30, 120, 480, 1440, 4320, 10080];

/** Human-readable duration per ladder step (parallel to SR_STEP_MINUTES) */
const SR_STEP_LABELS = ['10 Min', '30 Min', '2 Std', '8 Std', '1 Tag', '3 Tage', '7 Tage'];

/** Score at or above which an answer advances the card one ladder step */
const SR_PASS_SCORE = 0.8;

/** Score below which the card falls back to the first ladder step */
const SR_FAIL_SCORE = 0.5;

/** @type {{[cardKey: string]: {step: number, repetitions: number, nextReview: Date, lastReview?: Date, history: number[], confHistory: Array<number|null>}}} Spaced repetition data per card */
let spacedRepetitionData = {};

/**
 * Self-assessment mode: capture the student's confidence before the answer is
 * revealed, then feed back how well that estimate matched reality. On by
 * default; the choice is persisted, so opting out sticks.
 * @type {boolean}
 */
let calibrationMode = true;

/** @type {number|null} Confidence for the current card: 1=unsicher, 2=mittel, 3=sicher (null if unset) */
let currentConfidence = null;

/** @type {Array<{confidence: number, score: number}>} Confidence vs. outcome for the current session */
let sessionCalibration = [];

// ── Progress / meta-assessment journals (the "Lernreise") ──────────────────
/** @type {Array<{date:string, overallPercent:number, attempted:number, total:number, masteredCount:number, calibration:number|null, perDeck:object}>} Daily Lernstand snapshots */
let lernstandHistory = [];

/** @type {Array<{endedAt:string, deckNames:string[], cardsAnswered:number, correct:number, avgScore:number, avgConfidence:number|null}>} Completed-session log */
let sessionHistory = [];

/** @type {{deckMastered: object, bestSessionScore: number}} Earned milestones */
let achievements = { deckMastered: {}, bestSessionScore: 0 };

/** @type {string|null} Optional exam date (YYYY-MM-DD) for the readiness countdown */
let examDate = null;

/** @type {number} Overall Lernstand of the active decks when the current session started */
let sessionStartLernstand = 0;

// ============================================================================
// DOM Elements Cache
// ============================================================================

let fileInput;
let appContent;
let appTitle;
let appSubtitle;
let questionText;
let questionBack;
let sourceDeckDisplay;
let answerText;
let userAnswerInput;
let userAnswerContainer;
let userAnswerDisplay;
let optionsContainer;
let optionsContainerBack;
let selectedOptionsContainer;
let standardAnswerContainer;
let textExplanationContainer;
let textExplanationContent;
let showAnswerBtn;
let recallRating;
let nextCardBtn;
let calibrationModeCheckbox;
let confidencePrompt;
let progressBar;
let cardsRemainingElement;
let cardsCompletedElement;
let correctCountElement;
let incorrectCountElement;
let feedbackElement;
let finalScoreElement;
let deckStatsContainer;
let restartBtn;
let uploadNewBtn;
let returnToSrBtn;
let errorMessageElement;
let flipCard;
let cardContainer;
let startSelectedDecksBtn;
let readModeBtn;
let selectAllDecksBtn;
let deselectAllDecksBtn;
let deckSearchInput;
let srBucketsDisplay;
let startSelectedBucketsBtn;
let selectAllBucketsBtn;
let deselectAllBucketsBtn;
let cleanupOrphansBtn;
let bookView;
let progressView;
let hubOverview;
let hubManage;
let bookViewCards;
let bookViewTitle;
let undoBtn;
let exportBackupBtn;
let matchingContainer;
let matchingResultContainer;
let matchingPairedSection = null;
let matchingUnpairedSection = null;
let matchingUnpairedLeftCol = null;
let matchingUnpairedRightCol = null;
let matchingProgressEl = null;

/** @type {Array<object>} Undo stack for going back during quiz */
let undoStack = [];

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize DOM elements and set up event listeners
 * Called when DOM content is loaded
 */
function initializeApp() {
    // Cache DOM elements
    fileInput = document.querySelector('#file-input');
    appContent = document.querySelector('#app-content');
    appTitle = document.querySelector('#app-title');
    appSubtitle = document.querySelector('#app-subtitle');
    questionText = document.querySelector('#question-text');
    questionBack = document.querySelector('#question-back');
    sourceDeckDisplay = document.querySelector('#source-deck-display');
    answerText = document.querySelector('#answer-text');
    userAnswerInput = document.querySelector('#user-answer-input');
    userAnswerContainer = document.querySelector('#user-answer-container');
    userAnswerDisplay = document.querySelector('#user-answer-display');
    optionsContainer = document.querySelector('#options-container');
    optionsContainerBack = document.querySelector('#options-container-back');
    selectedOptionsContainer = document.querySelector('#selected-options-container');
    standardAnswerContainer = document.querySelector('#standard-answer-container');
    textExplanationContainer = document.querySelector('#text-explanation-container');
    textExplanationContent = document.querySelector('#text-explanation-content');
    showAnswerBtn = document.querySelector('#show-answer');
    recallRating = document.querySelector('#recall-rating');
    nextCardBtn = document.querySelector('#next-card');
    calibrationModeCheckbox = document.querySelector('#calibration-mode');
    confidencePrompt = document.querySelector('#confidence-prompt');
    progressBar = document.querySelector('#progress-bar');
    cardsRemainingElement = document.querySelector('#cards-remaining');
    cardsCompletedElement = document.querySelector('#cards-completed');
    correctCountElement = document.querySelector('#correct-count');
    incorrectCountElement = document.querySelector('#incorrect-count');
    feedbackElement = document.querySelector('#feedback');
    finalScoreElement = document.querySelector('#final-score');
    deckStatsContainer = document.querySelector('#deck-stats-container');
    restartBtn = document.querySelector('#restart-btn');
    uploadNewBtn = document.querySelector('#upload-new-btn');
    returnToSrBtn = document.querySelector('#return-to-sr-btn');
    errorMessageElement = document.querySelector('#error-message');
    flipCard = document.querySelector('#flip-card');
    cardContainer = document.querySelector('#card-container');
    startSelectedDecksBtn = document.querySelector('#start-selected-decks');
    readModeBtn = document.querySelector('#read-mode-btn');
    selectAllDecksBtn = document.querySelector('#select-all-decks');
    deselectAllDecksBtn = document.querySelector('#deselect-all-decks');
    deckSearchInput = document.querySelector('#deck-search');
    srBucketsDisplay = document.querySelector('#sr-buckets-display');
    startSelectedBucketsBtn = document.querySelector('#start-selected-buckets');
    selectAllBucketsBtn = document.querySelector('#select-all-buckets');
    deselectAllBucketsBtn = document.querySelector('#deselect-all-buckets');
    cleanupOrphansBtn = document.querySelector('#cleanup-orphans-btn');
    bookView = document.querySelector('#book-view');
    progressView = document.querySelector('#progress-view');
    hubOverview = document.querySelector('#hub-overview');
    hubManage = document.querySelector('#hub-manage');
    bookViewCards = document.querySelector('#book-view-cards');
    bookViewTitle = document.querySelector('#book-view-title');
    undoBtn = document.querySelector('#undo-btn');
    exportBackupBtn = document.querySelector('#export-backup-btn');
    matchingContainer = document.querySelector('#matching-container');
    matchingResultContainer = document.querySelector('#matching-result-container');
    matchingContainer.addEventListener('keydown', (e) => {
        if (matchingDrag) return; // never re-render mid-drag (would break pointer capture)
        if (e.key === 'Escape' && (selectedLeftIndex !== null || selectedRightIndex !== null)) {
            selectedLeftIndex = null;
            selectedRightIndex = null;
            renderMatchingPairs();
        }
    });

    // Set up event listeners with debouncing/throttling for performance
    fileInput.addEventListener('change', handleFileUpload);
    showAnswerBtn.addEventListener('click', throttle(showAnswer, 300));
    // Graded self-rating (text cards): the rating IS the "continue" action —
    // grade and advance in one click (no separate "Nächste"). The student has
    // already read the answer on the back before choosing a rating.
    recallRating.addEventListener('click', (e) => {
        const btn = e.target.closest('.recall-rating-btn');
        if (!btn || isAnswered) return;
        markAnswer(Number(btn.dataset.score));
        showNextCard();
    });
    nextCardBtn.addEventListener('click', throttle(showNextCard, 300));
    restartBtn.addEventListener('click', throttle(restartQuiz, 500));
    uploadNewBtn.addEventListener('click', throttle(resetAndUpload, 500));
    returnToSrBtn.addEventListener('click', throttle(returnToSRManager, 500));
    // Two actions on the selected decks; the "Nur falsche" filter (below)
    // applies to both. Reading skips the quiz and opens the book view.
    startSelectedDecksBtn.addEventListener(
        'click',
        throttle(() => {
            studyMode = 'spaced-repetition';
            startSelectedDecks();
        }, 500)
    );
    readModeBtn.addEventListener(
        'click',
        throttle(() => {
            studyMode = 'read-through';
            startSelectedDecks();
        }, 500)
    );
    selectAllDecksBtn.addEventListener('click', debounce(selectAllDecks, 200));
    deselectAllDecksBtn.addEventListener('click', debounce(deselectAllDecks, 200));
    deckSearchInput.addEventListener('input', debounce(handleDeckSearch, 250));
    for (const tab of document.querySelectorAll('.hub-tab')) {
        tab.addEventListener('click', () => switchHubTab(tab.dataset.tab));
    }
    startSelectedBucketsBtn.addEventListener('click', throttle(startSelectedBuckets, 500));
    selectAllBucketsBtn.addEventListener('click', debounce(selectAllSRBuckets, 200));
    deselectAllBucketsBtn.addEventListener('click', debounce(deselectAllSRBuckets, 200));
    cleanupOrphansBtn.addEventListener('click', throttle(cleanupOrphanedSRData, 500));
    setupSrBucketDelegation();
    document.querySelector('#book-view-csv').addEventListener('click', throttle(exportToCsv, 300));
    document
        .querySelector('#book-view-anki')
        .addEventListener('click', throttle(exportToAnki, 300));
    undoBtn.addEventListener('click', throttle(undoLastAnswer, 300));
    exportBackupBtn.addEventListener('click', throttle(exportBackup, 500));

    // Self-assessment option (persisted, on by default). It lives on the deck
    // picker, so it's only set before a session starts — updateCardContent reads
    // calibrationMode per card; no live mid-quiz toggling needed.
    const storedCalibration = localStorage.getItem('calibrationMode');
    calibrationMode = storedCalibration === null ? true : storedCalibration === '1';
    calibrationModeCheckbox.checked = calibrationMode;
    calibrationModeCheckbox.addEventListener('change', () => {
        calibrationMode = calibrationModeCheckbox.checked;
        persistToStorage('calibrationMode', calibrationMode ? '1' : '0');
    });
    confidencePrompt.addEventListener('click', (e) => {
        const btn = e.target.closest('.confidence-btn');
        if (!btn) return;
        currentConfidence = Number(btn.dataset.confidence);
        for (const b of confidencePrompt.querySelectorAll('.confidence-btn')) {
            const isSel = b === btn;
            b.classList.toggle('selected', isSel);
            b.setAttribute('aria-pressed', String(isSel));
        }
    });

    // Drop zone drag-and-drop
    setupDropZone();

    // Add event listener for text explanation toggle
    textExplanationContainer.addEventListener('click', toggleTextExplanation);

    // Add Enter key support for answer submission
    userAnswerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            showAnswer();
        }
    });

    // Global keyboard shortcuts for study flow
    document.addEventListener('keydown', handleGlobalKeyboard);

    // Keyboard hints toggle
    const hintsToggle = document.querySelector('.keyboard-hints-toggle');
    const hintsPanel = document.querySelector('.keyboard-hints-panel');
    if (hintsToggle && hintsPanel) {
        hintsToggle.addEventListener('click', () => {
            hintsPanel.classList.toggle('hidden');
        });
    }

    // Keyboard support for explanation box
    textExplanationContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleTextExplanation();
        }
    });

    // Back-link: target index.html from the deck-picker, but stay on
    // cards.html (reload to a clean picker) while a quiz or Lesemodus
    // is active — so users don't lose context with one stray click.
    setupBackLink();

    // Hide the next button initially
    nextCardBtn.style.display = 'none';

    // Load saved decks + study data first, then render (so knowledge badges and
    // the menu summary have their data on the very first paint). Snapshots are
    // recorded per completed session (in showFeedback), not on app open.
    loadSavedDecks();
    loadSpacedRepetitionData();
    loadProgressData();
    displaySavedDecks();

    // Set up service worker update listener
    setupServiceWorkerUpdates();

    // Deep link: cards.html?import=<library-deck-id>
    handleLibraryImportDeepLink();
}

// ============================================================================
// Keyboard Navigation
// ============================================================================

/**
 * Global keyboard shortcut handler for the study flow.
 * Delegates to screen-specific sub-handlers.
 * @param e
 */
function handleGlobalKeyboard(e) {
    // Don't intercept when typing in an input, textarea, or select
    if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT'
    ) {
        return;
    }

    // Toggle keyboard hints with ?
    if (e.key === '?') {
        const hintsPanel = document.querySelector('.keyboard-hints-panel');
        if (hintsPanel) {
            hintsPanel.classList.toggle('hidden');
        }
        return;
    }

    // Only handle shortcuts when quiz is active
    if (appContent.classList.contains('hidden')) {
        return;
    }

    // Undo: Backspace
    if (e.key === 'Backspace') {
        e.preventDefault();
        undoLastAnswer();
        return;
    }

    // Results/feedback screen
    if (!feedbackElement.classList.contains('hidden')) {
        handleFeedbackKeys(e);
        return;
    }

    // Card is hidden (shouldn't happen but safety check)
    if (cardContainer.classList.contains('hidden')) {
        return;
    }

    const isCardBack = flipCard.classList.contains('flipped');

    if (isCardBack) {
        handleCardBackKeys(e);
    } else {
        handleCardFrontKeys(e);
    }
}

/**
 * Handle keyboard shortcuts on card front (question side)
 * @param e
 */
function handleCardFrontKeys(e) {
    // Let the confidence buttons handle their own Space/Enter activation
    // instead of hijacking it to reveal the answer.
    if (e.target.closest('#confidence-prompt')) {
        return;
    }

    // Space or Enter: show answer
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        showAnswerBtn.click();
        return;
    }

    // Number keys 1-3: set the pre-reveal confidence — only on cards without MC
    // options (text/matching), where the 1-9 option shortcut below is inactive,
    // so the two never collide.
    const confNum = Number.parseInt(e.key);
    if (
        !confidencePrompt.classList.contains('hidden') &&
        optionsContainer.classList.contains('hidden') &&
        confNum >= 1 &&
        confNum <= 3
    ) {
        e.preventDefault();
        confidencePrompt.querySelector(`.confidence-btn[data-confidence="${confNum}"]`)?.click();
        return;
    }

    // Number keys 1-9: toggle MC option by position
    const num = Number.parseInt(e.key);
    if (num >= 1 && num <= 9) {
        const options = optionsContainer.querySelectorAll('.option-item');
        if (!optionsContainer.classList.contains('hidden') && num <= options.length) {
            e.preventDefault();
            const optionItem = options[num - 1];
            const checkbox = optionItem.querySelector('.option-checkbox');
            checkbox.checked = !checkbox.checked;
            optionItem.classList.toggle('selected', checkbox.checked);
            optionItem.setAttribute('aria-checked', String(checkbox.checked));

            const originalIndex = Number.parseInt(optionItem.dataset.index);
            if (checkbox.checked) {
                if (!selectedOptionIndices.includes(originalIndex)) {
                    selectedOptionIndices.push(originalIndex);
                }
            } else {
                const idx = selectedOptionIndices.indexOf(originalIndex);
                if (idx !== -1) selectedOptionIndices.splice(idx, 1);
            }
        }
    }
}

/**
 * Handle keyboard shortcuts on card back (answer side)
 * @param e
 */
function handleCardBackKeys(e) {
    // Enter or Space: next card (only when next button is visible)
    if ((e.key === 'Enter' || e.key === ' ') && nextCardBtn.style.display !== 'none') {
        e.preventDefault();
        nextCardBtn.click();
        return;
    }

    // Graded self-rating (text cards): keys 1-4 grade, arrows move focus.
    // Only active while the rating group is visible — for MC cards it stays
    // hidden, so the 1-9 option-tooltip shortcut below keeps working.
    if (!recallRating.classList.contains('hidden')) {
        const ratingBtns = [...recallRating.querySelectorAll('.recall-rating-btn')];
        const num = Number.parseInt(e.key);
        if (num >= 1 && num <= ratingBtns.length) {
            e.preventDefault();
            ratingBtns[num - 1].click();
            return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const current = ratingBtns.indexOf(document.activeElement);
            const delta = e.key === 'ArrowRight' ? 1 : -1;
            const next =
                current < 0 ? 0 : Math.min(Math.max(current + delta, 0), ratingBtns.length - 1);
            ratingBtns[next].focus();
            return;
        }
    }

    // E: toggle explanation (text answers)
    if (e.key === 'e' && !textExplanationContainer.classList.contains('hidden')) {
        e.preventDefault();
        toggleTextExplanation();
        return;
    }

    // Number keys 1-9: toggle MC option explanation tooltip on back side
    const num = Number.parseInt(e.key);
    if (num >= 1 && num <= 9) {
        const backOptions = optionsContainerBack.querySelectorAll('.option-item');
        if (!optionsContainerBack.classList.contains('hidden') && num <= backOptions.length) {
            e.preventDefault();
            const indicator = backOptions[num - 1].querySelector('.option-explanation-indicator');
            if (indicator) {
                // If already focused, blur to hide tooltip; otherwise focus to show it
                if (document.activeElement === indicator) {
                    indicator.blur();
                } else {
                    indicator.focus();
                }
            }
        }
    }
}

/**
 * Handle keyboard shortcuts on the results/feedback screen
 * @param e
 */
function handleFeedbackKeys(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (restartBtn.style.display !== 'none') {
            restartBtn.click();
        } else if (returnToSrBtn.style.display !== 'none') {
            returnToSrBtn.click();
        }
    }
    // Backspace on feedback also triggers undo (handled in parent)
}

/**
 * Set up listener for service worker updates
 * Shows notification when new version is available
 */
function setupServiceWorkerUpdates() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
                showUpdateNotification();
            }
        });
    }
}

/**
 * Show update notification banner
 */
function showUpdateNotification() {
    // Don't show if already showing
    if (document.querySelector('#update-notification')) return;

    const notification = document.createElement('div');
    notification.id = 'update-notification';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = '\u{1F504} Eine neue Version ist verfügbar!';

    const updateBtn = document.createElement('button');
    updateBtn.textContent = 'Jetzt aktualisieren';
    updateBtn.addEventListener('click', applyUpdate);

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '\u2715';
    dismissBtn.className = 'dismiss';
    dismissBtn.addEventListener('click', dismissUpdate);

    notification.append(messageSpan);
    notification.append(updateBtn);
    notification.append(dismissBtn);
    document.body.append(notification);
}

/**
 * Apply update by reloading the page
 */
function applyUpdate() {
    globalThis.location.reload();
}

/**
 * Dismiss update notification
 */
function dismissUpdate() {
    const notification = document.querySelector('#update-notification');
    if (notification) {
        notification.remove();
    }
}

// Initialize when DOM is ready. Guarded so the module can be require()'d in a
// non-browser context (the node:test suite) without a missing-addEventListener
// throw at load time.
if (typeof document !== 'undefined' && globalThis.addEventListener) {
    globalThis.addEventListener('DOMContentLoaded', initializeApp);
}

// ============================================================================
// File Upload Handlers
// ============================================================================

/**
 * Toggle visibility of JSON format example
 */
function toggleJsonSample() {
    const sampleJson = document.querySelector('#sample-json');
    sampleJson.classList.toggle('hidden');
}

// Exposed for the inline handler in cards.html's upload section. The SR-manager
// controls used to live here too, but they are now wired via event delegation
// (see setupSrBucketDelegation), so they no longer leak onto globalThis.
globalThis.toggleJsonSample = toggleJsonSample;

/**
 * Keep the header back-link in sync with the current view: from the
 * deck-picker it goes home (index.html); from an active quiz or
 * Lesemodus it returns to the cards.html picker so a single click
 * doesn't drop the user all the way out of the app.
 */
function setupBackLink() {
    const backLink = document.querySelector('.back-link');
    if (!backLink || !appContent || !bookView) return;

    const update = () => {
        const inBookView = !bookView.classList.contains('hidden');
        const previewId = new URLSearchParams(location.search).get('preview');

        // Vorschau was opened from a library detail page — route back there
        // rather than to the cards.html deck-picker.
        if (inBookView && previewId) {
            backLink.href = `library.html?deck=${encodeURIComponent(previewId)}`;
            backLink.title = 'Zurück zur Bibliothek';
            return;
        }

        const inSession =
            !appContent.classList.contains('hidden') ||
            inBookView ||
            (progressView && !progressView.classList.contains('hidden'));
        backLink.href = inSession ? 'cards.html' : 'index.html';
        backLink.title = inSession ? 'Zur Deck-Auswahl' : 'Zur Startseite';
    };

    // From the Fortschritt hub, the ← is the single exit: soft-close it in place
    // (no reload) instead of navigating. Other views fall through to the href.
    backLink.addEventListener('click', (e) => {
        if (progressView && !progressView.classList.contains('hidden')) {
            e.preventDefault();
            closeProgressView();
        }
    });

    const observer = new MutationObserver(update);
    observer.observe(appContent, { attributes: true, attributeFilter: ['class'] });
    observer.observe(bookView, { attributes: true, attributeFilter: ['class'] });
    if (progressView) {
        observer.observe(progressView, { attributes: true, attributeFilter: ['class'] });
    }
    update();
}

/**
 * Set up drop zone for drag-and-drop file import
 */
function setupDropZone() {
    const dropZone = document.querySelector('#drop-zone');
    if (!dropZone) return;

    // Clicking the drop zone triggers the file input
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // Only remove if leaving the drop zone itself (not a child)
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
        }
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleDroppedFiles(files);
        }
    });
}

/**
 * Handle files dropped onto the drop zone
 * @param {FileList} files - Dropped files
 */
async function handleDroppedFiles(files) {
    for (const file of files) {
        const isJson = file.type === 'application/json' || file.name.endsWith('.json');
        const isZip = file.type === 'application/zip' || file.name.endsWith('.zip');
        if (!isJson && !isZip) {
            showError('Bitte nur JSON- oder ZIP-Dateien ablegen.');
            continue;
        }
        // Create a synthetic event compatible with handleFileUpload.
        // Await so concurrent imports don't race on savedDecks / localStorage.
        const syntheticEvent = { target: { files: [file], value: '' } };
        await handleFileUpload(syntheticEvent);
    }
}

/**
 * Handle file upload - supports both JSON and ZIP files
 * @param {Event} event - File input change event
 */
async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        // Check if it's a ZIP file
        if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
            // Create a synthetic single-file event for handleZipUpload.
            // Await so concurrent zips don't race on savedDecks / localStorage.
            const syntheticEvent = { target: { files: [file], value: '' } };
            await handleZipUpload(syntheticEvent);
            continue;
        }

        // Otherwise, treat it as JSON — peek to determine if backup or deck
        if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
            showError('Bitte lade eine gültige JSON- oder ZIP-Datei hoch.');
            continue;
        }

        try {
            const text = await file.text();
            const data = sanitizeParsedJSON(JSON.parse(text));

            // Detect backup file: has flashcardDecks key
            if (data.flashcardDecks && typeof data.flashcardDecks === 'object' && !data.cards) {
                await handleBackupImport(data);
                continue;
            }

            // Otherwise treat as a card deck
            processJsonData(data, file.name);
        } catch (error) {
            showError('Fehler beim Lesen der JSON-Datei.');
            console.error(error);
        }
    }

    event.target.value = '';
}

/**
 * Handle ZIP file upload containing multiple JSON files
 * @param {Event} event - File input change event
 */
async function handleZipUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/zip' && !file.name.endsWith('.zip')) {
        showError('Bitte lade eine gültige ZIP-Datei hoch.');
        return;
    }

    try {
        const buffer = await file.arrayBuffer();
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(buffer);
        let errorCount = 0;
        const importedDeckNames = [];

        // ZIP basename serves as a topic-grouping fallback when an inner JSON has no meta.name.
        const zipBaseName = file.name.replace(/\.zip$/i, '');

        // Pre-pass: if the zip carries a manifest.json, use its meta as the
        // canonical deck-level metadata for every inner card file. Card JSONs
        // produced by the build pipeline no longer carry inline meta; the
        // ZIP-level manifest is the single source of truth.
        let manifestMeta = null;
        for (const [relPath, zipEntry] of Object.entries(zipContent.files)) {
            if (!zipEntry.dir && relPath.split('/').pop() === 'manifest.json') {
                try {
                    const parsed = sanitizeParsedJSON(JSON.parse(await zipEntry.async('string')));
                    if (parsed && typeof parsed.meta === 'object' && parsed.meta) {
                        manifestMeta = parsed.meta;
                    }
                } catch {
                    // ignore — fall back to per-file meta below
                }
                break;
            }
        }

        // Process each card JSON in the ZIP
        const promises = [];
        for (const [relativePath, zipEntry] of Object.entries(zipContent.files)) {
            if (zipEntry.dir) continue;
            const base = relativePath.split('/').pop();
            if (!relativePath.endsWith('.json') || base === 'manifest.json') continue;
            const promise = zipEntry.async('string').then((content) => {
                try {
                    const data = sanitizeParsedJSON(JSON.parse(content));

                    if (!data.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
                        errorCount++;
                        return;
                    }

                    // Check card validity
                    const validCards = validateCards(data.cards);

                    if (validCards.length === 0) {
                        errorCount++;
                        return;
                    }

                    // Save the deck with filename as deck name
                    const deckName = base.replace('.json', '');
                    // Resolution order: inline meta on the card file (legacy
                    // back-compat) → zip-level manifest.json → zip basename.
                    const meta = (data.meta && typeof data.meta === 'object' && data.meta) ||
                        manifestMeta || { name: zipBaseName };
                    saveToLocalStorage(deckName, validCards, meta);
                    importedDeckNames.push(deckName);
                } catch {
                    errorCount++;
                }
            });
            promises.push(promise);
        }

        await Promise.all(promises);

        if (importedDeckNames.length > 0) {
            displaySavedDecks('', importedDeckNames);
            const failureSuffix = errorCount > 0 ? `, ${errorCount} fehlgeschlagen` : '';
            showMessage(
                `${importedDeckNames.length} Decks erfolgreich importiert${failureSuffix}.`
            );
        } else {
            showError('Keine gültigen JSON-Dateien in der ZIP-Datei gefunden.');
        }

        // Reset the file input
        event.target.value = '';
    } catch (error) {
        showError('Fehler beim Entpacken der ZIP-Datei.');
        console.error(error);
    }
}

/**
 * Handle two library deep links:
 *   - cards.html?import=<id>  → real import: writes deck + library meta to
 *     localStorage, displays the deck-picker.
 *   - cards.html?preview=<id> → read-only preview: fetches and parses the
 *     deck in memory, opens the book view directly, writes nothing. The
 *     deck does not appear in savedDecks or localStorage; reload returns
 *     the user to a clean deck-picker.
 *
 * The URL parameter is stripped on completion so a refresh doesn't repeat
 * the action.
 */
async function handleLibraryImportDeepLink() {
    const params = new URLSearchParams(location.search);
    const importId = params.get('import');
    const previewId = params.get('preview');
    const id = importId || previewId;
    if (!id) return;
    const isPreview = !importId && Boolean(previewId);

    try {
        const manifestRes = await fetch('decks/library.json', { cache: 'no-cache' });
        if (!manifestRes.ok) throw new Error(`manifest HTTP ${manifestRes.status}`);
        const manifest = sanitizeParsedJSON(await manifestRes.json());
        if (!manifest || !Array.isArray(manifest.decks)) throw new Error('manifest malformed');

        const deckMeta = manifest.decks.find((d) => d.id === id);
        if (!deckMeta) {
            showError(`Bibliotheks-Deck „${id}“ wurde nicht gefunden.`);
            history.replaceState({}, '', 'cards.html');
            return;
        }

        const fileUrl = `decks/${encodeURIComponent(deckMeta.filename)}?v=${encodeURIComponent(deckMeta.version)}`;
        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) throw new Error(`deck HTTP ${fileRes.status}`);

        const isJson = /\.json$/i.test(deckMeta.filename);
        let entries;
        if (isJson) {
            entries = [{ name: deckMeta.filename, content: await fileRes.text() }];
        } else {
            if (typeof JSZip === 'undefined') throw new Error('JSZip nicht geladen');
            const zip = await JSZip.loadAsync(await fileRes.arrayBuffer());
            const zipEntries = Object.values(zip.files).filter(
                (e) => !e.dir && e.name.endsWith('.json')
            );
            entries = await Promise.all(
                zipEntries.map(async (e) => ({ name: e.name, content: await e.async('string') }))
            );
        }

        const importedDeckNames = [];
        const allCards = [];
        for (const entry of entries) {
            let data;
            try {
                data = sanitizeParsedJSON(JSON.parse(entry.content));
            } catch {
                continue;
            }
            if (!data || !Array.isArray(data.cards)) continue;
            const validCards = validateCards(data.cards);
            if (validCards.length === 0) continue;
            const deckName = entry.name
                .split('/')
                .pop()
                .replace(/\.json$/i, '');
            // Preview: don't touch localStorage or savedDecks at all.
            if (!isPreview) {
                // Fall back to library manifest meta (or zip basename) when the inner JSON omits it,
                // so all entries from the same library archive group into one topic.
                const zipBaseName = deckMeta.filename.replace(/\.(zip|json)$/i, '');
                const meta = (data && typeof data.meta === 'object' && data.meta) ||
                    deckMeta.meta || { name: zipBaseName };
                saveToLocalStorage(deckName, validCards, meta);
            }
            importedDeckNames.push(deckName);
            for (const card of validCards) {
                allCards.push({ ...card, sourceDeck: deckName });
            }
        }

        if (importedDeckNames.length === 0) {
            showError(
                isPreview
                    ? 'Keine gültigen Karten in der Vorschau gefunden.'
                    : 'Keine gültigen Karten im Bibliotheks-Deck gefunden.'
            );
            history.replaceState({}, '', 'cards.html');
            return;
        }

        if (!isPreview) {
            // Persist library metadata so the detail page can show "imported" /
            // "update available" pills. Failure here is non-fatal.
            try {
                let libMeta = JSON.parse(localStorage.getItem('flashcardLibraryMeta') || '{}');
                libMeta = sanitizeParsedJSON(libMeta) || {};
                for (const deckName of importedDeckNames) {
                    libMeta[deckName] = {
                        libraryId: deckMeta.id,
                        libraryVersion: deckMeta.version,
                        importedAt: new Date().toISOString(),
                    };
                }
                localStorage.setItem('flashcardLibraryMeta', JSON.stringify(libMeta));
            } catch (error) {
                console.warn('Could not persist library meta:', error);
            }
        }

        if (isPreview) {
            // Keep ?preview=<id> in the URL so the back-link can route to
            // library.html?deck=<id>, and a refresh re-renders cleanly.
            // Render the linear view directly — no deck-picker refresh,
            // because the deck was never saved and shouldn't appear there.
            openBookView(allCards, `Vorschau — ${deckMeta.title}`);
        } else {
            history.replaceState({}, '', 'cards.html');
            displaySavedDecks('', importedDeckNames);
            showMessage(
                `„${deckMeta.title}“ importiert (${allCards.length} Karten). Wähle Decks oder Kategorien für die nächste Runde.`
            );
        }
    } catch (error) {
        console.error('Library deep-link failed:', error);
        showError(
            isPreview
                ? 'Vorschau konnte nicht geladen werden.'
                : 'Bibliotheks-Deck konnte nicht importiert werden.'
        );
        history.replaceState({}, '', 'cards.html');
    }
}

/**
 * Process already-parsed JSON data as a card deck
 * @param {object} data - Parsed JSON object
 * @param {string} fileName - Original file name for deck naming
 */
function processJsonData(data, fileName) {
    if (!data.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
        showError(
            'Ungültiges JSON-Format. Bitte stelle sicher, dass deine Datei ein "cards" Array mit mindestens einer Karte enthält.'
        );
        return;
    }

    const validCards = validateCards(data.cards);

    if (validCards.length === 0) {
        showError(
            'Keine gültigen Karten gefunden. Jede Karte muss entweder ein "question" und ein "answer" Feld ODER ein "question", "options" und "correct" Feld haben.'
        );
        return;
    }

    const deckName = fileName.replace('.json', '');
    activeDecks = [deckName];

    updateAppTitle([deckName]);
    const meta = data && typeof data.meta === 'object' ? data.meta : null;
    saveToLocalStorage(deckName, validCards, meta);
    displaySavedDecks('', [deckName]);
    initializeQuiz(validCards.map((card) => ({ ...card, sourceDeck: deckName })));
    fileInput.value = '';
}

/**
 * Handle backup file import (auto-detected from handleFileUpload)
 * @param {object} backup - Parsed backup JSON object
 */
async function handleBackupImport(backup) {
    const deckCount = Object.keys(backup.flashcardDecks).length;
    const srCount = backup.spacedRepetitionData
        ? Object.keys(backup.spacedRepetitionData).length
        : 0;

    const ok = await uiConfirm(
        `Backup erkannt!\n\n${deckCount} Decks und ${srCount} SR-Einträge werden wiederhergestellt.\n\nAchtung: Vorhandene Daten werden überschrieben!`,
        { confirmText: 'Wiederherstellen', danger: true }
    );
    if (!ok) {
        fileInput.value = '';
        return;
    }

    try {
        savedDecks = backup.flashcardDecks;
        localStorage.setItem('flashcardDecks', JSON.stringify(savedDecks));

        if (backup.spacedRepetitionData) {
            spacedRepetitionData = backup.spacedRepetitionData;
            reviveSRData();
            localStorage.setItem('spacedRepetitionData', JSON.stringify(spacedRepetitionData));
        }

        // Restore the progress journey (optional — older backups won't have it)
        if (backup.lernstandHistory) {
            lernstandHistory = backup.lernstandHistory;
            localStorage.setItem('lernstandHistory', JSON.stringify(lernstandHistory));
        }
        if (backup.sessionHistory) {
            sessionHistory = backup.sessionHistory;
        }
        if (backup.achievements) {
            achievements = backup.achievements;
            if (!achievements.deckMastered) achievements.deckMastered = {};
            if (typeof achievements.bestSessionScore !== 'number') {
                achievements.bestSessionScore = 0;
            }
        }
        saveProgressData();
        if (backup.examDate) {
            examDate = backup.examDate;
            localStorage.setItem('examDate', examDate);
        }
    } catch (error) {
        console.error('Error restoring backup (storage quota exceeded?):', error);
        showError('Speicher voll! Backup konnte nicht vollständig importiert werden.');
        fileInput.value = '';
        return;
    }

    displaySavedDecks();
    showMessage(`Backup importiert: ${deckCount} Decks, ${srCount} SR-Einträge.`);
    fileInput.value = '';
}

/**
 * Collapse cards that share the same question text, keeping the LAST occurrence.
 * A deck's SR/progress data is keyed by `deck|||question`, so two cards with the
 * same question would otherwise collide and share state. Treating a re-import as
 * "the new card replaces the old" (e.g. a typo fix) keeps that key unambiguous.
 * @param {Array<object>} cards
 * @returns {Array<object>} de-duplicated cards (last wins, original order kept)
 */
function dedupeCardsByQuestion(cards) {
    const byQuestion = new Map();
    for (const card of cards) {
        // Map.set keeps the first insertion position but updates the value, so
        // order is stable and the latest content wins.
        byQuestion.set(card.question, card);
    }
    return [...byQuestion.values()];
}

/**
 * Validate card format - checks for required fields, then de-duplicates by
 * question text (last occurrence wins).
 * @param {Array<object>} cards - Array of card objects to validate
 * @returns {Array<object>} Array of valid, de-duplicated cards
 */
function validateCards(cards) {
    const valid = cards.filter((card) => {
        // Check standard card format (question + answer)
        if (card.question && card.answer) {
            return true;
        }
        // Check matching format (question + pairs)
        if (
            card.question &&
            Array.isArray(card.pairs) &&
            card.pairs.length >= 2 &&
            card.pairs.every(
                (p) =>
                    p &&
                    typeof p.right === 'string' &&
                    (p.left === null || p.left === undefined || typeof p.left === 'string')
            )
        ) {
            return true;
        }
        // Check multiple choice format (question + options + correct answers)
        if (
            card.question &&
            Array.isArray(card.options) &&
            card.options.length > 0 &&
            Array.isArray(card.correct) &&
            card.correct.length > 0
        ) {
            // Validate that all correct indices are within bounds
            const allIndicesValid = card.correct.every(
                (idx) => Number.isInteger(idx) && idx >= 0 && idx < card.options.length
            );
            return allIndicesValid;
        }
        return false;
    });
    return dedupeCardsByQuestion(valid);
}

// ============================================================================
// Local Storage Management
// ============================================================================

/**
 * Update the app title based on active decks
 * @param {Array<string>} deckNames - Names of active decks
 */
function updateAppTitle(deckNames) {
    appTitle.textContent =
        deckNames.length === 1
            ? `Lernkarten - ${deckNames[0]}`
            : `Lernkarten - ${deckNames.length} Decks kombiniert`;
    // Hide the subtitle when a deck is active
    appSubtitle.style.display = 'none';
}

/**
 * Load saved decks from localStorage
 */
function loadSavedDecks() {
    try {
        const savedDecksString = localStorage.getItem('flashcardDecks');
        if (savedDecksString) {
            savedDecks = JSON.parse(savedDecksString);
        }
    } catch (error) {
        console.error('Error loading saved decks:', error);
        savedDecks = {};
    }
}

/**
 * Save a deck to localStorage
 * @param {string} deckName - Name of the deck
 * @param {Array<object>} deckCards - Array of card objects
 * @param {object|null} [meta] - Optional deck metadata (name, subject, learningUnit, ...)
 */
function saveToLocalStorage(deckName, deckCards, meta = null) {
    savedDecks[deckName] = meta ? { cards: deckCards, meta } : { cards: deckCards };
    try {
        localStorage.setItem('flashcardDecks', JSON.stringify(savedDecks));
    } catch (error) {
        console.error('Error saving decks (storage quota exceeded?):', error);
        showError('Speicher voll! Bitte lösche nicht benötigte Decks.');
        delete savedDecks[deckName];
    }
}

/**
 * localStorage.setItem wrapped to swallow quota/availability errors (private
 * mode, full storage) instead of throwing out of a UI handler. Callers that
 * need rollback (e.g. saveToLocalStorage) handle errors themselves; this is for
 * best-effort writes where a failure should warn, not crash the flow.
 * @param {string} key - Storage key
 * @param {string} value - Serialized value to store
 * @returns {boolean} true when the write succeeded
 */
function persistToStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.error(`Error writing "${key}" to localStorage (quota exceeded?):`, error);
        return false;
    }
}

// ============================================================================
// Deck Management UI
// ============================================================================

/**
 * Classify a card as multiple-choice, free-text, or matching based on shape.
 * @param {object} card
 * @returns {'mc'|'text'|'matching'}
 */
function cardType(card) {
    if (Array.isArray(card.pairs)) return 'matching';
    return Array.isArray(card.options) && Array.isArray(card.correct) ? 'mc' : 'text';
}

/**
 * Group savedDecks into topics. A topic gathers all JSONs that share the same
 * meta.name (or, lacking meta, fall back to the deck name itself — so legacy
 * imports without meta render as standalone single-deck topics).
 * @returns {Map<string, {
 *   key: string,
 *   title: string,
 *   subtitle: string,
 *   decks: string[],
 *   totalCards: number,
 *   categories: Map<string, {mc: number, text: number, matching: number}>,
 * }>}
 */
function buildTopics() {
    const topics = new Map();
    for (const deckName of Object.keys(savedDecks)) {
        const deck = savedDecks[deckName];
        const meta = (deck && deck.meta) || {};
        const key = (meta.name && String(meta.name).trim()) || deckName;
        let topic = topics.get(key);
        if (!topic) {
            const subtitleParts = [meta.subject, meta.learningUnit].filter(Boolean);
            topic = {
                key,
                title: key,
                subtitle: subtitleParts.join(' · '),
                decks: [],
                totalCards: 0,
                categories: new Map(),
            };
            topics.set(key, topic);
        }
        topic.decks.push(deckName);
        for (const card of deck.cards || []) {
            topic.totalCards++;
            const type = cardType(card);
            const cats =
                card.categories && card.categories.length > 0
                    ? card.categories
                    : ['__uncategorized__'];
            for (const cat of cats) {
                let agg = topic.categories.get(cat);
                if (!agg) {
                    agg = { mc: 0, text: 0, matching: 0 };
                    topic.categories.set(cat, agg);
                }
                agg[type]++;
            }
        }
    }
    return topics;
}

/**
 * Build a category chip for a given type. Selected state is backed by the
 * `deselectedChips` model (chips are on by default), so it survives re-renders.
 * @param {'mc'|'text'|'matching'} type
 * @param {number} count
 * @param {string} topicKey
 * @param {string} catName
 */
function makeTypeChip(type, count, topicKey, catName) {
    const chip = document.createElement('button');
    chip.type = 'button';
    const selected = !deselectedChips.has(chipKey(topicKey, catName, type));
    chip.className = `type-chip type-chip-${type}${selected ? ' selected' : ''}`;
    chip.dataset.type = type;
    chip.dataset.topicKey = topicKey;
    chip.dataset.category = catName;
    let chipLabel;
    let chipTitle;
    if (type === 'mc') {
        chipLabel = 'MC';
        chipTitle = 'Multiple-Choice-Karten in dieser Kategorie ein-/ausblenden';
    } else if (type === 'matching') {
        chipLabel = 'ZO';
        chipTitle = 'Zuordnungsaufgaben in dieser Kategorie ein-/ausblenden';
    } else {
        chipLabel = 'Text';
        chipTitle = 'Freitext-Karten in dieser Kategorie ein-/ausblenden';
    }
    chip.textContent = `${chipLabel} ${count}`;
    chip.title = chipTitle;
    chip.setAttribute('aria-pressed', String(selected));
    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowSelected = !chip.classList.contains('selected');
        const key = chipKey(topicKey, catName, type);
        if (nowSelected) deselectedChips.delete(key);
        else deselectedChips.add(key);
        chip.classList.toggle('selected', nowSelected);
        chip.setAttribute('aria-pressed', String(nowSelected));
        updateStartButtonState();
    });
    return chip;
}

/**
 * Render the saved-deck list as topic accordions. Topics group JSONs by
 * meta.name (with deck-name fallback for legacy imports). Inside each topic,
 * categories are aggregated across all underlying decks; per-category
 * MC and Text type chips toggle independently.
 * @param {string} searchTerm - Filters topics by title, subtitle, deck, or category match.
 * @param {string[]} preselectDeckNames - Deck names whose containing topic should start checked.
 */
function displaySavedDecks(searchTerm = '', preselectDeckNames = []) {
    renderMenuSummary();
    const savedDecksDiv = document.querySelector('#saved-decks');
    savedDecksDiv.innerHTML = '';

    const topics = buildTopics();
    if (topics.size === 0) {
        const noDecksMessage = document.createElement('p');
        noDecksMessage.textContent = 'Keine gespeicherten Decks gefunden.';
        savedDecksDiv.append(noDecksMessage);
        startSelectedDecksBtn.disabled = true;
        return;
    }

    const preselectSet = new Set(preselectDeckNames);
    const lowerSearch = (searchTerm || '').trim().toLowerCase();

    const matching = [...topics.values()].filter((t) => {
        if (!lowerSearch) return true;
        if (t.title.toLowerCase().includes(lowerSearch)) return true;
        if (t.subtitle.toLowerCase().includes(lowerSearch)) return true;
        for (const deck of t.decks) {
            if (deck.toLowerCase().includes(lowerSearch)) return true;
        }
        for (const catName of t.categories.keys()) {
            if (catName !== '__uncategorized__' && catName.toLowerCase().includes(lowerSearch))
                return true;
        }
        return false;
    });

    if (matching.length === 0 && lowerSearch) {
        const noResultsMessage = document.createElement('p');
        noResultsMessage.textContent = 'Keine Decks gefunden.';
        savedDecksDiv.append(noResultsMessage);
        startSelectedDecksBtn.disabled = true;
        return;
    }

    matching.sort((a, b) => a.title.localeCompare(b.title, 'de'));

    // Seed the selection model for any just-imported topics so their checkboxes
    // render checked (the model, not the DOM, is the source of truth).
    for (const topic of topics.values()) {
        if (topic.decks.some((d) => preselectSet.has(d))) {
            for (const catName of topic.categories.keys()) {
                selectedCategories.add(catKey(topic.key, catName));
            }
        }
    }

    for (const topic of matching) {
        const folder = document.createElement('div');
        folder.className = 'topic-folder';
        folder.dataset.topicKey = topic.key;

        const header = document.createElement('div');
        header.className = 'topic-header';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'topic-checkbox';
        checkbox.dataset.topicKey = topic.key;
        // Derive the tri-state from how many of the topic's categories are selected.
        const catNames = [...topic.categories.keys()];
        const selCatCount = catNames.filter((c) =>
            selectedCategories.has(catKey(topic.key, c))
        ).length;
        checkbox.checked = selCatCount > 0 && selCatCount === catNames.length;
        checkbox.indeterminate = selCatCount > 0 && selCatCount < catNames.length;
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', () => {
            onTopicCheckboxChange(topic.key, checkbox.checked);
            updateStartButtonState();
        });

        const chevron = document.createElement('span');
        chevron.className = 'deck-chevron';
        chevron.textContent = '▶';

        const folderIcon = document.createElement('span');
        folderIcon.className = 'deck-folder-icon';
        folderIcon.textContent = '📚';

        const titleBlock = document.createElement('span');
        titleBlock.className = 'topic-title-block';
        const titleEl = document.createElement('span');
        titleEl.className = 'topic-title';
        titleEl.textContent = topic.title;
        titleBlock.append(titleEl);
        if (topic.subtitle) {
            const subtitleEl = document.createElement('span');
            subtitleEl.className = 'topic-subtitle';
            subtitleEl.textContent = topic.subtitle;
            titleBlock.append(subtitleEl);
        }

        const cardCount = document.createElement('span');
        cardCount.className = 'topic-card-count';
        cardCount.textContent = `${topic.totalCards} Karten`;

        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-deck';
        deleteButton.textContent = '×';
        deleteButton.title =
            topic.decks.length > 1 ? 'Topic löschen (alle Quellen)' : 'Deck löschen';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSavedTopic(topic);
        });

        header.append(checkbox, chevron, folderIcon, titleBlock, cardCount);
        const knowledgeBadge = buildKnowledgeBadge(topic.decks);
        if (knowledgeBadge) header.append(knowledgeBadge);
        header.append(deleteButton);
        folder.append(header);

        const catsContainer = document.createElement('div');
        catsContainer.className = 'topic-categories';

        const sortedCategories = [...topic.categories.entries()].toSorted((a, b) => {
            if (a[0] === '__uncategorized__') return 1;
            if (b[0] === '__uncategorized__') return -1;
            return a[0].localeCompare(b[0], 'de');
        });

        for (const [catName, counts] of sortedCategories) {
            const row = document.createElement('div');
            row.className = 'category-row';
            row.dataset.topicKey = topic.key;
            row.dataset.category = catName;

            const catCheckbox = document.createElement('input');
            catCheckbox.type = 'checkbox';
            catCheckbox.className = 'category-checkbox';
            catCheckbox.dataset.topicKey = topic.key;
            catCheckbox.dataset.category = catName;
            catCheckbox.checked = selectedCategories.has(catKey(topic.key, catName));
            catCheckbox.addEventListener('change', () => {
                const key = catKey(topic.key, catName);
                if (catCheckbox.checked) selectedCategories.add(key);
                else selectedCategories.delete(key);
                onCategoryCheckboxChange(topic.key);
                updateStartButtonState();
            });

            const labelEl = document.createElement('label');
            labelEl.className = 'category-label';
            const catIcon = document.createElement('span');
            catIcon.className = 'category-icon';
            catIcon.textContent = '🏷️';
            labelEl.append(catIcon);
            labelEl.append(
                document.createTextNode(
                    catName === '__uncategorized__' ? ' Allgemein' : ` ${catName}`
                )
            );
            // Sibling <label> (no `for=`) doesn't natively toggle the checkbox.
            // CSS gives it a pointer cursor, so wire up the click manually.
            labelEl.addEventListener('click', (e) => {
                e.preventDefault();
                catCheckbox.checked = !catCheckbox.checked;
                catCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            });

            const chips = document.createElement('span');
            chips.className = 'type-chips';
            if ((counts.mc || 0) > 0) {
                chips.append(makeTypeChip('mc', counts.mc, topic.key, catName));
            }
            if ((counts.text || 0) > 0) {
                chips.append(makeTypeChip('text', counts.text, topic.key, catName));
            }
            if ((counts.matching || 0) > 0) {
                chips.append(makeTypeChip('matching', counts.matching, topic.key, catName));
            }

            row.append(catCheckbox, labelEl, chips);
            catsContainer.append(row);
        }

        folder.append(catsContainer);

        header.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target === deleteButton) return;
            folder.classList.toggle('expanded');
        });

        savedDecksDiv.append(folder);
    }

    // Topics whose decks were just imported start expanded (their categories are
    // already selected in the model above).
    for (const topic of matching) {
        if (topic.decks.some((d) => preselectSet.has(d))) {
            const folder = savedDecksDiv.querySelector(
                `.topic-folder[data-topic-key="${CSS.escape(topic.key)}"]`
            );
            if (folder) folder.classList.add('expanded');
        }
    }

    // Type chips render selected by default (all types included); per-category
    // toggling happens in the expanded deck view.
    updateStartButtonState();
}

/**
 * Topic-level checkbox toggles: cascades to all category checkboxes in the topic
 * (both the model and the visible DOM). Type chip selection is intentionally
 * preserved across topic check/uncheck.
 * @param {string} topicKey
 * @param {boolean} checked
 */
function onTopicCheckboxChange(topicKey, checked) {
    const escaped = CSS.escape(topicKey);
    const catCheckboxes = document.querySelectorAll(
        `.category-checkbox[data-topic-key="${escaped}"]`
    );
    for (const cb of catCheckboxes) {
        cb.checked = checked;
        const key = catKey(topicKey, cb.dataset.category);
        if (checked) selectedCategories.add(key);
        else selectedCategories.delete(key);
    }
}

/**
 * Category checkbox change: derives parent topic checkbox state (off / indeterminate / on).
 * @param {string} topicKey
 */
function onCategoryCheckboxChange(topicKey) {
    const escaped = CSS.escape(topicKey);
    const catCheckboxes = document.querySelectorAll(
        `.category-checkbox[data-topic-key="${escaped}"]`
    );
    if (catCheckboxes.length === 0) return;

    const topicCb = document.querySelector(`.topic-checkbox[data-topic-key="${escaped}"]`);
    if (!topicCb) return;

    const checkedCount = [...catCheckboxes].filter((cb) => cb.checked).length;
    if (checkedCount === 0) {
        topicCb.checked = false;
        topicCb.indeterminate = false;
    } else if (checkedCount === catCheckboxes.length) {
        topicCb.checked = true;
        topicCb.indeterminate = false;
    } else {
        topicCb.checked = false;
        topicCb.indeterminate = true;
    }
}

/**
 * Whether at least one (category, type) pair is selected anywhere. Reads the
 * selection model, so it stays correct even for topics filtered out of the DOM.
 * @returns {boolean}
 */
function hasAnyActiveSelection() {
    return getSelectedFilters().size > 0;
}

/**
 * Update the enabled state of the start button based on the topic/category/type tree.
 */
function updateStartButtonState() {
    const noSelection = !hasAnyActiveSelection();
    startSelectedDecksBtn.disabled = noSelection;
    readModeBtn.disabled = noSelection;
}

/**
 * Read the current UI selection and produce a per-deck filter.
 * The type allow-list is tracked **per category** (not per topic), so e.g.
 * "MC of category A + Text of category B" filters precisely those cards.
 * @returns {Map<string, Map<string, Set<'mc'|'text'>>>}
 *   deckName → (catName → set of allowed types). Empty Map = nothing selected.
 */
function getSelectedFilters() {
    const result = new Map();
    const topics = buildTopics();
    for (const topic of topics.values()) {
        const perCategory = new Map();
        for (const [catName, counts] of topic.categories.entries()) {
            if (!selectedCategories.has(catKey(topic.key, catName))) continue;
            const types = new Set();
            for (const ty of ['mc', 'text', 'matching']) {
                if (
                    (counts[ty] || 0) > 0 &&
                    !deselectedChips.has(chipKey(topic.key, catName, ty))
                ) {
                    types.add(ty);
                }
            }
            if (types.size === 0) continue;
            perCategory.set(catName, types);
        }
        if (perCategory.size === 0) continue;
        for (const deckName of topic.decks) {
            result.set(deckName, perCategory);
        }
    }
    return result;
}

/**
 * Filter a deck's cards by a per-category type allow-list.
 * A card passes iff at least one of its categories is selected AND that
 * category's allow-list contains the card's type.
 * @param {Array<object>} cards
 * @param {Map<string, Set<'mc'|'text'>>} perCategory
 */
function filterCards(cards, perCategory) {
    if (!perCategory || perCategory.size === 0) return [];
    return cards.filter((card) => {
        const t = cardType(card);
        const cardCats =
            card.categories && card.categories.length > 0 ? card.categories : ['__uncategorized__'];
        return cardCats.some((c) => {
            const allowed = perCategory.get(c);
            return allowed && allowed.has(t);
        });
    });
}

/**
 * Start quiz with the current selection (topics → categories → types).
 */
function startSelectedDecks() {
    // Lesemodus: open book view instead of quiz
    if (studyMode === 'read-through') {
        startBookViewFromDecks();
        return;
    }

    const selectedPerDeck = getSelectedFilters();
    if (selectedPerDeck.size === 0) return;

    const selectedDeckNames = [...selectedPerDeck.keys()];
    activeDecks = selectedDeckNames;

    updateAppTitle(selectedDeckNames);

    let mergedCards = [];
    for (const [deckName, filter] of selectedPerDeck.entries()) {
        if (savedDecks[deckName]) {
            const filtered = filterCards(savedDecks[deckName].cards, filter);
            const cardsWithSource = filtered.map((card) => ({
                ...card,
                sourceDeck: deckName,
            }));
            mergedCards = [...mergedCards, ...cardsWithSource];
        }
    }

    if (mergedCards.length === 0) return;

    resetDeckStats(selectedDeckNames, selectedPerDeck);

    initializeQuiz(mergedCards);
}

/**
 * Reset deck statistics for the given deck names
 * @param {Array<string>} deckNames - Names of decks to reset stats for
 * @param {Map<string, {categories: Set<string>, types: Set<'mc'|'text'>}>} [selectedPerDeck] - Filters per deck
 */
function resetDeckStats(deckNames, selectedPerDeck) {
    deckStats = {};
    for (const deckName of deckNames) {
        const allCards = savedDecks[deckName].cards;
        let total = allCards.length;
        if (selectedPerDeck && selectedPerDeck.has(deckName)) {
            total = filterCards(allCards, selectedPerDeck.get(deckName)).length;
        }
        deckStats[deckName] = {
            correct: 0,
            incorrect: 0,
            total: total,
        };
    }
}

/**
 * Select all visible topic and category checkboxes (chips remain in their
 * current state). Updates both the model and the DOM.
 */
function selectAllDecks() {
    for (const cb of document.querySelectorAll('.topic-checkbox')) {
        cb.checked = true;
        cb.indeterminate = false;
    }
    for (const cb of document.querySelectorAll('.category-checkbox')) {
        cb.checked = true;
        selectedCategories.add(catKey(cb.dataset.topicKey, cb.dataset.category));
    }
    updateStartButtonState();
}

/**
 * Deselect all visible topic and category checkboxes (chips remain in their
 * current state). Updates both the model and the DOM.
 */
function deselectAllDecks() {
    for (const cb of document.querySelectorAll('.topic-checkbox')) {
        cb.checked = false;
        cb.indeterminate = false;
    }
    for (const cb of document.querySelectorAll('.category-checkbox')) {
        cb.checked = false;
        selectedCategories.delete(catKey(cb.dataset.topicKey, cb.dataset.category));
    }
    updateStartButtonState();
}

/**
 * Delete a saved deck from localStorage
 * @param {string} deckName - Name of the deck to delete
 */
async function deleteSavedDeck(deckName) {
    const ok = await uiConfirm(`Möchtest du das Deck "${deckName}" wirklich löschen?`, {
        confirmText: 'Löschen',
        danger: true,
    });
    if (!ok) return;

    delete savedDecks[deckName];
    persistToStorage('flashcardDecks', JSON.stringify(savedDecks));

    displaySavedDecks();
}

/**
 * Delete an entire topic (i.e. every saved deck that is grouped under it).
 * For single-deck topics this is equivalent to `deleteSavedDeck`.
 * @param {{title: string, decks: string[]}} topic
 */
async function deleteSavedTopic(topic) {
    if (!topic || !Array.isArray(topic.decks) || topic.decks.length === 0) return;
    if (topic.decks.length === 1) {
        await deleteSavedDeck(topic.decks[0]);
        return;
    }
    const sourceList = topic.decks.map((d) => `• ${d}`).join('\n');
    const msg = `Möchtest du das Thema "${topic.title}" mit allen ${topic.decks.length} Quelldateien wirklich löschen?\n\n${sourceList}`;
    const ok = await uiConfirm(msg, { confirmText: 'Löschen', danger: true });
    if (!ok) return;
    for (const deckName of topic.decks) {
        delete savedDecks[deckName];
    }
    persistToStorage('flashcardDecks', JSON.stringify(savedDecks));
    displaySavedDecks();
}

// ============================================================================
// Quiz Logic
// ============================================================================

/**
 * Initialize quiz with the given cards
 * @param {Array<object>} loadedCards - Cards to use in the quiz
 */
function initializeQuiz(loadedCards) {
    // Reset the quiz state
    cards = loadedCards;
    currentCardIndex = 0;
    correctCount = 0;
    incorrectCount = 0;
    answeredCards = Array.from({ length: cards.length }).fill(null);

    // Check if this is from SR buckets
    const isFromSRBuckets = activeDecks.length === 1 && activeDecks[0] === 'SR Buckets';

    // Shuffle, then order by review urgency so even a short session is spent
    // where it matters most (bucket order is preserved, so skip it there).
    if (!isFromSRBuckets) {
        shuffleArray(cards);
        orderCardsForReview();
    }

    // Clear undo stack and session calibration for new quiz
    undoStack = [];
    undoBtn.disabled = true;
    sessionCalibration = [];

    // Remember the starting Lernstand so the completion screen can show the gain
    sessionStartLernstand = computeDeckKnowledge(activeDecks.filter((d) => savedDecks[d])).percent;

    // Show the app content
    document.querySelector('#file-input-container').style.display = 'none';
    appContent.classList.remove('hidden');

    // Auto-show keyboard hints on first ever quiz
    if (!localStorage.getItem('keyboardHintsShown')) {
        const hintsPanel = document.querySelector('.keyboard-hints-panel');
        const hintsToggle = document.querySelector('.keyboard-hints-toggle');
        if (hintsPanel) {
            hintsPanel.classList.remove('hidden');
            persistToStorage('keyboardHintsShown', '1');
            setTimeout(() => hintsPanel.classList.add('hidden'), 5000);
        }
        if (hintsToggle) {
            hintsToggle.classList.add('pulse');
            hintsToggle.addEventListener(
                'animationend',
                () => hintsToggle.classList.remove('pulse'),
                { once: true }
            );
        }
    }

    // Update UI
    updateStatistics();
    showCurrentCard();
}

/**
 * Order the session for spaced-repetition mode. Nothing is excluded — students
 * cram whole decks repeatedly before an exam — but the order puts review time
 * where it pays off most:
 *   1. due cards (nextReview reached), weakest knowledge first
 *   2. cards never seen before
 *   3. not-yet-due cards, soonest due first
 * Ties keep the previous shuffle order (Array.sort is stable).
 */
function orderCardsForReview() {
    const now = new Date();
    const rankOf = (card) => {
        const data = spacedRepetitionData[getCardKey(card)];
        if (!data?.history?.length) return { group: 1, value: 0 };
        if (data.nextReview <= now) return { group: 0, value: cardKnowledge(data) };
        return { group: 2, value: data.nextReview.getTime() };
    };
    const ranked = cards.map((card) => ({ card, rank: rankOf(card) }));
    ranked.sort((a, b) => a.rank.group - b.rank.group || a.rank.value - b.rank.value);
    cards = ranked.map((r) => r.card);

    // Tell the student what this session looks like (only once cards are known)
    const dueCount = ranked.filter((r) => r.rank.group === 0).length;
    const newCount = ranked.filter((r) => r.rank.group === 1).length;
    if (dueCount + newCount < cards.length) {
        const laterCount = cards.length - dueCount - newCount;
        showMessage(
            `📅 ${dueCount} fällig · ${newCount} neu · ${laterCount} erst später fällig (kommen zuletzt)`
        );
    }
}

/**
 * Shuffle the current cards array
 */
function shuffleCards() {
    shuffleArray(cards);
}

/**
 * Fisher-Yates shuffle algorithm - shuffles array in place
 * @param {Array} array - Array to shuffle
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ============================================================================
// Card Display
// ============================================================================

/**
 * Display the current card or show feedback if quiz is complete
 */
function showCurrentCard() {
    if (currentCardIndex >= cards.length) {
        showFeedback();
        return;
    }

    isAnswered = false;
    selectedOptionIndices = []; // Reset selected options
    matchingPairs = []; // Reset matching state
    selectedLeftIndex = null;
    selectedRightIndex = null;
    shuffledRightItems = [];
    leftItemEls = [];
    rightItemEls = [];
    unpairedLeftOrder = [];
    unpairedRightOrder = [];
    rightRequiredCount = [];
    leftRequiredCount = [];
    matchingRequiredCount = 0;
    isMultiRight = false;
    isMultiLeft = false;
    isMultiCard = false;
    const card = cards[currentCardIndex];

    // Check if we're currently showing the back side
    const isShowingBack = flipCard.classList.contains('flipped');

    if (isShowingBack) {
        // Reset to front side and animate fly-in from bottom
        flipCard.classList.remove('flipped');

        // Update card content immediately (while transitioning to front)
        updateCardContent(card);

        // Start fly-in animation from bottom
        flipCard.classList.add('fly-in-bottom');

        // Clean up animation class after animation completes
        setTimeout(() => {
            flipCard.classList.remove('fly-in-bottom');
        }, 600);
    } else {
        // Normal case: just update content (first card or already on front)
        updateCardContent(card);
    }
}

/**
 * Toggle a multiple-choice option's checked state and keep selectedOptionIndices in sync.
 * @param {HTMLInputElement} checkbox
 * @param {HTMLElement} optionItem
 * @param {number[]} selectedOptionIndices
 * @param {number} originalIndex
 */
function toggleOption(checkbox, optionItem, selectedOptionIndices, originalIndex) {
    checkbox.checked = !checkbox.checked;
    syncOptionSelection(checkbox, optionItem, selectedOptionIndices, originalIndex);
}

/**
 * Sync visual + selectedOptionIndices state to match checkbox.checked
 * (used when the checkbox/label was toggled natively).
 * @param {HTMLInputElement} checkbox
 * @param {HTMLElement} optionItem
 * @param {number[]} selectedOptionIndices
 * @param {number} originalIndex
 */
function syncOptionSelection(checkbox, optionItem, selectedOptionIndices, originalIndex) {
    optionItem.classList.toggle('selected', checkbox.checked);
    optionItem.setAttribute('aria-checked', String(checkbox.checked));
    if (checkbox.checked) {
        if (!selectedOptionIndices.includes(originalIndex)) {
            selectedOptionIndices.push(originalIndex);
        }
    } else {
        const indexToRemove = selectedOptionIndices.indexOf(originalIndex);
        if (indexToRemove !== -1) {
            selectedOptionIndices.splice(indexToRemove, 1);
        }
    }
}

// ============================================================================
// Matching Handlers
// ============================================================================

/**
 * Order a component's pairs so consecutive rows share a left or right item.
 * Greedy chain: start at a leaf edge, keep extending via the same left
 * (preferring rights with the fewest remaining links, so shared items land at
 * run boundaries), then via the same right. Perfect contiguity is impossible
 * for some pair graphs (cycles); buildPairGroup tolerates any leftover splits.
 * @param {Array<[number, number]>} compPairs - pairs of one connected component
 * @returns {Array<[number, number]>} the same pairs in display-row order
 */
function orderComponentPairs(compPairs) {
    const remaining = [...compPairs];
    const degree = new Map();
    for (const [l, r] of remaining) {
        degree.set(`L${l}`, (degree.get(`L${l}`) ?? 0) + 1);
        degree.set(`R${r}`, (degree.get(`R${r}`) ?? 0) + 1);
    }
    const pickBest = (candidates, degKey) => {
        let best = -1;
        let bestDeg = Number.POSITIVE_INFINITY;
        for (const i of candidates) {
            const d = degree.get(degKey(remaining[i]));
            if (d < bestDeg) {
                bestDeg = d;
                best = i;
            }
        }
        return best;
    };
    const rows = [];
    while (remaining.length > 0) {
        let idx = -1;
        if (rows.length > 0) {
            const [prevL, prevR] = rows[rows.length - 1];
            const sameLeft = [];
            const sameRight = [];
            for (const [i, [l, r]] of remaining.entries()) {
                if (l === prevL) sameLeft.push(i);
                else if (r === prevR) sameRight.push(i);
            }
            if (sameLeft.length > 0) idx = pickBest(sameLeft, ([, r]) => `R${r}`);
            else if (sameRight.length > 0) idx = pickBest(sameRight, ([l]) => `L${l}`);
        }
        if (idx === -1) {
            // Start a new chain at a leaf edge when possible
            idx = remaining.findIndex(
                ([l, r]) => degree.get(`L${l}`) === 1 || degree.get(`R${r}`) === 1
            );
            if (idx === -1) idx = 0;
        }
        const [pair] = remaining.splice(idx, 1);
        degree.set(`L${pair[0]}`, degree.get(`L${pair[0]}`) - 1);
        degree.set(`R${pair[1]}`, degree.get(`R${pair[1]}`) - 1);
        rows.push(pair);
    }
    return rows;
}

/**
 * Build one paired group: a 3-column grid (left | unlink | right) with one row
 * per pair. Consecutive rows sharing an item are rendered as a single pill
 * spanning that run, so spans are derived from actual adjacency and pills can
 * never receive overlapping grid areas.
 * @param {Array<[number, number]>} rows - ordered [leftIndex, shuffledRightIndex] pairs
 * @returns {HTMLElement}
 */
function buildPairGroup(rows) {
    const group = document.createElement('div');
    group.className = 'matching-paired-group';

    const appendRuns = (getKey, getText, column) => {
        let runStart = 0;
        for (let i = 1; i <= rows.length; i++) {
            if (i < rows.length && getKey(rows[i]) === getKey(rows[runStart])) continue;
            const span = i - runStart;
            const el = document.createElement('div');
            el.className = 'matching-item paired';
            if (span > 1) el.classList.add('matching-paired-group-span');
            el.textContent = getText(rows[runStart]);
            el.style.gridColumn = column;
            el.style.gridRow = `${runStart + 1} / span ${span}`;
            group.append(el);
            runStart = i;
        }
    };
    appendRuns(
        ([l]) => l,
        ([l]) => leftItemEls[l].textContent,
        '1'
    );
    appendRuns(
        ([, r]) => r,
        ([, r]) => shuffledRightItems[r].text,
        '3'
    );

    for (const [rowIdx, [l, r]] of rows.entries()) {
        const unlinkBtn = document.createElement('button');
        unlinkBtn.type = 'button';
        unlinkBtn.className = 'matching-unlink-btn';
        unlinkBtn.setAttribute(
            'aria-label',
            `Verknüpfung trennen: ${leftItemEls[l].textContent} – ${shuffledRightItems[r].text}`
        );
        unlinkBtn.style.gridColumn = '2';
        unlinkBtn.style.gridRow = String(rowIdx + 1);
        unlinkBtn.addEventListener('click', () => unlinkPair(l, r));
        group.append(unlinkBtn);
    }
    return group;
}

function renderMatchingPairs() {
    const card = cards[currentCardIndex];
    if (!card || !Array.isArray(card.pairs)) return;

    // Clear all containers (items are recreated fresh each render)
    matchingPairedSection.innerHTML = '';
    matchingUnpairedLeftCol.innerHTML = '';
    matchingUnpairedRightCol.innerHTML = '';

    // Populate unpaired left column
    for (const lIdx of unpairedLeftOrder) {
        const el = leftItemEls[lIdx];
        el.className = 'matching-item';
        if (lIdx === selectedLeftIndex) el.classList.add('selected');
        el.setAttribute('aria-pressed', String(lIdx === selectedLeftIndex));
        matchingUnpairedLeftCol.append(el);
    }

    // Populate unpaired right column (in multi mode tiles persist for re-use)
    for (const rIdx of unpairedRightOrder) {
        const el = rightItemEls[rIdx];
        el.className = 'matching-item';
        if (rIdx === selectedRightIndex) el.classList.add('selected');
        el.setAttribute('aria-pressed', String(rIdx === selectedRightIndex));
        matchingUnpairedRightCol.append(el);
    }

    if (isMultiCard) {
        // Paired section: BFS the bipartite pair graph into connected components,
        // render each component as one grid with run-length spans.
        const leftNeighbors = new Map();
        const rightNeighbors = new Map();
        for (const [l, r] of matchingPairs) {
            if (!leftNeighbors.has(l)) leftNeighbors.set(l, []);
            leftNeighbors.get(l).push(r);
            if (!rightNeighbors.has(r)) rightNeighbors.set(r, []);
            rightNeighbors.get(r).push(l);
        }

        const visitedLeft = new Set();
        for (const [startL] of matchingPairs) {
            if (visitedLeft.has(startL)) continue;
            const compLefts = new Set();
            const compRights = new Set();
            const bfsQueue = [startL];
            while (bfsQueue.length > 0) {
                const cl = bfsQueue.shift();
                if (compLefts.has(cl)) continue;
                compLefts.add(cl);
                visitedLeft.add(cl);
                for (const cr of leftNeighbors.get(cl) ?? []) {
                    if (compRights.has(cr)) continue;
                    compRights.add(cr);
                    for (const cl2 of rightNeighbors.get(cr) ?? []) bfsQueue.push(cl2);
                }
            }
            const compPairs = matchingPairs.filter(([l]) => compLefts.has(l));
            matchingPairedSection.append(buildPairGroup(orderComponentPairs(compPairs)));
        }
    } else {
        // Standard matching: one 1:1 row per pair, sorted by left item
        for (const pair of matchingPairs.toSorted(([a], [b]) => a - b)) {
            matchingPairedSection.append(buildPairGroup([pair]));
        }
    }

    // In multi-card mode the unpaired section always stays visible
    const hasUnpaired = isMultiCard
        ? true
        : unpairedLeftOrder.length > 0 || unpairedRightOrder.length > 0;
    if (matchingUnpairedSection) {
        matchingUnpairedSection.classList.toggle('hidden', !hasUnpaired);
    }

    if (matchingProgressEl) {
        matchingProgressEl.textContent =
            matchingPairs.length === 0
                ? 'Tippe nacheinander zwei passende Begriffe an – oder ziehe sie aufeinander.'
                : `${matchingPairs.length} von ${matchingRequiredCount} Zuordnungen`;
    }
}

function createPair(leftIndex, shuffledRightIndex) {
    if (isAnswered) return;

    // On any rejected pairing, still release the selection so the UI never
    // appears stuck with a stale (possibly invisible) selection.
    const rejectPairing = () => {
        selectedLeftIndex = null;
        selectedRightIndex = null;
        renderMatchingPairs();
    };

    // Prevent duplicate pairing
    if (matchingPairs.some(([l, r]) => l === leftIndex && r === shuffledRightIndex)) {
        rejectPairing();
        return;
    }

    if (!isMultiCard) {
        // Standard mode: enforce 1:1 capacity
        let rightPairings = 0;
        for (const [, r] of matchingPairs) {
            if (r === shuffledRightIndex) rightPairings++;
        }
        if (rightPairings >= Math.max(rightRequiredCount[shuffledRightIndex] ?? 1, 1)) {
            rejectPairing();
            return;
        }

        let leftPairings = 0;
        for (const [l] of matchingPairs) {
            if (l === leftIndex) leftPairings++;
        }
        if (leftPairings >= Math.max(leftRequiredCount[leftIndex] ?? 1, 1)) {
            rejectPairing();
            return;
        }
    }

    matchingPairs.push([leftIndex, shuffledRightIndex]);

    if (!isMultiCard) {
        // Standard mode: remove items from columns once paired
        let leftPairings = 0;
        for (const [l] of matchingPairs) {
            if (l === leftIndex) leftPairings++;
        }
        if (leftPairings >= Math.max(leftRequiredCount[leftIndex] ?? 1, 1)) {
            unpairedLeftOrder = unpairedLeftOrder.filter((i) => i !== leftIndex);
        }
        let rightPairings = 0;
        for (const [, r] of matchingPairs) {
            if (r === shuffledRightIndex) rightPairings++;
        }
        if (rightPairings >= Math.max(rightRequiredCount[shuffledRightIndex] ?? 1, 1)) {
            unpairedRightOrder = unpairedRightOrder.filter((k) => k !== shuffledRightIndex);
        }
    }

    selectedLeftIndex = null;
    selectedRightIndex = null;
    renderMatchingPairs();
}

function handleMatchingLeftClick(leftIndex) {
    if (isAnswered || matchingDrag?.started || matchingDragJustEnded) return;
    if (selectedRightIndex === null) {
        selectedLeftIndex = selectedLeftIndex === leftIndex ? null : leftIndex;
        renderMatchingPairs();
    } else {
        createPair(leftIndex, selectedRightIndex);
    }
}

function handleMatchingRightClick(shuffledRightIndex) {
    if (isAnswered || matchingDrag?.started || matchingDragJustEnded) return;
    if (selectedLeftIndex === null) {
        selectedRightIndex = selectedRightIndex === shuffledRightIndex ? null : shuffledRightIndex;
        renderMatchingPairs();
    } else {
        createPair(selectedLeftIndex, shuffledRightIndex);
    }
}

function unlinkPair(leftIndex, rightIndex) {
    if (isAnswered || matchingDrag?.started) return;
    const prevLength = matchingPairs.length;
    matchingPairs = matchingPairs.filter(([l, r]) => !(l === leftIndex && r === rightIndex));
    if (matchingPairs.length === prevLength) return;

    // Re-add removed items at their original column position (standard non-multi
    // mode) — index order is the initial display order for both columns.
    if (!isMultiCard && !unpairedLeftOrder.includes(leftIndex)) {
        unpairedLeftOrder.push(leftIndex);
        unpairedLeftOrder.sort((a, b) => a - b);
    }
    if (!isMultiCard && !unpairedRightOrder.includes(rightIndex)) {
        unpairedRightOrder.push(rightIndex);
        unpairedRightOrder.sort((a, b) => a - b);
    }
    renderMatchingPairs();
}

// ----------------------------------------------------------------------------
// Pointer-based drag & drop for matching (touch-first; tap-to-pair still works)
// ----------------------------------------------------------------------------

/** @type {object|null} Active matching drag gesture state (null when idle) */
let matchingDrag = null;

/** @type {boolean} True briefly after a drop so the synthesized click on the source tile is ignored */
let matchingDragJustEnded = false;

/** Movement in px beyond which a press counts as a drag rather than a tap */
const MATCHING_DRAG_SLOP = 8;

/** Hold duration in ms after which a touch press lifts the tile for dragging */
const MATCHING_DRAG_HOLD_MS = 220;

function blockTouchScroll(e) {
    if (e.cancelable) e.preventDefault();
}

function blockContextMenu(e) {
    e.preventDefault();
}

/**
 * Wire pointer handlers so a column tile can be dragged onto the opposite
 * column to create a pair. A plain tap falls through to the click handler.
 * Tiles keep `touch-action: pan-y`: vertical swipes scroll the page, while
 * horizontal movement (toward the other column) or a short hold starts a drag.
 * @param {HTMLElement} item
 * @param {'left'|'right'} side
 * @param {number} index - leftIndex or shuffledRightIndex depending on side
 */
function attachMatchingDragHandlers(item, side, index) {
    item.addEventListener('pointerdown', (e) => {
        if (isAnswered || matchingDrag || !e.isPrimary) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        matchingDrag = {
            side,
            index,
            item,
            pointerId: e.pointerId,
            isTouch: e.pointerType === 'touch',
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastY: e.clientY,
            started: false,
            moved: false,
            ghost: null,
            dropEl: null,
            dropIndex: null,
            scroller: null,
            rafId: null,
            holdTimer: null,
        };
        if (matchingDrag.isTouch) {
            matchingDrag.holdTimer = setTimeout(() => {
                if (matchingDrag && !matchingDrag.started) startMatchingDrag();
            }, MATCHING_DRAG_HOLD_MS);
        }
        try {
            item.setPointerCapture(e.pointerId);
        } catch {
            /* synthetic events (tests) have no active pointer to capture */
        }
    });
    item.addEventListener('pointermove', handleMatchingDragMove);
    item.addEventListener('pointerup', handleMatchingDragEnd);
    item.addEventListener('pointercancel', cancelMatchingDrag);
}

function startMatchingDrag() {
    const d = matchingDrag;
    clearTimeout(d.holdTimer);
    d.started = true;

    // Floating ghost that follows the pointer; the source tile stays dimmed
    const rect = d.item.getBoundingClientRect();
    const ghost = d.item.cloneNode(true);
    ghost.classList.remove('selected');
    ghost.classList.add('matching-drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    d.ghost = ghost;
    d.item.classList.add('dragging');
    d.scroller = findMatchingScroller();

    // While a tile is lifted the finger must move it, not scroll the page
    document.addEventListener('touchmove', blockTouchScroll, { passive: false });
    document.addEventListener('contextmenu', blockContextMenu, true);
    navigator.vibrate?.(15);

    updateMatchingDragVisuals();
    d.rafId = requestAnimationFrame(matchingAutoScrollStep);
}

function updateMatchingDragVisuals() {
    const d = matchingDrag;
    d.ghost.style.transform = `translate(${d.lastX - d.startX}px, ${d.lastY - d.startY}px) scale(1.05)`;

    // Highlight the tile under the pointer when it is a valid pairing partner
    const under = document.elementFromPoint(d.lastX, d.lastY);
    const candidate = under?.closest('.matching-item');
    let dropEl = null;
    let dropIndex = null;
    if (candidate) {
        const targetCol = d.side === 'left' ? matchingUnpairedRightCol : matchingUnpairedLeftCol;
        if (candidate.parentElement === targetCol) {
            const idx =
                d.side === 'left'
                    ? Number(candidate.dataset.rightShuffledIndex)
                    : Number(candidate.dataset.leftIndex);
            const [l, r] = d.side === 'left' ? [d.index, idx] : [idx, d.index];
            const isDuplicate = matchingPairs.some(([pl, pr]) => pl === l && pr === r);
            if (!isDuplicate) {
                dropEl = candidate;
                dropIndex = idx;
            }
        }
    }
    if (d.dropEl !== dropEl) {
        d.dropEl?.classList.remove('drop-target');
        dropEl?.classList.add('drop-target');
    }
    d.dropEl = dropEl;
    d.dropIndex = dropIndex;
}

function handleMatchingDragMove(e) {
    const d = matchingDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > MATCHING_DRAG_SLOP) d.moved = true;

    if (!d.started) {
        if (!d.isTouch) {
            if (Math.hypot(dx, dy) > 4) startMatchingDrag();
        } else if (Math.abs(dx) > MATCHING_DRAG_SLOP && Math.abs(dx) > Math.abs(dy)) {
            // Horizontal-first movement on touch: drag toward the other column
            startMatchingDrag();
        } else if (Math.abs(dy) > MATCHING_DRAG_SLOP && Math.abs(dy) > Math.abs(dx)) {
            // Vertical-first movement on touch: this gesture is a scroll
            cancelMatchingDrag(e);
            return;
        }
        if (!d.started) return;
    }
    updateMatchingDragVisuals();
}

function handleMatchingDragEnd(e) {
    const d = matchingDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    const commit = d.started && d.dropIndex !== null && !isAnswered;
    const suppressClick = d.started && d.moved;
    const { side, index, dropIndex } = d;
    cleanupMatchingDrag();
    if (suppressClick) {
        // The browser may still synthesize a click on the source tile
        matchingDragJustEnded = true;
        setTimeout(() => {
            matchingDragJustEnded = false;
        }, 0);
    }
    if (commit) {
        if (side === 'left') createPair(index, dropIndex);
        else createPair(dropIndex, index);
    }
}

function cancelMatchingDrag(e) {
    const d = matchingDrag;
    if (!d || (e && e.pointerId !== d.pointerId)) return;
    cleanupMatchingDrag();
}

function cleanupMatchingDrag() {
    const d = matchingDrag;
    if (!d) return;
    clearTimeout(d.holdTimer);
    if (d.rafId !== null) cancelAnimationFrame(d.rafId);
    d.ghost?.remove();
    d.item.classList.remove('dragging');
    d.dropEl?.classList.remove('drop-target');
    try {
        d.item.releasePointerCapture(d.pointerId);
    } catch {
        /* capture may already be gone */
    }
    document.removeEventListener('touchmove', blockTouchScroll);
    document.removeEventListener('contextmenu', blockContextMenu, true);
    matchingDrag = null;
}

/**
 * Find the element that actually scrolls the matching UI, for edge auto-scroll
 * while dragging. Falls back to the page scroller.
 * @returns {Element}
 */
function findMatchingScroller() {
    let node = matchingContainer;
    while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
            return node;
        }
        node = node.parentElement;
    }
    return document.scrollingElement ?? document.documentElement;
}

// Scroll when the lifted tile hovers near the top/bottom viewport edge, so
// off-screen tiles are reachable on small phone screens
function matchingAutoScrollStep() {
    const d = matchingDrag;
    if (!d?.started) return;
    const margin = 64;
    const viewportH = window.innerHeight;
    let dy = 0;
    if (d.lastY < margin) dy = -Math.ceil((margin - d.lastY) / 6);
    else if (d.lastY > viewportH - margin) dy = Math.ceil((d.lastY - (viewportH - margin)) / 6);
    if (dy !== 0) {
        const before = d.scroller.scrollTop;
        d.scroller.scrollTop = before + dy;
        if (d.scroller.scrollTop !== before) updateMatchingDragVisuals();
    }
    d.rafId = requestAnimationFrame(matchingAutoScrollStep);
}

/**
 * Update the card content with new question data
 * @param {object} card - The card object to display
 */
function updateCardContent(card) {
    // Set question on both sides
    questionText.textContent = card.question;
    questionBack.textContent = card.question;

    // Show source deck info
    sourceDeckDisplay.textContent = `Quelle: ${card.sourceDeck}`;

    // Check if current card is multiple choice, matching, or standard
    const isMatching = Array.isArray(card.pairs) && card.pairs.length > 0;
    const isMultipleChoice = !isMatching && Array.isArray(card.options) && card.options.length > 0;

    if (isMatching) {
        // Handle matching question
        userAnswerInput.classList.add('hidden');
        optionsContainer.classList.add('hidden');
        showAnswerBtn.classList.remove('hidden');

        // Reset matching state for this new card
        cleanupMatchingDrag();
        matchingPairs = [];
        selectedLeftIndex = null;
        selectedRightIndex = null;
        leftItemEls = [];
        rightItemEls = [];
        unpairedLeftOrder = [];
        unpairedRightOrder = [];
        rightRequiredCount = [];
        leftRequiredCount = [];
        matchingRequiredCount = 0;
        isMultiRight = false;
        isMultiLeft = false;
        isMultiCard = false;

        // Defensive: collapse exact duplicate pair entries so required pairing
        // counts stay reachable (a duplicate can otherwise never be fulfilled)
        const seenPairKeys = new Set();
        const cardPairs = card.pairs.filter((p) => {
            const key = `${p.left}\u0000${p.right}`;
            if (seenPairKeys.has(key)) return false;
            seenPairKeys.add(key);
            return true;
        });

        // Extract unique left values (non-null) and unique right values from pairs
        const uniqueLeftValues = [];
        const seenLeft = new Set();
        for (const p of cardPairs) {
            if (p.left !== null && p.left !== undefined && !seenLeft.has(p.left)) {
                seenLeft.add(p.left);
                uniqueLeftValues.push(p.left);
            }
        }
        const uniqueRightValues = [];
        const seenRight = new Set();
        for (const p of cardPairs) {
            if (!seenRight.has(p.right)) {
                seenRight.add(p.right);
                uniqueRightValues.push(p.right);
            }
        }

        // Required pairings per right value (0 for distractors without a left partner)
        const rightRequiredCounts = new Map();
        for (const p of cardPairs) {
            if (p.left !== null && p.left !== undefined) {
                rightRequiredCounts.set(p.right, (rightRequiredCounts.get(p.right) ?? 0) + 1);
            }
        }

        // Build shuffled right-column items from unique right values (Fisher-Yates)
        shuffledRightItems = uniqueRightValues.map((v, i) => ({ original: i, text: v }));
        for (let i = shuffledRightItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledRightItems[i], shuffledRightItems[j]] = [
                shuffledRightItems[j],
                shuffledRightItems[i],
            ];
        }

        // Set required pairing counts indexed by shuffled position
        rightRequiredCount = shuffledRightItems.map(
            (item) => rightRequiredCounts.get(item.text) ?? 0
        );

        // Required pairings per left value (count occurrences in pairs with non-null right)
        const leftRequiredCounts = new Map();
        for (const p of cardPairs) {
            if (p.left !== null && p.left !== undefined) {
                leftRequiredCounts.set(p.left, (leftRequiredCounts.get(p.left) ?? 0) + 1);
            }
        }
        leftRequiredCount = uniqueLeftValues.map((v) => leftRequiredCounts.get(v) ?? 1);

        let totalRequired = 0;
        for (const c of leftRequiredCount) totalRequired += c;
        matchingRequiredCount = totalRequired;

        isMultiRight = rightRequiredCount.some((c) => c > 1);
        isMultiLeft = leftRequiredCount.some((c) => c > 1);
        isMultiCard = isMultiRight || isMultiLeft;

        // Initial ordering: left in original order, right in shuffled order
        unpairedLeftOrder = uniqueLeftValues.map((_, i) => i);
        unpairedRightOrder = shuffledRightItems.map((_, k) => k);

        // Build matching UI skeleton
        matchingContainer.innerHTML = '';

        // For multi-card mode: show a small hint so the student knows items can be reused
        if (isMultiCard) {
            const hint = document.createElement('div');
            hint.className = 'matching-multi-hint';
            hint.textContent =
                'Hinweis: Einige Begriffe und/oder Zuordnungen können mehrfach vergeben werden.';
            matchingContainer.append(hint);
        }

        // Paired section (top — empty initially, grows as pairs are made)
        matchingPairedSection = document.createElement('div');
        matchingPairedSection.className = 'matching-paired-section';
        matchingContainer.append(matchingPairedSection);

        // Unpaired section (column headers + two-column grid)
        matchingUnpairedSection = document.createElement('div');
        matchingUnpairedSection.className = 'matching-unpaired-section';

        const colHeaders = document.createElement('div');
        colHeaders.className = 'matching-col-headers';
        const leftHeader = document.createElement('div');
        leftHeader.className = 'matching-col-header';
        leftHeader.textContent = 'Begriffe';
        const rightHeader = document.createElement('div');
        rightHeader.className = 'matching-col-header';
        rightHeader.textContent = 'Zuordnung';
        colHeaders.append(leftHeader, rightHeader);
        matchingUnpairedSection.append(colHeaders);

        const unpairedCols = document.createElement('div');
        unpairedCols.className = 'matching-unpaired-cols';

        matchingUnpairedLeftCol = document.createElement('div');
        matchingUnpairedLeftCol.className = 'matching-col';
        matchingUnpairedLeftCol.id = 'matching-left-col';

        matchingUnpairedRightCol = document.createElement('div');
        matchingUnpairedRightCol.className = 'matching-col';
        matchingUnpairedRightCol.id = 'matching-right-col';

        unpairedCols.append(matchingUnpairedLeftCol, matchingUnpairedRightCol);
        matchingUnpairedSection.append(unpairedCols);
        matchingContainer.append(matchingUnpairedSection);

        // Progress line
        matchingProgressEl = document.createElement('div');
        matchingProgressEl.className = 'matching-progress';
        matchingProgressEl.id = 'matching-progress';
        matchingContainer.append(matchingProgressEl);

        // Pre-create left item elements from unique left values (placed by renderMatchingPairs)
        for (const [i, leftValue] of uniqueLeftValues.entries()) {
            const item = document.createElement('div');
            item.className = 'matching-item';
            item.dataset.leftIndex = i;
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `Begriff: ${leftValue}`);
            item.textContent = leftValue;
            item.addEventListener('click', () => handleMatchingLeftClick(i));
            item.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    handleMatchingLeftClick(i);
                }
            });
            attachMatchingDragHandlers(item, 'left', i);
            leftItemEls.push(item);
        }

        // Pre-create right item elements (placed by renderMatchingPairs)
        for (const [k, rightItem] of shuffledRightItems.entries()) {
            const item = document.createElement('div');
            item.className = 'matching-item';
            item.dataset.rightShuffledIndex = k;
            item.setAttribute('tabindex', '0');
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `Zuordnung: ${rightItem.text}`);
            item.textContent = rightItem.text;
            item.addEventListener('click', () => handleMatchingRightClick(k));
            item.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    handleMatchingRightClick(k);
                }
            });
            attachMatchingDragHandlers(item, 'right', k);
            rightItemEls.push(item);
        }

        // Place all items in initial positions
        renderMatchingPairs();

        matchingContainer.classList.remove('hidden');

        // Back-side containers
        standardAnswerContainer.classList.add('hidden');
        matchingResultContainer.classList.add('hidden');
    } else if (isMultipleChoice) {
        // Handle multiple choice question
        userAnswerInput.classList.add('hidden');
        optionsContainer.classList.remove('hidden');
        showAnswerBtn.classList.remove('hidden');

        // Clear previous options
        optionsContainer.innerHTML = '';

        // Create a copy of options array for shuffling
        const shuffledOptions = [...card.options];
        // Create a mapping to track original indices after shuffling
        const optionMapping = shuffledOptions.map((_, index) => index);

        // Shuffle options
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
            [optionMapping[i], optionMapping[j]] = [optionMapping[j], optionMapping[i]];
        }

        // Create option items with shuffled order
        for (const [index, option] of shuffledOptions.entries()) {
            const originalIndex = optionMapping[index];
            const optionItem = document.createElement('div');
            optionItem.className = 'option-item';
            optionItem.dataset.index = originalIndex;
            optionItem.setAttribute('tabindex', '0');
            optionItem.setAttribute('role', 'checkbox');
            optionItem.setAttribute('aria-checked', 'false');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'option-checkbox';
            checkbox.id = `option-${index}`;
            checkbox.setAttribute('tabindex', '-1');

            const label = document.createElement('label');
            label.htmlFor = `option-${index}`;
            label.textContent = `${index + 1}. ${option}`;

            optionItem.append(checkbox);
            optionItem.append(label);

            // Add click handler to toggle selection
            optionItem.addEventListener('click', (e) => {
                if (e.target !== checkbox && e.target !== label) {
                    toggleOption(checkbox, optionItem, selectedOptionIndices, originalIndex);
                } else {
                    // Checkbox/label toggled natively, sync state
                    syncOptionSelection(checkbox, optionItem, selectedOptionIndices, originalIndex);
                }
            });

            // Keyboard handler for option items: Space/Enter toggle, Arrow navigation
            optionItem.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case ' ':
                    case 'Enter': {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleOption(checkbox, optionItem, selectedOptionIndices, originalIndex);

                        break;
                    }
                    case 'ArrowDown':
                    case 'ArrowRight': {
                        e.preventDefault();
                        e.stopPropagation();
                        const next = optionItem.nextElementSibling;
                        if (next) next.focus();

                        break;
                    }
                    case 'ArrowUp':
                    case 'ArrowLeft': {
                        e.preventDefault();
                        e.stopPropagation();
                        const prev = optionItem.previousElementSibling;
                        if (prev) prev.focus();

                        break;
                    }
                    // No default
                }
            });

            optionsContainer.append(optionItem);
        }

        // Hide the standard text-answer container (MC feedback is rendered on the
        // back as colour-coded options in showAnswer()).
        standardAnswerContainer.classList.add('hidden');
    } else {
        // Handle standard question
        userAnswerInput.classList.remove('hidden');
        optionsContainer.classList.add('hidden');
        showAnswerBtn.classList.remove('hidden');

        // Reset user answer input
        userAnswerInput.value = '';
        userAnswerInput.readOnly = false;

        // Set answer text for standard card
        answerText.textContent = card.answer;
        standardAnswerContainer.classList.remove('hidden');
    }

    // Reset containers
    userAnswerContainer.classList.add('hidden');
    selectedOptionsContainer.classList.add('hidden');
    optionsContainerBack.classList.add('hidden');
    textExplanationContainer.classList.add('hidden');
    textExplanationContent.classList.add('hidden');
    matchingResultContainer.classList.add('hidden');
    if (!isMatching) matchingContainer.classList.add('hidden');

    // Reset explanation label and animation
    const explanationLabel = document.querySelector('.explanation-label');
    const explanationIcon = document.querySelector('.explanation-icon');
    if (explanationLabel) {
        explanationLabel.style.display = 'inline';
    }
    if (explanationIcon) {
        explanationIcon.style.animation = '';
    }

    // Clean up any existing tooltips from previous cards
    for (const indicator of document.querySelectorAll('.option-explanation-indicator')) {
        if (indicator._tooltip) {
            indicator._tooltip.remove();
            indicator._tooltip = null;
        }
    }
    for (const tooltip of document.querySelectorAll('.option-explanation-tooltip')) {
        tooltip.remove();
    }

    // Reset buttons + calibration UI for the fresh card
    recallRating.classList.add('hidden');
    nextCardBtn.style.display = 'none';

    // Pre-answer confidence prompt: shown on the front only in self-assessment
    // mode, and skipped for already-mastered cards (adaptive — no point asking
    // about cards the student reliably knows).
    currentConfidence = null;
    confidencePrompt.classList.toggle('hidden', !calibrationMode || isCardMastered(card));
    for (const b of confidencePrompt.querySelectorAll('.confidence-btn')) {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
    }

    // Tabindex management: prevent tabbing into back-side buttons when front is shown
    for (const b of recallRating.querySelectorAll('.recall-rating-btn')) {
        b.setAttribute('tabindex', '-1');
    }
    nextCardBtn.setAttribute('tabindex', '-1');
    showAnswerBtn.setAttribute('tabindex', '0');

    // Focus management: auto-focus the appropriate element
    setTimeout(() => {
        if (isMatching) {
            showAnswerBtn.focus({ preventScroll: true });
        } else if (!isMultipleChoice && !userAnswerInput.classList.contains('hidden')) {
            userAnswerInput.focus({ preventScroll: true });
        } else if (isMultipleChoice) {
            showAnswerBtn.focus({ preventScroll: true });
        }
    }, 100);

    updateStatistics();
}

/**
 * Add explanation indicator to a multiple choice option
 * @param {HTMLElement} optionItem - The option element
 * @param {number} index - The option index
 * @param {object} card - The card object
 */
function addExplanationToOption(optionItem, index, card) {
    // Check if explanations exist for this card and this specific option
    if (card.explanations && card.explanations[index.toString()]) {
        const explanation = card.explanations[index.toString()];

        // Create explanation indicator
        const indicator = document.createElement('span');
        indicator.className = 'option-explanation-indicator';
        indicator.setAttribute('tabindex', '0');
        indicator.setAttribute('role', 'button');
        indicator.setAttribute('aria-label', 'Erklärung anzeigen');

        // Create tooltip
        const tooltip = document.createElement('span');
        tooltip.className = 'option-explanation-tooltip';
        tooltip.textContent = explanation;

        // Append tooltip to body instead of indicator for better positioning
        document.body.append(tooltip);

        // Store reference to tooltip on indicator for cleanup
        indicator._tooltip = tooltip;

        optionItem.append(indicator);

        // Re-enable pointer events for the indicator only
        indicator.style.pointerEvents = 'auto';

        // Add event listeners for tooltip positioning
        let isHovering = false;

        const showTooltip = () => {
            isHovering = true;
            const rect = indicator.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Calculate available space
            const spaceAbove = rect.top;
            const spaceBelow = viewportHeight - rect.bottom;

            // Position vertically (prefer above, but use below if not enough space)
            if (spaceAbove > 120 || spaceAbove > spaceBelow) {
                // Position above
                tooltip.style.bottom = viewportHeight - rect.top + 8 + 'px';
                tooltip.style.top = 'auto';
                tooltip.dataset.arrow = 'down';
            } else {
                // Position below
                tooltip.style.top = rect.bottom + 8 + 'px';
                tooltip.style.bottom = 'auto';
                tooltip.dataset.arrow = 'up';
            }

            // Position horizontally (ensure it stays in viewport)
            const tooltipWidth = 250; // Approximate max-width
            if (rect.left + tooltipWidth > viewportWidth - 16) {
                // Align to right edge
                tooltip.style.right = '1rem';
                tooltip.style.left = 'auto';
            } else {
                // Align to left of indicator
                tooltip.style.left = Math.max(rect.left, 16) + 'px';
                tooltip.style.right = 'auto';
            }

            tooltip.style.display = 'block';
        };

        const hideTooltip = () => {
            isHovering = false;
            // Delay hiding to allow mouse to move to tooltip
            setTimeout(() => {
                if (!isHovering) {
                    tooltip.style.display = 'none';
                }
            }, 100);
        };

        // Allow hovering over the tooltip itself
        tooltip.addEventListener('mouseenter', () => {
            isHovering = true;
        });

        tooltip.addEventListener('mouseleave', () => {
            isHovering = false;
            hideTooltip();
        });

        indicator.addEventListener('mouseenter', showTooltip);
        indicator.addEventListener('mouseleave', hideTooltip);
        indicator.addEventListener('focus', showTooltip);
        indicator.addEventListener('blur', hideTooltip);
    }
}

/**
 * Toggle the visibility of text explanation content
 */
function toggleTextExplanation() {
    const isHidden = textExplanationContent.classList.contains('hidden');
    textExplanationContent.classList.toggle('hidden');

    // Stop pulsating animation after first click
    const icon = textExplanationContainer.querySelector('.explanation-icon');
    const label = textExplanationContainer.querySelector('.explanation-label');

    if (icon) {
        icon.style.animation = 'none';
    }

    // Toggle label visibility based on explanation visibility
    if (label) {
        label.style.display = isHidden ? 'none' : 'inline';
    }
}

/**
 * Flip the card to show the answer
 */
function showAnswer() {
    flipCard.classList.add('flipped');
    // Enable "Zurück" so the user can flip back to the question even before grading.
    undoBtn.disabled = false;

    const card = cards[currentCardIndex];
    const isMatching = Array.isArray(card.pairs) && card.pairs.length > 0;
    const isMultipleChoice =
        !isMatching && Array.isArray(card.options) && Array.isArray(card.correct);

    if (isMatching) {
        // Evaluate matching pairs
        let correctPairCount = 0;
        matchingResultContainer.innerHTML = '';

        for (const [i, el] of leftItemEls.entries()) {
            const leftValue = el.textContent;
            const requiredRights = [
                ...new Set(card.pairs.filter((p) => p.left === leftValue).map((p) => p.right)),
            ];

            // Collect all right values the user paired to this left item
            const userRights = [];
            for (const [l, r] of matchingPairs) {
                if (l === i) userRights.push(shuffledRightItems[r].text);
            }

            if (userRights.length === 0) {
                // No pairing made — one incorrect row
                const row = document.createElement('div');
                row.className = 'matching-result-pair incorrect';
                const icon = document.createElement('span');
                icon.className = 'matching-result-icon';
                icon.textContent = '✗';
                const textEl = document.createElement('span');
                textEl.className = 'matching-result-text';
                textEl.textContent = `${leftValue} ↔ `;
                const pairedSpan = document.createElement('span');
                pairedSpan.textContent = '(nicht zugeordnet)';
                textEl.append(pairedSpan);
                row.append(icon, textEl);
                const correction = document.createElement('div');
                correction.className = 'matching-correction';
                correction.textContent = `Richtig: ${requiredRights.join(', ')}`;
                row.append(correction);
                matchingResultContainer.append(row);
            } else {
                // One row per user pairing
                for (const rightValue of userRights) {
                    const isCorrect = card.pairs.some(
                        (p) => p.left === leftValue && p.right === rightValue
                    );
                    if (isCorrect) correctPairCount++;
                    const row = document.createElement('div');
                    row.className = `matching-result-pair ${isCorrect ? 'correct' : 'incorrect'}`;
                    const icon = document.createElement('span');
                    icon.className = 'matching-result-icon';
                    icon.textContent = isCorrect ? '✓' : '✗';
                    const textEl = document.createElement('span');
                    textEl.className = 'matching-result-text';
                    textEl.textContent = `${leftValue} ↔ `;
                    const pairedSpan = document.createElement('span');
                    pairedSpan.textContent = rightValue;
                    textEl.append(pairedSpan);
                    row.append(icon, textEl);
                    if (!isCorrect) {
                        const correction = document.createElement('div');
                        correction.className = 'matching-correction';
                        correction.textContent = `Richtig: ${requiredRights.join(', ')}`;
                        row.append(correction);
                    }
                    matchingResultContainer.append(row);
                }

                // For multi-pairing left items, also show any missed required pairings
                if (requiredRights.length > 1) {
                    for (const reqRight of requiredRights) {
                        if (!userRights.includes(reqRight)) {
                            const row = document.createElement('div');
                            row.className = 'matching-result-pair incorrect';
                            const icon = document.createElement('span');
                            icon.className = 'matching-result-icon';
                            icon.textContent = '✗';
                            const textEl = document.createElement('span');
                            textEl.className = 'matching-result-text';
                            textEl.textContent = `${leftValue} ↔ `;
                            const pairedSpan = document.createElement('span');
                            pairedSpan.textContent = `(fehlt: ${reqRight})`;
                            textEl.append(pairedSpan);
                            row.append(icon, textEl);
                            matchingResultContainer.append(row);
                        }
                    }
                }
            }
        }

        matchingResultContainer.classList.remove('hidden');

        const score = matchingRequiredCount > 0 ? correctPairCount / matchingRequiredCount : 0;
        markAnswer(score);

        nextCardBtn.style.display = 'inline-block';
    } else if (isMultipleChoice) {
        // For multiple choice questions
        // Clone options to back side for color-coded feedback
        optionsContainerBack.innerHTML = optionsContainer.innerHTML;

        // Apply color coding to back side option items
        const backOptionItems = optionsContainerBack.querySelectorAll('.option-item');
        for (const optionItem of backOptionItems) {
            const originalIndex = Number.parseInt(optionItem.dataset.index);
            const isCorrectOption = card.correct.includes(originalIndex);
            const wasSelected = selectedOptionIndices.includes(originalIndex);

            // Disable further interaction
            const checkbox = optionItem.querySelector('.option-checkbox');
            checkbox.disabled = true;
            optionItem.style.pointerEvents = 'none';

            // Remove previous selection styling
            optionItem.classList.remove('selected');

            // Apply color coding based on correctness
            if (wasSelected && isCorrectOption) {
                // Correctly selected
                optionItem.classList.add('mc-correct-selected');
            } else if (wasSelected && !isCorrectOption) {
                // Incorrectly selected (should not have been ticked)
                optionItem.classList.add('mc-incorrect-selected');
                // Add explanation indicator if available
                addExplanationToOption(optionItem, originalIndex, card);
            } else if (!wasSelected && isCorrectOption) {
                // Should have been selected but wasn't
                optionItem.classList.add('mc-missed');
                // Add explanation indicator if available
                addExplanationToOption(optionItem, originalIndex, card);
            } else {
                // Correctly not selected
                optionItem.classList.add('mc-neutral');
            }
        }

        // Show back options container and hide other answer displays
        optionsContainerBack.classList.remove('hidden');
        selectedOptionsContainer.classList.add('hidden');

        // Auto-score with a set-based (Jaccard) overlap of correct vs. selected
        // options — far more discriminating than the old per-option scheme, where
        // a near-miss on a many-distractor question still cleared the pass mark.
        markAnswer(scoreMultipleChoice(card.correct, selectedOptionIndices));

        // Multiple choice is auto-scored — no self-rating, just advance.
        nextCardBtn.style.display = 'inline-block';
    } else {
        // Handle standard text answer display
        const userAnswer = userAnswerInput.value.trim();
        if (userAnswer) {
            userAnswerDisplay.textContent = userAnswer;
            userAnswerContainer.classList.remove('hidden');
        } else {
            userAnswerContainer.classList.add('hidden');
        }

        // Show explanation for text answers if available (always, not just for incorrect answers)
        if (card.explanation) {
            textExplanationContent.textContent = card.explanation;
            textExplanationContainer.classList.remove('hidden');
        }

        // Treat a normalized match (case/whitespace/trailing-punctuation
        // insensitive) as correct; anything else falls through to self-grading.
        const isExactMatch =
            userAnswer.length > 0 && normalizeAnswer(userAnswer) === normalizeAnswer(card.answer);

        if (isExactMatch) {
            // Exact text match is a fair correctness proxy: auto-grade as perfect.
            markAnswer(true);
            recallRating.classList.add('hidden');
            nextCardBtn.style.display = 'inline-block';
        } else {
            // Otherwise let the student grade their own recall (4-level scale),
            // which feeds the spaced-repetition ladder a finer signal than yes/no.
            recallRating.classList.remove('hidden');
            nextCardBtn.style.display = 'none';
        }
    }

    // Tabindex: hide front-side from tab, expose back-side
    showAnswerBtn.setAttribute('tabindex', '-1');
    userAnswerInput.setAttribute('tabindex', '-1');
    for (const b of recallRating.querySelectorAll('.recall-rating-btn')) {
        b.setAttribute('tabindex', '0');
    }
    nextCardBtn.setAttribute('tabindex', '0');

    // Focus the first actionable control after flip animation
    setTimeout(() => {
        if (nextCardBtn.style.display !== 'none') {
            nextCardBtn.focus({ preventScroll: true });
        } else if (!recallRating.classList.contains('hidden')) {
            recallRating.querySelector('.recall-rating-btn')?.focus({ preventScroll: true });
        }
    }, 400);
}

/**
 * Format a score for display: show as integer if whole, otherwise one decimal
 * @param {number} value - Score value
 * @returns {string} Formatted score
 */
function formatScore(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Normalize a free-text answer for forgiving comparison: lower-case, collapse
 * internal whitespace, and drop trailing sentence punctuation. This lets
 * "Berlin." / "berlin" / "der  Bundestag " match the stored answer instead of
 * needlessly dropping the student into manual self-grading on a near-exact hit.
 * @param {string} text
 * @returns {string}
 */
function normalizeAnswer(text) {
    return String(text ?? '')
        .trim()
        .toLowerCase()
        .replaceAll(/\s+/g, ' ')
        .replace(/[.,;:!?]+$/u, '')
        .trim();
}

/**
 * Score a multiple-choice answer as the Jaccard overlap between the correct and
 * the selected option sets: |correct ∩ selected| / |correct ∪ selected|.
 * This rewards getting the *set* right rather than each option independently, so
 * a wrong tick or a missed correct answer meaningfully lowers the score even on
 * questions with many distractors. Selecting nothing when nothing is correct is
 * a perfect 1; any mismatch trends toward 0.
 * @param {number[]} correctIndices - Indices that should be selected
 * @param {number[]} selectedIndices - Indices the user selected
 * @returns {number} Score in [0, 1]
 */
function scoreMultipleChoice(correctIndices, selectedIndices) {
    const correct = new Set(correctIndices);
    const selected = new Set(selectedIndices);
    if (correct.size === 0 && selected.size === 0) return 1;
    let intersection = 0;
    for (const i of selected) {
        if (correct.has(i)) intersection++;
    }
    const union = correct.size + selected.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Mark the current answer as correct or incorrect
 * @param {number|boolean} scoreOrBool - Score from 0.0 to 1.0, or boolean
 */
function markAnswer(scoreOrBool) {
    if (isAnswered) {
        return;
    }

    // Normalize: boolean → number (true=1, false=0), number stays as-is
    let score = scoreOrBool;
    if (typeof scoreOrBool === 'boolean') score = scoreOrBool ? 1 : 0;
    const isFullyCorrect = score === 1;
    const card = cards[currentCardIndex];

    // Capture undo snapshot BEFORE modifying state
    captureUndoSnapshot(card, score);

    isAnswered = true;
    answeredCards[currentCardIndex] = score;
    const deckName = card.sourceDeck;

    // Update spaced repetition data
    const isFromSRBuckets = activeDecks.length === 1 && activeDecks[0] === 'SR Buckets';
    if (studyMode === 'spaced-repetition' || isFromSRBuckets) {
        updateSpacedRepetition(card, score, currentConfidence);
    }

    // Calibration: compare the pre-answer confidence with the actual outcome.
    // Works in any study mode; the undo snapshot (captured above) remembers
    // whether an entry was pushed so it can be rolled back.
    if (calibrationMode && currentConfidence !== null) {
        sessionCalibration.push({ confidence: currentConfidence, score });
        if (undoStack.length > 0) undoStack.at(-1).calibrationPushed = true;
        showCalibrationCue(currentConfidence, score);
    }

    // Accumulate fractional scores
    correctCount += score;
    if (deckStats[deckName]) {
        deckStats[deckName].correct += score;
    }
    if (score < 1) {
        incorrectCount += 1 - score;
        if (deckStats[deckName]) {
            deckStats[deckName].incorrect += 1 - score;
        }
    }

    if (isFullyCorrect) {
        // Trigger confetti animation for fully correct answers
        triggerConfetti();
    }

    // Hide the rating control and show next button
    recallRating.classList.add('hidden');
    confidencePrompt.classList.add('hidden');
    nextCardBtn.style.display = 'inline-block';

    // If this was a multiple choice question, highlight correct/incorrect options
    if (Array.isArray(card.options) && Array.isArray(card.correct)) {
        const optionItems = document.querySelectorAll('.option-item');

        for (const item of optionItems) {
            const optionIndex = Number.parseInt(item.dataset.index);
            const isOptionCorrect = card.correct.includes(optionIndex);
            const isOptionSelected = selectedOptionIndices.includes(optionIndex);

            // First remove any existing styling classes
            item.classList.remove('correct', 'incorrect');

            // Add appropriate styling
            if (isOptionCorrect) {
                item.classList.add('correct');
            } else if (isOptionSelected) {
                item.classList.add('incorrect');
            }
        }
    }

    updateStatistics();

    // Focus the next button after marking
    if (nextCardBtn.style.display !== 'none') {
        nextCardBtn.focus({ preventScroll: true });
    }
}

/**
 * Surface a calibration nudge as a brief toast — only when the self-estimate
 * and the outcome actually disagree (the cases worth acting on). Matches stay
 * silent so the flow stays quiet. Toast-based so it survives the immediate
 * advance after a rating click.
 * @param {number} confidence - 1 (unsicher) … 3 (sicher)
 * @param {number} score - answer score 0..1
 */
function showCalibrationCue(confidence, score) {
    const correct = score >= SR_PASS_SCORE;
    if (confidence === 3 && !correct) {
        showMessage('Überschätzt – diese Karte kommt schneller wieder dran.');
    } else if (confidence === 1 && correct) {
        showMessage('Besser als gedacht – du kannst das schon.');
    }
}

/**
 * Move to the next card
 */
function showNextCard() {
    currentCardIndex++;
    showCurrentCard();
}

/**
 * Update the statistics display
 */
function updateStatistics() {
    const totalCards = cards.length;
    const completedCards = answeredCards.filter((a) => a !== null).length;
    const remainingCards = totalCards - completedCards;
    const percentageComplete = totalCards > 0 ? (completedCards / totalCards) * 100 : 0;

    cardsRemainingElement.textContent = remainingCards;
    cardsCompletedElement.textContent = completedCards;
    correctCountElement.textContent = formatScore(correctCount);
    incorrectCountElement.textContent = formatScore(incorrectCount);

    progressBar.style.width = `${percentageComplete}%`;
    // Mirror progress onto the progressbar role for assistive tech.
    const progressTrack = progressBar.parentElement;
    if (progressTrack) {
        progressTrack.setAttribute('aria-valuenow', String(Math.round(percentageComplete)));
        progressTrack.setAttribute(
            'aria-valuetext',
            `${completedCards} von ${totalCards} Karten bearbeitet`
        );
    }
}

// ============================================================================
// Quiz Completion & Restart
// ============================================================================

/**
 * Show feedback and statistics when quiz is complete
 */
function showFeedback() {
    const totalAnswered = correctCount + incorrectCount;
    const percentageCorrect =
        totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    finalScoreElement.textContent = `${percentageCorrect}% (${formatScore(correctCount)} von ${formatScore(totalAnswered)})`;
    feedbackElement.classList.remove('hidden');
    cardContainer.classList.add('hidden');

    // Overall knowledge estimate for the studied decks (after this session's
    // answers are recorded) — gives crammers a "bin ich bereit?" readout.
    let knowledgeLine = document.querySelector('#feedback-knowledge');
    if (!knowledgeLine) {
        knowledgeLine = document.createElement('div');
        knowledgeLine.id = 'feedback-knowledge';
        knowledgeLine.className = 'feedback-knowledge';
        // final-score is a <span> inside a <p> — insert after the paragraph
        finalScoreElement.parentElement.after(knowledgeLine);
    }
    const realDecks = activeDecks.filter((d) => savedDecks[d]);
    const knowledge = computeDeckKnowledge(realDecks);
    if (knowledge.total > 0) {
        const level = knowledge.percent >= 80 ? 'high' : knowledge.percent >= 50 ? 'mid' : 'low';
        knowledgeLine.className = `feedback-knowledge feedback-knowledge-${level}`;
        knowledgeLine.textContent = `📈 Lernstand: ${knowledge.percent} % (${knowledge.attempted} von ${knowledge.total} Karten geübt)`;
        knowledgeLine.classList.remove('hidden');
    } else {
        knowledgeLine.classList.add('hidden');
    }

    // Calibration summary: how well the student's confidence matched reality.
    let calibrationLine = document.querySelector('#feedback-calibration');
    if (!calibrationLine) {
        calibrationLine = document.createElement('div');
        calibrationLine.id = 'feedback-calibration';
        calibrationLine.className = 'feedback-knowledge';
        (document.querySelector('#feedback-knowledge') ?? finalScoreElement.parentElement).after(
            calibrationLine
        );
    }
    if (sessionCalibration.length > 0) {
        const avgConf =
            sessionCalibration.reduce((a, e) => a + (e.confidence - 1) / 2, 0) /
            sessionCalibration.length;
        const avgScore =
            sessionCalibration.reduce((a, e) => a + e.score, 0) / sessionCalibration.length;
        const sure = sessionCalibration.filter((e) => e.confidence === 3);
        let msg;
        if (sure.length > 0) {
            const sureCorrect = Math.round(
                (sure.filter((e) => e.score >= SR_PASS_SCORE).length / sure.length) * 100
            );
            msg = `Selbsteinschätzung: von deinen „sicher“-Karten lagst du zu ${sureCorrect} % richtig`;
        } else {
            msg = `Selbsteinschätzung für ${sessionCalibration.length} Karten erfasst`;
        }
        const gap = avgConf - avgScore;
        if (gap > 0.15) msg += ' · du neigst zur Überschätzung';
        else if (gap < -0.15) msg += ' · du bist strenger zu dir als nötig';
        else msg += ' · deine Einschätzung passt gut';
        calibrationLine.textContent = msg;
        calibrationLine.classList.remove('hidden');
    } else {
        calibrationLine.classList.add('hidden');
    }

    // Record the journey (session log + daily snapshot) and the gamification line
    recordSession();
    recordLernstandSnapshot();
    renderFeedbackGamification(knowledge);

    // Show/hide buttons based on whether we're in SR bucket mode
    const isFromSRBuckets = activeDecks.length === 1 && activeDecks[0] === 'SR Buckets';
    if (isFromSRBuckets) {
        restartBtn.style.display = 'none';
        uploadNewBtn.style.display = 'none';
        returnToSrBtn.style.display = 'inline-block';
    } else {
        restartBtn.style.display = 'inline-block';
        uploadNewBtn.style.display = 'inline-block';
        returnToSrBtn.style.display = 'none';
    }

    // Display per-deck statistics
    deckStatsContainer.innerHTML = '';

    if (activeDecks.length > 1) {
        const deckStatsHeader = document.createElement('h3');
        deckStatsHeader.textContent = 'Statistik pro Deck:';
        deckStatsContainer.append(deckStatsHeader);

        const deckStatsList = document.createElement('div');
        deckStatsList.className = 'deck-stats-list';

        for (const deckName in deckStats) {
            const stats = deckStats[deckName];
            const totalAnswered = stats.correct + stats.incorrect;

            if (totalAnswered === 0) continue;

            const deckAccuracy = Math.round((stats.correct / totalAnswered) * 100);
            const deckKnowledge = savedDecks[deckName] ? computeDeckKnowledge([deckName]) : null;
            const knowledgeSuffix =
                deckKnowledge && deckKnowledge.total > 0
                    ? `, Lernstand ${deckKnowledge.percent}%`
                    : '';

            const deckStatItem = document.createElement('div');
            deckStatItem.className = 'deck-stat-item';
            deckStatItem.innerHTML = `
                <strong>${sanitizeHTML(deckName)}:</strong>
                ${formatScore(stats.correct)} richtig,
                ${formatScore(stats.incorrect)} falsch,
                ${deckAccuracy}% Genauigkeit${knowledgeSuffix}
            `;

            deckStatsList.append(deckStatItem);
        }

        deckStatsContainer.append(deckStatsList);
    }

    // Focus first visible action button
    setTimeout(() => {
        if (restartBtn.style.display !== 'none') {
            restartBtn.focus({ preventScroll: true });
        } else if (returnToSrBtn.style.display !== 'none') {
            returnToSrBtn.focus({ preventScroll: true });
        }
    }, 100);
}

/**
 * Restart the quiz with the same cards
 */
function restartQuiz() {
    // Don't allow restart from SR buckets mode
    const isFromSRBuckets = activeDecks.length === 1 && activeDecks[0] === 'SR Buckets';
    if (isFromSRBuckets) {
        showError('Bitte nutze "Zurück zur SR-Verwaltung" um neue Buckets auszuwählen.');
        return;
    }

    currentCardIndex = 0;
    correctCount = 0;
    incorrectCount = 0;

    // Reset deck statistics
    resetDeckStats(activeDecks);

    // Reset answered cards
    answeredCards = Array.from({ length: cards.length }).fill(null);

    // Reset session-scoped accumulators too (otherwise the completion screen's
    // calibration summary double-counts, the Lernstand-gain badge measures from
    // the first run, and the undo stack carries stale snapshots across the reset).
    undoStack = [];
    undoBtn.disabled = true;
    sessionCalibration = [];
    sessionStartLernstand = computeDeckKnowledge(activeDecks.filter((d) => savedDecks[d])).percent;

    // Reshuffle and re-order by review urgency for the repeat run
    shuffleCards();
    orderCardsForReview();

    // Reset UI
    feedbackElement.classList.add('hidden');
    cardContainer.classList.remove('hidden');
    updateStatistics();
    showCurrentCard();
}

/**
 * Return to SR Manager after completing a quiz from SR buckets
 */
function returnToSRManager() {
    // Hide quiz content, return to the hub on the "Karten verwalten" tab
    appContent.classList.add('hidden');
    feedbackElement.classList.add('hidden');
    document.querySelector('#file-input-container').style.display = 'block';
    appTitle.textContent = 'Lernkarten App';
    activeDecks = [];
    openProgressView('manage');
}

/**
 * Reset the app and return to deck selection
 */
function resetAndUpload() {
    // Don't allow upload from SR buckets mode
    const isFromSRBuckets = activeDecks.length === 1 && activeDecks[0] === 'SR Buckets';
    if (isFromSRBuckets) {
        showError('Bitte nutze "Zurück zur SR-Verwaltung" um neue Buckets auszuwählen.');
        return;
    }

    // Reset everything and show file upload
    document.querySelector('#file-input-container').style.display = 'block';
    appContent.classList.add('hidden');
    feedbackElement.classList.add('hidden');
    cardContainer.classList.remove('hidden');
    fileInput.value = '';

    // Reset the app title
    appTitle.textContent = 'Lernkarten';
    appSubtitle.style.display = 'block';

    // Clear any error messages
    errorMessageElement.classList.add('hidden');
    errorMessageElement.textContent = '';

    // Display saved decks
    displaySavedDecks();
}

// ============================================================================
// User Feedback
// ============================================================================

/**
 * Show an error message to the user
 * @param {string} message - Error message to display
 */
function showError(message) {
    errorMessageElement.textContent = message;
    errorMessageElement.classList.remove('hidden');
    setTimeout(() => {
        errorMessageElement.classList.add('hidden');
    }, 5000);
}

// ============================================================================
// UX Enhancements
// ============================================================================

/**
 * Get unique key for a card (for spaced repetition tracking)
 * Uses ||| as separator since it won't appear in normal text
 * @param {object} card - Card object
 * @returns {string} Unique card key
 */
function getCardKey(card) {
    return `${card.sourceDeck || 'unknown'}|||${card.question}`;
}

/**
 * Pure projection of the ladder: given the current step and an answer score,
 * return the resulting step and how long to wait before the next review.
 *   - score ≈ 1   → skip ahead two steps (mastered, like Anki's "Easy")
 *   - score ≥ 0.8 → advance one step
 *   - 0.5–0.8     → keep step, review at half the interval (partial recall)
 *   - score < 0.5 → reset to the first step
 * @param {number} step - current ladder step
 * @param {number} score - answer score 0..1
 * @returns {{step: number, waitMinutes: number}}
 */
function projectSR(step, score) {
    const maxStep = SR_STEP_MINUTES.length - 1;
    if (score >= 0.999) {
        const newStep = Math.min(step + 2, maxStep);
        return { step: newStep, waitMinutes: SR_STEP_MINUTES[newStep] };
    }
    if (score >= SR_PASS_SCORE) {
        const newStep = Math.min(step + 1, maxStep);
        return { step: newStep, waitMinutes: SR_STEP_MINUTES[newStep] };
    }
    if (score >= SR_FAIL_SCORE) {
        // Partially correct: keep the step, but review sooner than usual.
        // (The old SM-2 logic reset everything on any score < 1, which punished
        // matching/MC cards where partial scores are the norm.)
        return { step, waitMinutes: Math.max(SR_STEP_MINUTES[step] / 2, SR_STEP_MINUTES[0]) };
    }
    return { step: 0, waitMinutes: SR_STEP_MINUTES[0] };
}

/**
 * Update spaced repetition data after answering
 * @param {object} card - Card object
 * @param {number} score - answer score 0..1
 * @param {number|null} [confidence] - pre-answer self-rated confidence (1-3), null if not captured
 */
function updateSpacedRepetition(card, score, confidence = null) {
    const key = getCardKey(card);
    const now = new Date();
    const data = spacedRepetitionData[key] ?? {
        step: 0,
        repetitions: 0,
        nextReview: now,
        history: [],
        confHistory: [],
    };

    // Backward compat with entries created before the cram ladder / calibration
    if (!data.history) data.history = [];
    if (!data.confHistory) data.confHistory = [];
    if (data.step === undefined) data.step = migrateLegacyInterval(data.interval);

    data.history.push(score);
    // Keep confHistory index-aligned with history: back-fill null for any older
    // answers recorded before calibration existed, then append this one.
    while (data.confHistory.length < data.history.length - 1) data.confHistory.push(null);
    data.confHistory.push(confidence);
    data.repetitions = (data.repetitions ?? 0) + 1;

    const projected = projectSR(data.step, score);
    data.step = projected.step;
    data.lastReview = now;
    data.nextReview = new Date(now.getTime() + projected.waitMinutes * 60 * 1000);

    spacedRepetitionData[key] = data;
    saveSpacedRepetitionData();
}

/**
 * Map a legacy SM-2 day interval onto the cram ladder.
 * @param {number|undefined} days
 * @returns {number} ladder step index
 */
function migrateLegacyInterval(days) {
    if (!days || days <= 1) return 4; // legacy "1 Tag"
    if (days <= 4) return 5; // legacy short intervals → "3 Tage"
    return 6; // anything longer → "7 Tage"
}

/**
 * Revive and migrate raw SR data (from localStorage or a backup import):
 * date strings become Date objects, legacy SM-2 entries get a ladder step.
 */
function reviveSRData() {
    for (const data of Object.values(spacedRepetitionData)) {
        data.nextReview = new Date(data.nextReview);
        if (data.lastReview) data.lastReview = new Date(data.lastReview);
        if (data.step === undefined) data.step = migrateLegacyInterval(data.interval);
        if (!data.confHistory) data.confHistory = [];
    }
}

/**
 * Estimate how well one card is known right now (0..1).
 * Blend of the recency-weighted last scores (how well the student answers)
 * and ladder progress (how often the card was already repeated successfully).
 * Step 4 (1 Tag) counts as fully consolidated — adequate for an exam within days.
 * @param {object} data - SR entry for the card
 * @returns {number}
 */
function cardKnowledge(data) {
    if (!data?.history?.length) return 0;
    const recent = data.history.slice(-3).reverse();
    const weights = [0.6, 0.25, 0.15];
    let sum = 0;
    let weightSum = 0;
    for (const [i, s] of recent.entries()) {
        sum += s * weights[i];
        weightSum += weights[i];
    }
    const recentScore = sum / weightSum;
    const consolidation = Math.min((data.step ?? 0) / 4, 1);
    return 0.7 * recentScore + 0.3 * consolidation;
}

/**
 * Aggregate knowledge estimate over all cards of the given decks.
 * Cards never attempted count as 0, so the percentage reflects both
 * coverage and mastery — a deck is only "green" once everything sits.
 * @param {string[]} deckNames
 * @returns {{percent: number, attempted: number, total: number}}
 */
function computeDeckKnowledge(deckNames) {
    let sum = 0;
    let total = 0;
    let attempted = 0;
    for (const deckName of deckNames) {
        const deck = savedDecks[deckName];
        if (!deck?.cards) continue;
        for (const c of deck.cards) {
            total++;
            const data = spacedRepetitionData[`${deckName}|||${c.question}`];
            if (data?.history?.length) {
                attempted++;
                sum += cardKnowledge(data);
            }
        }
    }
    return { percent: total > 0 ? Math.round((sum / total) * 100) : 0, attempted, total };
}

/**
 * Build the small "Lernstand" badge (mini progress bar + percent) shown in
 * deck rows. Returns null when no card of the decks was ever attempted.
 * @param {string[]} deckNames
 * @returns {HTMLElement|null}
 */
function buildKnowledgeBadge(deckNames) {
    const knowledge = computeDeckKnowledge(deckNames);
    if (knowledge.attempted === 0) return null;

    const badge = document.createElement('span');
    const level = knowledge.percent >= 80 ? 'high' : knowledge.percent >= 50 ? 'mid' : 'low';
    badge.className = `topic-knowledge topic-knowledge-${level}`;
    badge.title =
        `Lernstand: berücksichtigt deine letzten Antworten und wie sicher die Karten ` +
        `bereits wiederholt wurden (${knowledge.attempted} von ${knowledge.total} Karten geübt).`;

    const bar = document.createElement('span');
    bar.className = 'topic-knowledge-bar';
    const fill = document.createElement('span');
    fill.className = 'topic-knowledge-fill';
    fill.style.width = `${knowledge.percent}%`;
    bar.append(fill);

    const text = document.createElement('span');
    text.className = 'topic-knowledge-text';
    text.textContent = `${knowledge.percent} %`;

    badge.append(bar, text);

    // Tiny trend sparkline if this topic has enough snapshot history
    const spark = buildSparkline(deckTrendSeries(deckNames));
    if (spark) badge.append(spark);

    return badge;
}

/**
 * Save spaced repetition data to localStorage
 */
function saveSpacedRepetitionData() {
    try {
        localStorage.setItem('spacedRepetitionData', JSON.stringify(spacedRepetitionData));
    } catch (error) {
        console.error('Error saving spaced repetition data:', error);
    }
}

/**
 * Load spaced repetition data from localStorage
 */
function loadSpacedRepetitionData() {
    try {
        const data = localStorage.getItem('spacedRepetitionData');
        if (data) {
            spacedRepetitionData = JSON.parse(data);
            reviveSRData();
        }
    } catch (error) {
        console.error('Error loading spaced repetition data:', error);
        spacedRepetitionData = {};
    }
}

/**
 * Handle deck search input
 * @param {Event} event - Input event
 */
function handleDeckSearch(event) {
    const searchTerm = event.target.value.trim();
    displaySavedDecks(searchTerm);
}

/**
 * Show a temporary success/info message to the user
 * @param {string} message - Message to display
 */
function showMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message-popup';
    // Announce to assistive tech without stealing focus.
    messageEl.setAttribute('role', 'status');
    messageEl.textContent = message;
    document.body.append(messageEl);

    setTimeout(() => {
        messageEl.classList.add('show');
    }, 10);

    setTimeout(() => {
        messageEl.classList.remove('show');
        setTimeout(() => {
            messageEl.remove();
        }, 300);
    }, 3000);
}

/**
 * Accessible modal dialog — a themed, focus-trapped replacement for the native
 * blocking `confirm()` / `prompt()`. Returns a Promise resolving to:
 *   - confirm: `true` (confirmed) / `false` (cancelled)
 *   - prompt:  the entered string (confirmed) / `null` (cancelled)
 * Esc and backdrop click cancel; Enter confirms (from a prompt's input or the
 * focused confirm button); focus is trapped while open and restored on close.
 * @param {object} opts
 * @param {string} opts.message
 * @param {'confirm'|'prompt'} [opts.kind]
 * @param {string} [opts.defaultValue]
 * @param {string} [opts.confirmText]
 * @param {string} [opts.cancelText]
 * @param {boolean} [opts.danger] - Style the confirm button as destructive.
 * @returns {Promise<boolean|string|null>}
 */
function uiDialog(opts) {
    const {
        message,
        kind = 'confirm',
        defaultValue = '',
        confirmText = 'OK',
        cancelText = 'Abbrechen',
        danger = false,
    } = opts;

    return new Promise((resolve) => {
        const previouslyFocused = document.activeElement;

        const backdrop = document.createElement('div');
        backdrop.className = 'ui-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'ui-modal';
        modal.setAttribute('role', kind === 'prompt' ? 'dialog' : 'alertdialog');
        modal.setAttribute('aria-modal', 'true');

        const msgEl = document.createElement('p');
        msgEl.className = 'ui-modal-message';
        msgEl.id = `ui-modal-msg-${Date.now()}`;
        msgEl.textContent = message;
        modal.setAttribute('aria-labelledby', msgEl.id);
        modal.append(msgEl);

        let input = null;
        if (kind === 'prompt') {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'ui-modal-input';
            input.value = defaultValue;
            input.setAttribute('aria-label', message);
            modal.append(input);
        }

        const actions = document.createElement('div');
        actions.className = 'ui-modal-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ui-modal-btn ui-modal-cancel';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = `ui-modal-btn ui-modal-confirm${danger ? ' ui-modal-danger' : ''}`;
        confirmBtn.textContent = confirmText;

        actions.append(cancelBtn, confirmBtn);
        modal.append(actions);
        backdrop.append(modal);
        document.body.append(backdrop);

        const prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const cancelResult = kind === 'prompt' ? null : false;
        let settled = false;
        /**
         * @param {boolean|string|null} result
         */
        function close(result) {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeydown, true);
            document.body.style.overflow = prevBodyOverflow;
            backdrop.remove();
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
            resolve(result);
        }

        /**
         * @param {KeyboardEvent} e
         */
        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(cancelResult);
            } else if (e.key === 'Enter' && input && document.activeElement === input) {
                // Buttons handle their own Enter/Space natively; only the prompt
                // input needs Enter wired to confirm.
                e.preventDefault();
                close(input.value);
            } else if (e.key === 'Tab') {
                const order = input ? [input, cancelBtn, confirmBtn] : [cancelBtn, confirmBtn];
                const first = order[0];
                const last = order[order.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        cancelBtn.addEventListener('click', () => close(cancelResult));
        confirmBtn.addEventListener('click', () => close(input ? input.value : true));
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop) close(cancelResult);
        });
        document.addEventListener('keydown', onKeydown, true);

        if (input) {
            input.focus();
            input.select();
        } else {
            confirmBtn.focus();
        }
    });
}

/**
 * Themed confirm dialog. @see uiDialog
 * @param {string} message
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
function uiConfirm(message, options = {}) {
    return uiDialog({ ...options, message, kind: 'confirm' });
}

/**
 * Themed prompt dialog. @see uiDialog
 * @param {string} message
 * @param {string} [defaultValue]
 * @param {object} [options]
 * @returns {Promise<string|null>}
 */
function uiPrompt(message, defaultValue = '', options = {}) {
    return uiDialog({ ...options, message, defaultValue, kind: 'prompt' });
}

// ============================================================================
// Backup & Restore
// ============================================================================

/**
 * Export all app data as a single JSON backup file
 */
function exportBackup() {
    const backup = {
        version: 1,
        exportDate: new Date().toISOString(),
        flashcardDecks: savedDecks,
        spacedRepetitionData: spacedRepetitionData,
        // Progress journey so it survives a backup/restore
        lernstandHistory: lernstandHistory,
        sessionHistory: sessionHistory,
        achievements: achievements,
        examDate: examDate,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lernkarten-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const deckCount = Object.keys(savedDecks).length;
    const srCount = Object.keys(spacedRepetitionData).length;
    showMessage(`Backup exportiert: ${deckCount} Decks, ${srCount} SR-Einträge.`);
}

// ============================================================================
// Undo / Go Back One Card
// ============================================================================

/**
 * Capture a snapshot of the current state before marking an answer.
 * Called from markAnswer() before any state changes.
 * @param card
 * @param score
 */
function captureUndoSnapshot(card, score) {
    const deckName = card.sourceDeck;
    const key = getCardKey(card);

    undoStack.push({
        cardIndex: currentCardIndex,
        score: score,
        correctCount: correctCount,
        incorrectCount: incorrectCount,
        deckStatsSnapshot: deckStats[deckName] ? { ...deckStats[deckName] } : null,
        deckName: deckName,
        srDataSnapshot: spacedRepetitionData[key]
            ? structuredClone(spacedRepetitionData[key])
            : null,
        srKey: key,
    });

    undoBtn.disabled = false;
}

/**
 * Undo the last answer and go back one card
 */
function undoLastAnswer() {
    // Pre-grading case: answer is shown but Richtig/Falsch not yet pressed →
    // flip back to the question side so the user can re-attempt before grading.
    if (undoStack.length === 0) {
        if (flipCard.classList.contains('flipped')) {
            flipCard.classList.remove('flipped');
            undoBtn.disabled = true;
        }
        return;
    }

    const snapshot = undoStack.pop();

    // If on feedback screen, restore card view
    if (!feedbackElement.classList.contains('hidden')) {
        feedbackElement.classList.add('hidden');
        cardContainer.classList.remove('hidden');
    }

    // Restore global counters
    correctCount = snapshot.correctCount;
    incorrectCount = snapshot.incorrectCount;

    // Restore deck stats
    if (snapshot.deckStatsSnapshot && deckStats[snapshot.deckName]) {
        deckStats[snapshot.deckName] = snapshot.deckStatsSnapshot;
    }

    // Restore SR data
    if (snapshot.srDataSnapshot) {
        spacedRepetitionData[snapshot.srKey] = snapshot.srDataSnapshot;
        saveSpacedRepetitionData();
    } else if (spacedRepetitionData[snapshot.srKey] && !snapshot.srDataSnapshot) {
        // Card had no SR data before — remove it
        delete spacedRepetitionData[snapshot.srKey];
        saveSpacedRepetitionData();
    }

    // Roll back the session calibration entry recorded for this answer
    if (snapshot.calibrationPushed) sessionCalibration.pop();
    currentConfidence = null;

    // Restore card state
    answeredCards[snapshot.cardIndex] = null;
    currentCardIndex = snapshot.cardIndex;
    isAnswered = false;

    // Update UI
    undoBtn.disabled = undoStack.length === 0;
    updateStatistics();
    showCurrentCard();
}

// ============================================================================
// Confetti Animation
// ============================================================================

/** Whether the user has asked the OS to minimize non-essential motion. */
function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Trigger an improved confetti animation for correct answers
 */
function triggerConfetti() {
    // Respect the OS "reduce motion" preference — confetti is purely decorative.
    if (prefersReducedMotion()) return;

    const confettiContainer = document.querySelector('#confetti-container');
    if (!confettiContainer) {
        console.error('Confetti container not found');
        return;
    }

    // Vibrant color palette
    const colors = [
        '#FF6B6B',
        '#4ECDC4',
        '#45B7D1',
        '#FFA07A',
        '#98D8C8',
        '#F7DC6F',
        '#BB8FCE',
        '#85C1E2',
        '#F8B739',
        '#52D17C',
        '#FF8ED4',
        '#6C5CE7',
        '#FD79A8',
        '#FDCB6E',
        '#00B894',
    ];

    const numConfetti = 80;

    for (let i = 0; i < numConfetti; i++) {
        const piece = document.createElement('div');

        // Random starting position (spread across top)
        const startX = Math.random() * 100;
        const startY = -20 - Math.random() * 50;

        // Random color
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Random size variation
        const size = 10 + Math.random() * 6;

        // Random shape
        const shapeRand = Math.random();
        let borderRadius = '0';
        let clipPath = 'none';
        if (shapeRand > 0.66) {
            borderRadius = '50%';
        } else if (shapeRand > 0.33) {
            clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
        }

        // Animation properties
        const duration = 1 + Math.random() * 0.5; // 1-1.5 seconds (very fast)
        const delay = Math.random() * 0.15;
        const horizontalDrift = (Math.random() - 0.5) * 200;
        const rotation = 360 + Math.random() * 720;

        // Set all styles inline
        piece.style.cssText = `
            position: absolute;
            left: ${startX}vw;
            top: ${startY}px;
            width: ${size}px;
            height: ${size}px;
            background-color: ${color};
            border-radius: ${borderRadius};
            clip-path: ${clipPath};
            opacity: 1;
            z-index: 10000;
            pointer-events: none;
            --confetti-x: ${horizontalDrift}px;
            --confetti-rotate: ${rotation}deg;
            animation: confetti-fall ${duration}s ease-in forwards;
            animation-delay: ${delay}s;
        `;

        // Add to DOM
        confettiContainer.append(piece);

        // Remove piece after animation completes
        setTimeout(
            () => {
                if (piece.parentNode) {
                    piece.remove();
                }
            },
            (duration + delay) * 1000 + 100
        );
    }
}

// ============================================================================
// Book View / Lesemodus
// ============================================================================

/** Cards currently displayed in book view, for export */
let bookViewCurrentCards = [];

/**
 * Whether an enriched book-view entry has any answer history attached.
 * @param {{ srData?: { history?: number[] } }} e
 * @returns {boolean}
 */
function hasAnswerHistory(e) {
    return Boolean(e.srData && e.srData.history && e.srData.history.length > 0);
}

/**
 * Render cards in book view format
 * @param {Array<object>} cardsToShow - Cards to render
 * @param {string} title - Title for the book view
 */
function openBookView(cardsToShow, title) {
    bookViewCurrentCards = cardsToShow;
    bookViewTitle.textContent = title;
    bookViewCards.innerHTML = '';

    // Enrich cards with SR data and sort: wrong/partial first, then correct, then unanswered
    const enriched = cardsToShow.map((card) => {
        const key = getCardKey(card);
        const srData = spacedRepetitionData[key] || null;
        return { card, srData };
    });

    enriched.sort((a, b) => {
        const aHist = a.srData && a.srData.history && a.srData.history.length > 0;
        const bHist = b.srData && b.srData.history && b.srData.history.length > 0;
        // Unanswered cards go to bottom
        if (!aHist && !bHist) return 0;
        if (!aHist) return 1;
        if (!bHist) return -1;
        // Among answered: lower average score (weaker cards) first
        const aAvg = a.srData.history.reduce((x, y) => x + y, 0) / a.srData.history.length;
        const bAvg = b.srData.history.reduce((x, y) => x + y, 0) / b.srData.history.length;
        return aAvg - bAvg;
    });

    // Find where unanswered section starts (no SR data OR SR data with empty history)
    const firstUnansweredIdx = enriched.findIndex((e) => !hasAnswerHistory(e));
    const answeredCount = firstUnansweredIdx === -1 ? enriched.length : firstUnansweredIdx;

    for (let i = 0; i < enriched.length; i++) {
        const { card, srData } = enriched[i];

        // Insert separator before unanswered section
        if (i === answeredCount && answeredCount > 0 && answeredCount < enriched.length) {
            const separator = document.createElement('div');
            separator.className = 'book-section-separator';
            separator.textContent = `Noch nicht beantwortet (${enriched.length - answeredCount})`;
            bookViewCards.append(separator);
        }

        const cardEl = document.createElement('div');
        cardEl.className = 'book-card';

        let html = `<div class="book-card-number">Karte ${i + 1} von ${enriched.length}`;
        if (card.categories && card.categories.length > 0) {
            html += ` · ${card.categories.map((c) => sanitizeHTML(c)).join(', ')}`;
        }
        html += '</div>';

        // Attempt history badge for answered cards
        if (srData) {
            const history = srData.history || [];
            if (history.length > 0) {
                const hasPartialScores = history.some((s) => s > 0 && s < 1);
                let badgeText;
                if (hasPartialScores) {
                    // MC with partial scores: show percentages per attempt
                    const pcts = history.map((s) => Math.round(s * 100) + '%');
                    badgeText = `${pcts.join(' → ')} richtig durch die letzten ${history.length} Versuche`;
                } else {
                    // Binary scores: show "X von Y Mal richtig"
                    const correctAttempts = history.filter((s) => s === 1).length;
                    badgeText = `${correctAttempts} von ${history.length} Mal richtig beantwortet`;
                }
                const avgScore = history.reduce((a, b) => a + b, 0) / history.length;
                let badgeClass = 'book-sr-overdue';
                if (avgScore >= 0.8) badgeClass = 'book-sr-good';
                else if (avgScore >= 0.5) badgeClass = '';
                html += `<div class="book-card-sr-badge ${badgeClass}">${sanitizeHTML(badgeText)}</div>`;
            }
        }

        html += `<div class="book-card-question">${sanitizeHTML(card.question)}</div>`;

        if (card.options && Array.isArray(card.options)) {
            html += '<div class="book-card-options">';
            for (let j = 0; j < card.options.length; j++) {
                const isCorrect = card.correct && card.correct.includes(j);
                html += `<div class="book-option ${isCorrect ? 'book-option-correct' : 'book-option-wrong'}">`;
                html += `<span>${isCorrect ? '✓' : '✗'}</span> <span>${sanitizeHTML(card.options[j])}</span>`;
                html += '</div>';
                if (card.explanations && card.explanations[String(j)]) {
                    html += `<div class="book-option-explanation">${sanitizeHTML(card.explanations[String(j)])}</div>`;
                }
            }
            html += '</div>';
        } else if (card.pairs && Array.isArray(card.pairs)) {
            html += '<div class="book-card-pairs">';
            for (const pair of card.pairs) {
                html += `<div class="book-pair-row"><span class="book-pair-left">${sanitizeHTML(pair.left)}</span><span class="book-pair-arrow">↔</span><span class="book-pair-right">${sanitizeHTML(pair.right)}</span></div>`;
            }
            html += '</div>';
        } else {
            html += `<div class="book-card-answer">${sanitizeHTML(card.answer)}</div>`;
            if (card.explanation) {
                html += `<div class="book-card-explanation">${sanitizeHTML(card.explanation)}</div>`;
            }
        }

        if (card.sourceDeck) {
            html += `<div class="book-card-source">Quelle: ${sanitizeHTML(card.sourceDeck)}</div>`;
        }

        cardEl.innerHTML = html;
        bookViewCards.append(cardEl);
    }

    // Hide everything else, show book view
    document.querySelector('#file-input-container').style.display = 'none';
    appContent.classList.add('hidden');
    bookView.classList.remove('hidden');
}

/**
 * Export currently displayed book view cards as Anki-importable tab-separated text file
 */
/**
 * Export currently displayed book view cards as CSV
 */
function exportToCsv() {
    if (bookViewCurrentCards.length === 0) return;

    const rows = [
        ['Frage', 'Antwort', 'Erklärung', 'Optionen', 'Korrekte Optionen', 'Kategorien', 'Deck'],
    ];

    for (const card of bookViewCurrentCards) {
        const question = card.question || '';
        let answer = '';
        let explanation = '';
        let options = '';
        let correctOptions = '';

        if (card.options && Array.isArray(card.options)) {
            options = card.options.join('; ');
            correctOptions = (card.correct || []).map((i) => card.options[i]).join('; ');
            // Collect explanations
            if (card.explanations) {
                const parts = [];
                for (const [idx, text] of Object.entries(card.explanations)) {
                    parts.push(`${card.options[Number.parseInt(idx)] || idx}: ${text}`);
                }
                explanation = parts.join('; ');
            }
        } else {
            answer = card.answer || '';
            explanation = card.explanation || '';
        }

        const categories = (card.categories || []).join('; ');
        const deck = card.sourceDeck || '';

        rows.push([question, answer, explanation, options, correctOptions, categories, deck]);
    }

    const csvContent = rows
        .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
        .join('\n');

    // BOM for Excel UTF-8 detection
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'lernkarten-export.csv';
    a.click();
    URL.revokeObjectURL(url);

    showMessage(`${bookViewCurrentCards.length} Karten als CSV exportiert.`);
}

/**
 * Export currently displayed book view cards as Anki-importable tab-separated text file
 */
function exportToAnki() {
    if (bookViewCurrentCards.length === 0) return;

    const lines = [
        '#separator:tab',
        '#html:true',
        '#tags column:4',
        '#columns:Front\tBack\tExtra\tTags',
    ];

    for (const card of bookViewCurrentCards) {
        let front = escapeAnkiField(card.question);
        let back;
        let extra = '';

        if (card.options && Array.isArray(card.options)) {
            // MC: add options to front, correct answers + explanations to back
            front += '<br><br>';
            front += card.options
                .map((opt, i) => {
                    const letter = String.fromCodePoint(65 + i); // A, B, C...
                    return `${letter}) ${escapeAnkiField(opt)}`;
                })
                .join('<br>');

            const correctLabels = (card.correct || []).map((i) => {
                const letter = String.fromCodePoint(65 + i);
                return `${letter}) ${escapeAnkiField(card.options[i])}`;
            });
            back = correctLabels.join('<br>');

            // Explanations as extra
            if (card.explanations) {
                const explanationParts = [];
                for (const [idx, text] of Object.entries(card.explanations)) {
                    const letter = String.fromCodePoint(65 + Number.parseInt(idx));
                    explanationParts.push(`${letter}: ${escapeAnkiField(text)}`);
                }
                if (explanationParts.length > 0) {
                    extra = explanationParts.join('<br>');
                }
            }
        } else {
            // Standard card
            back = escapeAnkiField(card.answer || '');
            if (card.explanation) {
                extra = escapeAnkiField(card.explanation);
            }
        }

        // Tags: categories + source deck, space-separated
        const tags = [];
        if (card.categories && card.categories.length > 0) {
            tags.push(...card.categories.map((c) => c.replaceAll(/\s+/g, '_')));
        }
        if (card.sourceDeck) {
            tags.push('deck::' + card.sourceDeck.replaceAll(/\s+/g, '_'));
        }

        lines.push(`${front}\t${back}\t${extra}\t${tags.join(' ')}`);
    }

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'lernkarten-anki-export.txt';
    a.click();
    URL.revokeObjectURL(url);

    showMessage(`${bookViewCurrentCards.length} Karten als Anki-Datei exportiert.`);
}

/**
 * Escape a string for use in an Anki tab-separated field
 * @param text
 */
function escapeAnkiField(text) {
    return text.replaceAll('\t', ' ').replaceAll('\n', '<br>');
}

/**
 * Open book view for cards selected via deck/category checkboxes (Lesemodus)
 */
function startBookViewFromDecks() {
    const selectedPerDeck = getSelectedFilters();
    if (selectedPerDeck.size === 0) return;

    const selectedDeckNames = [...selectedPerDeck.keys()];

    let allCards = [];
    for (const [deckName, filter] of selectedPerDeck.entries()) {
        if (savedDecks[deckName]) {
            const filtered = filterCards(savedDecks[deckName].cards, filter);
            const cardsWithSource = filtered.map((card) => ({ ...card, sourceDeck: deckName }));
            allCards = [...allCards, ...cardsWithSource];
        }
    }

    if (allCards.length === 0) return;

    const title =
        selectedDeckNames.length === 1
            ? `Lesemodus — ${selectedDeckNames[0]}`
            : `Lesemodus — ${selectedDeckNames.length} Decks`;

    openBookView(allCards, title);
}

/**
 * Open book view for a specific SR bucket interval
 * @param {number} interval - The bucket interval in days
 */
function openBookViewForBucket(step) {
    const cardsInBucket = [];

    for (const [key, data] of Object.entries(spacedRepetitionData)) {
        if ((data.step ?? 0) === step) {
            const card = getCardFromKey(key);
            if (card) {
                cardsInBucket.push(card);
            }
        }
    }

    if (cardsInBucket.length === 0) {
        showMessage('Keine Karten in diesem Bucket gefunden.');
        return;
    }

    const label = getStepLabel(step);
    progressView.classList.add('hidden');
    openBookView(cardsInBucket, `${label} — ${cardsInBucket.length} Karten`);
}

// ============================================================================
// Spaced Repetition Manager
// ============================================================================

/**
 * Build the ladder-distribution bar (how many cards sit in each consolidation
 * stage) plus a compact facts line. Rendered in the progress overview; reuses
 * the existing sr-bucket-bar styling.
 * @returns {string} HTML
 */
function buildLadderDistributionHTML() {
    const srEntries = Object.values(spacedRepetitionData);
    const total = srEntries.length;
    if (total === 0) {
        return '<p class="progress-empty">Noch keine Karten im Wiederholungssystem – starte eine Lernsitzung.</p>';
    }
    const colors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];
    const labels = ['Wackelig (Minuten)', 'Im Aufbau (Stunden)', '1 Tag', '3 Tage', '7 Tage'];
    const counts = [0, 0, 0, 0, 0];
    let attempts = 0;
    let scoreSum = 0;
    for (const data of srEntries) {
        const step = data.step ?? 0;
        if (step <= 1) counts[0]++;
        else if (step <= 3) counts[1]++;
        else if (step === 4) counts[2]++;
        else if (step === 5) counts[3]++;
        else counts[4]++;
        if (data.history) {
            for (const s of data.history) {
                scoreSum += s;
                attempts++;
            }
        }
    }

    let html = '<div class="sr-bucket-bar">';
    for (let i = 0; i < 5; i++) {
        const pct = (counts[i] / total) * 100;
        if (pct > 0) {
            html += `<div class="sr-bucket-bar-segment" style="width:${pct}%;background:${colors[i]}" title="${labels[i]}: ${counts[i]}"></div>`;
        }
    }
    html += '</div><div class="sr-bucket-bar-legend">';
    for (let i = 0; i < 5; i++) {
        if (counts[i] > 0) {
            html += `<span style="--legend-color:${colors[i]}">${labels[i]}: ${counts[i]}</span>`;
        }
    }
    html += '</div>';
    if (attempts > 0) {
        html += `<div class="ladder-facts">${attempts} Versuche · Ø ${Math.round((scoreSum / attempts) * 100)} % richtig</div>`;
    }
    return html;
}

/**
 * Wire a single delegated click handler for the SR bucket list. The list is
 * rebuilt via innerHTML on every render, so per-element listeners would leak;
 * delegation on the stable container handles every (re)rendered control and
 * keeps the bucket actions off the global scope (they read `data-action`).
 */
function setupSrBucketDelegation() {
    srBucketsDisplay.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl || !srBucketsDisplay.contains(actionEl)) return;
        const step = Number(actionEl.dataset.step);
        switch (actionEl.dataset.action) {
            case 'move': {
                handleMoveSRCard(actionEl);
                break;
            }
            case 'delete': {
                handleDeleteSRCard(actionEl);
                break;
            }
            case 'book': {
                openBookViewForBucket(step);
                break;
            }
            case 'toggle-select': {
                // The native checkbox toggle already fired; mirror it onto the bucket.
                toggleBucketSelection(step);
                break;
            }
            case 'toggle-expand': {
                toggleBucketExpansion(step);
                break;
            }
            // No default
        }
    });
}

/**
 * Render the "Karten verwalten" bucket list in the hub.
 */
function displaySpacedRepetitionBuckets() {
    // Save current expanded and selected state before overwriting
    const expandedSteps = new Set(
        [...document.querySelectorAll('.sr-bucket-cards.expanded')].map((el) =>
            Number.parseInt(el.id.replace('bucket-cards-', ''))
        )
    );
    const selectedSteps = new Set(
        [...document.querySelectorAll('.sr-bucket.selected')].map((el) =>
            Number.parseInt(el.dataset.step)
        )
    );

    // Check if there are any cards with SR data
    if (Object.keys(spacedRepetitionData).length === 0) {
        srBucketsDisplay.innerHTML =
            '<div class="sr-empty-message">Noch keine Karten im Spaced Repetition System. Beantworte Fragen im Spaced Repetition Modus, um Karten hier zu sehen.</div>';
        startSelectedBucketsBtn.disabled = true;
        return;
    }

    // Group cards by ladder step
    const buckets = {};
    const now = new Date();
    for (const [key, data] of Object.entries(spacedRepetitionData)) {
        const stepKey = data.step ?? 0;
        if (!buckets[stepKey]) {
            buckets[stepKey] = [];
        }

        // Parse the card from the key
        const card = getCardFromKey(key);
        if (card) {
            buckets[stepKey].push({
                key,
                card,
                data,
                isOverdue: data.nextReview <= now,
            });
        } else {
            console.warn('Card not found for key:', key);
            // Still add it with the key as the question
            buckets[stepKey].push({
                key,
                card: {
                    question: key.split('|||')[1] || 'Unbekannte Frage',
                    sourceDeck: 'Unbekannt',
                },
                data,
                isOverdue: data.nextReview <= now,
            });
        }
    }

    // Sort buckets by step
    const sortedSteps = Object.keys(buckets)
        .map(Number)
        .toSorted((a, b) => a - b);

    // Build HTML
    let html = '';
    for (const step of sortedSteps) {
        const cards = buckets[step];
        const stepLabel = getStepLabel(step);
        const overdueCount = cards.filter((c) => c.isOverdue).length;

        const isExpanded = expandedSteps.has(step) ? 'expanded' : '';
        const isSelected = selectedSteps.has(step) ? 'selected' : '';
        const isChecked = selectedSteps.has(step) ? 'checked' : '';

        html += `
            <div class="sr-bucket ${isSelected}" data-step="${step}">
                <div class="sr-bucket-header" data-action="toggle-expand" data-step="${step}">
                    <div class="sr-bucket-info">
                        <input type="checkbox" class="sr-bucket-checkbox" data-action="toggle-select" data-step="${step}" ${isChecked}>
                        <span class="sr-bucket-title">${stepLabel}</span>
                        <span class="sr-bucket-count">${cards.length} Karten${overdueCount > 0 ? ` (${overdueCount} fällig)` : ''}</span>
                    </div>
                    <button class="sr-bucket-book-btn" data-action="book" data-step="${step}" title="Buchansicht">📖</button>
                    <span class="sr-bucket-interval">${SR_STEP_LABELS[step] ?? ''}</span>
                </div>
                <div class="sr-bucket-cards ${isExpanded}" id="bucket-cards-${step}">
                    ${cards
                        .map(
                            ({ key, card, data, isOverdue }) => `
                        <div class="sr-card-item" data-card-key="${encodeURIComponent(key)}">
                            <div class="sr-card-question">${sanitizeHTML(card.question || 'Unbekannte Frage')}</div>
                            <div class="sr-card-meta">
                                <span class="sr-card-next-review ${isOverdue ? 'sr-overdue' : 'sr-on-time'}">
                                    ${isOverdue ? '⚠️ Fällig' : '✓'} ${formatDate(data.nextReview)}
                                </span>
                                <div class="sr-card-actions">
                                    <button class="sr-move-btn" data-action="move" data-step="${step}" title="Zu anderer Stufe verschieben">
                                        Verschieben
                                    </button>
                                    <button class="sr-delete-btn" data-action="delete" title="Aus SR-System entfernen">
                                        Löschen
                                    </button>
                                </div>
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            </div>
        `;
    }

    srBucketsDisplay.innerHTML = html;
    updateStartBucketButton();
}

/**
 * Human-readable label for a ladder step
 * @param {number} step
 */
function getStepLabel(step) {
    const names = [
        'Wackelig',
        'Frisch gelernt',
        'Im Aufbau',
        'Fast sicher',
        'Sicher',
        'Sehr sicher',
        'Langzeit',
    ];
    return `Stufe ${step + 1}: ${names[step] ?? 'Unbekannt'}`;
}

/**
 * Toggle bucket expansion
 * @param step
 */
function toggleBucketExpansion(step) {
    const cardsContainer = document.querySelector(`#bucket-cards-${step}`);
    cardsContainer.classList.toggle('expanded');
}

/**
 * Toggle bucket selection
 * @param step
 */
function toggleBucketSelection(step) {
    const bucket = document.querySelector(`.sr-bucket[data-step="${step}"]`);
    bucket.classList.toggle('selected');
    updateStartBucketButton();
}

/**
 * Update the state of the start button based on selected buckets
 */
function updateStartBucketButton() {
    const selectedCount = document.querySelectorAll('.sr-bucket.selected').length;
    startSelectedBucketsBtn.disabled = selectedCount === 0;
    const bucketSuffix = selectedCount === 1 ? '' : 's';
    startSelectedBucketsBtn.textContent =
        selectedCount > 0
            ? `Mit ${selectedCount} Bucket${bucketSuffix} üben`
            : 'Mit ausgewählten Buckets üben';
}

/**
 * Select all SR buckets
 */
function selectAllSRBuckets() {
    for (const bucket of document.querySelectorAll('.sr-bucket')) {
        bucket.classList.add('selected');
        const checkbox = bucket.querySelector('.sr-bucket-checkbox');
        if (checkbox) checkbox.checked = true;
    }
    updateStartBucketButton();
}

/**
 * Deselect all SR buckets
 */
function deselectAllSRBuckets() {
    for (const bucket of document.querySelectorAll('.sr-bucket')) {
        bucket.classList.remove('selected');
        const checkbox = bucket.querySelector('.sr-bucket-checkbox');
        if (checkbox) checkbox.checked = false;
    }
    updateStartBucketButton();
}

/**
 * Start practice session with selected buckets
 */
function startSelectedBuckets() {
    const selectedBuckets = [...document.querySelectorAll('.sr-bucket.selected')];
    if (selectedBuckets.length === 0) {
        showError('Bitte wähle mindestens einen Bucket aus.');
        return;
    }

    // Collect all cards from selected buckets
    const selectedCards = [];
    for (const bucket of selectedBuckets) {
        const step = Number.parseInt(bucket.dataset.step);
        for (const [key, data] of Object.entries(spacedRepetitionData)) {
            if ((data.step ?? 0) === step) {
                const card = getCardFromKey(key);
                if (card) {
                    // Add sourceDeck to maintain compatibility with quiz system
                    selectedCards.push({
                        ...card,
                        sourceDeck: card.sourceDeck || 'SR Practice',
                    });
                }
            }
        }
    }

    if (selectedCards.length === 0) {
        showError('Keine Karten in den ausgewählten Buckets gefunden.');
        return;
    }

    // Sort cards by ladder step (bucket order) then by nextReview within each bucket
    selectedCards.sort((a, b) => {
        const aData = spacedRepetitionData[getCardKey(a)];
        const bData = spacedRepetitionData[getCardKey(b)];

        if ((aData.step ?? 0) !== (bData.step ?? 0)) {
            return (aData.step ?? 0) - (bData.step ?? 0);
        }

        // Within same step, sort by nextReview date (most overdue first)
        return new Date(aData.nextReview) - new Date(bData.nextReview);
    });

    // Set active decks for title display
    activeDecks = ['SR Buckets'];

    // Bucket practice always runs as spaced repetition
    studyMode = 'spaced-repetition';

    // Update the app title
    updateAppTitle(['SR Buckets']);

    // Close the hub and show quiz
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');

    progressView.classList.add('hidden');
    savedDecksContainer.classList.remove('hidden');
    if (uploadSection) uploadSection.classList.remove('hidden');
    if (subtitle) subtitle.classList.remove('hidden');

    // Initialize the quiz with selected cards
    initializeQuiz(selectedCards);
}

/**
 * Handler for move button click - extracts key from data attributes
 * @param button
 */
function handleMoveSRCard(button) {
    const cardItem = button.closest('.sr-card-item');
    const cardKey = decodeURIComponent(cardItem.dataset.cardKey);
    const currentStep = Number.parseInt(button.dataset.step);
    moveSRCard(cardKey, currentStep);
}

/**
 * Handler for delete button click - extracts key from data attributes
 * @param button
 */
function handleDeleteSRCard(button) {
    const cardItem = button.closest('.sr-card-item');
    const cardKey = decodeURIComponent(cardItem.dataset.cardKey);
    deleteSRCard(cardKey);
}

/**
 * Move a card to a different interval bucket
 * @param cardKey
 * @param currentInterval
 */
async function moveSRCard(cardKey, currentStep) {
    const legend = SR_STEP_LABELS.map((label, i) => `${i + 1} = ${label}`).join(' · ');
    const input = await uiPrompt(
        `Karte zu welcher Stufe verschieben? (1-${SR_STEP_MINUTES.length})\n${legend}`,
        String(currentStep + 1),
        { confirmText: 'Verschieben' }
    );

    if (input === null) return; // Cancelled

    const stepNumber = Number.parseInt(input.trim());
    if (Number.isNaN(stepNumber) || stepNumber < 1 || stepNumber > SR_STEP_MINUTES.length) {
        showError(`Bitte gib eine Stufe von 1 bis ${SR_STEP_MINUTES.length} ein.`);
        return;
    }

    if (spacedRepetitionData[cardKey]) {
        const step = stepNumber - 1;
        spacedRepetitionData[cardKey].step = step;
        spacedRepetitionData[cardKey].nextReview = new Date(
            Date.now() + SR_STEP_MINUTES[step] * 60 * 1000
        );

        saveSpacedRepetitionData();
        displaySpacedRepetitionBuckets();
        showMessage(`Karte zu Stufe ${stepNumber} (${SR_STEP_LABELS[step]}) verschoben.`);
    } else {
        showError('Karte wurde nicht gefunden.');
    }
}

/**
 * Delete a card from the SR system
 * @param cardKey
 */
async function deleteSRCard(cardKey) {
    const ok = await uiConfirm('Diese Karte aus dem Spaced Repetition System entfernen?', {
        confirmText: 'Entfernen',
        danger: true,
    });
    if (!ok) return;

    delete spacedRepetitionData[cardKey];
    saveSpacedRepetitionData();
    displaySpacedRepetitionBuckets();
    showMessage('Karte aus SR-System entfernt.');
}

/**
 * Cleanup orphaned SR data. Two kinds of orphans:
 *   1. Deck-level: deck was deleted entirely.
 *   2. Question-level: deck still exists but the question text changed
 *      (e.g. after re-importing an updated library deck), so the old
 *      "deckName|||oldQuestionText" key no longer matches any card.
 */
async function cleanupOrphanedSRData() {
    const orphanedKeys = [];
    const deckQuestionSets = new Map();

    for (const key of Object.keys(spacedRepetitionData)) {
        const sepIndex = key.indexOf('|||');
        if (sepIndex === -1) continue;
        const deckName = key.slice(0, sepIndex);
        const question = key.slice(sepIndex + 3);

        const deck = savedDecks[deckName];
        if (!deck) {
            orphanedKeys.push(key);
            continue;
        }

        let questionSet = deckQuestionSets.get(deckName);
        if (!questionSet) {
            questionSet = new Set((deck.cards || []).map((c) => c && c.question));
            deckQuestionSets.set(deckName, questionSet);
        }
        if (!questionSet.has(question)) {
            orphanedKeys.push(key);
        }
    }

    if (orphanedKeys.length === 0) {
        showMessage('Keine verwaisten Einträge gefunden. Alles sauber!');
        return;
    }

    const ok = await uiConfirm(
        `${orphanedKeys.length} verwaiste Einträge gefunden (gelöschte Decks oder geänderte Fragen). Jetzt entfernen?`,
        { confirmText: 'Entfernen', danger: true }
    );
    if (!ok) return;

    for (const key of orphanedKeys) {
        delete spacedRepetitionData[key];
    }

    saveSpacedRepetitionData();
    displaySpacedRepetitionBuckets();
    showMessage(`${orphanedKeys.length} verwaiste Einträge entfernt.`);
}

/**
 * Get card object from SR data key
 * Key format: "deckName|||question"
 * @param key
 */
function getCardFromKey(key) {
    const parts = key.split('|||');
    if (parts.length < 2) {
        console.warn('Invalid key format:', key);
        return null;
    }

    const deckName = parts[0];
    const question = parts.slice(1).join('|||'); // Handle ||| in question (unlikely but safe)

    // Try to find the card in saved decks
    if (savedDecks[deckName]) {
        const found = savedDecks[deckName].cards.find((card) => card.question === question);
        if (found) {
            return { ...found, sourceDeck: deckName };
        }
    }

    // If deck not found or card not in deck, return a basic card object
    return {
        question: question,
        sourceDeck: deckName,
        answer: 'Nicht verfügbar',
    };
}

/**
 * Format date for display
 * @param date
 */
function formatDate(date) {
    const diffMinutes = Math.round((date - Date.now()) / 60000);

    if (diffMinutes <= 0) return 'Überfällig';
    if (diffMinutes < 60) return `in ${diffMinutes} Min`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `in ${diffHours} Std`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays === 1) return 'Morgen';
    return `in ${diffDays} Tagen`;
}

// ============================================================================
// Progress & Meta-Assessment (the "Lernreise")
// ============================================================================

/**
 * Read a JSON value from localStorage, falling back on parse/IO errors.
 * @param {string} key
 * @param {*} fallback
 */
function readJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

/** Load the progress journals (trend snapshots, session log, achievements, exam date). */
function loadProgressData() {
    lernstandHistory = readJsonStorage('lernstandHistory', []);
    sessionHistory = readJsonStorage('sessionHistory', []);
    achievements = readJsonStorage('achievements', { deckMastered: {}, bestSessionScore: 0 });
    if (!achievements.deckMastered) achievements.deckMastered = {};
    if (typeof achievements.bestSessionScore !== 'number') achievements.bestSessionScore = 0;
    examDate = localStorage.getItem('examDate') || null;
}

/** Persist the session log + achievements (snapshots are saved as they are recorded). */
function saveProgressData() {
    persistToStorage('sessionHistory', JSON.stringify(sessionHistory));
    persistToStorage('achievements', JSON.stringify(achievements));
}

/**
 * A card counts as "mastered" once its recency-weighted knowledge is high.
 * @param {object} card
 */
function isCardMastered(card) {
    const data = spacedRepetitionData[getCardKey(card)];
    return !!data?.history?.length && cardKnowledge(data) >= 0.8;
}

/**
 * Coverage/mastery tally across the given decks.
 * @param {string[]} deckNames
 * @returns {{mastered:number, attempted:number, total:number}}
 */
function countMastered(deckNames) {
    let mastered = 0;
    let attempted = 0;
    let total = 0;
    for (const deckName of deckNames) {
        const deck = savedDecks[deckName];
        if (!deck?.cards) continue;
        for (const c of deck.cards) {
            total++;
            const data = spacedRepetitionData[`${deckName}|||${c.question}`];
            if (data?.history?.length) {
                attempted++;
                if (cardKnowledge(data) >= 0.8) mastered++;
            }
        }
    }
    return { mastered, attempted, total };
}

/**
 * Calibration across all confidence-rated answers: an overall agreement score
 * (1 − mean abs error of normalized confidence vs. outcome) plus a per-level
 * accuracy breakdown for the reliability chart.
 * @returns {{percent:number|null, pairs:number, byLevel:Array<{level:number,count:number,accuracy:number|null}>}}
 */
function computeCalibration() {
    const byLevel = [
        { level: 1, sum: 0, n: 0 },
        { level: 2, sum: 0, n: 0 },
        { level: 3, sum: 0, n: 0 },
    ];
    let pairs = 0;
    let errSum = 0;
    for (const data of Object.values(spacedRepetitionData)) {
        if (!data.confHistory || !data.history) continue;
        for (const [i, c] of data.confHistory.entries()) {
            if (c === null || c === undefined) continue;
            const score = data.history[i] ?? 0;
            const bucket = byLevel[c - 1];
            if (bucket) {
                bucket.sum += score;
                bucket.n++;
            }
            errSum += Math.abs((c - 1) / 2 - score);
            pairs++;
        }
    }
    return {
        percent: pairs > 0 ? Math.round((1 - errSum / pairs) * 100) : null,
        pairs,
        byLevel: byLevel.map((l) => ({
            level: l.level,
            count: l.n,
            accuracy: l.n > 0 ? Math.round((l.sum / l.n) * 100) : null,
        })),
    };
}

/** Count of cards whose next review is due now. */
function countDueCards() {
    const now = new Date();
    return Object.values(spacedRepetitionData).filter((d) => new Date(d.nextReview) <= now).length;
}

/**
 * Append a snapshot of overall Lernstand after a completed session, so the
 * journey curve grows per session (and therefore within a single cram day, not
 * only across calendar days). No-op until at least one card has been studied.
 */
function recordLernstandSnapshot() {
    const allDecks = Object.keys(savedDecks);
    if (allDecks.length === 0) return;
    const knowledge = computeDeckKnowledge(allDecks);
    if (knowledge.attempted === 0) return;

    const { mastered } = countMastered(allDecks);
    const cal = computeCalibration();
    const perDeck = {};
    for (const d of allDecks) {
        const k = computeDeckKnowledge([d]);
        if (k.attempted > 0) perDeck[d] = k.percent;
    }
    lernstandHistory.push({
        date: new Date().toISOString().slice(0, 10),
        overallPercent: knowledge.percent,
        attempted: knowledge.attempted,
        total: knowledge.total,
        masteredCount: mastered,
        calibration: cal.percent,
        perDeck,
    });
    if (lernstandHistory.length > 120) lernstandHistory = lernstandHistory.slice(-120);
    persistToStorage('lernstandHistory', JSON.stringify(lernstandHistory));
}

/** Append a record of the session that just finished. */
function recordSession() {
    const cardsAnswered = answeredCards.filter((a) => a !== null).length;
    if (cardsAnswered === 0) return;
    const realDecks = activeDecks.filter((d) => savedDecks[d]);
    const totalAnswered = correctCount + incorrectCount;
    const avgConfidence =
        sessionCalibration.length > 0
            ? sessionCalibration.reduce((a, e) => a + e.confidence, 0) / sessionCalibration.length
            : null;
    sessionHistory.push({
        endedAt: new Date().toISOString(),
        deckNames: realDecks.length > 0 ? realDecks : activeDecks,
        cardsAnswered,
        correct: Math.round(correctCount * 10) / 10,
        avgScore: totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0,
        avgConfidence,
    });
    if (sessionHistory.length > 50) sessionHistory = sessionHistory.slice(-50);
    persistToStorage('sessionHistory', JSON.stringify(sessionHistory));
}

/**
 * Record any newly-crossed mastery milestones (deck Lernstand ≥ 80 %).
 * @returns {string[]} human-readable labels for milestones earned just now
 */
function checkAchievements() {
    const earned = [];
    for (const d of activeDecks.filter((x) => savedDecks[x])) {
        const k = computeDeckKnowledge([d]);
        if (k.total > 0 && k.percent >= 80 && !achievements.deckMastered[d]) {
            achievements.deckMastered[d] = new Date().toISOString();
            earned.push(`Deck gemeistert: ${d}`);
        }
    }
    if (earned.length > 0) saveProgressData();
    return earned;
}

/**
 * Render the gamification line on the completion screen: Lernstand gain, new
 * mastery milestones, and personal-best — all framed as progress, not streaks.
 * @param {{percent:number, total:number}} knowledge
 */
function renderFeedbackGamification(knowledge) {
    let el = document.querySelector('#feedback-gamification');
    if (!el) {
        el = document.createElement('div');
        el.id = 'feedback-gamification';
        el.className = 'feedback-gamification';
        (document.querySelector('#feedback-calibration') ?? finalScoreElement.parentElement).after(
            el
        );
    }

    const parts = [];
    if (knowledge.total > 0) {
        const delta = knowledge.percent - sessionStartLernstand;
        if (delta > 0) {
            parts.push(
                `<span class="gam-badge gam-up">+${delta} % Lernstand in dieser Sitzung</span>`
            );
        }
    }

    const earned = checkAchievements();
    for (const m of earned)
        parts.push(`<span class="gam-badge gam-master">${sanitizeHTML(m)}</span>`);

    const totalAnswered = correctCount + incorrectCount;
    const pct = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    if (pct > achievements.bestSessionScore) {
        achievements.bestSessionScore = pct;
        saveProgressData();
        parts.push(`<span class="gam-badge gam-best">Neue Bestleistung: ${pct} %</span>`);
    }

    if (parts.length > 0) {
        el.innerHTML = parts.join('');
        el.classList.remove('hidden');
        if (earned.length > 0) triggerConfetti();
    } else {
        el.classList.add('hidden');
        el.innerHTML = '';
    }
}

/**
 * Compact summary strip shown above the deck list on the menu: overall
 * Lernstand, due count, mastered ratio, calibration, plus a link to the
 * dedicated progress page.
 */
function renderMenuSummary() {
    const el = document.querySelector('#menu-summary');
    if (!el) return;
    const allDecks = Object.keys(savedDecks);
    // Shown whenever decks exist — it's the single entry to the Fortschritt hub
    // (stats + card management), so it must be reachable even before studying.
    if (allDecks.length === 0) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    const overall = computeDeckKnowledge(allDecks);
    const { mastered, total } = countMastered(allDecks);
    const cal = computeCalibration();
    const calStr = cal.percent === null ? '–' : `${cal.percent} %`;
    el.innerHTML = `
        <div class="menu-summary-stats">
            <span class="menu-stat"><strong>${overall.percent} %</strong> Lernstand</span>
            <span class="menu-stat"><strong>${countDueCards()}</strong> fällig</span>
            <span class="menu-stat"><strong>${mastered}/${total}</strong> gemeistert</span>
            <span class="menu-stat"><strong>${calStr}</strong> Treffsicherheit</span>
        </div>
        <button class="btn btn-soft" id="open-progress">Fortschritt ansehen →</button>
    `;
    el.classList.remove('hidden');
    const btn = el.querySelector('#open-progress');
    if (btn) btn.addEventListener('click', () => openProgressView('overview'));
}

/**
 * Open the Fortschritt hub on the given tab (overview = stats, manage = SR
 * card management). Single entry point for both — replaces the old separate
 * "SR verwalten" view.
 * @param {'overview'|'manage'} [tab]
 */
function openProgressView(tab = 'overview') {
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');
    progressView.classList.remove('hidden');
    savedDecksContainer.classList.add('hidden');
    if (uploadSection) uploadSection.classList.add('hidden');
    if (subtitle) subtitle.classList.add('hidden');
    switchHubTab(tab);
}

/** Switch between the hub's "Übersicht" and "Karten verwalten" tabs. */
function switchHubTab(tab) {
    const isManage = tab === 'manage';
    hubOverview.classList.toggle('hidden', isManage);
    hubManage.classList.toggle('hidden', !isManage);
    for (const t of document.querySelectorAll('.hub-tab')) {
        const active = t.dataset.tab === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
    }
    if (isManage) displaySpacedRepetitionBuckets();
    else renderProgressView();
}

/** Close the hub and return to the deck-picker menu (soft close, no reload). */
function closeProgressView() {
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');
    progressView.classList.add('hidden');
    savedDecksContainer.classList.remove('hidden');
    if (uploadSection) uploadSection.classList.remove('hidden');
    if (subtitle) subtitle.classList.remove('hidden');
    displaySavedDecks(deckSearchInput.value);
}

/** Build the whole progress page into #progress-content and wire its controls. */
function renderProgressView() {
    const allDecks = Object.keys(savedDecks);
    const overall = computeDeckKnowledge(allDecks);
    const cal = computeCalibration();
    const content = document.querySelector('#progress-content');
    content.innerHTML = `
        <section class="progress-section progress-readiness">
            ${progressRing(overall.percent, 'Lernstand erreicht')}
            <div class="readiness-side">
                <div class="readiness-goal">Ziel: Lernstand 80 % – dann „sitzt“ der Stoff.</div>
                <div class="readiness-facts">${overall.attempted} von ${overall.total} Karten geübt · ${countDueCards()} fällig</div>
                ${progressExam(allDecks)}
            </div>
        </section>
        <section class="progress-section"><h4>Lernstand-Verlauf</h4>${progressTrend(lernstandHistory)}</section>
        <section class="progress-section"><h4>Selbsteinschätzung</h4>${progressReliability(cal)}</section>
        <section class="progress-section"><h4>Abdeckung &amp; Beherrschung</h4>${progressCoverage(allDecks)}</section>
        <section class="progress-section"><h4>Wiederholungs-Stufen</h4>${buildLadderDistributionHTML()}</section>
        <section class="progress-section"><h4>Schwachstellen</h4>${progressWeakSpots(allDecks)}</section>
        <section class="progress-section"><h4>Erfolge</h4>${progressAchievements(cal)}</section>
        <section class="progress-section"><h4>Sitzungen</h4>${progressSessions()}</section>
    `;

    const examInput = content.querySelector('#exam-date-input');
    if (examInput) {
        examInput.addEventListener('change', () => {
            examDate = examInput.value || null;
            if (examDate) persistToStorage('examDate', examDate);
            else localStorage.removeItem('examDate');
            renderProgressView();
        });
    }
    const studyWeakest = content.querySelector('#study-weakest');
    if (studyWeakest) {
        studyWeakest.addEventListener('click', () => {
            startDecksByNames(JSON.parse(decodeURIComponent(studyWeakest.dataset.decks)));
        });
    }
}

/** A traffic-light level class from a 0–100 percentage. */
function levelClass(percent) {
    return percent >= 80 ? 'high' : percent >= 50 ? 'mid' : 'low';
}

/** Readiness ring (SVG donut + centered percentage). */
function progressRing(percent, caption) {
    const r = 46;
    const circ = 2 * Math.PI * r;
    const off = circ * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return `
        <div class="progress-ring progress-ring-${levelClass(percent)}">
            <svg viewBox="0 0 120 120" role="img" aria-label="${caption}: ${percent} Prozent">
                <circle class="ring-track" cx="60" cy="60" r="${r}"></circle>
                <circle class="ring-value" cx="60" cy="60" r="${r}"
                    stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
                    transform="rotate(-90 60 60)"></circle>
                <text x="60" y="60" class="ring-text">${percent}%</text>
            </svg>
            <div class="progress-ring-caption">${caption}</div>
        </div>`;
}

/** Lernstand-over-time line chart from the daily snapshots. */
function progressTrend(points) {
    if (points.length < 2) {
        return '<p class="progress-empty">Nach deiner zweiten Lernsitzung wächst hier deine Kurve.</p>';
    }
    const w = 320;
    const h = 90;
    const pad = 6;
    const n = points.length;
    const x = (i) => pad + (i * (w - 2 * pad)) / (n - 1);
    const y = (v) => h - pad - (v / 100) * (h - 2 * pad);
    const line = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.overallPercent).toFixed(1)}`)
        .join(' ');
    const area = `${line} L${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)} L${x(0).toFixed(1)},${(h - pad).toFixed(1)} Z`;
    const last = points.at(-1);
    return `
        <svg class="progress-trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Lernstand-Verlauf">
            <path class="trend-area" d="${area}"></path>
            <path class="trend-line" d="${line}" vector-effect="non-scaling-stroke"></path>
            <circle class="trend-dot" cx="${x(n - 1).toFixed(1)}" cy="${y(last.overallPercent).toFixed(1)}" r="3"></circle>
        </svg>
        <div class="progress-trend-labels"><span>${points[0].date.slice(5)}</span><span>zuletzt · ${last.overallPercent} %</span></div>`;
}

/** Confidence-vs-accuracy reliability chart (per confidence level). */
function progressReliability(cal) {
    if (cal.pairs === 0) {
        return '<p class="progress-empty">Aktiviere „Selbsteinschätzung“ und schätze vor dem Aufdecken ein – dann erscheint hier, wie gut du dich selbst kennst.</p>';
    }
    const labels = { 1: 'Unsicher', 2: 'Mittel', 3: 'Sicher' };
    const rows = cal.byLevel
        .filter((l) => l.count > 0)
        .map((l) => {
            const acc = l.accuracy ?? 0;
            return `<div class="reliability-row">
                <span class="reliability-label">${labels[l.level]}</span>
                <span class="reliability-bar"><span class="reliability-fill reliability-${levelClass(acc)}" style="width:${acc}%"></span></span>
                <span class="reliability-val">${acc} % richtig <small>(${l.count})</small></span>
            </div>`;
        })
        .join('');
    const verdict =
        cal.percent >= 80 ? 'gut kalibriert' : cal.percent >= 60 ? 'ordentlich' : 'noch wacklig';
    return `<div class="reliability-chart">${rows}</div>
        <div class="reliability-summary">Treffsicherheit insgesamt: <strong>${cal.percent} %</strong> · ${verdict}</div>`;
}

/** Coverage vs. mastery stacked bar across all cards. */
function progressCoverage(allDecks) {
    const { mastered, attempted, total } = countMastered(allDecks);
    if (total === 0) return '<p class="progress-empty">Noch keine Karten vorhanden.</p>';
    const m = (mastered / total) * 100;
    const p = ((attempted - mastered) / total) * 100;
    const u = 100 - m - p;
    return `
        <div class="coverage-bar">
            ${m > 0 ? `<span class="coverage-seg coverage-mastered" style="width:${m}%"></span>` : ''}
            ${p > 0 ? `<span class="coverage-seg coverage-practiced" style="width:${p}%"></span>` : ''}
            ${u > 0 ? `<span class="coverage-seg coverage-untouched" style="width:${u}%"></span>` : ''}
        </div>
        <div class="coverage-legend">
            <span class="lg lg-mastered">Gemeistert ${mastered}</span>
            <span class="lg lg-practiced">Geübt ${attempted - mastered}</span>
            <span class="lg lg-untouched">Ungeübt ${total - attempted}</span>
        </div>`;
}

/** Weakest decks first, with a one-tap drill-in for the lowest three. */
function progressWeakSpots(allDecks) {
    const arr = allDecks
        .map((d) => ({ d, k: computeDeckKnowledge([d]) }))
        .filter((x) => x.k.attempted > 0)
        .sort((a, b) => a.k.percent - b.k.percent)
        .slice(0, 8);
    if (arr.length === 0) return '<p class="progress-empty">Noch keine geübten Karten.</p>';
    const rows = arr
        .map(
            (x) => `<div class="weakspot-row">
            <span class="weakspot-name">${sanitizeHTML(x.d)}</span>
            <span class="weakspot-bar"><span class="weakspot-fill weakspot-${levelClass(x.k.percent)}" style="width:${x.k.percent}%"></span></span>
            <span class="weakspot-val">${x.k.percent} %</span>
        </div>`
        )
        .join('');
    const weakest = arr
        .filter((x) => x.k.percent < 80)
        .slice(0, 3)
        .map((x) => x.d);
    const btn =
        weakest.length > 0
            ? `<button class="btn btn-primary" id="study-weakest" data-decks="${encodeURIComponent(JSON.stringify(weakest))}">Schwächste ${weakest.length} üben</button>`
            : '';
    return `<div class="weakspot-list">${rows}</div>${btn}`;
}

/** Earned milestones as calm text pills (no emoji). */
function progressAchievements(cal) {
    const badges = [];
    for (const d of Object.keys(achievements.deckMastered || {})) {
        if (savedDecks[d])
            badges.push(`<span class="achv achv-master">Gemeistert: ${sanitizeHTML(d)}</span>`);
    }
    if (cal.pairs >= 10 && cal.percent !== null && cal.percent >= 80) {
        badges.push(`<span class="achv achv-cal">Gut kalibriert: ${cal.percent} %</span>`);
    }
    if (achievements.bestSessionScore > 0) {
        badges.push(
            `<span class="achv achv-best">Bestleistung: ${achievements.bestSessionScore} %</span>`
        );
    }
    if (badges.length === 0) {
        return '<p class="progress-empty">Noch keine Erfolge – meistere ein Deck (Lernstand ≥ 80 %).</p>';
    }
    return `<div class="achv-list">${badges.join('')}</div>`;
}

/** Recent session log. */
function progressSessions() {
    if (sessionHistory.length === 0) {
        return '<p class="progress-empty">Noch keine abgeschlossenen Sitzungen.</p>';
    }
    const confLabels = ['', 'niedrig', 'mittel', 'hoch'];
    const rows = [...sessionHistory]
        .reverse()
        .slice(0, 10)
        .map((s) => {
            const d = new Date(s.endedAt);
            const when =
                d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) +
                ' ' +
                d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const conf =
                typeof s.avgConfidence === 'number'
                    ? ` · Sicherheit ${confLabels[Math.round(s.avgConfidence)] ?? ''}`
                    : '';
            return `<div class="session-row">
                <span class="session-date">${when}</span>
                <span class="session-decks">${sanitizeHTML((s.deckNames || []).join(', '))}</span>
                <span class="session-meta">${s.cardsAnswered} Karten · ${s.avgScore} %${conf}</span>
            </div>`;
        })
        .join('');
    return `<div class="session-list">${rows}</div>`;
}

/** Optional exam-date countdown + date picker. */
function progressExam(allDecks) {
    const overall = computeDeckKnowledge(allDecks);
    let countdown = '';
    if (examDate) {
        const days = Math.ceil((new Date(`${examDate}T23:59:59`) - Date.now()) / 86_400_000);
        countdown =
            days >= 0
                ? `<div class="exam-countdown">Noch <strong>${days}</strong> ${days === 1 ? 'Tag' : 'Tage'} bis zur Prüfung · Lernstand <strong>${overall.percent} %</strong></div>`
                : '<div class="exam-countdown">Der Prüfungstermin liegt in der Vergangenheit.</div>';
    }
    return `${countdown}
        <label class="exam-input-row">Prüfungstermin (optional):
            <input type="date" id="exam-date-input" value="${examDate || ''}">
        </label>`;
}

/** Average per-deck Lernstand series from the snapshots, for menu sparklines. */
function deckTrendSeries(deckNames) {
    const series = [];
    for (const snap of lernstandHistory) {
        const vals = deckNames.map((d) => snap.perDeck?.[d]).filter((v) => typeof v === 'number');
        if (vals.length > 0) series.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return series;
}

/** Tiny inline sparkline element from a series of percentages (null if too short). */
function buildSparkline(values) {
    if (values.length < 2) return null;
    const w = 48;
    const h = 16;
    const n = values.length;
    const x = (i) => (i * w) / (n - 1);
    const y = (v) => h - 1 - (v / 100) * (h - 2);
    const line = values
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
        .join(' ');
    const span = document.createElement('span');
    span.className = 'deck-sparkline';
    span.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}" vector-effect="non-scaling-stroke"></path></svg>`;
    return span;
}

/**
 * Start a focused study session on the given decks (used by the weak-spot
 * drill-in). Builds the merged card set directly, bypassing the checkbox UI.
 * @param {string[]} deckNames
 */
function startDecksByNames(deckNames) {
    const valid = deckNames.filter((d) => savedDecks[d]?.cards?.length);
    if (valid.length === 0) return;
    studyMode = 'spaced-repetition';
    activeDecks = valid;
    updateAppTitle(valid);
    let merged = [];
    deckStats = {};
    for (const deckName of valid) {
        const withSource = savedDecks[deckName].cards.map((card) => ({
            ...card,
            sourceDeck: deckName,
        }));
        merged = [...merged, ...withSource];
        deckStats[deckName] = { correct: 0, incorrect: 0, total: withSource.length };
    }
    if (merged.length === 0) return;
    closeProgressView();
    initializeQuiz(merged);
}

// Expose the pure, side-effect-free helpers for unit testing under node:test.
// No-op in the browser (and in the inlined production build), where `module`
// is undefined — so this stays invisible to end users.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        projectSR,
        cardKnowledge,
        scoreMultipleChoice,
        normalizeAnswer,
        dedupeCardsByQuestion,
        validateCards,
        SR_STEP_MINUTES,
        SR_PASS_SCORE,
        SR_FAIL_SCORE,
    };
}
