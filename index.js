/**
 * Index page: starting to learn is worth celebrating. Choosing a mode fires
 * confetti from the chosen card, then navigates once the burst has peaked.
 */

const CELEBRATION_MS = 1250;

/**
 * Celebrate the choice, then navigate to `url`.
 * @param {HTMLElement} origin - the tapped card (the burst starts there)
 * @param {string} url
 */
function celebrateAndGo(origin, url) {
    const prefersReducedMotion = Boolean(
        globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
    // No confetti engine or reduced motion: go straight there, no waiting.
    if (!globalThis.confetti || prefersReducedMotion) {
        globalThis.location.href = url;
        return;
    }
    globalThis.confetti.pop(origin);
    setTimeout(() => globalThis.confetti.pop(origin), 180);
    setTimeout(() => {
        globalThis.location.href = url;
    }, CELEBRATION_MS);
}

document.addEventListener('DOMContentLoaded', () => {
    for (const [id, url] of [
        ['#study-btn', 'cards.html'],
        ['#quiz-btn', 'quiz.html'],
    ]) {
        const link = document.querySelector(id);
        link.addEventListener('click', (e) => {
            // Let modified clicks (new tab/window) behave like normal links.
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            celebrateAndGo(link, url);
        });
    }
});
