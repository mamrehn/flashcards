/**
 * Confetti engine shared by the study app and the quiz.
 *
 * One full-screen canvas, one animation loop, simple physics: pieces are
 * launched in a cone, lose speed to air drag, then flutter down at a paper-like
 * terminal velocity while swaying and flipping (two-tone front/back). Three
 * intensities, so the celebration matches the achievement:
 *   confetti.pop(origin)   – a small burst from where the answer was given
 *   confetti.celebrate()   – two cannons from the bottom corners
 *   confetti.grand()       – cannons, a second volley and a gentle rain
 * Does nothing when the user prefers reduced motion.
 */
(function () {
    'use strict';

    // Curated, high-contrast on both themes; gold gets a metallic highlight.
    const PALETTE = ['#ff5d73', '#ffb627', '#4cc9f0', '#7b61ff', '#2ec4b6', '#f72585', '#e8c547'];
    const GOLD = '#e8c547';
    const MAX_PARTICLES = 700;
    const GRAVITY = 0.28; // px per frame² at 60 fps
    const DRAG = 0.985;

    let canvas = null;
    let ctx = null;
    let dpr = 1;
    let particles = [];
    let rafId = 0;
    let lastTime = 0;

    /** @returns {boolean} */
    function reducedMotion() {
        return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    }

    /**
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * A darker variant of a #rrggbb colour, used for the back of a piece.
     * @param {string} hex
     * @returns {string}
     */
    function shade(hex) {
        const n = Number.parseInt(hex.slice(1), 16);
        const r = Math.round(((n >> 16) & 255) * 0.78);
        const g = Math.round(((n >> 8) & 255) * 0.78);
        const b = Math.round((n & 255) * 0.78);
        return `rgb(${r}, ${g}, ${b})`;
    }

    /** Match the canvas to the viewport at device resolution (capped at 2×). */
    function resize() {
        dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        canvas.width = Math.round(globalThis.innerWidth * dpr);
        canvas.height = Math.round(globalThis.innerHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Lazily create the overlay canvas. */
    function ensureCanvas() {
        if (canvas) return;
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText =
            'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10000';
        document.body.append(canvas);
        ctx = canvas.getContext('2d');
        resize();
        globalThis.addEventListener('resize', resize);
    }

    /**
     * Create one piece.
     * @param {number} x
     * @param {number} y
     * @param {number} angle - launch direction in degrees (0 = right, 90 = up)
     * @param {number} spread - cone width in degrees
     * @param {number} speed - launch speed in px per frame
     * @param {number} lifeScale - lifetime multiplier (rain needs longer)
     * @returns {object}
     */
    function makeParticle(x, y, angle, spread, speed, lifeScale) {
        const dir = ((angle + rand(-spread / 2, spread / 2)) * Math.PI) / 180;
        const velocity = speed * rand(0.55, 1.1);
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        const roll = Math.random();
        let shape = 'paper';
        if (roll > 0.86) shape = 'sequin';
        else if (roll > 0.7) shape = 'streamer';
        return {
            x,
            y,
            vx: Math.cos(dir) * velocity,
            vy: -Math.sin(dir) * velocity,
            shape,
            color,
            back: shade(color),
            gold: color === GOLD,
            w: rand(6, 9),
            h: rand(10, 15),
            rotation: rand(0, Math.PI * 2),
            spin: rand(-0.12, 0.12),
            tilt: rand(0, Math.PI * 2),
            tiltSpeed: rand(0.08, 0.2),
            wobble: rand(0, Math.PI * 2),
            wobbleSpeed: rand(0.03, 0.07),
            sway: rand(0.6, 1.6),
            terminal: rand(1.8, 3.2),
            life: rand(2.2, 3.4) * lifeScale,
            age: 0,
        };
    }

    /**
     * Launch a cone of pieces.
     * @param {{x: number, y: number, angle: number, spread: number, speed: number,
     *   count: number, lifeScale?: number}} o
     */
    function launch({ x, y, angle, spread, speed, count, lifeScale = 1 }) {
        if (reducedMotion() || document.hidden) return;
        ensureCanvas();
        const room = MAX_PARTICLES - particles.length;
        for (let i = 0; i < Math.min(count, room); i++) {
            particles.push(makeParticle(x, y, angle, spread, speed, lifeScale));
        }
        if (!rafId) {
            lastTime = performance.now();
            rafId = requestAnimationFrame(frame);
        }
    }

    /**
     * Draw a single piece at its current state.
     * @param {object} p
     */
    function draw(p) {
        const flip = Math.cos(p.tilt);
        const fade = Math.min(1, (p.life - p.age) / 0.6);
        ctx.globalAlpha = Math.max(0, fade);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        if (p.shape === 'streamer') {
            // A thin curling strip.
            const curl = Math.sin(p.wobble * 3) * 5;
            ctx.strokeStyle = flip > 0 ? p.color : p.back;
            ctx.lineWidth = 2.6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, -p.h);
            ctx.quadraticCurveTo(curl, 0, 0, p.h);
            ctx.stroke();
        } else if (p.shape === 'sequin') {
            ctx.scale(Math.abs(flip) * 0.9 + 0.1, 1);
            ctx.fillStyle = flip > 0 ? p.color : p.back;
            ctx.beginPath();
            ctx.arc(0, 0, p.w * 0.55, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.scale(1, flip);
            ctx.fillStyle = flip > 0 ? p.color : p.back;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            // Metallic glint when a gold piece faces the viewer.
            if (p.gold && flip > 0.85) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * 0.35);
            }
        }
        ctx.restore();
    }

    /**
     * Advance and draw all pieces; stops itself when none are left.
     * @param {number} now
     */
    function frame(now) {
        // Frame-rate independent (60/90/120 Hz phones); clamp long gaps.
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        const k = dt * 60;
        const drag = DRAG ** k;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        const height = globalThis.innerHeight;
        particles = particles.filter((p) => {
            p.age += dt;
            p.vx *= drag;
            p.vy = Math.min(p.vy * drag + GRAVITY * k, p.terminal);
            p.wobble += p.wobbleSpeed * k;
            p.tilt += p.tiltSpeed * k;
            p.rotation += p.spin * k;
            p.x += (p.vx + Math.sin(p.wobble) * p.sway) * k;
            p.y += p.vy * k;
            if (p.age >= p.life || p.y > height + 40) return false;
            draw(p);
            return true;
        });
        ctx.globalAlpha = 1;

        if (particles.length > 0) {
            rafId = requestAnimationFrame(frame);
        } else {
            rafId = 0;
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        }
    }

    /**
     * Resolve an origin (element or point) to viewport coordinates.
     * @param {Element|{x: number, y: number}|null|undefined} origin
     * @returns {{x: number, y: number}}
     */
    function originPoint(origin) {
        if (origin && typeof origin.getBoundingClientRect === 'function') {
            const r = origin.getBoundingClientRect();
            if (r.width > 0 || r.height > 0)
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        } else if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
            return origin;
        }
        return { x: globalThis.innerWidth / 2, y: globalThis.innerHeight * 0.35 };
    }

    /**
     * Small burst from where the success happened (a correct answer).
     * @param {Element|{x: number, y: number}} [origin]
     */
    function pop(origin) {
        const { x, y } = originPoint(origin);
        launch({
            x,
            y,
            angle: 90,
            spread: 70,
            speed: rand(9, 12),
            count: Math.round(rand(34, 48)),
        });
    }

    /** Two cannons from the bottom corners, aimed inwards. */
    function celebrate() {
        const w = globalThis.innerWidth;
        const h = globalThis.innerHeight;
        const speed = Math.min(22, Math.max(15, h / 42));
        launch({ x: 0, y: h, angle: 62, spread: 30, speed, count: 90 });
        launch({ x: w, y: h, angle: 118, spread: 30, speed, count: 90 });
    }

    /** The big one: cannons, a second volley and a gentle rain from the top. */
    function grand() {
        celebrate();
        setTimeout(celebrate, 380);
        const w = globalThis.innerWidth;
        for (let i = 0; i < 6; i++) {
            setTimeout(
                () =>
                    launch({
                        x: rand(0, w),
                        y: -20,
                        angle: 270,
                        spread: 50,
                        speed: 2,
                        count: 18,
                        lifeScale: 2,
                    }),
                700 + i * 180
            );
        }
    }

    globalThis.confetti = { pop, celebrate, grand };
})();
