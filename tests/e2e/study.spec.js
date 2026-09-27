'use strict';

/**
 * Start page, library and solo study (index / library / cards) with the real
 * Content-Security-Policy enforced: everything must load from this site, a
 * crafted backup must not run script, undo must not double-log a session.
 */

const fs = require('node:fs');
const { test, expect } = require('./fixtures');

const STATIC = { enforceCsp: true, serviceWorkers: 'allow' };

test('start page and library load everything from this site', async ({ device, baseURL }) => {
    const page = await device('site', STATIC);
    const external = [];
    page.on('request', (r) => {
        if (!r.url().startsWith(baseURL) && !r.url().startsWith('data:')) external.push(r.url());
    });

    await page.goto('/index.html');
    const icons = page.locator('svg.icon');
    await expect(icons).toHaveCount(4);
    for (const box of await icons.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
        expect(box.width).toBeGreaterThan(10);
    }
    await expect(page.locator('a[href="datenschutz.html"]')).toHaveCount(1);

    await page.goto('/library.html');
    await page.waitForFunction(
        () => globalThis.marked !== undefined && globalThis.DOMPurify !== undefined
    );
    expect(external, 'no request may leave the site').toEqual([]);
});

test('a crafted backup cannot run script and malformed entries are dropped', async ({
    device,
}, testInfo) => {
    const backup = {
        flashcardDecks: {
            Hauptstaedte: {
                cards: [{ question: 'Hauptstadt von Deutschland?', answer: 'Berlin' }],
            },
        },
        spacedRepetitionData: {
            'Hauptstaedte|||Hauptstadt von Deutschland?': {
                step: 1,
                history: [1],
                nextReview: '2026-01-01T00:00:00Z',
            },
        },
        lernstandHistory: [
            { date: '2026-<img src=x onerror="alert(1)">', overallPercent: 99 },
            { date: '2026-09-01', overallPercent: 10, perDeck: { Hauptstaedte: 10 } },
            { date: '2026-09-02', overallPercent: 20, perDeck: { Hauptstaedte: 20 } },
        ],
        sessionHistory: [
            {
                endedAt: '2026-09-01T10:00:00Z',
                deckNames: ['Hauptstaedte'],
                cardsAnswered: '<img src=x onerror="alert(2)">',
                avgScore: 50,
            },
        ],
        examDate: '"><img src=x onerror="alert(3)">',
    };
    const file = testInfo.outputPath('hostile-backup.json');
    fs.writeFileSync(file, JSON.stringify(backup));

    const page = await device('cards', STATIC);
    await page.goto('/cards.html');
    await page.setInputFiles('#file-input', file);
    await page.click('.ui-modal-confirm');
    await page.click('#open-progress');
    // Rendering the trend and the session log is where the payloads would fire
    // (an alert fails the test through the device fixture).
    await expect(page.locator('#progress-content .progress-trend-wrap')).toBeVisible();
    await expect(page.locator('#progress-content .session-row')).toHaveCount(1);

    const stored = await page.evaluate(() => ({
        trend: JSON.parse(localStorage.getItem('lernstandHistory')).length,
        cardsAnswered: JSON.parse(localStorage.getItem('sessionHistory'))[0].cardsAnswered,
        exam: localStorage.getItem('examDate'),
    }));
    expect(stored).toEqual({ trend: 2, cardsAnswered: 0, exam: null });
});

test('undo on the results screen does not log the session twice', async ({ device }, testInfo) => {
    const deck = testInfo.outputPath('one-card.json');
    fs.writeFileSync(
        deck,
        JSON.stringify({ cards: [{ question: 'Wie viele Beine hat eine Spinne?', answer: '8' }] })
    );
    const page = await device('cards', STATIC);
    await page.goto('/cards.html');
    const sessions = () =>
        page.evaluate(() => JSON.parse(localStorage.getItem('sessionHistory') || '[]').length);

    const finishCard = async () => {
        await page.fill('#user-answer-input', '8');
        await page.click('#show-answer');
        // Exact answers are graded automatically; the focused "next" button
        // must react to Enter natively.
        await expect(page.locator('#next-card')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.locator('#feedback')).toBeVisible();
    };

    await page.setInputFiles('#file-input', deck);
    await finishCard();
    expect(await sessions()).toBe(1);

    await page.keyboard.press('Backspace'); // undo
    await expect(page.locator('#feedback')).toBeHidden();
    expect(await sessions()).toBe(0);

    await finishCard();
    expect(await sessions()).toBe(1);
});

test('the service worker precaches the self-hosted libraries', async ({ device }) => {
    const page = await device('offline', STATIC);
    await page.goto('/cards.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
        .poll(() =>
            page.evaluate(async () => {
                // Whatever the current version is (sw.js bumps CACHE_NAME).
                const name = (await caches.keys()).find((k) => k.startsWith('flashcards-'));
                if (!name) return false;
                const cache = await caches.open(name);
                const wanted = [
                    'vendor/jszip-3.10.1.min.js',
                    'vendor/qrcode-1.0.0.min.js',
                    'vendor/marked-16.3.0.umd.min.js',
                    'vendor/purify-3.2.7.min.js',
                    'ws-client.js',
                    'ui-dialog.js',
                ];
                const hits = await Promise.all(wanted.map((u) => cache.match(u)));
                return hits.every(Boolean);
            })
        )
        .toBe(true);
});

test('a library import shows up as imported and stays selected after a reload', async ({
    device,
}) => {
    const page = await device('cards', STATIC);
    // Nothing saved yet: the library offers no way "back" to an empty study app.
    await page.goto('/library.html');
    await expect(page.locator('.deck-card').first()).toBeVisible();
    await expect(page.locator('#my-decks-link')).toBeHidden();

    await page.goto('/cards.html?import=beispiel-allgemeinwissen');
    // The confirmation is a real, visible toast (it used to be unstyled text
    // appended below the page).
    const toast = page.locator('#toast-region .message-popup');
    await expect(toast).toContainText('importiert');
    await expect(toast).toHaveClass(/show/);
    await expect(page.locator('#toast-region')).toHaveCSS('position', 'fixed');

    const start = page.locator('#start-selected-decks');
    await expect(start).toBeEnabled();
    await expect(start).toHaveText(/^\d+ Karten lernen$/);
    const label = await start.textContent();

    // Returning later: the remembered selection makes "start" one tap away.
    await page.reload();
    await expect(start).toBeEnabled();
    await expect(start).toHaveText(label);

    // The library matches imports by id (the study app keys them by file name).
    await page.goto('/library.html');
    await expect(page.locator('#my-decks-link')).toBeVisible();
    await expect(
        page.locator('.deck-card', { hasText: 'Allgemeinwissen' }).locator('.status-pill')
    ).toHaveText('✓ Importiert');

    // Deleting the deck in the study app clears that badge again.
    await page.goto('/cards.html');
    await page.locator('.topic-toggle', { hasText: 'Allgemeinwissen' }).click();
    await page.getByRole('button', { name: /Deck löschen/ }).click();
    await page.click('.ui-modal-confirm');
    await page.goto('/library.html');
    await expect(page.locator('.deck-card', { hasText: 'Allgemeinwissen' })).toBeVisible();
    await expect(page.locator('.status-pill')).toHaveCount(0);
});

test('matching: a used statement leaves its column, a reusable term stays', async ({
    device,
}, testInfo) => {
    const deck = testInfo.outputPath('one-matching.json');
    fs.writeFileSync(
        deck,
        JSON.stringify({
            cards: [
                {
                    question: 'Ordne die Adresstypen ihren Eigenschaften zu.',
                    pairs: [
                        { left: 'MAC', right: '48 Bit' },
                        { left: 'MAC', right: 'OUI + Gerät' },
                        { left: 'IPv4', right: '32 Bit' },
                    ],
                },
            ],
        })
    );
    const page = await device('cards', STATIC);
    await page.goto('/cards.html');
    await page.setInputFiles('#file-input', deck);

    const tile = (col, text) =>
        page.locator(`#matching-${col}-col .matching-item`, {
            hasText: new RegExp(`^${text}$`),
        });
    await expect(page.locator('.matching-multi-hint')).toHaveText(
        'Hinweis: Einige Begriffe können mehrfach vergeben werden.'
    );

    // Every statement belongs to exactly one term: once paired, it's gone.
    await tile('left', 'IPv4').click();
    await tile('right', '32 Bit').click();
    await expect(tile('right', '32 Bit')).toHaveCount(0);
    // Terms stay, so the column doesn't reveal which one takes more partners.
    await expect(tile('left', 'IPv4')).toHaveCount(1);
    await tile('left', 'MAC').click();
    await tile('right', '48 Bit').click();
    await expect(tile('right', '48 Bit')).toHaveCount(0);
    await expect(tile('left', 'MAC')).toHaveCount(1);
    await expect(page.locator('#matching-progress')).toHaveText('2 von 3 Zuordnungen');

    // All statements placed: nothing left to pair, so the columns go.
    await tile('left', 'MAC').click();
    await tile('right', 'OUI \\+ Gerät').click();
    await expect(page.locator('.matching-unpaired-section')).toBeHidden();

    // Unlinking puts the statement back (and with it the columns).
    await page.locator('.matching-unlink-btn[aria-label*="32 Bit"]').click();
    await expect(tile('right', '32 Bit')).toHaveCount(1);
    await expect(page.locator('.matching-unpaired-section')).toBeVisible();
});

test('multiple choice: tapping the option text toggles it exactly once', async ({
    device,
}, testInfo) => {
    const deck = testInfo.outputPath('one-mc.json');
    fs.writeFileSync(
        deck,
        JSON.stringify({
            cards: [
                {
                    question: 'Welche sind Primzahlen?',
                    options: ['2', '4', '7'],
                    correct: [0, 2],
                    explanations: { 1: '4 = 2×2', 2: '7 ist nur durch 1 und 7 teilbar.' },
                },
            ],
        })
    );
    const page = await device('cards', STATIC);
    await page.goto('/cards.html');
    await page.setInputFiles('#file-input', deck);

    const option = (text) =>
        page.locator('#options-container .option-item', {
            has: page.locator('.option-text', { hasText: new RegExp(`^${text}$`) }),
        });
    for (const text of ['2', '4']) {
        await option(text).locator('.option-text').click();
        await expect(option(text)).toHaveAttribute('aria-checked', 'true');
    }
    await option('4').locator('.option-text').click();
    await expect(option('4')).toHaveAttribute('aria-checked', 'false');

    await page.click('#show-answer');
    // Outcome in words; the explanations are opt-in behind one toggle.
    await expect(page.locator('#answer-verdict')).toContainText('Teilweise richtig');
    const back = page.locator('#options-container-back');
    await expect(back.locator('.mc-missed .option-status')).toHaveText('! fehlte');
    const explanation = back.locator('.mc-missed .option-explanation');
    const toggle = page.locator('#mc-explanations-toggle');
    await expect(explanation).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(explanation).toHaveText('7 ist nur durch 1 und 7 teilbar.');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText('Erklärungen ausblenden');
    await expect(back.locator('.mc-correct-selected .option-status')).toHaveText('✓ richtig');
});
