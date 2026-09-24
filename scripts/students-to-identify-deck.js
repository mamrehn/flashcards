#!/usr/bin/env node
/**
 * Convert a scraped roster (students.json) into an "identify" flashcard deck.
 *
 * Private data: input and output files start with `_`, which .gitignore
 * excludes (`_*.json`) and the library build skips — rosters with photos must
 * never be committed or published.
 *
 * Input shape (WebUntis-style export):
 *   { className, students: [{ firstName, lastName, name, image }] }
 * where `image` is a base64 data URI (or null when no photo exists).
 *
 * Output is a single self-contained deck JSON usable by cards.js:
 *   { meta, set, cards: [{ type: "identify", media, labels, categories }] }
 * Each student becomes one card. Students with a photo are quizzed in modes
 * that escalate with mastery (pick the name/face → type the first name given
 * the last → type the whole name), drawing distractors from the other cards.
 * Students without a photo get `media: null` — cards.js
 * keeps them as "pool-only" entries: never quizzed (every mode needs the face)
 * but still usable as distractor names for the classmates who do have a photo.
 *
 * Usage: node scripts/students-to-identify-deck.js [_students.json] [outfile]
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || path.join(REPO_ROOT, '_students.json'));

/**
 * Normalize an image data URI: keep the media type and base64 payload, drop a
 * stray `charset=…` parameter some exporters inject (harmless but non-standard
 * for binary image data). Non-image or non-data URIs are rejected (returns null)
 * so nothing but a real picture ends up as card media.
 * @param {unknown} src
 * @returns {string|null}
 */
function normalizeMedia(src) {
    if (typeof src !== 'string' || src.length === 0) return null;
    const m = /^data:(image\/[\d+.a-z-]+)((?:;[^,]*)?);base64,(.+)$/i.exec(src);
    if (!m) return null;
    return `data:${m[1]};base64,${m[3]}`;
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const className = (typeof raw.className === 'string' && raw.className.trim()) || 'Klasse';
const students = Array.isArray(raw.students) ? raw.students : [];

const cards = [];
const poolOnly = [];
for (const s of students) {
    const media = normalizeMedia(s && s.image);
    const firstName = (s && s.firstName ? String(s.firstName) : '').trim();
    const lastName = (s && s.lastName ? String(s.lastName) : '').trim();
    const display = [firstName, lastName].filter(Boolean).join(' ') || (s && s.name) || '?';
    if (!firstName && !lastName) continue; // no name at all → unusable
    const labels = {};
    if (firstName) labels.firstName = firstName;
    if (lastName) labels.lastName = lastName;
    // media === null → pool-only card (name serves as a distractor only).
    if (!media) poolOnly.push(display);
    cards.push({
        type: 'identify',
        media: media || null,
        labels,
        categories: [className],
    });
}

const deck = {
    meta: {
        name: className,
        subject: 'Personen',
        description: `Gesichter und Namen der Klasse ${className} lernen.`,
        author: 'students-to-identify-deck.js',
    },
    set: {
        prompt: 'Wie heißt diese Person?',
        labelParts: ['firstName', 'lastName'],
        accept: 'anyPart',
        // Difficulty ladder: pick a name/face → type the first name given the
        // last (recallPart) → type the whole name (recall).
        modes: ['recall', 'recallPart', 'pickLabel', 'pickMedia'],
        distractors: 2,
        mediaKind: 'image',
    },
    cards,
};

const safeName = className.replaceAll(/[^\w-]+/g, '_');
const outPath = path.resolve(
    process.argv[3] || path.join(REPO_ROOT, 'decks', `_${safeName}_Namen.json`)
);
fs.writeFileSync(outPath, JSON.stringify(deck, null, 2) + '\n');

const rel = path.relative(REPO_ROOT, outPath);
const quizzable = cards.length - poolOnly.length;
console.log(`Wrote ${cards.length} identify cards (${quizzable} with photo) → ${rel}`);
if (poolOnly.length > 0) {
    console.log(
        `${poolOnly.length} without a photo → pool-only (distractor names): ${poolOnly.join(', ')}`
    );
}
