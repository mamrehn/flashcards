#!/usr/bin/env node
/**
 * Build decks/library.json from every ZIP in decks/.
 *
 * For each ZIP we extract: a stable id (slug of filename), human title (filename),
 * total/valid question counts, type breakdown (text vs multiple choice), category
 * union, per-deck content hash (drives cache-busting + "update available" badge).
 *
 * The manifest powers library.html (browse + detail page) and is a pure static
 * artifact — no backend at runtime.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const REPO_ROOT = path.resolve(__dirname, '..');
const DECKS_DIR = path.join(REPO_ROOT, 'decks');
const MANIFEST_PATH = path.join(DECKS_DIR, 'library.json');

function slugify(str) {
    return str
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
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

function cardType(card) {
    return Array.isArray(card.options) ? 'multiple-choice' : 'text';
}

/**
 * Pull a deck-level meta block out of a parsed JSON, normalizing strings.
 * Returns null when no usable meta is present.
 */
function readMeta(data) {
    if (!data || typeof data.meta !== 'object' || data.meta === null) return null;
    const m = data.meta;
    const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
    const out = {
        name: str(m.name),
        subject: str(m.subject),
        gradeLevel: str(m.gradeLevel),
        learningUnit: str(m.learningUnit),
        description: str(m.description),
        author: str(m.author)
    };
    // Drop undefined keys so JSON output stays clean.
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return Object.keys(out).length > 0 ? out : null;
}

async function processZip(zipPath) {
    const buf = fs.readFileSync(zipPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const zip = await JSZip.loadAsync(buf);

    let totalCards = 0;
    let validCards = 0;
    let textCards = 0;
    let mcCards = 0;
    const categoryCounts = new Map();
    const sourceFiles = [];
    let meta = null;

    const entries = Object.values(zip.files).filter(e => !e.dir && e.name.endsWith('.json'));
    for (const entry of entries) {
        sourceFiles.push(entry.name);
        const content = await entry.async('string');
        let data;
        try { data = JSON.parse(content); } catch { continue; }
        if (!data || !Array.isArray(data.cards)) continue;

        // First JSON file with a meta block wins for the ZIP-level metadata.
        // Multi-JSON ZIPs typically share subject/grade/unit; per-card detail
        // lives in the cards themselves.
        if (!meta) {
            const m = readMeta(data);
            if (m) meta = m;
        }

        for (const card of data.cards) {
            totalCards++;
            if (!isValidCard(card)) continue;
            validCards++;
            if (cardType(card) === 'text') textCards++; else mcCards++;
            if (Array.isArray(card.categories)) {
                for (const c of card.categories) {
                    if (typeof c !== 'string' || c.trim() === '') continue;
                    const name = c.trim();
                    categoryCounts.set(name, (categoryCounts.get(name) || 0) + 1);
                }
            }
        }
    }

    const filename = path.basename(zipPath);
    const baseName = filename.replace(/\.zip$/i, '');
    const id = slugify(baseName);

    // Sort categories by count descending, then name ascending for stable output.
    const categories = [...categoryCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'de'));

    return {
        id,
        filename,
        title: (meta && meta.name) || baseName,
        meta: meta || null,
        version: hash,
        size: buf.length,
        questionCount: validCards,
        invalidCount: totalCards - validCards,
        types: { text: textCards, multipleChoice: mcCards },
        categories,
        sourceFiles: sourceFiles.sort()
    };
}

async function main() {
    if (!fs.existsSync(DECKS_DIR)) {
        console.error(`decks/ directory not found at ${DECKS_DIR}`);
        process.exit(1);
    }

    const zips = fs.readdirSync(DECKS_DIR)
        .filter(f => f.toLowerCase().endsWith('.zip'))
        .map(f => path.join(DECKS_DIR, f))
        .sort();

    const decks = [];
    const seenIds = new Set();
    for (const zip of zips) {
        try {
            const meta = await processZip(zip);
            if (seenIds.has(meta.id)) {
                console.error(`Duplicate deck id "${meta.id}" from ${meta.filename} — rename to avoid collision.`);
                process.exit(1);
            }
            seenIds.add(meta.id);
            decks.push(meta);
            const metaSummary = meta.meta
                ? ` [${meta.meta.subject || '?'} ${meta.meta.gradeLevel || '?'} ${meta.meta.learningUnit || '?'}]`
                : ' [no meta]';
            console.log(`  ✓ ${meta.filename}${metaSummary} (${meta.questionCount} questions, ${meta.categories.length} categories, v${meta.version})`);
        } catch (err) {
            console.error(`  ✗ ${path.basename(zip)}: ${err.message}`);
            process.exit(1);
        }
    }

    const manifest = {
        generatedAt: new Date().toISOString(),
        deckCount: decks.length,
        decks
    };

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Wrote ${MANIFEST_PATH} (${decks.length} deck${decks.length === 1 ? '' : 's'})`);
}

main().catch(err => { console.error(err); process.exit(1); });
