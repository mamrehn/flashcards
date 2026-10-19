'use strict';

/**
 * Multiplayer quiz (quiz.html): lobby censoring, a relay restart in the middle
 * of a question, the double-click guard, the final screen after a reload, and
 * starting a second game.
 */

const path = require('node:path');
const { test, expect } = require('./fixtures');

const DECK = path.join(__dirname, 'data', 'quiz-two-questions.json');
const CODE_DECK = path.join(__dirname, 'data', 'quiz-code-question.json');
const MATCHING_DECK = path.join(__dirname, 'data', 'quiz-matching-question.json');

/**
 * Host a quiz with a two-question test deck.
 * @param {(label: string) => Promise<import('@playwright/test').Page>} device
 * @param {string} [deck] - path of the deck file
 * @returns {Promise<{host: import('@playwright/test').Page, code: string}>}
 */
async function hostQuiz(device, deck = DECK) {
    const host = await device('host');
    await host.goto('/quiz.html');
    await host.click('#host-btn');
    const code = await openRoom(host, deck);
    return { host, code };
}

/**
 * Import a two-question test deck on the host setup and open a room.
 * @param {import('@playwright/test').Page} host
 * @param {string} [deck] - path of the deck file
 * @returns {Promise<string>} the room code
 */
async function openRoom(host, deck = DECK) {
    await host.setInputFiles('#json-file', deck);
    await expect(host.locator('#file-status')).toContainText(
        'Importiert: 2 Multiple-Choice-Fragen'
    );
    await host.fill('#question-duration-min', '15');
    await host.fill('#question-duration-max', '20');
    await host.click('#start-quiz-btn');
    await expect(host.locator('#room-id')).toHaveText(/^\S{2} \S{2}$/);
    return (await host.locator('#room-id').textContent()).replaceAll(' ', '');
}

/**
 * @param {(label: string) => Promise<import('@playwright/test').Page>} device
 * @param {string} code
 * @param {string} name
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function joinQuiz(device, code, name) {
    const page = await device(name);
    await page.goto(`/quiz.html?host=${code}`);
    // The code comes from the link; the name field has focus and the phone
    // keyboard's Enter ("Los") joins.
    await expect(page.locator('#player-name-input')).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(page.locator('#waiting-message')).toContainText('Du bist drin');
    return page;
}

/**
 * Pick the first option and submit, once the (current) question accepts input.
 * @param {import('@playwright/test').Page} page
 * @param {string} [optionSelector]
 */
async function answer(page, optionSelector = '.option-btn:not([disabled])') {
    await page.locator(`#player-question ${optionSelector}`).first().click();
    await page.click('#submit-answer-btn');
}

/**
 * The code snippet a page shows under its question, or null while it is hidden.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<string|null>}
 */
function codeOf(page, selector) {
    return page
        .locator(selector)
        .evaluate((el) => (el.classList.contains('hidden') ? null : el.textContent));
}

test('lobby: emoji stripped, the dice gives a random name the player cannot undo', async ({
    device,
}) => {
    const { host, code } = await hostQuiz(device);
    await joinQuiz(device, code, 'Mia');
    const rude = await joinQuiz(device, code, 'Rüpel 💩');
    const names = host.locator('#players-list .player-name');
    await expect(names).toHaveText(['Mia', 'Rüpel']);

    await host
        .locator('#players-list .player-item', { hasText: 'Rüpel' })
        .locator('.player-rename-btn')
        .click();
    await host.click('.ui-modal-confirm');

    const title = rude.locator('#lobby-welcome-title');
    await expect(title).not.toContainText('Rüpel');
    const newName = (await title.textContent()).replace('Willkommen, ', '').replace('!', '');
    // Kahoot / Ubuntu style: alliterative adjective + animal, e.g. "Brave Badger".
    expect(newName).toMatch(/^([A-Z])[a-z]+ \1[a-z]+$/);
    await expect(names).toHaveText(['Mia', newName]);

    await rude.reload();
    await expect(title).toContainText(newName);
});

test('a code snippet reaches the host screen and the phones, line breaks intact', async ({
    device,
}) => {
    const { host, code } = await hostQuiz(device, CODE_DECK);
    const mia = await joinQuiz(device, code, 'Mia');
    const snippet = 'for i in range(3):\n    print(i)';

    await host.click('#start-questions-btn');
    // The quiz shuffles its questions, so check both in whatever order they come.
    for (const n of [1, 2]) {
        await expect(mia.locator('#player-question-counter')).toHaveText(`Frage ${n} von 2`);
        const question = await host.locator('#current-question-text').textContent();
        const expected = question.includes('Schleife') ? snippet : null;
        expect(await codeOf(host, '#current-question-code')).toBe(expected);
        expect(await codeOf(mia, '#player-question-code')).toBe(expected);
        if (expected) {
            // Highlighted as Python on both screens, with the language label.
            for (const [page, selector] of [
                [host, '#current-question-code'],
                [mia, '#player-question-code'],
            ]) {
                await expect(page.locator(`${selector} .hljs-keyword`).first()).toHaveText('for');
                await expect(page.locator(selector)).toHaveAttribute('data-language', 'Python');
            }
        }
        await answer(mia);
        if (n === 1) {
            await host.click('#show-next-btn');
        }
    }
});

test('a relay restart mid-question resumes the round; double click and reload are safe', async ({
    device,
    relay,
}) => {
    const { host, code } = await hostQuiz(device);
    const mia = await joinQuiz(device, code, 'Mia');
    const ben = await joinQuiz(device, code, 'Ben');

    await host.click('#start-questions-btn');
    for (const page of [mia, ben]) await expect(page.locator('#player-question')).toBeVisible();
    await expect(host.locator('#players-list .player-rename-btn')).toHaveCount(0);

    await test.step('the server restarts after Mia answered', async () => {
        await answer(mia);
        await expect(mia.locator('#submit-answer-btn')).toContainText('Gesendet');
        await expect(host.locator('#answers-count')).toHaveText('1');
        // Mark the current buttons so we can tell the resumed question apart.
        for (const page of [mia, ben]) {
            await page.evaluate(() => {
                for (const b of document.querySelectorAll('.option-btn')) b.dataset.stale = '1';
            });
        }
        await relay.restart();
        const resumed = '.option-btn:not([data-stale])';
        await expect(
            ben.locator(`#player-question ${resumed}:not([disabled])`).first()
        ).toBeVisible({
            timeout: 30_000,
        });
        // Mia's answer survived the restart: her resumed question stays locked.
        await expect(mia.locator(`#player-question ${resumed}`).first()).toBeDisabled({
            timeout: 30_000,
        });
        await answer(ben, `${resumed}:not([disabled])`);
        await expect(host.locator('#show-next-btn')).toBeVisible();
        for (const page of [mia, ben]) await expect(page.locator('#player-result')).toBeVisible();
    });

    await test.step('a double click on "Nächste Frage" advances exactly one question', async () => {
        await host.locator('#show-next-btn').dblclick();
        for (const page of [mia, ben]) {
            await expect(page.locator('#player-question-counter')).toHaveText(/^Frage 2 von 2$/);
        }
        await expect(host.locator('#question-counter')).toHaveText('Frage 2 von 2');
    });

    await test.step('the final screen survives a reload', async () => {
        for (const page of [mia, ben]) await answer(page);
        await host.click('#show-results-btn');
        await expect(mia.locator('#player-final-result')).toBeVisible();
        await expect(mia.locator('#player-leaderboard-container')).toContainText('Rangliste');
        // Each row is numbered once (the list marker used to add a second
        // "1.") and the player's own row is marked, with the place up front.
        const ranking = mia.locator('#player-leaderboard-container .final-ranking');
        await expect(ranking).toHaveCSS('list-style-type', 'none');
        await expect(ranking.locator('li').first()).toHaveText(/^1\.\S/);
        await expect(ranking.locator('.is-me')).toContainText('Mia (du)');
        await expect(mia.locator('.final-own-rank')).toHaveText(/^Du bist auf Platz [12] von 2\.$/);
        await mia.reload();
        await expect(mia.locator('#player-final-result')).toBeVisible();
        await expect(mia.locator('#player-leaderboard-container')).toContainText(
            'Endgültige Rangliste'
        );
        await expect(ranking.locator('.is-me')).toContainText('Mia (du)');
    });

    await test.step('host and players start a second game', async () => {
        await expect(host.locator('#host-results')).toBeVisible();
        await expect(host.locator('#leaderboard')).toContainText('Mia');
        // Mia leaves by herself; Ben is sent back when the host ends the room.
        await mia.click('#play-again-btn');
        await Promise.all([host.waitForEvent('load'), host.click('#new-quiz-btn')]);
        await expect(ben.locator('#player-btn')).toBeVisible();
        const code2 = await openRoom(host);
        expect(code2).not.toBe(code);
        for (const [page, name] of [
            [mia, 'Mia'],
            [ben, 'Ben'],
        ]) {
            await page.click('#player-btn');
            await page.fill('#room-code-input', code2);
            await page.fill('#player-name-input', name);
            await page.click('#join-btn');
            await expect(page.locator('#waiting-message')).toContainText('Du bist drin');
        }
        await expect(host.locator('#players-list')).toContainText('Mia');
        await expect(host.locator('#players-list')).toContainText('Ben');
    });
});

/**
 * A tile of the phone's matching board.
 * @param {import('@playwright/test').Page} page
 * @param {'left'|'right'} side - terms or assignments
 * @param {string} text
 * @returns {import('@playwright/test').Locator}
 */
function tile(page, side, text) {
    return page.locator(`#player-question .match-item[data-side="${side}"]`, {
        hasText: new RegExp(`^${text}$`),
    });
}

/**
 * A term tile, by its text.
 * @param {string} text
 * @returns {(page: import('@playwright/test').Page) => import('@playwright/test').Locator}
 */
const term = (text) => (page) => tile(page, 'left', text);

/**
 * An assignment tile, by its text.
 * @param {string} text
 * @returns {(page: import('@playwright/test').Page) => import('@playwright/test').Locator}
 */
const assignment = (text) => (page) => tile(page, 'right', text);

/**
 * Tap two tiles to pair them (term then assignment, or the other way round).
 * @param {import('@playwright/test').Page} page
 * @param {(page: import('@playwright/test').Page) => import('@playwright/test').Locator} first
 * @param {(page: import('@playwright/test').Page) => import('@playwright/test').Locator} second
 */
async function pair(page, first, second) {
    await first(page).click();
    await second(page).click();
}

test('a matching round: pairs on the phone, partial credit, results on both screens', async ({
    device,
}) => {
    const host = await device('host');
    await host.goto('/quiz.html');
    await host.click('#host-btn');
    await host.setInputFiles('#json-file', MATCHING_DECK);
    // The free-text card can't be played live; the matching card can.
    await expect(host.locator('#file-status')).toContainText('Importiert: 1 Zuordnungsfrage');
    await expect(host.locator('#file-status')).toContainText('1 Freitext-Karte(n) übersprungen');
    await host.fill('#question-duration-min', '30');
    await host.fill('#question-duration-max', '30');
    await host.click('#start-quiz-btn');
    await expect(host.locator('#room-id')).toHaveText(/^\S{2} \S{2}$/);
    const code = (await host.locator('#room-id').textContent()).replaceAll(' ', '');
    const mia = await joinQuiz(device, code, 'Mia');
    const ben = await joinQuiz(device, code, 'Ben');
    await host.click('#start-questions-btn');

    await test.step('Mia pairs everything right, in either tap order', async () => {
        await expect(mia.locator('#player-question-hint')).toHaveText(
            'Tippe einen Begriff an, dann die passende Zuordnung.'
        );
        // The projector shows both columns too, without the answers.
        await expect(host.locator('#host-current-options .host-match-item')).toHaveCount(7);
        await expect(tile(mia, 'right', 'Madrid')).toBeVisible();
        await pair(mia, term('Deutschland'), assignment('Berlin'));
        await expect(mia.locator('.match-pair')).toHaveText(['Deutschland → Berlin✕']);
        // One partner each: both tiles left their columns.
        await expect(tile(mia, 'left', 'Deutschland')).toHaveCount(0);
        await expect(tile(mia, 'right', 'Berlin')).toHaveCount(0);
        await expect(mia.locator('.match-progress')).toHaveText('1 von 3 Zuordnungen');
        await pair(mia, assignment('Paris'), term('Frankreich'));
        await pair(mia, term('Italien'), assignment('Rom'));
        // Nothing left to pair: the columns go, the distractor stays unpaired.
        await expect(mia.locator('.match-cols')).toHaveCount(0);
        await mia.click('#submit-answer-btn');
        await expect(mia.locator('#submit-answer-btn')).toContainText('Gesendet');
    });

    await test.step('Ben gets one of three, after taking a pair back', async () => {
        await pair(ben, term('Deutschland'), assignment('Madrid'));
        await ben.locator('.match-unlink').click();
        await expect(tile(ben, 'left', 'Deutschland')).toBeVisible();
        await pair(ben, term('Deutschland'), assignment('Paris'));
        await pair(ben, term('Frankreich'), assignment('Berlin'));
        await pair(ben, term('Italien'), assignment('Rom'));
        await ben.click('#submit-answer-btn');
    });

    await test.step('verdicts on the phones, pair counts on the projector', async () => {
        // The only question is also the last: the phones go on to the final
        // screen; the round's verdict is rendered underneath it.
        await expect(mia.locator('#player-final-result')).toBeVisible();
        await expect(mia.locator('#result-label')).toHaveText('Richtig!');
        await expect(ben.locator('#result-icon')).toHaveText('1/3');
        await expect(ben.locator('#result-label')).toHaveText('Teilweise richtig');
        await expect(ben.locator('.result-pick-tally')).toHaveText(
            '2 richtige Zuordnungen fehlen · 2 falsche Zuordnungen'
        );
        await expect(ben.locator('.correct-answer-chip.player-selected')).toHaveText([
            'Italien → Rom',
        ]);
        const reveal = host.locator('#host-current-options li');
        await expect(reveal.filter({ hasText: 'Italien → Rom (2× richtig)' })).toHaveCount(1);
        await expect(reveal.filter({ hasText: 'Deutschland → Berlin (1× richtig)' })).toHaveCount(
            1
        );
        await expect(reveal.filter({ hasText: 'Madrid – passt zu keinem Begriff' })).toHaveCount(1);
    });

    await test.step('one right pair of three is a third of the points', async () => {
        await host.click('#show-results-btn');
        const points = async (name) => {
            const text = await host
                .locator('.podium-place', { hasText: name })
                .locator('.podium-score')
                .textContent();
            return Number.parseInt(text, 10);
        };
        const [miaPoints, benPoints] = [await points('Mia'), await points('Ben')];
        expect(benPoints).toBeGreaterThan(0);
        // Both answered within a few seconds, so the speed bonus is about the
        // same: Ben's share is close to 1/3 of Mia's.
        expect(benPoints / miaPoints).toBeGreaterThan(0.25);
        expect(benPoints / miaPoints).toBeLessThan(0.4);
    });
});

test('scoring and places: no gain from extra ticks, equal points share a place', async ({
    device,
}) => {
    const { host, code } = await hostQuiz(device);
    const shares = await host.evaluate(() => ({
        // One right and one wrong option of a single-answer question: half.
        hedge: globalThis.mcScoreRatio([0], [0, 1]),
        all: globalThis.mcScoreRatio([0], [0, 1, 2, 3]),
        exact: globalThis.mcScoreRatio([0, 2], [2, 0]),
        // Linking each term to both assignments: half, not everything.
        matchingHedge: globalThis.matchingScoreRatio([0, 2, 1, 3], [0, 2, 0, 3, 1, 2, 1, 3]),
        matchingPartial: globalThis.matchingScoreRatio([0, 3, 1, 4, 2, 5], [0, 3]),
        ranks: globalThis.competitionRanks([300.2, 299.6, 120, 0, 0]),
    }));
    expect(shares).toEqual({
        hedge: 0.5,
        all: 0.25,
        exact: 1,
        matchingHedge: 0.5,
        matchingPartial: 1 / 3,
        ranks: [1, 1, 3, 4, 4],
    });

    // Both players answer wrong: two players on 0 points share 1st place.
    const players = [await joinQuiz(device, code, 'Mia'), await joinQuiz(device, code, 'Ben')];
    await host.click('#start-questions-btn');
    const wrongOption = {
        'Welche sind Primzahlen?': '4',
        'Welche Planeten sind Gasriesen?': 'Mars',
    };
    for (const page of players) {
        await expect(page.locator('#player-question')).toBeVisible();
        const question = await page.locator('#player-question-text').textContent();
        await page
            .locator('#player-question .option-btn', {
                has: page.locator('.option-btn-text', {
                    hasText: new RegExp(`^${wrongOption[question]}$`),
                }),
            })
            .click();
        await page.click('#submit-answer-btn');
    }
    await expect(host.locator('#scoreboard-list .scoreboard-item')).toHaveCount(2);
    await expect(host.locator('#scoreboard-list .player-rank')).toHaveText(['1.', '1.']);
});
