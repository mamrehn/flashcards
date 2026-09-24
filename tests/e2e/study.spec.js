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
        () =>
            globalThis.JSZip !== undefined &&
            globalThis.marked !== undefined &&
            globalThis.DOMPurify !== undefined
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
                const cache = await caches.open('flashcards-v6');
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
