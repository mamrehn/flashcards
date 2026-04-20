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

/**
 * Sanitize user input for storage and display
 * Trims whitespace and limits length
 * @param {string} input - The input string to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 1000)
 * @returns {string} Sanitized string
 */
function sanitizeInput(input, maxLength = 1000) {
    if (typeof input !== 'string') {
        return '';
    }

    // Trim whitespace
    let sanitized = input.trim();

    // Limit length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, Math.max(0, maxLength));
    }

    // Remove any null bytes
    sanitized = sanitized.replaceAll('\0', '');

    return sanitized;
}

/**
 * Sanitize player name for multiplayer quiz.
 * Trims, length-caps, then strips anything outside letters, digits, German
 * umlauts, whitespace, and `- _ .` — which inherently removes HTML/JS payloads.
 * @param {string} name - The player name to sanitize
 * @returns {string} Sanitized player name
 */
function sanitizePlayerName(name) {
    if (typeof name !== 'string') {
        return '';
    }

    let sanitized = sanitizeInput(name, 50);
    sanitized = sanitized.replaceAll(/[^a-zA-Z0-9äöüÄÖÜß\s\-_.]/g, '');
    return sanitized;
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
