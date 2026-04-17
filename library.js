/**
 * Lernkarten-Bibliothek (Library) page.
 *
 * Renders a grid of decks from decks/library.json and a per-deck detail view
 * (?deck=<id>). On import, writes the deck into localStorage in the same
 * shape cards.js expects, plus per-deck library metadata into a separate map
 * so the detail page can show "imported" and "update available" badges.
 */

const MANIFEST_URL = 'decks/library.json';
const SAVED_DECKS_KEY = 'flashcardDecks';
const LIBRARY_META_KEY = 'flashcardLibraryMeta';
const SR_KEY = 'spacedRepetitionData';

let manifest = null;

const els = {
    loading: null,
    error: null,
    grid: null,
    gridContainer: null,
    detail: null,
    detailContent: null,
    backToGrid: null,
    search: null,
    empty: null,
    banner: null,
    title: null,
    subtitle: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    cacheElements();
    bindEvents();
    await loadManifest();
    routeFromURL();
}

function cacheElements() {
    els.loading = document.getElementById('loading-state');
    els.error = document.getElementById('error-state');
    els.gridContainer = document.getElementById('grid-view');
    els.grid = document.getElementById('deck-grid');
    els.detail = document.getElementById('detail-view');
    els.detailContent = document.getElementById('detail-content');
    els.backToGrid = document.getElementById('back-to-grid');
    els.search = document.getElementById('library-search');
    els.empty = document.getElementById('empty-state');
    els.banner = document.getElementById('message-banner');
    els.title = document.getElementById('library-title');
    els.subtitle = document.getElementById('library-subtitle');
}

function bindEvents() {
    els.backToGrid.addEventListener('click', () => {
        history.pushState({}, '', 'library.html');
        routeFromURL();
    });
    els.search.addEventListener('input', () => renderGrid(els.search.value.trim().toLowerCase()));
    window.addEventListener('popstate', routeFromURL);
}

async function loadManifest() {
    try {
        // Cache-busting via timestamp ensures returning visitors notice the
        // moment a new manifest is published; SW still serves cache-first
        // for the underlying request, so this just hints freshness.
        const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        manifest = sanitizeParsedJSON(await res.json());
        if (!manifest || !Array.isArray(manifest.decks)) {
            throw new Error('Manifest hat ein unerwartetes Format.');
        }
        els.loading.classList.add('hidden');
    } catch (err) {
        console.error('Failed to load library manifest:', err);
        els.loading.classList.add('hidden');
        els.error.textContent = 'Bibliothek konnte nicht geladen werden. Bitte später erneut versuchen.';
        els.error.classList.remove('hidden');
    }
}

function routeFromURL() {
    if (!manifest) return;
    const params = new URLSearchParams(location.search);
    const deckId = params.get('deck');
    if (deckId) {
        showDetail(deckId);
    } else {
        showGrid();
    }
}

function showGrid() {
    els.detail.classList.add('hidden');
    els.gridContainer.classList.remove('hidden');
    els.title.textContent = '📚 Lernkarten-Bibliothek';
    els.subtitle.textContent = manifest.decks.length === 0
        ? 'Noch keine Decks verfügbar.'
        : `${manifest.decks.length} Deck${manifest.decks.length === 1 ? '' : 's'} verfügbar`;
    renderGrid('');
}

function renderGrid(filter) {
    els.grid.innerHTML = '';
    const meta = readLibraryMeta();
    const filtered = manifest.decks.filter(d => {
        if (!filter) return true;
        if (d.title.toLowerCase().includes(filter)) return true;
        if (d.categories.some(c => c.name.toLowerCase().includes(filter))) return true;
        const m = d.meta || {};
        return [m.subject, m.gradeLevel, m.learningUnit, m.description, m.author]
            .some(v => typeof v === 'string' && v.toLowerCase().includes(filter));
    });

    if (filtered.length === 0) {
        els.empty.textContent = filter
            ? 'Keine Decks passen zur Suche.'
            : 'Keine Decks in der Bibliothek gefunden.';
        els.empty.classList.remove('hidden');
        return;
    }
    els.empty.classList.add('hidden');

    for (const deck of filtered) {
        els.grid.appendChild(buildDeckCard(deck, meta[deck.title]));
    }
}

function buildDeckCard(deck, importedMeta) {
    const card = document.createElement('a');
    card.className = 'deck-card';
    card.href = `library.html?deck=${encodeURIComponent(deck.id)}`;
    card.addEventListener('click', (e) => {
        e.preventDefault();
        history.pushState({}, '', card.href);
        routeFromURL();
    });

    const chips = buildMetaChips(deck.meta);
    if (chips) card.appendChild(chips);

    const title = document.createElement('h2');
    title.className = 'deck-card-title';
    title.textContent = deck.title;
    card.appendChild(title);

    if (deck.meta && deck.meta.description) {
        const desc = document.createElement('p');
        desc.className = 'deck-card-description';
        desc.textContent = deck.meta.description;
        card.appendChild(desc);
    }

    const stats = document.createElement('div');
    stats.className = 'deck-card-stats';
    const line = document.createElement('p');
    line.className = 'stats-line';
    line.textContent = `📝 ${deck.questionCount} Fragen${formatTypeBreakdown(deck.types, ' (', ')')}`;
    stats.appendChild(line);
    card.appendChild(stats);

    if (deck.categories.length > 0) {
        card.appendChild(buildCategoryList(deck.categories, 5));
    }

    if (importedMeta) {
        const status = document.createElement('div');
        status.className = 'deck-card-status';
        const pill = document.createElement('span');
        if (importedMeta.libraryVersion === deck.version) {
            pill.className = 'status-pill imported';
            pill.textContent = '✓ Importiert';
        } else {
            pill.className = 'status-pill update';
            pill.textContent = '🔄 Aktualisierung verfügbar';
        }
        status.appendChild(pill);
        card.appendChild(status);
    }

    return card;
}

/**
 * Compose chips for the small filename-encoded codes (subject/grade/unit).
 * Returns null when the deck has no meta block (older zips without one).
 */
function buildMetaChips(meta) {
    if (!meta) return null;
    const codes = [meta.subject, meta.gradeLevel, meta.learningUnit].filter(Boolean);
    if (codes.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = 'meta-chips';
    for (const code of codes) {
        const chip = document.createElement('span');
        chip.className = 'meta-chip';
        chip.textContent = code;
        wrap.appendChild(chip);
    }
    return wrap;
}

/**
 * Bullet list of categories with per-category counts. Caps at `limit`
 * with a "+N weitere" tail so tiles stay compact.
 */
function buildCategoryList(categories, limit) {
    const list = document.createElement('ul');
    list.className = 'category-list';
    const shown = categories.slice(0, limit);
    for (const cat of shown) {
        const li = document.createElement('li');
        const name = document.createTextNode(cat.name + ' ');
        const count = document.createElement('span');
        count.className = 'cat-count';
        count.textContent = `(${cat.count})`;
        li.appendChild(name);
        li.appendChild(count);
        list.appendChild(li);
    }
    if (categories.length > limit) {
        const more = document.createElement('li');
        more.className = 'cat-more';
        more.textContent = `${categories.length - limit} weitere`;
        list.appendChild(more);
    }
    return list;
}

/**
 * "(23 Text + 26 MC)" — only shown when both types are present, so the
 * breakdown clearly explains the total rather than looking additive.
 */
function formatTypeBreakdown(types, prefix, suffix) {
    const parts = [];
    if (types.text > 0) parts.push(`${types.text} Text`);
    if (types.multipleChoice > 0) parts.push(`${types.multipleChoice} MC`);
    if (parts.length < 2) return '';
    return `${prefix}${parts.join(' + ')}${suffix}`;
}

function showDetail(deckId) {
    const deck = manifest.decks.find(d => d.id === deckId);
    if (!deck) {
        els.gridContainer.classList.add('hidden');
        els.detail.classList.remove('hidden');
        els.detailContent.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'state-message';
        msg.textContent = 'Dieses Deck wurde nicht in der Bibliothek gefunden. Vielleicht wurde es entfernt.';
        els.detailContent.appendChild(msg);
        return;
    }

    els.gridContainer.classList.add('hidden');
    els.detail.classList.remove('hidden');
    els.title.textContent = '📚 Deck-Details';
    els.subtitle.textContent = '';

    const meta = readLibraryMeta()[deck.title];
    renderDetail(deck, meta);
}

function renderDetail(deck, importedMeta) {
    els.detailContent.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'detail-card';

    const chips = buildMetaChips(deck.meta);
    if (chips) card.appendChild(chips);

    const title = document.createElement('h2');
    title.className = 'detail-title';
    title.textContent = deck.title;
    card.appendChild(title);

    if (deck.meta && deck.meta.description) {
        const desc = document.createElement('p');
        desc.className = 'detail-description';
        desc.textContent = deck.meta.description;
        card.appendChild(desc);
    }

    const metaLine = document.createElement('div');
    metaLine.className = 'detail-meta-line';
    metaLine.textContent = `Version ${deck.version} · ${formatBytes(deck.size)}`;
    card.appendChild(metaLine);

    if (importedMeta) {
        if (importedMeta.libraryVersion === deck.version) {
            card.appendChild(buildBanner(
                'imported-banner',
                '✓ Bereits importiert',
                'Du hast dieses Deck in der aktuellen Version. Re-Import behält deinen Fortschritt für unveränderte Fragen.'
            ));
        } else {
            card.appendChild(buildBanner(
                'update-banner',
                '🔄 Aktualisierung verfügbar',
                `Deine importierte Version (${importedMeta.libraryVersion}) ist nicht mehr aktuell. Beim Aktualisieren bleibt dein Lernfortschritt für unveränderte Fragen erhalten — nur Fragen mit geändertem Wortlaut starten neu.`
            ));
        }
    }

    // One prominent total + a sub-line that makes the breakdown explicit
    // (avoids the "is it 49 + 23 + 26?" misread).
    const summary = document.createElement('div');
    summary.className = 'detail-summary';
    const summaryCount = document.createElement('p');
    summaryCount.className = 'detail-summary-count';
    summaryCount.textContent = `${deck.questionCount} Fragen`;
    summary.appendChild(summaryCount);
    const breakdown = formatDetailBreakdown(deck.types);
    if (breakdown) {
        const breakdownEl = document.createElement('p');
        breakdownEl.className = 'detail-summary-breakdown';
        breakdownEl.textContent = breakdown;
        summary.appendChild(breakdownEl);
    }
    card.appendChild(summary);

    if (deck.categories.length > 0) {
        const heading = document.createElement('h3');
        heading.className = 'detail-section-title';
        heading.textContent = `Kategorien (${deck.categories.length})`;
        card.appendChild(heading);
        card.appendChild(buildCategoryList(deck.categories, deck.categories.length));
    }

    if (deck.meta && deck.meta.author) {
        const author = document.createElement('div');
        author.className = 'detail-author';
        author.textContent = `Autor:in: ${deck.meta.author}`;
        card.appendChild(author);
    }

    const actions = document.createElement('div');
    actions.className = 'detail-actions';

    if (importedMeta && importedMeta.libraryVersion !== deck.version) {
        const updateBtn = document.createElement('button');
        updateBtn.className = 'btn btn-update';
        updateBtn.textContent = '🔄 Aktualisieren (Fortschritt erhalten)';
        updateBtn.addEventListener('click', () => updateDeck(deck, updateBtn));
        actions.appendChild(updateBtn);
    }

    const importBtn = document.createElement('button');
    importBtn.className = 'btn btn-primary';
    importBtn.textContent = importedMeta && importedMeta.libraryVersion === deck.version
        ? '▶ Lernen starten'
        : '⬇ Importieren & lernen';
    importBtn.addEventListener('click', () => {
        location.href = `cards.html?import=${encodeURIComponent(deck.id)}`;
    });
    actions.appendChild(importBtn);

    card.appendChild(actions);
    els.detailContent.appendChild(card);
}

function buildBanner(cls, title, detail) {
    const banner = document.createElement('div');
    banner.className = cls;
    const t = document.createElement('div');
    t.className = 'banner-title';
    t.textContent = title;
    banner.appendChild(t);
    const d = document.createElement('div');
    d.className = 'banner-detail';
    d.textContent = detail;
    banner.appendChild(d);
    return banner;
}

function formatDetailBreakdown(types) {
    const parts = [];
    if (types.text > 0) parts.push(`${types.text} Text-Antworten`);
    if (types.multipleChoice > 0) parts.push(`${types.multipleChoice} Multiple Choice`);
    if (parts.length < 2) return '';
    return `davon ${parts.join(' · ')}`;
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Re-import a deck in place from the library, writing the new version
 * into localStorage. Existing SR stats survive automatically for any
 * question whose text is unchanged (keys are deckName|||question).
 */
async function updateDeck(deck, btn) {
    btn.disabled = true;
    btn.textContent = 'Aktualisiere …';
    try {
        await importDeckFromLibrary(deck);
        showMessage(`„${deck.title}“ wurde aktualisiert. Ungeänderte Fragen behalten ihren Fortschritt.`);
        renderDetail(deck, readLibraryMeta()[deck.title]);
    } catch (err) {
        console.error(err);
        showMessage('Aktualisierung fehlgeschlagen.', true);
        btn.disabled = false;
        btn.textContent = '🔄 Aktualisieren (Fortschritt erhalten)';
    }
}

async function importDeckFromLibrary(deckMeta) {
    const url = `decks/${encodeURIComponent(deckMeta.filename)}?v=${encodeURIComponent(deckMeta.version)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();

    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip nicht geladen.');
    }
    const zip = await JSZip.loadAsync(buf);

    let savedDecks;
    try {
        savedDecks = JSON.parse(localStorage.getItem(SAVED_DECKS_KEY) || '{}');
    } catch {
        savedDecks = {};
    }
    savedDecks = sanitizeParsedJSON(savedDecks) || {};

    let importedAny = false;
    const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith('.json'));
    for (const entry of entries) {
        const content = await entry.async('string');
        let data;
        try { data = sanitizeParsedJSON(JSON.parse(content)); } catch { continue; }
        if (!data || !Array.isArray(data.cards)) continue;
        const validCards = data.cards.filter(isValidCard);
        if (validCards.length === 0) continue;

        const deckName = entry.name.split('/').pop().replace(/\.json$/i, '');
        savedDecks[deckName] = { cards: validCards };
        importedAny = true;
    }

    if (!importedAny) throw new Error('Keine gültigen Karten in der Datei gefunden.');

    localStorage.setItem(SAVED_DECKS_KEY, JSON.stringify(savedDecks));

    const meta = readLibraryMeta();
    meta[deckMeta.title] = {
        libraryId: deckMeta.id,
        libraryVersion: deckMeta.version,
        importedAt: new Date().toISOString()
    };
    localStorage.setItem(LIBRARY_META_KEY, JSON.stringify(meta));
}

function isValidCard(card) {
    if (!card || typeof card !== 'object') return false;
    if (typeof card.question !== 'string' || card.question.trim() === '') return false;
    if (typeof card.answer === 'string' && card.answer.trim() !== '') return true;
    if (Array.isArray(card.options) && card.options.length > 0 &&
        Array.isArray(card.correct) && card.correct.length > 0) {
        return card.correct.every(i => Number.isInteger(i) && i >= 0 && i < card.options.length);
    }
    return false;
}

function readLibraryMeta() {
    try {
        const raw = localStorage.getItem(LIBRARY_META_KEY);
        if (!raw) return {};
        const parsed = sanitizeParsedJSON(JSON.parse(raw));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function showMessage(text, isError) {
    els.banner.textContent = text;
    els.banner.classList.remove('hidden', 'error');
    if (isError) els.banner.classList.add('error');
    setTimeout(() => els.banner.classList.add('hidden'), 4000);
}
