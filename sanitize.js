/**
 * Input Sanitization Utility
 * Provides functions to sanitize user inputs and prevent XSS attacks
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
 * Sanitize player name for multiplayer quiz
 * Ensures name is alphanumeric with limited special characters
 * @param {string} name - The player name to sanitize
 * @returns {string} Sanitized player name
 */
function sanitizePlayerName(name) {
    if (typeof name !== 'string') {
        return '';
    }

    // Trim and limit length first
    let sanitized = sanitizeInput(name, 50);

    // Only allow letters, numbers, spaces, and basic punctuation
    // This inherently strips any HTML tags or dangerous characters
    sanitized = sanitized.replaceAll(/[^a-zA-Z0-9äöüÄÖÜß\s\-_\.]/g, '');

    return sanitized;
}

/**
 * Sanitize room code for multiplayer quiz
 * Ensures code is alphanumeric only
 * @param {string} code - The room code to sanitize
 * @returns {string} Sanitized room code
 */
function sanitizeRoomCode(code) {
    if (typeof code !== 'string') {
        return '';
    }

    // Only allow uppercase letters and numbers
    return code
        .toUpperCase()
        .replaceAll(/[^A-Z0-9]/g, '')
        .slice(0, 10);
}

/**
 * Sanitize question or answer text for storage.
 * Trims, limits length, and removes null bytes. Does NOT HTML-encode —
 * use sanitizeHTML() separately at display time to avoid double-encoding.
 * @param {string} text - The text to sanitize
 * @returns {string} Sanitized text (plain text, not HTML-encoded)
 */
function sanitizeQuestionText(text) {
    if (typeof text !== 'string') {
        return '';
    }

    return sanitizeInput(text, 5000);
}

/**
 * Validate and sanitize JSON input
 * Ensures JSON is valid and within size limits
 * @param {string} jsonString - The JSON string to validate
 * @param {number} maxSize - Maximum size in bytes (default: 5MB)
 * @returns {object | null} Parsed JSON object or null if invalid
 */
function sanitizeJSON(jsonString, maxSize = 5 * 1024 * 1024) {
    if (typeof jsonString !== 'string') {
        return null;
    }

    // Check size
    if (new Blob([jsonString]).size > maxSize) {
        console.error('JSON file too large');
        return null;
    }

    try {
        const parsed = JSON.parse(jsonString);
        return parsed;
    } catch (error) {
        console.error('Invalid JSON:', error);
        return null;
    }
}

/**
 * Sanitize URL to prevent javascript: or data: URLs
 * Only allows http: and https: protocols
 * @param {string} url - The URL to sanitize
 * @returns {string} Sanitized URL or empty string if invalid
 */
function sanitizeURL(url) {
    if (typeof url !== 'string') {
        return '';
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return url;
        }
    } catch {
        // Invalid URL
    }

    return '';
}

/**
 * Create a safe text node for DOM insertion
 * Prevents XSS by using createTextNode instead of innerHTML
 * @param {string} text - The text to display
 * @returns {Text} Text node safe for DOM insertion
 */
function createSafeTextNode(text) {
    return document.createTextNode(sanitizeInput(text));
}

/**
 * Safely set element text content
 * @param {HTMLElement} element - The element to update
 * @param {string} text - The text to set
 */
function setSafeText(element, text) {
    if (element && typeof text === 'string') {
        element.textContent = sanitizeInput(text);
    }
}

/**
 * Recursively strip prototype-pollution keys (__proto__, constructor, prototype)
 * from a parsed JSON object. Call this on any user-supplied JSON before assigning
 * it to application state.
 * @param {*} obj - The parsed JSON value to sanitize
 * @returns {*} The same structure with dangerous keys removed
 */
function sanitizeParsedJSON(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeParsedJSON);

    const clean = {};
    for (const key of Object.keys(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        clean[key] = sanitizeParsedJSON(obj[key]);
    }
    return clean;
}

/**
 * Validate email format (basic check)
 * @param {string} email - Email to validate
 * @returns {boolean} True if email format is valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
