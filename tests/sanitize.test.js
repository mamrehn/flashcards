'use strict';

/**
 * Client-side name sanitizing (sanitize.js). Must agree with the server's
 * sanitizeName (covered in server.protocol.test.js) so what a player sees
 * before joining is what everyone sees afterwards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizePlayerName } = require('../sanitize.js');

test('sanitizePlayerName keeps letters of any script', () => {
    assert.equal(sanitizePlayerName('Ayşe'), 'Ayşe');
    assert.equal(sanitizePlayerName('Łukasz Nguyễn'), 'Łukasz Nguyễn');
    assert.equal(sanitizePlayerName('Zoë Müller-Groß'), 'Zoë Müller-Groß');
    assert.equal(sanitizePlayerName("D'Angelo"), "D'Angelo");
    assert.equal(sanitizePlayerName('Олена'), 'Олена');
});

test('sanitizePlayerName removes emoji and symbols', () => {
    assert.equal(sanitizePlayerName('Anna 😀'), 'Anna');
    assert.equal(sanitizePlayerName('🔥Max🔥'), 'Max');
    assert.equal(sanitizePlayerName('👍🏽 Tom'), 'Tom');
    assert.equal(sanitizePlayerName('<b>Ben</b>'), 'bBenb');
    // Only emoji → nothing usable; the UI refuses to submit it.
    assert.equal(sanitizePlayerName('😀😀'), '');
    assert.equal(sanitizePlayerName('🇩🇪'), '');
});

test('sanitizePlayerName normalizes and caps', () => {
    // Decomposed "ü" (u + combining diaeresis) becomes the composed form.
    assert.equal(sanitizePlayerName('Mu\u{0308}ller'), 'Müller');
    assert.equal(sanitizePlayerName('  a   b  '), 'a b');
    assert.equal([...sanitizePlayerName('x'.repeat(80))].length, 50);
    // Stacked combining marks ("Zalgo") are capped at two per base letter
    // (NFC first merges a + U+0301 into "á", leaving three marks → two).
    assert.equal(sanitizePlayerName('a\u{0301}\u{0302}\u{0303}\u{0304}'), '\u{E1}\u{0302}\u{0303}');
    assert.equal(sanitizePlayerName(42), '');
});
