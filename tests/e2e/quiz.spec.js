'use strict';

/**
 * Multiplayer quiz (quiz.html): lobby censoring, a relay restart in the middle
 * of a question, the double-click guard, and the final screen after a reload.
 */

const path = require('node:path');
const { test, expect } = require('./fixtures');

const DECK = path.join(__dirname, 'data', 'quiz-two-questions.json');

/**
 * Host a quiz with the two-question test deck.
 * @param {(label: string) => Promise<import('@playwright/test').Page>} device
 * @returns {Promise<{host: import('@playwright/test').Page, code: string}>}
 */
async function hostQuiz(device) {
    const host = await device('host');
    await host.goto('/quiz.html');
    await host.click('#host-btn');
    await host.setInputFiles('#json-file', DECK);
    await expect(host.locator('#file-status')).toContainText('Importiert: 2 MC-Fragen');
    await host.fill('#question-duration-min', '15');
    await host.fill('#question-duration-max', '20');
    await host.click('#start-quiz-btn');
    await expect(host.locator('#room-id')).toHaveText(/^\S{2} \S{2}$/);
    const code = (await host.locator('#room-id').textContent()).replaceAll(' ', '');
    return { host, code };
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
        await mia.reload();
        await expect(mia.locator('#player-final-result')).toBeVisible();
        await expect(mia.locator('#player-leaderboard-container')).toContainText(
            'Endgültige Rangliste'
        );
    });
});
