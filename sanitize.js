/**
 * Input Sanitization Utility
 * Loaded via <script> tag on cards.html, library.html, quiz.html.
 * Exposes sanitizeHTML / sanitizePlayerName / sanitizeParsedJSON on globalThis
 * for use by cards.js, library.js, quiz.js.
 */

/**
 * Sanitize HTML string to prevent XSS attacks.
 * Uses textContent→innerHTML round-trip to HTML-entity-encode the input.
 * The returned string is safe for direct assignment to element.innerHTML.
 *
 * IMPORTANT: Do NOT chain this with other sanitize functions before display —
 * the output is already encoded, so a second pass would double-encode entities.
 * @param {string} input - The input string to sanitize
 * @returns {string} HTML-entity-encoded string safe for innerHTML assignment
 */
function sanitizeHTML(input) {
    if (typeof input !== 'string') {
        return '';
    }

    // Create a temporary div to leverage browser's HTML parsing
    const temp = document.createElement('div');
    temp.textContent = input; // textContent automatically escapes HTML
    return temp.innerHTML;
}

// Emoji and their glue characters (ZWJ, variation selectors, skin tones, flags,
// keycaps, tag sequences). Names are plain text; emoji belong in the avatar.
const PLAYER_NAME_EMOJI_RE =
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{200D}|\u{FE0E}|\u{FE0F}|\u{20E3}|[\u{E0020}-\u{E007F}]/gu;

/**
 * Sanitize a player name for quiz and poll. Keeps letters and digits of any
 * script (so "Ayşe", "Łukasz", "Nguyễn" survive) plus spaces and `' ’ - _ .`;
 * drops emoji, symbols, control and bidi characters, and caps stacked
 * combining marks. Mirrors sanitizeName in server/server.js.
 * @param {string} name - The player name to sanitize
 * @returns {string} Sanitized player name ('' when nothing usable is left)
 */
function sanitizePlayerName(name) {
    if (typeof name !== 'string') {
        return '';
    }
    const cleaned = name
        .slice(0, 500)
        .normalize('NFC')
        .replaceAll(PLAYER_NAME_EMOJI_RE, '')
        .replaceAll(/[^\p{L}\p{M}\p{N}\s'’\-_.]/gu, '')
        .replaceAll(/(\p{M}{2})\p{M}+/gu, '$1')
        .replaceAll(/\s+/g, ' ')
        .trim();
    return [...cleaned].slice(0, 50).join('').trim();
}

/**
 * Recursively strip prototype-pollution keys (__proto__, constructor, prototype)
 * from a parsed JSON object. Call this on any user-supplied JSON before assigning
 * it to application state.
 * @param {unknown} obj - The parsed JSON value to sanitize
 * @returns {unknown} The same structure with dangerous keys removed
 */
function sanitizeParsedJSON(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map((item) => sanitizeParsedJSON(item));

    const clean = {};
    for (const key of Object.keys(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        clean[key] = sanitizeParsedJSON(obj[key]);
    }
    return clean;
}

// Expose to other scripts loaded on the same page (cards.js, library.js, quiz.js).
globalThis.sanitizeHTML = sanitizeHTML;
globalThis.sanitizePlayerName = sanitizePlayerName;
globalThis.sanitizeParsedJSON = sanitizeParsedJSON;

// Node (tests) — the browser ignores this.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizePlayerName, sanitizeParsedJSON };
}
