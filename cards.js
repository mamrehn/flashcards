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

/** @type {Array<boolean|null>} Track answers for each card (true=correct, false=incorrect, null=not answered) */
let answeredCards = [];

/** @type {boolean} Flag to prevent double-marking answers */
let isAnswered = false;

/** @type {Array<string>} Names of currently active decks */
let activeDecks = [];

/** @type {{[deckName: string]: {cards: Array}}} Saved decks from localStorage */
let savedDecks = {};

/** @type {{[deckName: string]: Array<number>}} Indices of incorrect answers per deck */
let previousIncorrectIndices = {};

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

/** @type {number[]} Display order of unpaired left indices (append on unlink to move to bottom) */
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

/** @type {string} Current study mode: 'spaced-repetition', 'incorrect-only' */
let studyMode = 'spaced-repetition';

/** @type {{[cardKey: string]: {interval: number, easeFactor: number, repetitions: number, nextReview: Date}}} Spaced repetition data per card */
let spacedRepetitionData = {};

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
let mcCorrectAnswerContainer;
let mcCorrectAnswerText;
let standardAnswerContainer;
let textExplanationContainer;
let textExplanationContent;
let showAnswerBtn;
let markCorrectBtn;
let markIncorrectBtn;
let nextCardBtn;
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
let selectAllDecksBtn;
let deselectAllDecksBtn;
let studyModeSelect;
let deckSearchInput;
let openSrManagerBtn;
let srManagerContainer;
let srBucketsDisplay;
let startSelectedBucketsBtn;
let selectAllBucketsBtn;
let deselectAllBucketsBtn;
let cleanupOrphansBtn;
let bookView;
let bookViewCards;
let bookViewTitle;
let undoBtn;
let exportBackupBtn;
let srStatsDashboard;
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
    mcCorrectAnswerContainer = document.querySelector('#mc-correct-answer-container');
    mcCorrectAnswerText = document.querySelector('#mc-correct-answer-text');
    standardAnswerContainer = document.querySelector('#standard-answer-container');
    textExplanationContainer = document.querySelector('#text-explanation-container');
    textExplanationContent = document.querySelector('#text-explanation-content');
    showAnswerBtn = document.querySelector('#show-answer');
    markCorrectBtn = document.querySelector('#mark-correct');
    markIncorrectBtn = document.querySelector('#mark-incorrect');
    nextCardBtn = document.querySelector('#next-card');
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
    selectAllDecksBtn = document.querySelector('#select-all-decks');
    deselectAllDecksBtn = document.querySelector('#deselect-all-decks');
    studyModeSelect = document.querySelector('#study-mode');
    deckSearchInput = document.querySelector('#deck-search');
    openSrManagerBtn = document.querySelector('#open-sr-manager');
    srManagerContainer = document.querySelector('#spaced-repetition-manager-container');
    srBucketsDisplay = document.querySelector('#sr-buckets-display');
    startSelectedBucketsBtn = document.querySelector('#start-selected-buckets');
    selectAllBucketsBtn = document.querySelector('#select-all-buckets');
    deselectAllBucketsBtn = document.querySelector('#deselect-all-buckets');
    cleanupOrphansBtn = document.querySelector('#cleanup-orphans-btn');
    bookView = document.querySelector('#book-view');
    bookViewCards = document.querySelector('#book-view-cards');
    bookViewTitle = document.querySelector('#book-view-title');
    undoBtn = document.querySelector('#undo-btn');
    exportBackupBtn = document.querySelector('#export-backup-btn');
    srStatsDashboard = document.querySelector('#sr-stats-dashboard');
    matchingContainer = document.querySelector('#matching-container');
    matchingResultContainer = document.querySelector('#matching-result-container');

    // Set up event listeners with debouncing/throttling for performance
    fileInput.addEventListener('change', handleFileUpload);
    showAnswerBtn.addEventListener('click', throttle(showAnswer, 300));
    markCorrectBtn.addEventListener(
        'click',
        throttle(() => markAnswer(true), 300)
    );
    markIncorrectBtn.addEventListener(
        'click',
        throttle(() => markAnswer(false), 300)
    );
    nextCardBtn.addEventListener('click', throttle(showNextCard, 300));
    restartBtn.addEventListener('click', throttle(restartQuiz, 500));
    uploadNewBtn.addEventListener('click', throttle(resetAndUpload, 500));
    returnToSrBtn.addEventListener('click', throttle(returnToSRManager, 500));
    startSelectedDecksBtn.addEventListener('click', throttle(startSelectedDecks, 500));
    selectAllDecksBtn.addEventListener('click', debounce(selectAllDecks, 200));
    deselectAllDecksBtn.addEventListener('click', debounce(deselectAllDecks, 200));
    for (const btn of document.querySelectorAll('.type-filter-btn')) {
        btn.addEventListener('click', () => applyGlobalTypeFilter(btn.dataset.filter));
    }
    studyModeSelect.addEventListener('change', throttle(handleStudyModeChange, 300));
    deckSearchInput.addEventListener('input', debounce(handleDeckSearch, 250));
    openSrManagerBtn.addEventListener('click', throttle(openSpacedRepetitionManager, 300));
    startSelectedBucketsBtn.addEventListener('click', throttle(startSelectedBuckets, 500));
    selectAllBucketsBtn.addEventListener('click', debounce(selectAllSRBuckets, 200));
    deselectAllBucketsBtn.addEventListener('click', debounce(deselectAllSRBuckets, 200));
    cleanupOrphansBtn.addEventListener('click', throttle(cleanupOrphanedSRData, 500));
    document.querySelector('#book-view-csv').addEventListener('click', throttle(exportToCsv, 300));
    document
        .querySelector('#book-view-anki')
        .addEventListener('click', throttle(exportToAnki, 300));
    undoBtn.addEventListener('click', throttle(undoLastAnswer, 300));
    exportBackupBtn.addEventListener('click', throttle(exportBackup, 500));

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

    // Load saved decks from localStorage
    loadSavedDecks();
    displaySavedDecks();
    loadSpacedRepetitionData();

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
    // Space or Enter: show answer
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        showAnswerBtn.click();
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

    // R: mark correct (Richtig)
    if (e.key === 'r' && markCorrectBtn.style.display !== 'none') {
        e.preventDefault();
        markCorrectBtn.click();
        return;
    }

    // F: mark incorrect (Falsch)
    if (e.key === 'f' && markIncorrectBtn.style.display !== 'none') {
        e.preventDefault();
        markIncorrectBtn.click();
        return;
    }

    // Arrow keys: cycle focus between Richtig/Falsch buttons
    if (e.key === 'ArrowRight' && markCorrectBtn.style.display !== 'none') {
        e.preventDefault();
        markIncorrectBtn.focus();
        return;
    }
    if (e.key === 'ArrowLeft' && markIncorrectBtn.style.display !== 'none') {
        e.preventDefault();
        markCorrectBtn.focus();
        return;
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

// Initialize when DOM is ready
globalThis.addEventListener('DOMContentLoaded', initializeApp);

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

// Expose SR manager functions to global scope for onclick handlers
globalThis.toggleBucketExpansion = toggleBucketExpansion;
globalThis.toggleBucketSelection = toggleBucketSelection;
globalThis.moveSRCard = moveSRCard;
globalThis.deleteSRCard = deleteSRCard;
globalThis.toggleJsonSample = toggleJsonSample;
globalThis.openBookViewForBucket = openBookViewForBucket;
globalThis.handleMoveSRCard = handleMoveSRCard;
globalThis.handleDeleteSRCard = handleDeleteSRCard;

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
            (srManagerContainer && !srManagerContainer.classList.contains('hidden'));
        backLink.href = inSession ? 'cards.html' : 'index.html';
        backLink.title = inSession ? 'Zur Deck-Auswahl' : 'Zur Startseite';
    };

    const observer = new MutationObserver(update);
    observer.observe(appContent, { attributes: true, attributeFilter: ['class'] });
    observer.observe(bookView, { attributes: true, attributeFilter: ['class'] });
    if (srManagerContainer) {
        observer.observe(srManagerContainer, { attributes: true, attributeFilter: ['class'] });
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
                    saveToLocalStorage(deckName, validCards, [], meta);
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
                saveToLocalStorage(deckName, validCards, [], meta);
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
    saveToLocalStorage(deckName, validCards, [], meta);
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
            localStorage.setItem('spacedRepetitionData', JSON.stringify(spacedRepetitionData));
        }

        if (backup.flashcardIncorrectIndices) {
            previousIncorrectIndices = backup.flashcardIncorrectIndices;
            localStorage.setItem(
                'flashcardIncorrectIndices',
                JSON.stringify(previousIncorrectIndices)
            );
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
 * Validate card format - checks for required fields
 * @param {Array<object>} cards - Array of card objects to validate
 * @returns {Array<object>} Array of valid cards
 */
function validateCards(cards) {
    return cards.filter((card) => {
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

    try {
        const incorrectIndicesString = localStorage.getItem('flashcardIncorrectIndices');
        if (incorrectIndicesString) {
            previousIncorrectIndices = JSON.parse(incorrectIndicesString);
        }
    } catch (error) {
        console.error('Error loading incorrect indices:', error);
        previousIncorrectIndices = {};
    }
}

/**
 * Save a deck to localStorage
 * @param {string} deckName - Name of the deck
 * @param {Array<object>} deckCards - Array of card objects
 * @param {Array<number>} incorrectIndices - Indices of incorrectly answered cards
 * @param {object|null} [meta] - Optional deck metadata (name, subject, learningUnit, ...)
 */
function saveToLocalStorage(deckName, deckCards, incorrectIndices = [], meta = null) {
    savedDecks[deckName] = meta ? { cards: deckCards, meta } : { cards: deckCards };
    try {
        localStorage.setItem('flashcardDecks', JSON.stringify(savedDecks));
    } catch (error) {
        console.error('Error saving decks (storage quota exceeded?):', error);
        showError('Speicher voll! Bitte lösche nicht benötigte Decks.');
        delete savedDecks[deckName];
        return;
    }

    // Save incorrect indices separately
    if (!previousIncorrectIndices[deckName]) {
        previousIncorrectIndices[deckName] = [];
    }
    if (incorrectIndices.length > 0) {
        previousIncorrectIndices[deckName] = [...incorrectIndices];
    }
    try {
        localStorage.setItem('flashcardIncorrectIndices', JSON.stringify(previousIncorrectIndices));
    } catch (error) {
        console.error('Error saving incorrect indices:', error);
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

/**
 * Update incorrect indices in localStorage
 */
function updateIncorrectIndices() {
    persistToStorage('flashcardIncorrectIndices', JSON.stringify(previousIncorrectIndices));
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
 * Build a category chip for a given type. Visual state lives in the DOM
 * (`.selected`); selection logic reads it from there at start time.
 * @param {'mc'|'text'} type
 * @param {number} count
 * @param {string} topicKey
 * @param {string} catName
 */
function makeTypeChip(type, count, topicKey, catName) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `type-chip type-chip-${type} selected`;
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
    chip.setAttribute('aria-pressed', 'true');
    chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowSelected = !chip.classList.contains('selected');
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
        const preselected = topic.decks.some((d) => preselectSet.has(d));
        if (preselected) checkbox.checked = true;
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

        header.append(checkbox, chevron, folderIcon, titleBlock, cardCount, deleteButton);
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
            catCheckbox.addEventListener('change', () => {
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

    // Cascade preselection: topics whose decks were just imported start expanded and fully checked
    for (const topic of matching) {
        if (topic.decks.some((d) => preselectSet.has(d))) {
            onTopicCheckboxChange(topic.key, true);
            const folder = savedDecksDiv.querySelector(
                `.topic-folder[data-topic-key="${CSS.escape(topic.key)}"]`
            );
            if (folder) folder.classList.add('expanded');
        }
    }

    // Chips are freshly created with `selected`, but the global filter buttons
    // are static HTML and keep their state across renders. Re-apply the active
    // filter so chip state stays in sync with the visibly-pressed button.
    const activeFilterBtn = document.querySelector('.type-filter-btn.selected');
    const activeFilter = activeFilterBtn ? activeFilterBtn.dataset.filter : 'all';
    if (activeFilter && activeFilter !== 'all') {
        applyGlobalTypeFilter(activeFilter);
    } else {
        updateStartButtonState();
    }
}

/**
 * Topic-level checkbox toggles: cascades to all category checkboxes in the topic.
 * Type chip selection is intentionally preserved across topic check/uncheck.
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
 * Apply a global type filter to every chip on the page.
 * @param {'all'|'mc'|'text'} filter
 */
function applyGlobalTypeFilter(filter) {
    const chips = document.querySelectorAll('.type-chip');
    for (const chip of chips) {
        const matches = filter === 'all' || chip.dataset.type === filter;
        chip.classList.toggle('selected', matches);
        chip.setAttribute('aria-pressed', String(matches));
    }
    for (const btn of document.querySelectorAll('.type-filter-btn')) {
        const active = btn.dataset.filter === filter;
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', String(active));
    }
    updateStartButtonState();
}

/**
 * Whether at least one (category, type) pair is selected anywhere.
 * @returns {boolean}
 */
function hasAnyActiveSelection() {
    for (const cb of document.querySelectorAll('.category-checkbox:checked')) {
        const topicKey = cb.dataset.topicKey;
        const cat = cb.dataset.category;
        const chips = document.querySelectorAll(
            `.type-chip[data-topic-key="${CSS.escape(topicKey)}"][data-category="${CSS.escape(cat)}"]`
        );
        // Category contributes if it has any selected chip (or no chips at all = degenerate, treat as active).
        if (chips.length === 0) return true;
        for (const chip of chips) {
            if (chip.classList.contains('selected')) return true;
        }
    }
    return false;
}

/**
 * Update the enabled state of the start button based on the topic/category/type tree.
 */
function updateStartButtonState() {
    startSelectedDecksBtn.disabled = !hasAnyActiveSelection();
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
        const escaped = CSS.escape(topic.key);
        const catCheckboxes = document.querySelectorAll(
            `.category-checkbox[data-topic-key="${escaped}"]`
        );
        const perCategory = new Map();
        for (const catCb of catCheckboxes) {
            if (!catCb.checked) continue;
            const catName = catCb.dataset.category;
            const chips = document.querySelectorAll(
                `.type-chip[data-topic-key="${escaped}"][data-category="${CSS.escape(catName)}"]`
            );
            if (chips.length === 0) {
                // Degenerate: category checked but no chips rendered — include both types.
                perCategory.set(catName, new Set(['mc', 'text', 'matching']));
                continue;
            }
            const types = new Set();
            for (const chip of chips) {
                if (chip.classList.contains('selected')) types.add(chip.dataset.type);
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
 * Select all topic and category checkboxes (chips remain in their current state).
 */
function selectAllDecks() {
    for (const cb of document.querySelectorAll('.topic-checkbox')) {
        cb.checked = true;
        cb.indeterminate = false;
    }
    for (const cb of document.querySelectorAll('.category-checkbox')) {
        cb.checked = true;
    }
    updateStartButtonState();
}

/**
 * Deselect all topic and category checkboxes (chips remain in their current state).
 */
function deselectAllDecks() {
    for (const cb of document.querySelectorAll('.topic-checkbox')) {
        cb.checked = false;
        cb.indeterminate = false;
    }
    for (const cb of document.querySelectorAll('.category-checkbox')) {
        cb.checked = false;
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

    if (previousIncorrectIndices[deckName]) {
        delete previousIncorrectIndices[deckName];
        persistToStorage('flashcardIncorrectIndices', JSON.stringify(previousIncorrectIndices));
    }

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
    let incorrectChanged = false;
    for (const deckName of topic.decks) {
        delete savedDecks[deckName];
        if (previousIncorrectIndices[deckName]) {
            delete previousIncorrectIndices[deckName];
            incorrectChanged = true;
        }
    }
    persistToStorage('flashcardDecks', JSON.stringify(savedDecks));
    if (incorrectChanged) {
        persistToStorage('flashcardIncorrectIndices', JSON.stringify(previousIncorrectIndices));
    }
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

    // Only shuffle if not from SR buckets (bucket order should be preserved)
    if (!isFromSRBuckets) {
        // Randomize initial card order
        shuffleArray(cards);

        // Prioritize incorrectly answered cards if available
        prioritizeIncorrectCards();

        // Apply "Nur falsche wiederholen" filter at quiz start — the dropdown
        // is hidden during active quizzes, so this can only take effect here.
        if (studyMode === 'incorrect-only') {
            const incorrectCards = cards.filter((c) => isCardIncorrectFromPreviousSession(c));
            if (incorrectCards.length === 0) {
                showError('Keine falsch beantworteten Karten gefunden.');
                return;
            }
            cards = incorrectCards;
            answeredCards = Array.from({ length: cards.length }).fill(null);
        }
    }

    // Clear undo stack for new quiz
    undoStack = [];
    undoBtn.disabled = true;

    // Show the app content
    document.querySelector('#file-input-container').style.display = 'none';
    appContent.classList.remove('hidden');

    // Hide mode switcher + SR button during active quiz (cannot change mode mid-quiz)
    studyModeSelect.style.display = 'none';
    openSrManagerBtn.style.display = 'none';

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
 * Prioritize incorrectly answered cards from previous sessions
 * Places incorrect cards at the beginning of the deck
 */
function prioritizeIncorrectCards() {
    if (activeDecks.length === 0) return;

    // Create a copy of the cards array for manipulation
    const allCards = [...cards];
    const prioritizedCards = [];
    const remainingCards = [];

    // First, identify cards from decks with incorrect answers
    for (const card of allCards) {
        const deckName = card.sourceDeck;
        if (previousIncorrectIndices[deckName] && previousIncorrectIndices[deckName].length > 0) {
            // Find if this card was incorrect in its original deck
            const originalIndex = savedDecks[deckName].cards.findIndex(
                (c) =>
                    c.question === card.question &&
                    (c.answer === card.answer ||
                        (Array.isArray(c.options) &&
                            Array.isArray(card.options) &&
                            JSON.stringify(c.options) === JSON.stringify(card.options)) ||
                        (Array.isArray(c.pairs) &&
                            Array.isArray(card.pairs) &&
                            JSON.stringify(c.pairs) === JSON.stringify(card.pairs)))
            );

            if (
                originalIndex !== -1 &&
                previousIncorrectIndices[deckName].includes(originalIndex)
            ) {
                prioritizedCards.push(card);
            } else {
                remainingCards.push(card);
            }
        } else {
            remainingCards.push(card);
        }
    }

    // Shuffle both arrays
    shuffleArray(prioritizedCards);
    shuffleArray(remainingCards);

    // Combine the arrays
    cards = [...prioritizedCards, ...remainingCards];
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
        matchingUnpairedLeftCol.append(el);
    }

    if (isMultiCard) {
        // Right column: persistent tiles, .full when at capacity
        for (const rIdx of unpairedRightOrder) {
            const el = rightItemEls[rIdx];
            el.textContent = shuffledRightItems[rIdx].text;
            el.className = 'matching-item';
            if (rIdx === selectedRightIndex) el.classList.add('selected');
            matchingUnpairedRightCol.append(el);
        }

        // Paired section: bipartite connected-component grouping.
        // For each component, choose layout by structure:
        //   exactly 1 multi-left + ≥1 multi-right → 4-col complex group
        //     (left-span | extra-left | unlink | right-or-span)
        //   multi-left only  → 3-col left-span group per multi-left item
        //   multi-right only → 3-col right-span group per multi-right item
        //   simple           → flat 3-col row
        const leftRightCount = new Map();
        const rightLeftCount = new Map();
        const leftNeighbors = new Map();
        const rightNeighbors = new Map();
        for (const [l, r] of matchingPairs) {
            leftRightCount.set(l, (leftRightCount.get(l) ?? 0) + 1);
            rightLeftCount.set(r, (rightLeftCount.get(r) ?? 0) + 1);
            if (!leftNeighbors.has(l)) leftNeighbors.set(l, []);
            leftNeighbors.get(l).push(r);
            if (!rightNeighbors.has(r)) rightNeighbors.set(r, []);
            rightNeighbors.get(r).push(l);
        }

        // BFS: find connected components in the pair bipartite graph
        const visitedLeft = new Set();
        const components = [];
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
            const multiLefts = unpairedLeftOrder.filter(
                (l) => compLefts.has(l) && leftRightCount.get(l) > 1
            );
            const multiRights = unpairedRightOrder.filter(
                (r) => compRights.has(r) && rightLeftCount.get(r) > 1
            );
            components.push({ compPairs, multiLefts, multiRights });
        }

        for (const { compPairs, multiLefts, multiRights } of components) {
            // Complex: ≥1 multi-left AND ≥1 multi-right → 3-col grid, both sides may span.
            // Row order: for each multi-right, non-multiLeft rows first then multiLeft rows,
            // so the multi-left's rows are contiguous (enabling a left span) while each
            // multi-right's rows are also contiguous (enabling right spans).
            if (multiLefts.length > 0 && multiRights.length > 0) {
                const multiLeftSet = new Set(multiLefts);
                const rowPairs = [];
                const rowKeys = new Set();
                for (const rIdx of multiRights) {
                    for (const [l, r] of compPairs) {
                        if (r === rIdx && !multiLeftSet.has(l) && !rowKeys.has(`${l},${r}`)) {
                            rowPairs.push([l, r]);
                            rowKeys.add(`${l},${r}`);
                        }
                    }
                    for (const [l, r] of compPairs) {
                        if (r === rIdx && multiLeftSet.has(l) && !rowKeys.has(`${l},${r}`)) {
                            rowPairs.push([l, r]);
                            rowKeys.add(`${l},${r}`);
                        }
                    }
                }
                for (const [l, r] of compPairs) {
                    if (!rowKeys.has(`${l},${r}`)) {
                        rowPairs.push([l, r]);
                        rowKeys.add(`${l},${r}`);
                    }
                }
                // Compute contiguous span info for left and right items
                const leftSpanInfo = new Map();
                for (const [i, [li]] of rowPairs.entries()) {
                    if ((leftRightCount.get(li) ?? 0) > 1) {
                        if (!leftSpanInfo.has(li)) leftSpanInfo.set(li, { start: i + 1, count: 0 });
                        leftSpanInfo.get(li).count++;
                    }
                }
                const rightSpanInfo = new Map();
                for (const [i, [, ri]] of rowPairs.entries()) {
                    if ((rightLeftCount.get(ri) ?? 0) > 1) {
                        if (!rightSpanInfo.has(ri))
                            rightSpanInfo.set(ri, { start: i + 1, count: 0 });
                        rightSpanInfo.get(ri).count++;
                    }
                }
                const cGroup = document.createElement('div');
                cGroup.className = 'matching-paired-group';
                const leftSpanSeen = new Set();
                const rightSpanSeen = new Set();
                for (const [rowIdx, [lIdx, rIdx]] of rowPairs.entries()) {
                    const rowNum = rowIdx + 1;
                    if ((leftRightCount.get(lIdx) ?? 0) > 1 && !leftSpanSeen.has(lIdx)) {
                        const info = leftSpanInfo.get(lIdx);
                        const spanLeft = document.createElement('div');
                        spanLeft.className = 'matching-item paired matching-paired-group-span';
                        spanLeft.textContent = leftItemEls[lIdx].textContent;
                        spanLeft.style.gridColumn = '1';
                        spanLeft.style.gridRow = `${info.start} / span ${info.count}`;
                        cGroup.append(spanLeft);
                        leftSpanSeen.add(lIdx);
                    } else if ((leftRightCount.get(lIdx) ?? 0) <= 1) {
                        const leftEl = document.createElement('div');
                        leftEl.className = 'matching-item paired';
                        leftEl.style.gridColumn = '1';
                        leftEl.style.gridRow = String(rowNum);
                        leftEl.textContent = leftItemEls[lIdx].textContent;
                        cGroup.append(leftEl);
                    }
                    const unlinkBtn = document.createElement('button');
                    unlinkBtn.type = 'button';
                    unlinkBtn.className = 'matching-unlink-btn';
                    unlinkBtn.setAttribute('aria-label', 'Verknüpfung trennen');
                    unlinkBtn.style.gridColumn = '2';
                    unlinkBtn.style.gridRow = String(rowNum);
                    const lIdx_ = lIdx;
                    const rIdx_ = rIdx;
                    unlinkBtn.addEventListener('click', () => unlinkPair(lIdx_, rIdx_));
                    cGroup.append(unlinkBtn);
                    if ((rightLeftCount.get(rIdx) ?? 0) > 1 && !rightSpanSeen.has(rIdx)) {
                        const info = rightSpanInfo.get(rIdx);
                        const spanRight = document.createElement('div');
                        spanRight.className = 'matching-item paired matching-paired-group-span';
                        spanRight.textContent = shuffledRightItems[rIdx].text;
                        spanRight.style.gridColumn = '3';
                        spanRight.style.gridRow = `${info.start} / span ${info.count}`;
                        cGroup.append(spanRight);
                        rightSpanSeen.add(rIdx);
                    } else if ((rightLeftCount.get(rIdx) ?? 0) <= 1) {
                        const rightEl = document.createElement('div');
                        rightEl.className = 'matching-item paired';
                        rightEl.style.gridColumn = '3';
                        rightEl.style.gridRow = String(rowNum);
                        rightEl.textContent = shuffledRightItems[rIdx].text;
                        cGroup.append(rightEl);
                    }
                }
                matchingPairedSection.append(cGroup);
                continue;
            }

            // Non-complex: 3-col groups
            const handledKeys = new Set();
            for (const lIdx of multiLefts) {
                const pRights = [];
                for (const [l, r] of compPairs) {
                    if (l === lIdx) {
                        pRights.push(r);
                        handledKeys.add(`${l},${r}`);
                    }
                }
                const group = document.createElement('div');
                group.className = 'matching-paired-group';
                const spanEl = document.createElement('div');
                spanEl.className = 'matching-item paired matching-paired-group-span';
                spanEl.textContent = leftItemEls[lIdx].textContent;
                spanEl.style.gridColumn = '1';
                spanEl.style.gridRow = `1 / span ${pRights.length}`;
                group.append(spanEl);
                for (let rowNum = 1; rowNum <= pRights.length; rowNum++) {
                    const rIdx = pRights[rowNum - 1];
                    const unlinkBtn = document.createElement('button');
                    unlinkBtn.type = 'button';
                    unlinkBtn.className = 'matching-unlink-btn';
                    unlinkBtn.setAttribute('aria-label', 'Verknüpfung trennen');
                    unlinkBtn.style.gridColumn = '2';
                    unlinkBtn.style.gridRow = String(rowNum);
                    const lIdx_ = lIdx;
                    const rIdx_ = rIdx;
                    unlinkBtn.addEventListener('click', () => unlinkPair(lIdx_, rIdx_));
                    const rightEl = document.createElement('div');
                    rightEl.className = 'matching-item paired';
                    rightEl.style.gridColumn = '3';
                    rightEl.style.gridRow = String(rowNum);
                    rightEl.textContent = shuffledRightItems[rIdx].text;
                    group.append(unlinkBtn, rightEl);
                }
                matchingPairedSection.append(group);
            }
            // Right-grouped: unhandled pairs where this right has ≥2 remaining lefts
            const rightUnhandled = new Map();
            for (const [l, r] of compPairs) {
                if (!handledKeys.has(`${l},${r}`)) {
                    if (!rightUnhandled.has(r)) rightUnhandled.set(r, []);
                    rightUnhandled.get(r).push(l);
                }
            }
            for (const [rIdx, pLefts] of rightUnhandled) {
                if (pLefts.length < 2) continue;
                for (const lIdx of pLefts) handledKeys.add(`${lIdx},${rIdx}`);
                const group = document.createElement('div');
                group.className = 'matching-paired-group';
                const spanEl = document.createElement('div');
                spanEl.className = 'matching-item paired matching-paired-group-span';
                spanEl.textContent = shuffledRightItems[rIdx].text;
                spanEl.style.gridColumn = '3';
                spanEl.style.gridRow = `1 / span ${pLefts.length}`;
                group.append(spanEl);
                for (let rowNum = 1; rowNum <= pLefts.length; rowNum++) {
                    const lIdx = pLefts[rowNum - 1];
                    const unlinkBtn = document.createElement('button');
                    unlinkBtn.type = 'button';
                    unlinkBtn.className = 'matching-unlink-btn';
                    unlinkBtn.setAttribute('aria-label', 'Verknüpfung trennen');
                    unlinkBtn.style.gridColumn = '2';
                    unlinkBtn.style.gridRow = String(rowNum);
                    const lIdx_ = lIdx;
                    const rIdx_ = rIdx;
                    unlinkBtn.addEventListener('click', () => unlinkPair(lIdx_, rIdx_));
                    const leftEl = document.createElement('div');
                    leftEl.className = 'matching-item paired';
                    leftEl.style.gridColumn = '1';
                    leftEl.style.gridRow = String(rowNum);
                    leftEl.textContent = leftItemEls[lIdx].textContent;
                    group.append(unlinkBtn, leftEl);
                }
                matchingPairedSection.append(group);
            }
            // Flat: remaining simple 1:1 pairs
            for (const [l, r] of compPairs) {
                if (handledKeys.has(`${l},${r}`)) continue;
                const group = document.createElement('div');
                group.className = 'matching-paired-group';
                const leftEl = document.createElement('div');
                leftEl.className = 'matching-item paired';
                leftEl.style.gridColumn = '1';
                leftEl.textContent = leftItemEls[l].textContent;
                const unlinkBtn = document.createElement('button');
                unlinkBtn.type = 'button';
                unlinkBtn.className = 'matching-unlink-btn';
                unlinkBtn.setAttribute('aria-label', 'Verknüpfung trennen');
                unlinkBtn.style.gridColumn = '2';
                const l_ = l;
                const r_ = r;
                unlinkBtn.addEventListener('click', () => unlinkPair(l_, r_));
                const rightEl = document.createElement('div');
                rightEl.className = 'matching-item paired';
                rightEl.style.gridColumn = '3';
                rightEl.textContent = shuffledRightItems[r].text;
                group.append(leftEl, unlinkBtn, rightEl);
                matchingPairedSection.append(group);
            }
        }
    } else {
        // Standard matching: right column tiles + flat paired rows
        for (const rIdx of unpairedRightOrder) {
            const el = rightItemEls[rIdx];
            el.className = 'matching-item';
            if (rIdx === selectedRightIndex) el.classList.add('selected');
            matchingUnpairedRightCol.append(el);
        }

        const sortedPairs = matchingPairs.toSorted(([a], [b]) => a - b);
        for (const [lIdx, rIdx] of sortedPairs) {
            const row = document.createElement('div');
            row.className = 'matching-pair-row';

            const leftEl = leftItemEls[lIdx];
            leftEl.className = 'matching-item paired';

            const unlinkBtn = document.createElement('button');
            unlinkBtn.type = 'button';
            unlinkBtn.className = 'matching-unlink-btn';
            unlinkBtn.setAttribute('aria-label', 'Verknüpfung trennen');
            const lIdx_ = lIdx;
            const rIdx_ = rIdx;
            unlinkBtn.addEventListener('click', () => unlinkPair(lIdx_, rIdx_));

            const rightEl = document.createElement('div');
            rightEl.className = 'matching-item paired';
            rightEl.textContent = shuffledRightItems[rIdx].text;

            row.append(leftEl, unlinkBtn, rightEl);
            matchingPairedSection.append(row);
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
        matchingProgressEl.textContent = `${matchingPairs.length} von ${matchingRequiredCount} Begriffen zugeordnet`;
    }
}

function createPair(leftIndex, shuffledRightIndex) {
    // Prevent duplicate pairing
    if (matchingPairs.some(([l, r]) => l === leftIndex && r === shuffledRightIndex)) return;

    if (!isMultiCard) {
        // Standard mode: enforce 1:1 capacity
        let rightPairings = 0;
        for (const [, r] of matchingPairs) {
            if (r === shuffledRightIndex) rightPairings++;
        }
        if (rightPairings >= Math.max(rightRequiredCount[shuffledRightIndex] ?? 1, 1)) return;

        let leftPairings = 0;
        for (const [l] of matchingPairs) {
            if (l === leftIndex) leftPairings++;
        }
        if (leftPairings >= Math.max(leftRequiredCount[leftIndex] ?? 1, 1)) return;
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
    if (isAnswered) return;
    if (selectedRightIndex === null) {
        selectedLeftIndex = selectedLeftIndex === leftIndex ? null : leftIndex;
        renderMatchingPairs();
    } else {
        createPair(leftIndex, selectedRightIndex);
    }
}

function handleMatchingRightClick(shuffledRightIndex) {
    if (isAnswered) return;
    if (selectedLeftIndex === null) {
        selectedRightIndex = selectedRightIndex === shuffledRightIndex ? null : shuffledRightIndex;
        renderMatchingPairs();
    } else {
        createPair(selectedLeftIndex, shuffledRightIndex);
    }
}

function unlinkPair(leftIndex, rightIndex) {
    if (isAnswered) return;
    const prevLength = matchingPairs.length;
    matchingPairs = matchingPairs.filter(([l, r]) => !(l === leftIndex && r === rightIndex));
    if (matchingPairs.length === prevLength) return;

    // Re-add left to column if it was removed (standard non-multi mode)
    if (!isMultiCard && !unpairedLeftOrder.includes(leftIndex)) {
        unpairedLeftOrder.push(leftIndex);
    }
    // Re-add right to column if it was removed (standard non-multi mode)
    if (!isMultiCard && !unpairedRightOrder.includes(rightIndex)) {
        unpairedRightOrder.push(rightIndex);
    }
    renderMatchingPairs();
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

        // Extract unique left values (non-null) and unique right values from pairs
        const uniqueLeftValues = [];
        const seenLeft = new Set();
        for (const p of card.pairs) {
            if (p.left !== null && p.left !== undefined && !seenLeft.has(p.left)) {
                seenLeft.add(p.left);
                uniqueLeftValues.push(p.left);
            }
        }
        const uniqueRightValues = [];
        const seenRight = new Set();
        for (const p of card.pairs) {
            if (!seenRight.has(p.right)) {
                seenRight.add(p.right);
                uniqueRightValues.push(p.right);
            }
        }

        // Required pairings per right value (0 for distractors without a left partner)
        const rightRequiredCounts = new Map();
        for (const p of card.pairs) {
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
        for (const p of card.pairs) {
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
            rightItemEls.push(item);
        }

        // Place all items in initial positions
        renderMatchingPairs();

        matchingContainer.classList.remove('hidden');

        // Back-side containers
        standardAnswerContainer.classList.add('hidden');
        mcCorrectAnswerContainer.classList.add('hidden');
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

        // Set answer text for back of card
        standardAnswerContainer.classList.add('hidden');
        mcCorrectAnswerContainer.classList.remove('hidden');
        mcCorrectAnswerText.innerHTML = ''; // Will be populated in showAnswer()
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
        mcCorrectAnswerContainer.classList.add('hidden');
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

    // Reset buttons
    markCorrectBtn.style.display = 'inline-block';
    markIncorrectBtn.style.display = 'inline-block';
    nextCardBtn.style.display = 'none';

    // Tabindex management: prevent tabbing into back-side buttons when front is shown
    markCorrectBtn.setAttribute('tabindex', '-1');
    markIncorrectBtn.setAttribute('tabindex', '-1');
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
            const requiredRights = card.pairs
                .filter((p) => p.left === leftValue)
                .map((p) => p.right);

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

        markCorrectBtn.style.display = 'none';
        markIncorrectBtn.style.display = 'none';
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
        mcCorrectAnswerContainer.classList.add('hidden');

        // Automatically evaluate the answer with partial scoring
        let score;
        if (selectedOptionIndices.length > 0 || card.correct.length === 0) {
            // Count how many options were handled correctly
            let correctChoices = 0;
            for (let i = 0; i < card.options.length; i++) {
                const shouldBeSelected = card.correct.includes(i);
                const wasSelected = selectedOptionIndices.includes(i);
                if (shouldBeSelected === wasSelected) correctChoices++;
            }
            score = card.options.length > 0 ? correctChoices / card.options.length : 0;
        } else {
            // No selection was made
            score = 0;
        }
        markAnswer(score);

        // For multiple choice, always hide Richtig/Falsch buttons and show Next button
        markCorrectBtn.style.display = 'none';
        markIncorrectBtn.style.display = 'none';
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

        // Check if the user's answer exactly matches the correct answer
        const correctAnswer = card.answer.trim();
        const isExactMatch = userAnswer.toLowerCase() === correctAnswer.toLowerCase();

        if (isExactMatch) {
            // Automatically mark as correct and show only Next button
            markAnswer(true);
            markCorrectBtn.style.display = 'none';
            markIncorrectBtn.style.display = 'none';
            nextCardBtn.style.display = 'inline-block';
        } else {
            // For text answers that don't match, show the Richtig/Falsch buttons
            markCorrectBtn.style.display = 'inline-block';
            markIncorrectBtn.style.display = 'inline-block';
            nextCardBtn.style.display = 'none';
        }
    }

    // Tabindex: hide front-side from tab, expose back-side
    showAnswerBtn.setAttribute('tabindex', '-1');
    userAnswerInput.setAttribute('tabindex', '-1');
    markCorrectBtn.setAttribute('tabindex', '0');
    markIncorrectBtn.setAttribute('tabindex', '0');
    nextCardBtn.setAttribute('tabindex', '0');

    // Focus the first actionable button after flip animation
    setTimeout(() => {
        if (nextCardBtn.style.display !== 'none') {
            nextCardBtn.focus({ preventScroll: true });
        } else if (markCorrectBtn.style.display !== 'none') {
            markCorrectBtn.focus({ preventScroll: true });
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
        updateSpacedRepetition(card, isFullyCorrect, score);
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

    if (
        !isFullyCorrect && // Store the incorrect/partial card in the source deck's incorrect indices
        deckName &&
        savedDecks[deckName]
    ) {
        const originalDeckCards = savedDecks[deckName].cards;
        const originalIndex = originalDeckCards.findIndex(
            (c) =>
                c.question === card.question &&
                (c.answer === card.answer ||
                    (Array.isArray(c.options) &&
                        Array.isArray(card.options) &&
                        JSON.stringify(c.options) === JSON.stringify(card.options)) ||
                    (Array.isArray(c.pairs) &&
                        Array.isArray(card.pairs) &&
                        JSON.stringify(c.pairs) === JSON.stringify(card.pairs)))
        );

        if (originalIndex !== -1) {
            if (!previousIncorrectIndices[deckName]) {
                previousIncorrectIndices[deckName] = [];
            }
            if (!previousIncorrectIndices[deckName].includes(originalIndex)) {
                previousIncorrectIndices[deckName].push(originalIndex);
            }
        }
    } else if (
        isFullyCorrect &&
        deckName &&
        savedDecks[deckName] &&
        previousIncorrectIndices[deckName]?.length > 0
    ) {
        // Remove from incorrect indices when answered correctly
        const originalDeckCards = savedDecks[deckName].cards;
        const originalIndex = originalDeckCards.findIndex(
            (c) =>
                c.question === card.question &&
                (c.answer === card.answer ||
                    (Array.isArray(c.options) &&
                        Array.isArray(card.options) &&
                        JSON.stringify(c.options) === JSON.stringify(card.options)) ||
                    (Array.isArray(c.pairs) &&
                        Array.isArray(card.pairs) &&
                        JSON.stringify(c.pairs) === JSON.stringify(card.pairs)))
        );
        if (originalIndex !== -1) {
            const idx = previousIncorrectIndices[deckName].indexOf(originalIndex);
            if (idx !== -1) previousIncorrectIndices[deckName].splice(idx, 1);
        }
    }

    // Update incorrect indices in local storage
    updateIncorrectIndices();

    // Hide the evaluation buttons and show next button
    markCorrectBtn.style.display = 'none';
    markIncorrectBtn.style.display = 'none';
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

            const deckStatItem = document.createElement('div');
            deckStatItem.className = 'deck-stat-item';
            deckStatItem.innerHTML = `
                <strong>${sanitizeHTML(deckName)}:</strong>
                ${formatScore(stats.correct)} richtig,
                ${formatScore(stats.incorrect)} falsch,
                ${deckAccuracy}% Genauigkeit
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

    // Prioritize incorrect cards again and reshuffle
    shuffleCards();
    prioritizeIncorrectCards();

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
    // Hide quiz content
    appContent.classList.add('hidden');
    feedbackElement.classList.add('hidden');

    // Show file input container and SR manager
    document.querySelector('#file-input-container').style.display = 'block';
    srManagerContainer.classList.remove('hidden');

    // Hide saved decks and upload section
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');

    savedDecksContainer.classList.add('hidden');
    if (uploadSection) uploadSection.classList.add('hidden');
    if (subtitle) subtitle.classList.add('hidden');

    // Hide the SR button — back-arrow is the only exit from this view
    openSrManagerBtn.style.display = 'none';

    // Hide study mode selector in SR manager
    studyModeSelect.style.display = 'none';

    // Refresh SR buckets display
    displaySpacedRepetitionBuckets();

    // Reset the app title
    appTitle.textContent = 'Lernkarten App';

    // Clear active decks
    activeDecks = [];
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
    studyModeSelect.style.display = 'inline-block';

    // Show SR button only if in spaced-repetition mode
    openSrManagerBtn.style.display = studyMode === 'spaced-repetition' ? 'inline-block' : 'none';

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
 * Handle study mode change. The dropdown is only reachable on the deck-selection
 * screen (it's hidden once a quiz starts), so this just records the choice —
 * filtering / sorting happens at quiz start inside initializeQuiz.
 * @param {Event} event - Change event from select element
 */
function handleStudyModeChange(event) {
    studyMode = event.target.value;

    // Show/hide SR button based on mode
    openSrManagerBtn.style.display = studyMode === 'spaced-repetition' ? 'inline-block' : 'none';
}

/**
 * Check if a card was answered incorrectly in a previous session
 * @param {object} card - Card object
 * @returns {boolean} True if card was incorrect in previous session
 */
function isCardIncorrectFromPreviousSession(card) {
    const deckName = card.sourceDeck;
    if (
        !deckName ||
        !previousIncorrectIndices[deckName] ||
        previousIncorrectIndices[deckName].length === 0
    ) {
        return false;
    }

    // Find the original index of this card in its source deck
    if (!savedDecks[deckName]) return false;

    const originalIndex = savedDecks[deckName].cards.findIndex(
        (c) =>
            c.question === card.question &&
            (c.answer === card.answer ||
                (Array.isArray(c.options) &&
                    Array.isArray(card.options) &&
                    JSON.stringify(c.options) === JSON.stringify(card.options)) ||
                (Array.isArray(c.pairs) &&
                    Array.isArray(card.pairs) &&
                    JSON.stringify(c.pairs) === JSON.stringify(card.pairs)))
    );

    return originalIndex !== -1 && previousIncorrectIndices[deckName].includes(originalIndex);
}

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
 * Update spaced repetition data after answering
 * @param {object} card - Card object
 * @param {boolean} wasCorrect - Whether answer was correct
 * @param score
 */
function updateSpacedRepetition(card, wasCorrect, score) {
    const key = getCardKey(card);
    let data = spacedRepetitionData[key] || {
        interval: 1,
        easeFactor: 2.5,
        repetitions: 0,
        nextReview: new Date(),
        history: [],
    };

    // Ensure history array exists (backward compat with old data)
    if (!data.history) data.history = [];

    // Record attempt (score: 0.0-1.0, or 1/0 for text cards)
    let recordedScore = score;
    if (recordedScore === undefined) recordedScore = wasCorrect ? 1 : 0;
    data.history.push(recordedScore);

    if (wasCorrect) {
        if (data.repetitions === 0) {
            data.interval = 1;
        } else if (data.repetitions === 1) {
            data.interval = 6;
        } else {
            data.interval = Math.round(data.interval * data.easeFactor);
        }
        data.repetitions++;
        data.easeFactor = Math.min(3, Math.max(1.3, data.easeFactor + 0.1));
    } else {
        data.repetitions = 0;
        data.interval = 1;
        data.easeFactor = Math.max(1.3, data.easeFactor - 0.2);
    }

    // Calculate next review date
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + data.interval);
    data.nextReview = nextReview;

    spacedRepetitionData[key] = data;
    saveSpacedRepetitionData();
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
            // Convert date strings back to Date objects
            for (const key of Object.keys(spacedRepetitionData)) {
                spacedRepetitionData[key].nextReview = new Date(
                    spacedRepetitionData[key].nextReview
                );
            }
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
        flashcardIncorrectIndices: previousIncorrectIndices,
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
        previousIncorrectSnapshot: previousIncorrectIndices[deckName]
            ? [...previousIncorrectIndices[deckName]]
            : null,
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

    // Restore incorrect indices
    if (snapshot.previousIncorrectSnapshot !== null) {
        previousIncorrectIndices[snapshot.deckName] = snapshot.previousIncorrectSnapshot;
    } else if (previousIncorrectIndices[snapshot.deckName]) {
        delete previousIncorrectIndices[snapshot.deckName];
    }
    persistToStorage('flashcardIncorrectIndices', JSON.stringify(previousIncorrectIndices));

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

/**
 * Trigger an improved confetti animation for correct answers
 */
function triggerConfetti() {
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
    studyModeSelect.style.display = 'none';
    openSrManagerBtn.style.display = 'none';
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
function openBookViewForBucket(interval) {
    const cardsInBucket = [];

    for (const [key, data] of Object.entries(spacedRepetitionData)) {
        if (data.interval === interval) {
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

    const label = getIntervalLabel(interval);
    srManagerContainer.classList.add('hidden');
    openBookView(cardsInBucket, `${label} — ${cardsInBucket.length} Karten`);
}

// ============================================================================
// Spaced Repetition Manager
// ============================================================================

/**
 * Toggle the Spaced Repetition Manager interface
 */
function openSpacedRepetitionManager() {
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');
    const isCurrentlyOpen = !srManagerContainer.classList.contains('hidden');

    if (isCurrentlyOpen) {
        // Close SR manager, show saved decks
        srManagerContainer.classList.add('hidden');
        savedDecksContainer.classList.remove('hidden');
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (subtitle) subtitle.classList.remove('hidden');
        studyModeSelect.style.display = 'inline-block';
        openSrManagerBtn.style.display = 'inline-block';
        // Refresh saved decks display
        displaySavedDecks(deckSearchInput.value);
    } else {
        // Open SR manager, hide saved decks. The header back-arrow is the
        // single exit affordance from this view, so we hide the SR button
        // entirely rather than morphing it into a "Decks anzeigen" toggle.
        srManagerContainer.classList.remove('hidden');
        savedDecksContainer.classList.add('hidden');
        if (uploadSection) uploadSection.classList.add('hidden');
        if (subtitle) subtitle.classList.add('hidden');
        studyModeSelect.style.display = 'none';
        openSrManagerBtn.style.display = 'none';
        displaySpacedRepetitionBuckets();
    }
}

/**
 * Display cards grouped by their spaced repetition intervals (buckets)
 */
/**
 * Render the progress dashboard at the top of the SR manager
 */
function renderSRDashboard() {
    const srEntries = Object.values(spacedRepetitionData);
    const totalSRCards = srEntries.length;
    const totalDecks = Object.keys(savedDecks).length;
    const now = new Date();

    // Count overdue cards
    const overdueCount = srEntries.filter((d) => new Date(d.nextReview) <= now).length;

    // Calculate average score from histories
    let totalAttempts = 0;
    let totalScore = 0;
    for (const data of srEntries) {
        if (data.history && data.history.length > 0) {
            for (const s of data.history) {
                totalScore += s;
                totalAttempts++;
            }
        }
    }
    const avgScore = totalAttempts > 0 ? Math.round((totalScore / totalAttempts) * 100) : 0;

    // Bucket distribution for bar chart
    const bucketColors = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];
    const bucketLabels = ['Neu (1d)', '2-7d', '8-30d', '1-3M', '3M+'];
    const bucketCounts = [0, 0, 0, 0, 0];
    for (const data of srEntries) {
        const interval = data.interval;
        if (interval <= 1) bucketCounts[0]++;
        else if (interval <= 7) bucketCounts[1]++;
        else if (interval <= 30) bucketCounts[2]++;
        else if (interval <= 90) bucketCounts[3]++;
        else bucketCounts[4]++;
    }

    let html = '';

    // Stat cards
    html += `<div class="sr-stat-card"><span class="sr-stat-value">${totalDecks}</span> Decks</div>`;
    html += `<div class="sr-stat-card"><span class="sr-stat-value">${totalSRCards}</span> SR-Karten</div>`;
    html += `<div class="sr-stat-card"><span class="sr-stat-value">${overdueCount}</span> Fällig</div>`;
    html += `<div class="sr-stat-card">Ø <span class="sr-stat-value">${totalAttempts > 0 ? avgScore + '%' : '–'}</span> richtig</div>`;
    html += `<div class="sr-stat-card"><span class="sr-stat-value">${totalAttempts}</span> Versuche</div>`;

    // Bucket distribution bar
    if (totalSRCards > 0) {
        html += '<div class="sr-bucket-bar">';
        for (let i = 0; i < 5; i++) {
            const pct = (bucketCounts[i] / totalSRCards) * 100;
            if (pct > 0) {
                html += `<div class="sr-bucket-bar-segment" style="width:${pct}%;background:${bucketColors[i]}" title="${bucketLabels[i]}: ${bucketCounts[i]}"></div>`;
            }
        }
        html += '</div>';

        html += '<div class="sr-bucket-bar-legend">';
        for (let i = 0; i < 5; i++) {
            if (bucketCounts[i] > 0) {
                html += `<span style="--legend-color:${bucketColors[i]}">${bucketLabels[i]}: ${bucketCounts[i]}</span>`;
            }
        }
        html += '</div>';
    }

    srStatsDashboard.innerHTML = html;
}

/**
 *
 */
function displaySpacedRepetitionBuckets() {
    // Always render dashboard (even if empty — shows deck count)
    renderSRDashboard();

    // Save current expanded and selected state before overwriting
    const expandedIntervals = new Set(
        [...document.querySelectorAll('.sr-bucket-cards.expanded')].map((el) =>
            Number.parseInt(el.id.replace('bucket-cards-', ''))
        )
    );
    const selectedIntervals = new Set(
        [...document.querySelectorAll('.sr-bucket.selected')].map((el) =>
            Number.parseInt(el.dataset.interval)
        )
    );

    // Check if there are any cards with SR data
    if (Object.keys(spacedRepetitionData).length === 0) {
        srBucketsDisplay.innerHTML =
            '<div class="sr-empty-message">Noch keine Karten im Spaced Repetition System. Beantworte Fragen im Spaced Repetition Modus, um Karten hier zu sehen.</div>';
        startSelectedBucketsBtn.disabled = true;
        return;
    }

    // Group cards by interval
    const buckets = {};
    const now = new Date();
    for (const [key, data] of Object.entries(spacedRepetitionData)) {
        const intervalKey = data.interval;
        if (!buckets[intervalKey]) {
            buckets[intervalKey] = [];
        }

        // Parse the card from the key
        const card = getCardFromKey(key);
        if (card) {
            buckets[intervalKey].push({
                key,
                card,
                data,
                isOverdue: data.nextReview <= now,
            });
        } else {
            console.warn('Card not found for key:', key);
            // Still add it with the key as the question
            buckets[intervalKey].push({
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

    // Sort buckets by interval
    const sortedIntervals = Object.keys(buckets)
        .map(Number)
        .toSorted((a, b) => a - b);

    // Build HTML
    let html = '';
    for (const interval of sortedIntervals) {
        const cards = buckets[interval];
        const intervalLabel = getIntervalLabel(interval);
        const overdueCount = cards.filter((c) => c.isOverdue).length;

        const isExpanded = expandedIntervals.has(interval) ? 'expanded' : '';
        const isSelected = selectedIntervals.has(interval) ? 'selected' : '';
        const isChecked = selectedIntervals.has(interval) ? 'checked' : '';

        html += `
            <div class="sr-bucket ${isSelected}" data-interval="${interval}">
                <div class="sr-bucket-header" onclick="toggleBucketExpansion(${interval})">
                    <div class="sr-bucket-info">
                        <input type="checkbox" class="sr-bucket-checkbox" onclick="event.stopPropagation(); toggleBucketSelection(${interval})" data-interval="${interval}" ${isChecked}>
                        <span class="sr-bucket-title">${intervalLabel}</span>
                        <span class="sr-bucket-count">${cards.length} Karten${overdueCount > 0 ? ` (${overdueCount} fällig)` : ''}</span>
                    </div>
                    <button class="sr-bucket-book-btn" onclick="event.stopPropagation(); openBookViewForBucket(${interval})" title="Buchansicht">📖</button>
                    <span class="sr-bucket-interval">${interval} Tag${interval === 1 ? '' : 'e'}</span>
                </div>
                <div class="sr-bucket-cards ${isExpanded}" id="bucket-cards-${interval}">
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
                                    <button class="sr-move-btn" onclick="handleMoveSRCard(this)" data-interval="${interval}" title="Zu anderem Bucket verschieben">
                                        Verschieben
                                    </button>
                                    <button class="sr-delete-btn" onclick="handleDeleteSRCard(this)" title="Aus SR-System entfernen">
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
 * Get human-readable interval label
 * Maps intervals to 5 semantic learning stages
 * @param interval
 */
function getIntervalLabel(interval) {
    if (interval === 1) return 'Neu (Tag 1)';
    if (interval <= 7) return 'Anfänger (2-7 Tage)';
    if (interval <= 30) return 'In Übung (8-30 Tage)';
    if (interval <= 90) return 'Fortgeschritten (1-3 Monate)';
    return 'Gut gelernt (3+ Monate)';
}

/**
 * Toggle bucket expansion
 * @param interval
 */
function toggleBucketExpansion(interval) {
    const cardsContainer = document.querySelector(`#bucket-cards-${interval}`);
    cardsContainer.classList.toggle('expanded');
}

/**
 * Toggle bucket selection
 * @param interval
 */
function toggleBucketSelection(interval) {
    const bucket = document.querySelector(`.sr-bucket[data-interval="${interval}"]`);
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
        const interval = Number.parseInt(bucket.dataset.interval);
        for (const [key, data] of Object.entries(spacedRepetitionData)) {
            if (data.interval === interval) {
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

    // Sort cards by interval (bucket order) then by nextReview date within each bucket
    selectedCards.sort((a, b) => {
        const aKey = getCardKey(a);
        const bKey = getCardKey(b);
        const aData = spacedRepetitionData[aKey];
        const bData = spacedRepetitionData[bKey];

        // First sort by interval (bucket)
        if (aData.interval !== bData.interval) {
            return aData.interval - bData.interval;
        }

        // Within same interval, sort by nextReview date (most overdue first)
        return new Date(aData.nextReview) - new Date(bData.nextReview);
    });

    // Set active decks for title display
    activeDecks = ['SR Buckets'];

    // Ensure study mode is set to spaced-repetition and hide selector
    studyMode = 'spaced-repetition';
    studyModeSelect.value = 'spaced-repetition';
    studyModeSelect.style.display = 'none';

    // Update the app title
    updateAppTitle(['SR Buckets']);

    // Close SR manager and show quiz
    const savedDecksContainer = document.querySelector('#saved-decks-container');
    const uploadSection = document.querySelector('.upload-section');
    const subtitle = document.querySelector('#app-subtitle');

    srManagerContainer.classList.add('hidden');
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
    const currentInterval = Number.parseInt(button.dataset.interval);
    moveSRCard(cardKey, currentInterval);
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
async function moveSRCard(cardKey, currentInterval) {
    const newInterval = await uiPrompt(
        `Karte zu welchem Intervall (in Tagen) verschieben?\nAktuell: ${currentInterval} Tag${currentInterval === 1 ? '' : 'e'}`,
        String(currentInterval),
        { confirmText: 'Verschieben' }
    );

    if (newInterval === null) return; // Cancelled

    const trimmed = newInterval.trim();
    if (trimmed === '') {
        showError('Bitte gib eine gültige Anzahl von Tagen ein.');
        return;
    }

    const interval = Number.parseInt(trimmed);
    if (Number.isNaN(interval) || interval < 1 || interval > 365) {
        showError('Bitte gib eine gültige Anzahl von Tagen ein (1-365).');
        return;
    }

    if (spacedRepetitionData[cardKey]) {
        spacedRepetitionData[cardKey].interval = interval;

        // Recalculate next review date
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + interval);
        spacedRepetitionData[cardKey].nextReview = nextReview;

        saveSpacedRepetitionData();
        displaySpacedRepetitionBuckets();
        showMessage(`Karte zu ${interval}-Tage-Intervall verschoben.`);
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
    const now = new Date();
    const diffDays = Math.floor((date - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Überfällig';
    if (diffDays === 0) return 'Heute';
    if (diffDays === 1) return 'Morgen';
    return `in ${diffDays} Tagen`;
}
