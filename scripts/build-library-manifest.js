#!/usr/bin/env node
/**
 * Build decks/library.json from every ZIP or standalone JSON in decks/.
 *
 * For each deck file we extract: a stable id (slug of filename), human title
 * (filename), total/valid question counts, type breakdown (text vs multiple
 * choice), category union, per-deck content hash (drives cache-busting +
 * "update available" badge).
 *
 * The manifest powers library.html (browse + detail page) and is a pure static
 * artifact — no backend at runtime.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
// Card validation comes from the app itself, so the library's counts always
// match what an import actually keeps (cards.js is require()-safe in Node).
const { validateCards, foldIdentitySet, cardType, isPoolOnlyIdentify } = require('../cards.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DECKS_DIR = path.join(REPO_ROOT, 'decks');
const MANIFEST_PATH = path.join(DECKS_DIR, 'library.json');

/**
 *
 * @param str
 */
function slugify(str) {
    return (
        str
            .toLowerCase()
            .normalize('NFD')
            .replaceAll(/[\u0300-\u036F]/g, '')
            .replaceAll('ä', 'ae')
            .replaceAll('ö', 'oe')
            .replaceAll('ü', 'ue')
            .replaceAll('ß', 'ss')
            .replaceAll(/[^\da-z]+/g, '-')
            // Trim leading/trailing dashes. Build-time input (deck filenames) is trusted.
            .replace(/^-+/, '')
            // eslint-disable-next-line sonarjs/slow-regex
            .replace(/-+$/, '')
    );
}

/**
 * Trim a string field, returning undefined when empty/non-string.
 * @param {unknown} v
 * @returns {string | undefined}
 */
function trimMetaString(v) {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Pull a deck-level meta block out of a parsed JSON, normalizing strings.
 * Returns null when no usable meta is present.
 * @param data
 */
function readMeta(data) {
    if (!data || typeof data.meta !== 'object' || data.meta === null) return null;
    const m = data.meta;
    const str = trimMetaString;
    // Canonical field order; missing/empty values are dropped below.
    const out = {
        name: str(m.name),
        institution: str(m.institution),
        program: str(m.program),
        subject: str(m.subject),
        gradeLevel: str(m.gradeLevel),
        learningUnit: str(m.learningUnit),
        description: str(m.description),
        author: str(m.author),
    };
    // Drop undefined keys so JSON output stays clean.
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * Read a deck file (ZIP or standalone JSON) and return all relevant entries
 * as { name, content } pairs. Includes both .json (card files / manifest) and
 * .md (long-description) entries; non-zip deck files are returned as a single
 * standalone JSON entry.
 * @param filePath
 * @param buf
 */
async function readDeckEntries(filePath, buf) {
    if (filePath.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(buf);
        const entries = Object.values(zip.files).filter(
            (e) => !e.dir && (e.name.endsWith('.json') || e.name.toLowerCase().endsWith('.md'))
        );
        const out = [];
        for (const entry of entries) {
            out.push({ name: entry.name, content: await entry.async('string') });
        }
        return out;
    }
    return [{ name: path.basename(filePath), content: buf.toString('utf8') }];
}

/**
 *
 * @param filePath
 */
async function processDeckFile(filePath) {
    const buf = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

    let totalCards = 0;
    let validCards = 0;
    const typeCounts = { text: 0, multipleChoice: 0, matching: 0, identify: 0 };
    const categoryCounts = new Map();
    const sourceFiles = [];
    let meta = null;
    let longDescription = null;
    let longDescriptionFromManifest = false;

    const entries = await readDeckEntries(filePath, buf);

    // Pass 1: pick up manifest.json (canonical meta + optional inline long
    // description) and longDescription.md (the markdown body). Order in zip is
    // not guaranteed, so resolve these before the card loop so the meta source
    // is unambiguous regardless of file iteration order.
    for (const entry of entries) {
        const base = entry.name.split('/').pop();
        if (base === 'manifest.json') {
            try {
                const m = JSON.parse(entry.content);
                if (m && typeof m === 'object') {
                    const cleaned = readMeta(m);
                    if (cleaned) meta = cleaned;
                    if (typeof m.longDescription === 'string' && m.longDescription.trim() !== '') {
                        longDescription = m.longDescription;
                        longDescriptionFromManifest = true;
                    }
                }
            } catch {
                // malformed manifest — fall through to card-file fallback
            }
        } else if (
            base.toLowerCase() === 'longdescription.md' &&
            !longDescriptionFromManifest &&
            entry.content.trim() !== ''
        ) {
            longDescription = entry.content;
        }
    }

    // Pass 2: count cards / collect categories. Also pick up a fallback meta
    // from the first card JSON when no manifest.json was present (back-compat
    // with pre-manifest decks and single-JSON deck files).
    for (const entry of entries) {
        const base = entry.name.split('/').pop();
        if (base === 'manifest.json' || base.toLowerCase().endsWith('.md')) {
            sourceFiles.push(entry.name);
            continue;
        }
        sourceFiles.push(entry.name);
        let data;
        try {
            data = JSON.parse(entry.content);
        } catch {
            continue;
        }
        if (!data || !Array.isArray(data.cards)) continue;

        if (!meta) {
            const m = readMeta(data);
            if (m) meta = m;
        }

        totalCards += data.cards.length;
        for (const card of validateCards(foldIdentitySet(data))) {
            // Photo-less identify cards only serve as distractors; they are
            // stored but never asked, so they don't count as questions.
            if (isPoolOnlyIdentify(card)) continue;
            validCards++;
            const type = cardType(card);
            switch (type) {
                case 'mc': {
                    typeCounts.multipleChoice++;
                    break;
                }
                case 'matching': {
                    typeCounts.matching++;
                    break;
                }
                case 'identify': {
                    typeCounts.identify++;
                    break;
                }
                default: {
                    typeCounts.text++;
                }
            }
            if (Array.isArray(card.categories)) {
                for (const c of card.categories) {
                    if (typeof c !== 'string' || c.trim() === '') continue;
                    const name = c.trim();
                    categoryCounts.set(name, (categoryCounts.get(name) || 0) + 1);
                }
            }
        }
    }

    const filename = path.basename(filePath);
    const baseName = filename.replace(/\.(zip|json)$/i, '');
    const id = slugify(baseName);

    // Sort categories by count descending, then name ascending for stable output.
    const categories = [...categoryCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));

    const result = {
        id,
        filename,
        title: (meta && meta.name) || baseName,
        meta: meta || null,
        version: hash,
        size: buf.length,
        questionCount: validCards,
        invalidCount: totalCards - validCards,
        types: typeCounts,
        categories,
        sourceFiles: sourceFiles.toSorted(),
    };
    if (longDescription) result.longDescription = longDescription;
    return result;
}

/**
 *
 */
async function main() {
    if (!fs.existsSync(DECKS_DIR)) {
        console.error(`decks/ directory not found at ${DECKS_DIR}`);
        process.exit(1);
    }

    const deckFiles = fs
        .readdirSync(DECKS_DIR)
        // `_`-prefixed files are private (gitignored, e.g. class rosters with
        // photos) and must never end up in the public library.
        .filter(
            (f) =>
                /\.(zip|json)$/i.test(f) && f.toLowerCase() !== 'library.json' && !f.startsWith('_')
        )
        .map((f) => path.join(DECKS_DIR, f))
        .toSorted();

    const decks = [];
    const seenIds = new Set();
    for (const deckFile of deckFiles) {
        try {
            const meta = await processDeckFile(deckFile);
            if (seenIds.has(meta.id)) {
                console.error(
                    `Duplicate deck id "${meta.id}" from ${meta.filename} — rename to avoid collision.`
                );
                process.exit(1);
            }
            seenIds.add(meta.id);
            decks.push(meta);
            const metaSummary = meta.meta
                ? ` [${meta.meta.subject || '?'} ${meta.meta.gradeLevel || '?'} ${meta.meta.learningUnit || '?'}]`
                : ' [no meta]';
            console.log(
                `  ✓ ${meta.filename}${metaSummary} (${meta.questionCount} questions, ${meta.categories.length} categories, v${meta.version})`
            );
        } catch (error) {
            console.error(`  ✗ ${path.basename(deckFile)}: ${error.message}`);
            process.exit(1);
        }
    }

    // No build timestamp: the manifest is a pure function of the deck inputs so
    // it only changes when a deck actually changes. A `new Date()` here made
    // library.json differ on every CI run, forcing a needless gh-pages commit
    // each deploy even when no deck was touched.
    const manifest = {
        deckCount: decks.length,
        decks,
    };

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Wrote ${MANIFEST_PATH} (${decks.length} deck${decks.length === 1 ? '' : 's'})`);
}

// CommonJS module — top-level await is not available, so chain off main().
// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
