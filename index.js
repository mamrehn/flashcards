/**
 * Index Page - Confetti Animation and Navigation
 * Provides confetti effects when navigating to different sections
 */

/**
 * Trigger confetti animation and navigate to URL
 * @param {string} url - The URL to navigate to after confetti animation
 */
function triggerConfettiTo(url) {
    const confettiContainer = document.querySelector('#confetti-container');
    const prefersReducedMotion =
        globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Skip the celebratory confetti (and its 1.25 s navigation delay) when the
    // container is missing or the user asked for reduced motion — go straight
    // to the destination instead of making them wait for an animation.
    if (!confettiContainer || prefersReducedMotion) {
        if (!confettiContainer) console.warn('Confetti-Container nicht gefunden.');
        globalThis.location.href = url;
        return;
    }

    const colors = [
        '#f44336',
        '#e91e63',
        '#9c27b0',
        '#673ab7',
        '#3f51b5',
        '#2196f3',
        '#03a9f4',
        '#00bcd4',
        '#009688',
        '#4CAF50',
        '#8bc34a',
        '#cddc39',
        '#ffeb3b',
        '#ffc107',
        '#ff9800',
        '#ff5722',
    ];

    const numConfetti = 50;

    for (let i = 0; i < numConfetti; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.top = `${-20 - Math.random() * 100}px`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;

        confettiContainer.append(piece);

        piece.addEventListener('animationend', () => {
            piece.remove();
        });
    }

    setTimeout(function () {
        globalThis.location.href = url;
    }, 1250);
}

// Set up event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('#study-btn').addEventListener('click', (e) => {
        e.preventDefault();
        triggerConfettiTo('cards.html');
    });
    document.querySelector('#quiz-btn').addEventListener('click', (e) => {
        e.preventDefault();
        triggerConfettiTo('quiz.html');
    });
});
