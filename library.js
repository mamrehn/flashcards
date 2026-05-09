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

let manifest = null;

const els = {
    loading: null,
    error: null,
    grid: null,
    gridContainer: null,
    detail: null,
    detailContent: null,
    backLink: null,
    search: null,
    empty: null,
    banner: null,
    title: null,
    subtitle: null,
    resultCount: null,
    facetsPanel: null,
    facets: null,
    facetsClear: null,
    facetsToggle: null,
};

/**
 * Faceted-filter axes (in display order). Each axis reads a single
 * meta field; values are enumerated from the loaded manifest. Axes
 * with fewer than 2 distinct values are hidden — single-option groups
 * are pure noise (no narrowing power).
 */
const FACET_DEFS = [
    { key: 'institution', label: 'Schulart' },
    { key: 'program', label: 'Bildungsgang' },
    { key: 'subject', label: 'Fach' },
    { key: 'gradeLevel', label: 'Klassenstufe' },
    { key: 'learningUnit', label: 'Lerneinheit' },
    // Categories live at the deck level (deck.categories[].name), not
    // inside meta. Default-collapsed because the value list is long
    // (often one entry per deck-section) and would otherwise dominate
    // the sidebar.
    { key: 'categories', label: 'Kategorien', defaultOpen: false },
];

/**
 * Pull all values for a facet axis off a deck. Returns an array
 * regardless of source shape so callers don't have to branch:
 *   - meta single-string field → [value] when non-empty
 *   - deck.categories          → list of category names
 *   - meta array field         → its contents (string-filtered)
 * @param deck
 * @param key
 */
function getDeckValues(deck, key) {
    if (key === 'categories') {
        if (!Array.isArray(deck.categories)) return [];
        return deck.categories
            .map((c) => (c && typeof c.name === 'string' ? c.name : null))
            .filter((n) => n !== null && n !== '');
    }
    const v = deck.meta && deck.meta[key];
    if (typeof v === 'string') return v === '' ? [] : [v];
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x !== '');
    return [];
}

/**
 * Active filter state. `text` is the free-text search; `facets`
 * holds selected values per axis (key → Set<string>). Axes with no
 * selections are absent from the map entirely.
 */
const filterState = {
    text: '',
    facets: new Map(),
};

document.addEventListener('DOMContentLoaded', init);

/**
 *
 */
async function init() {
    cacheElements();
    bindEvents();
    await loadManifest();
    routeFromURL();
}

/**
 *
 */
function cacheElements() {
    els.loading = document.querySelector('#loading-state');
    els.error = document.querySelector('#error-state');
    els.gridContainer = document.querySelector('#grid-view');
    els.grid = document.querySelector('#deck-grid');
    els.detail = document.querySelector('#detail-view');
    els.detailContent = document.querySelector('#detail-content');
    els.backLink = document.querySelector('.back-link');
    els.search = document.querySelector('#library-search');
    els.empty = document.querySelector('#empty-state');
    els.banner = document.querySelector('#message-banner');
    els.title = document.querySelector('#library-title');
    els.subtitle = document.querySelector('#library-subtitle');
    els.resultCount = document.querySelector('#result-count');
    els.facetsPanel = document.querySelector('#facets-panel');
    els.facets = document.querySelector('#facets');
    els.facetsClear = document.querySelector('#facets-clear');
    els.facetsToggle = document.querySelector('#facets-toggle');
}

/**
 *
 */
function bindEvents() {
    // Back-arrow: from the detail view, transition in-page to the grid
    // (no reload); from the grid, fall through to the default index.html
    // link target.
    els.backLink.addEventListener('click', (e) => {
        if (new URLSearchParams(location.search).get('deck')) {
            e.preventDefault();
            history.pushState({}, '', 'library.html');
            routeFromURL();
        }
    });
    els.search.addEventListener('input', () => {
        filterState.text = els.search.value.trim().toLowerCase();
        applyFiltersToUI();
    });
    els.facetsClear.addEventListener('click', () => {
        filterState.facets.clear();
        applyFiltersToUI();
    });
    els.facetsToggle.addEventListener('click', () => {
        const open = els.facetsPanel.classList.toggle('facets-panel--open');
        els.facetsToggle.setAttribute('aria-expanded', String(open));
    });
    globalThis.addEventListener('popstate', routeFromURL);
}

/**
 *
 */
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
    } catch (error) {
        console.error('Failed to load library manifest:', error);
        els.loading.classList.add('hidden');
        els.error.textContent =
            'Bibliothek konnte nicht geladen werden. Bitte später erneut versuchen.';
        els.error.classList.remove('hidden');
    }
}

/**
 *
 */
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

/**
 *
 */
function showGrid() {
    els.detail.classList.add('hidden');
    els.gridContainer.classList.remove('hidden');
    els.title.textContent = '📚 Lernkarten-Bibliothek';
    els.backLink.href = 'index.html';
    els.backLink.title = 'Zur Startseite';
    els.subtitle.textContent =
        manifest.decks.length === 0
            ? 'Noch keine Decks verfügbar.'
            : 'Wähle ein Deck zum Importieren';
    applyFiltersToUI();
}

/**
 * Re-render facets, grid, result counter, and reset-button visibility
 * after any filter-state change.
 */
function applyFiltersToUI() {
    renderFacets();
    renderGrid();
    renderResultCount();
    renderClearButton();
}

/**
 * True when the deck matches the free-text needle in any of its
 * indexed fields. Empty needle matches everything.
 * @param deck
 * @param needle
 */
function matchesText(deck, needle) {
    if (!needle) return true;
    if (deck.title.toLowerCase().includes(needle)) return true;
    if (deck.categories.some((c) => c.name.toLowerCase().includes(needle))) return true;
    const m = deck.meta || {};
    const haystack = [
        m.institution,
        m.program,
        m.subject,
        m.gradeLevel,
        m.learningUnit,
        m.description,
        m.author,
    ];
    return haystack.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
}

/**
 * True when the deck satisfies the active facet selections, optionally
 * skipping one axis (used when computing per-value counts so a facet's
 * own selections don't zero out its other values).
 * @param deck
 * @param skipKey
 */
function matchesFacets(deck, skipKey) {
    for (const [key, selected] of filterState.facets) {
        if (key === skipKey) continue;
        // OR within axis: at least one of the deck's values must be
        // in the selected set. Works uniformly for single-string axes
        // (one value) and array axes (tags).
        const deckValues = getDeckValues(deck, key);
        if (!deckValues.some((v) => selected.has(v))) return false;
    }
    return true;
}

/**
 * Decks visible under the current full filter state.
 */
function visibleDecks() {
    return manifest.decks.filter(
        (d) => matchesText(d, filterState.text) && matchesFacets(d, null)
    );
}

/**
 * Map<value, count> for one axis, intersection-aware: counts reflect
 * how many decks would remain if the user were to additionally pick
 * each value, given everything *else* that's currently filtering.
 * Uses the same skip-self trick that Amazon-style facet UIs use so
 * the user can see what's reachable from here.
 * @param facetKey
 */
function countsFor(facetKey) {
    const counts = new Map();
    for (const d of manifest.decks) {
        if (!matchesText(d, filterState.text)) continue;
        if (!matchesFacets(d, facetKey)) continue;
        for (const v of getDeckValues(d, facetKey)) {
            counts.set(v, (counts.get(v) || 0) + 1);
        }
    }
    return counts;
}

/**
 * Sort facet values: gradeLevel numerically when possible (so 8 < 10
 * < 11), learningUnit by its leading "LSn.m" tokens, otherwise locale.
 * @param key
 * @param values
 */
function sortFacetValues(key, values) {
    if (key === 'gradeLevel') {
        return [...values].toSorted((a, b) => {
            const an = Number.parseInt(a, 10);
            const bn = Number.parseInt(b, 10);
            if (Number.isNaN(an) || Number.isNaN(bn)) return a.localeCompare(b, 'de');
            return an - bn || a.localeCompare(b, 'de');
        });
    }
    return [...values].toSorted((a, b) => a.localeCompare(b, 'de'));
}

/**
 *
 */
function renderFacets() {
    els.facets.innerHTML = '';
    let anyAxis = false;
    for (const def of FACET_DEFS) {
        const counts = countsFor(def.key);
        const selected = filterState.facets.get(def.key);
        // Hide only fully-empty axes. A single-value axis still has
        // narrowing power when some decks have the value and others
        // don't (e.g. ticking "Berufsschule" filters out a demo deck
        // that has no institution at all). An axis with selections is
        // always shown so the user can unselect it.
        if (counts.size === 0 && (!selected || selected.size === 0)) continue;
        anyAxis = true;
        els.facets.append(buildFacetGroup(def, counts, selected));
    }
    if (!anyAxis) {
        const empty = document.createElement('p');
        empty.className = 'facets-empty';
        empty.textContent = 'Keine Filter verfügbar.';
        els.facets.append(empty);
    }
}

/**
 *
 * @param def
 * @param counts
 * @param selected
 */
function buildFacetGroup(def, counts, selected) {
    const group = document.createElement('details');
    group.className = 'facet-group';
    // Default-open unless explicitly opted out; selected axes always
    // open so the user can see (and unselect) what's narrowing.
    group.open = def.defaultOpen !== false || (selected && selected.size > 0);

    const summary = document.createElement('summary');
    summary.className = 'facet-summary';
    summary.textContent = def.label;
    group.append(summary);

    const list = document.createElement('div');
    list.className = 'facet-options';

    // Union of reachable values + already-selected values (so a
    // selection that has been narrowed out of reach by other facets
    // still shows up — otherwise the user can't unselect it).
    const allValues = new Set(counts.keys());
    if (selected) for (const v of selected) allValues.add(v);

    for (const value of sortFacetValues(def.key, allValues)) {
        list.append(buildFacetOption(def.key, value, counts.get(value) || 0, selected));
    }
    group.append(list);
    return group;
}

/**
 *
 * @param key
 * @param value
 * @param count
 * @param selected
 */
function buildFacetOption(key, value, count, selected) {
    const opt = document.createElement('label');
    opt.className = 'facet-option';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(selected && selected.has(value));
    cb.addEventListener('change', () => toggleFacet(key, value, cb.checked));
    opt.append(cb);

    const labelEl = document.createElement('span');
    labelEl.className = 'facet-option-label';
    labelEl.textContent = value;
    opt.append(labelEl);

    const countEl = document.createElement('span');
    countEl.className = 'facet-option-count';
    countEl.textContent = String(count);
    opt.append(countEl);

    return opt;
}

/**
 *
 * @param key
 * @param value
 * @param checked
 */
function toggleFacet(key, value, checked) {
    let set = filterState.facets.get(key);
    if (checked) {
        if (!set) {
            set = new Set();
            filterState.facets.set(key, set);
        }
        set.add(value);
    } else if (set) {
        set.delete(value);
        if (set.size === 0) filterState.facets.delete(key);
    }
    applyFiltersToUI();
}

/**
 *
 */
function renderGrid() {
    els.grid.innerHTML = '';
    const filtered = visibleDecks();
    const importedMeta = readLibraryMeta();

    if (filtered.length === 0) {
        renderEmptyState();
        return;
    }
    els.empty.classList.add('hidden');

    for (const deck of filtered) {
        els.grid.append(buildDeckCard(deck, importedMeta[deck.title]));
    }
}

/**
 *
 */
function renderEmptyState() {
    els.empty.innerHTML = '';
    if (filterState.text || filterState.facets.size > 0) {
        els.empty.append(
            document.createTextNode('Keine Decks passen zu den aktiven Filtern. ')
        );
        const reset = document.createElement('a');
        reset.href = '#';
        reset.textContent = 'Filter zurücksetzen';
        reset.addEventListener('click', (e) => {
            e.preventDefault();
            resetAllFilters();
        });
        els.empty.append(reset);
    } else {
        els.empty.textContent = 'Keine Decks in der Bibliothek gefunden.';
    }
    els.empty.classList.remove('hidden');
}

/**
 *
 */
function renderResultCount() {
    const total = manifest.decks.length;
    const active = filterState.text || filterState.facets.size > 0;
    if (!active || total === 0) {
        els.resultCount.hidden = true;
        return;
    }
    const visible = visibleDecks().length;
    els.resultCount.hidden = false;
    els.resultCount.textContent = `${visible} von ${total} Decks`;
}

/**
 *
 */
function renderClearButton() {
    const activeFacetCount = [...filterState.facets.values()].reduce((n, s) => n + s.size, 0);
    els.facetsClear.hidden = activeFacetCount === 0;
    // Surface the active count in the mobile toggle label so it
    // remains useful when the panel is collapsed.
    els.facetsToggle.textContent =
        activeFacetCount > 0 ? `🎛 Filter (${activeFacetCount})` : '🎛 Filter';
}

/**
 *
 */
function resetAllFilters() {
    filterState.text = '';
    filterState.facets.clear();
    els.search.value = '';
    applyFiltersToUI();
}

/**
 *
 * @param deck
 * @param importedMeta
 */
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
    if (chips) card.append(chips);

    const title = document.createElement('h2');
    title.className = 'deck-card-title';
    title.textContent = deck.title;
    card.append(title);

    if (deck.meta && deck.meta.description) {
        const desc = document.createElement('p');
        desc.className = 'deck-card-description';
        desc.textContent = deck.meta.description;
        card.append(desc);
    }

    const stats = document.createElement('div');
    stats.className = 'deck-card-stats';
    const line = document.createElement('p');
    line.className = 'stats-line';
    line.textContent = `📝 ${deck.questionCount} Fragen${formatTypeBreakdown(deck.types, ' (', ')')}`;
    stats.append(line);
    card.append(stats);

    if (deck.categories.length > 0) {
        card.append(buildCategoryList(deck.categories, 5));
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
        status.append(pill);
        card.append(status);
    }

    return card;
}

/**
 * Compose chips for the small filename-encoded codes (subject/grade/unit).
 * Returns null when the deck has no meta block (older zips without one).
 * @param meta
 */
function buildMetaChips(meta) {
    if (!meta) return null;
    const codes = [meta.gradeLevel, meta.subject, meta.learningUnit].filter(Boolean);
    if (codes.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = 'meta-chips';
    for (const code of codes) {
        const chip = document.createElement('span');
        chip.className = 'meta-chip';
        chip.textContent = code;
        wrap.append(chip);
    }
    return wrap;
}

/**
 * Labeled metadata section for the detail page. Shows every meta field
 * that exists plus the zip filename, version hash, and byte size so the
 * user can match the displayed title (meta.name) back to the source file.
 * @param deck
 */
function buildMetaTable(deck) {
    const m = deck.meta || {};
    const fileLink = document.createElement('a');
    fileLink.href = `https://github.com/mamrehn/flashcards/blob/main/decks/${encodeURIComponent(deck.filename)}`;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    fileLink.textContent = deck.filename;

    const rows = [
        ['Schulart', m.institution],
        ['Bildungsgang', m.program],
        ['Fach', m.subject],
        ['Klassenstufe', m.gradeLevel],
        ['Lerneinheit', m.learningUnit],
        ['Autor:in', m.author],
        ['Datei', fileLink],
        ['Version', deck.version],
        ['Größe', formatBytes(deck.size)],
    ].filter(([, value]) => {
        if (value instanceof Node) return true;
        return typeof value === 'string' && value !== '';
    });

    const dl = document.createElement('dl');
    dl.className = 'detail-meta';
    for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'detail-meta-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        if (value instanceof Node) dd.append(value);
        else dd.textContent = value;
        row.append(dt);
        row.append(dd);
        dl.append(row);
    }
    return dl;
}

/**
 * Bullet list of categories with per-category counts. Caps at `limit`
 * with a "+N weitere" tail so tiles stay compact.
 * @param categories
 * @param limit
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
        li.append(name);
        li.append(count);
        list.append(li);
    }
    if (categories.length > limit) {
        const more = document.createElement('li');
        more.className = 'cat-more';
        more.textContent = `${categories.length - limit} weitere`;
        list.append(more);
    }
    return list;
}

/**
 * "(23 Text + 26 MC)" — only shown when both types are present, so the
 * breakdown clearly explains the total rather than looking additive.
 * @param types
 * @param prefix
 * @param suffix
 */
function formatTypeBreakdown(types, prefix, suffix) {
    const parts = [];
    if (types.text > 0) parts.push(`${types.text} Text`);
    if (types.multipleChoice > 0) parts.push(`${types.multipleChoice} MC`);
    if (parts.length < 2) return '';
    return `${prefix}${parts.join(' + ')}${suffix}`;
}

/**
 *
 * @param deckId
 */
function showDetail(deckId) {
    els.backLink.href = 'library.html';
    els.backLink.title = 'Zur Übersicht';

    const deck = manifest.decks.find((d) => d.id === deckId);
    if (!deck) {
        els.gridContainer.classList.add('hidden');
        els.detail.classList.remove('hidden');
        els.detailContent.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'state-message';
        msg.textContent =
            'Dieses Deck wurde nicht in der Bibliothek gefunden. Vielleicht wurde es entfernt.';
        els.detailContent.append(msg);
        return;
    }

    els.gridContainer.classList.add('hidden');
    els.detail.classList.remove('hidden');
    els.title.textContent = '📚 Deck-Details';
    els.subtitle.textContent = '';

    const meta = readLibraryMeta()[deck.title];
    renderDetail(deck, meta);
}

/**
 *
 * @param deck
 * @param importedMeta
 */
function renderDetail(deck, importedMeta) {
    els.detailContent.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'detail-card';

    const title = document.createElement('h2');
    title.className = 'detail-title';
    title.textContent = deck.title;
    card.append(title);

    if (importedMeta) {
        if (importedMeta.libraryVersion === deck.version) {
            card.append(
                buildBanner(
                    'imported-banner',
                    '✓ Bereits importiert',
                    'Du hast dieses Deck in der aktuellen Version. Re-Import behält deinen Fortschritt für unveränderte Fragen.'
                )
            );
        } else {
            card.append(
                buildBanner(
                    'update-banner',
                    '🔄 Aktualisierung verfügbar',
                    `Deine importierte Version (${importedMeta.libraryVersion}) ist nicht mehr aktuell. Beim Aktualisieren bleibt dein Lernfortschritt für unveränderte Fragen erhalten — nur Fragen mit geändertem Wortlaut starten neu.`
                )
            );
        }
    }

    const actions = document.createElement('div');
    actions.className = 'detail-actions detail-actions-top';

    if (importedMeta && importedMeta.libraryVersion !== deck.version) {
        const updateBtn = document.createElement('button');
        updateBtn.className = 'btn btn-update';
        updateBtn.textContent = '🔄 Aktualisieren (Fortschritt erhalten)';
        updateBtn.addEventListener('click', () => updateDeck(deck, updateBtn));
        actions.append(updateBtn);
    }

    const isCurrentlyImported = importedMeta && importedMeta.libraryVersion === deck.version;

    const importBtn = document.createElement('button');
    importBtn.className = 'btn btn-primary';
    importBtn.textContent = isCurrentlyImported ? '▶ Lernen starten' : '⬇ Importieren & lernen';
    importBtn.addEventListener('click', () => {
        location.href = `cards.html?import=${encodeURIComponent(deck.id)}`;
    });
    actions.append(importBtn);

    const previewBtn = document.createElement('button');
    previewBtn.className = 'btn btn-secondary';
    previewBtn.textContent = '👁 Vorschau';
    previewBtn.title = 'Alle Karten dieses Decks linear anzeigen — keine Speicherung';
    previewBtn.addEventListener('click', () => {
        location.href = `cards.html?preview=${encodeURIComponent(deck.id)}`;
    });
    actions.append(previewBtn);

    card.append(actions);

    if (deck.meta && deck.meta.description) {
        const desc = document.createElement('p');
        desc.className = 'detail-description';
        desc.textContent = deck.meta.description;
        card.append(desc);
    }

    card.append(buildMetaTable(deck));

    // One prominent total + a sub-line that makes the breakdown explicit
    // (avoids the "is it 49 + 23 + 26?" misread).
    const summary = document.createElement('div');
    summary.className = 'detail-summary';
    const summaryCount = document.createElement('p');
    summaryCount.className = 'detail-summary-count';
    summaryCount.textContent = `${deck.questionCount} Fragen`;
    summary.append(summaryCount);
    const breakdown = formatDetailBreakdown(deck.types);
    if (breakdown) {
        const breakdownEl = document.createElement('p');
        breakdownEl.className = 'detail-summary-breakdown';
        breakdownEl.textContent = breakdown;
        summary.append(breakdownEl);
    }
    card.append(summary);

    if (deck.categories.length > 0) {
        const heading = document.createElement('h3');
        heading.className = 'detail-section-title';
        heading.textContent = `Kategorien (${deck.categories.length})`;
        card.append(heading);
        card.append(buildCategoryList(deck.categories, deck.categories.length));
    }

    els.detailContent.append(card);
}

/**
 *
 * @param cls
 * @param title
 * @param detail
 */
function buildBanner(cls, title, detail) {
    const banner = document.createElement('div');
    banner.className = cls;
    const t = document.createElement('div');
    t.className = 'banner-title';
    t.textContent = title;
    banner.append(t);
    const d = document.createElement('div');
    d.className = 'banner-detail';
    d.textContent = detail;
    banner.append(d);
    return banner;
}

/**
 *
 * @param types
 */
function formatDetailBreakdown(types) {
    const parts = [];
    if (types.text > 0) parts.push(`${types.text} Text-Antworten`);
    if (types.multipleChoice > 0) parts.push(`${types.multipleChoice} Multiple Choice`);
    if (parts.length < 2) return '';
    return `davon ${parts.join(' · ')}`;
}

/**
 *
 * @param n
 */
function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Re-import a deck in place from the library, writing the new version
 * into localStorage. Existing SR stats survive automatically for any
 * question whose text is unchanged (keys are deckName|||question).
 * @param deck
 * @param btn
 */
async function updateDeck(deck, btn) {
    btn.disabled = true;
    btn.textContent = 'Aktualisiere …';
    try {
        await importDeckFromLibrary(deck);
        showMessage(
            `„${deck.title}“ wurde aktualisiert. Ungeänderte Fragen behalten ihren Fortschritt.`
        );
        renderDetail(deck, readLibraryMeta()[deck.title]);
    } catch (error) {
        console.error(error);
        showMessage('Aktualisierung fehlgeschlagen.', true);
        btn.disabled = false;
        btn.textContent = '🔄 Aktualisieren (Fortschritt erhalten)';
    }
}

/**
 *
 * @param deckMeta
 */
async function importDeckFromLibrary(deckMeta) {
    const url = `decks/${encodeURIComponent(deckMeta.filename)}?v=${encodeURIComponent(deckMeta.version)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);

    const isJson = /\.json$/i.test(deckMeta.filename);
    let entries;
    if (isJson) {
        entries = [{ name: deckMeta.filename, content: await res.text() }];
    } else {
        if (typeof JSZip === 'undefined') {
            throw new TypeError('JSZip nicht geladen.');
        }
        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const zipEntries = Object.values(zip.files).filter(
            (e) => !e.dir && e.name.endsWith('.json')
        );
        entries = await Promise.all(
            zipEntries.map(async (e) => ({ name: e.name, content: await e.async('string') }))
        );
    }

    let savedDecks;
    try {
        savedDecks = JSON.parse(localStorage.getItem(SAVED_DECKS_KEY) || '{}');
    } catch {
        savedDecks = {};
    }
    savedDecks = sanitizeParsedJSON(savedDecks) || {};

    let importedAny = false;
    for (const entry of entries) {
        let data;
        try {
            data = sanitizeParsedJSON(JSON.parse(entry.content));
        } catch {
            continue;
        }
        if (!data || !Array.isArray(data.cards)) continue;
        const validCards = data.cards.filter((c) => isValidCard(c));
        if (validCards.length === 0) continue;

        const deckName = entry.name
            .split('/')
            .pop()
            .replace(/\.json$/i, '');
        savedDecks[deckName] = { cards: validCards };
        importedAny = true;
    }

    if (!importedAny) throw new Error('Keine gültigen Karten in der Datei gefunden.');

    localStorage.setItem(SAVED_DECKS_KEY, JSON.stringify(savedDecks));

    const meta = readLibraryMeta();
    meta[deckMeta.title] = {
        libraryId: deckMeta.id,
        libraryVersion: deckMeta.version,
        importedAt: new Date().toISOString(),
    };
    localStorage.setItem(LIBRARY_META_KEY, JSON.stringify(meta));
}

/**
 *
 * @param card
 */
function isValidCard(card) {
    if (!card || typeof card !== 'object') return false;
    if (typeof card.question !== 'string' || card.question.trim() === '') return false;
    if (typeof card.answer === 'string' && card.answer.trim() !== '') return true;
    if (
        Array.isArray(card.options) &&
        card.options.length > 0 &&
        Array.isArray(card.correct) &&
        card.correct.length > 0
    ) {
        return card.correct.every((i) => Number.isInteger(i) && i >= 0 && i < card.options.length);
    }
    return false;
}

/**
 *
 */
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

/**
 *
 * @param text
 * @param isError
 */
function showMessage(text, isError) {
    els.banner.textContent = text;
    els.banner.classList.remove('hidden', 'error');
    if (isError) els.banner.classList.add('error');
    setTimeout(() => els.banner.classList.add('hidden'), 4000);
}
