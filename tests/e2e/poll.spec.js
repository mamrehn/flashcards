'use strict';

/**
 * Poll (poll.html): joining, locked rooms with knocking, teacher renames, and
 * secret untimed votes — the flows a real class election depends on.
 */

const { test, expect } = require('./fixtures');

/**
 * @param {(label: string) => Promise<import('@playwright/test').Page>} device
 * @returns {Promise<{host: import('@playwright/test').Page, code: string}>}
 */
async function hostPoll(device) {
    const host = await device('host');
    await host.goto('/poll.html');
    await host.click('#host-btn');
    await expect(host.locator('#room-id')).toHaveText(/^\S{2} \S{2}$/);
    const code = (await host.locator('#room-id').textContent()).replaceAll(' ', '');
    return { host, code };
}

/**
 * @param {(label: string) => Promise<import('@playwright/test').Page>} device
 * @param {string} code
 * @param {string} name
 * @param {string} [label]
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function joinPoll(device, code, name, label = name) {
    const page = await device(label);
    await page.goto(`/poll.html?room=${code}`);
    await page.fill('#player-name-input', name);
    await page.click('#join-btn');
    return page;
}

const chips = (host) => host.locator('#players-list .player-chip');
const loggedInAs = (page, name) =>
    expect(page.locator('#player-name-display')).toHaveText(`Eingeloggt als ${name}`);

test('names: emoji-only is refused, emoji are stripped, a double tap joins once', async ({
    device,
}) => {
    const { host, code } = await hostPoll(device);

    const emoji = await joinPoll(device, code, '😀😀', 'emoji');
    await expect(emoji.locator('#toast-notification')).toContainText('Emojis');
    await expect(chips(host)).toHaveCount(0);

    const anna = await joinPoll(device, code, 'Anna 😀', 'anna');
    await loggedInAs(anna, 'Anna');

    const ben = await device('ben');
    await ben.goto(`/poll.html?room=${code}`);
    await ben.fill('#player-name-input', 'Ben');
    // Impatient taps while the server wakes up used to open a second socket.
    await ben.evaluate(() => {
        const button = document.querySelector('#join-btn');
        button.click();
        button.click();
        button.click();
    });
    await loggedInAs(ben, 'Ben');
    await ben.waitForTimeout(800);
    await expect(chips(host)).toHaveText(['Anna', 'Ben']);
});

test('locked room: newcomers knock, known sessions rejoin, a lost session gets its seat back', async ({
    device,
}) => {
    const { host, code } = await hostPoll(device);
    const anna = await joinPoll(device, code, 'Anna');
    await loggedInAs(anna, 'Anna');

    await host.click('#room-lock-btn');
    await expect(host.locator('#room-lock-btn')).toContainText('gesperrt');

    await test.step('a newcomer knocks and is admitted', async () => {
        const cara = await joinPoll(device, code, 'Cara');
        await expect(cara.locator('#player-waiting-status')).toContainText('angeklopft');
        await expect(host.locator('#knock-list')).toContainText('Cara');
        await host.click('#knock-list .knock-admit');
        await loggedInAs(cara, 'Cara');
        await expect(host.locator('#knock-panel')).toBeHidden();
    });

    await test.step('a reload rejoins without knocking', async () => {
        await anna.reload();
        await expect(anna.locator('#player-waiting-status')).toContainText('Wiederverbunden');
        await expect(host.locator('#knock-list .knock-item')).toHaveCount(0);
    });

    await test.step('without the saved session, the teacher reassigns the old seat', async () => {
        await anna.context().close();
        await expect(host.locator('#players-list .player-chip.disconnected')).toHaveText('Anna');
        const annaAgain = await joinPoll(device, code, 'Anna', 'anna-other-browser');
        const seat = host.locator('#knock-list .knock-seat');
        // The dropped-out seat with the same name is offered first.
        await expect(seat.locator('option').nth(1)).toHaveText('Anna');
        await seat.selectOption({ index: 1 });
        await expect(annaAgain.locator('#player-waiting-status')).toContainText('Wiederverbunden');
        await expect(chips(host)).toHaveText(['Anna', 'Cara']);
    });
});

test('the teacher renames a player and the new name sticks', async ({ device }) => {
    const { host, code } = await hostPoll(device);
    const ben = await joinPoll(device, code, 'Ben');
    await loggedInAs(ben, 'Ben');

    await chips(host).filter({ hasText: 'Ben' }).click();
    await host.fill('.ui-modal-input', 'Benjamin 🔥');
    await host.click('.ui-modal-confirm');
    await loggedInAs(ben, 'Benjamin');
    await expect(chips(host)).toHaveText(['Benjamin']);

    await ben.reload();
    await loggedInAs(ben, 'Benjamin');
});

test('untimed secret vote: no timer, no auto-submit, ballots counted on reveal', async ({
    device,
}) => {
    const { host, code } = await hostPoll(device);
    const voters = [];
    for (const name of ['Anna', 'Ben', 'Cara']) {
        const page = await joinPoll(device, code, name);
        await loggedInAs(page, name);
        voters.push(page);
    }

    await host.click('#show-composer-btn');
    await host.fill('#composer-question', 'Wer soll Klassensprecher werden?');
    await host.check('#composer-untimed');
    await host.click('#start-vote-btn');
    await expect(host.locator('#host-voting')).toBeVisible();
    await expect(host.locator('#host-timer-container')).toBeHidden();

    for (const page of voters) await expect(page.locator('#player-vote')).toBeVisible();
    await expect(voters[2].locator('#player-timer-container')).toBeHidden();
    await expect(voters[2].locator('#player-vote-hint')).toContainText('Geheime Abstimmung');
    // An untimed vote must not close or auto-submit on its own.
    await host.waitForTimeout(2500);
    await expect(voters[2].locator('#player-vote')).toBeVisible();

    for (const page of voters) {
        await page.locator('#rank-options button', { hasText: 'Cara' }).click();
        await page.click('#submit-vote-btn');
    }

    // Everyone connected voted → the vote ends, ballots are collected.
    await expect(host.locator('#host-reveal')).toBeVisible();
    await expect(host.locator('#host-podium-list li').first()).toContainText('Cara');
    await expect(host.locator('#host-podium-list li').first()).toContainText('3 Pkt');
    await expect(host.locator('#host-reveal-meta')).toContainText('3 von 3 Stimmen');
    await expect(host.locator('#host-reveal-meta')).toContainText('geheime Abstimmung');
    await expect(voters[0].locator('#player-podium-list')).toContainText('Cara');
});
