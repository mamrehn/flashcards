'use strict';

/**
 * Unit tests for the pure, side-effect-free helpers in cards.js.
 * Run with `npm test` (node --test). cards.js guards its browser-only top-level
 * code, so it can be require()'d here without a DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    projectSR,
    cardKnowledge,
    scoreMultipleChoice,
    normalizeAnswer,
    dedupeCardsByQuestion,
    validateCards,
    cardType,
    canonicalLabel,
    acceptedAnswers,
    foldIdentitySet,
    isSafeMediaSrc,
    isPoolOnlyIdentify,
    SR_STEP_MINUTES,
    SR_PASS_SCORE,
} = require('../cards.js');

// A tiny but structurally valid inline image data URI for media tests.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('projectSR: perfect recall jumps two ladder steps', () => {
    assert.deepEqual(projectSR(0, 1), { step: 2, waitMinutes: SR_STEP_MINUTES[2] });
});

test('projectSR: a pass advances one step', () => {
    assert.deepEqual(projectSR(1, SR_PASS_SCORE), { step: 2, waitMinutes: SR_STEP_MINUTES[2] });
});

test('projectSR: partial recall keeps the step but reviews sooner', () => {
    const result = projectSR(3, 0.6);
    assert.equal(result.step, 3);
    assert.ok(result.waitMinutes < SR_STEP_MINUTES[3]);
    assert.ok(result.waitMinutes >= SR_STEP_MINUTES[0]);
});

test('projectSR: a fail resets to the first step', () => {
    assert.deepEqual(projectSR(5, 0.2), { step: 0, waitMinutes: SR_STEP_MINUTES[0] });
});

test('projectSR: advancing never exceeds the last step', () => {
    const last = SR_STEP_MINUTES.length - 1;
    assert.equal(projectSR(last, 1).step, last);
});

test('scoreMultipleChoice: exact set match scores 1', () => {
    assert.equal(scoreMultipleChoice([0, 2, 4], [0, 2, 4]), 1);
});

test('scoreMultipleChoice: selecting nothing when nothing is correct scores 1', () => {
    assert.equal(scoreMultipleChoice([], []), 1);
});

test('scoreMultipleChoice: a single-correct question with one extra wrong tick is penalised', () => {
    // Old per-option scheme gave 4/5 = 0.8 (a pass); Jaccard gives 1/2 = 0.5.
    assert.equal(scoreMultipleChoice([2], [2, 0]), 0.5);
    assert.ok(scoreMultipleChoice([2], [2, 0]) < SR_PASS_SCORE);
});

test('scoreMultipleChoice: missing a required option lowers the score', () => {
    assert.equal(scoreMultipleChoice([0, 1], [0]), 0.5);
});

test('scoreMultipleChoice: selecting nothing scores 0', () => {
    assert.equal(scoreMultipleChoice([1], []), 0);
});

test('normalizeAnswer: case, whitespace and trailing punctuation are ignored', () => {
    assert.equal(normalizeAnswer('Berlin.'), normalizeAnswer('berlin'));
    assert.equal(normalizeAnswer('  der   Bundestag '), 'der bundestag');
    assert.equal(normalizeAnswer('Was?!'), 'was');
});

test('normalizeAnswer: tolerates non-strings', () => {
    assert.equal(normalizeAnswer(undefined), '');
    assert.equal(normalizeAnswer(null), '');
});

test('dedupeCardsByQuestion: duplicate questions collapse, last content wins', () => {
    const cards = [
        { question: 'Q1', answer: 'old' },
        { question: 'Q2', answer: 'keep' },
        { question: 'Q1', answer: 'new' },
    ];
    const result = dedupeCardsByQuestion(cards);
    assert.equal(result.length, 2);
    const q1 = result.find((c) => c.question === 'Q1');
    assert.equal(q1.answer, 'new');
});

test('validateCards: keeps valid shapes, drops invalid, then de-duplicates', () => {
    const cards = [
        { question: 'Text', answer: 'A' },
        { question: 'NoAnswer' },
        { question: 'MC', options: ['a', 'b'], correct: [0] },
        { question: 'BadMC', options: ['a'], correct: [5] },
        { question: 'Text', answer: 'A2' }, // duplicate question, newer
    ];
    const result = validateCards(cards);
    const questions = result.map((c) => c.question).sort();
    assert.deepEqual(questions, ['MC', 'Text']);
    assert.equal(result.find((c) => c.question === 'Text').answer, 'A2');
});

test('cardKnowledge: empty history is zero, strong history is high', () => {
    assert.equal(cardKnowledge({ history: [] }), 0);
    assert.equal(cardKnowledge(null), 0);
    const strong = cardKnowledge({ history: [1, 1, 1], step: 4 });
    assert.ok(strong >= 0.8, `expected strong knowledge, got ${strong}`);
    const weak = cardKnowledge({ history: [0, 0, 0], step: 0 });
    assert.ok(weak < strong);
});

// ---------------------------------------------------------------------------
// Identify card type
// ---------------------------------------------------------------------------

test('cardType: explicit type wins; legacy shapes still infer correctly', () => {
    assert.equal(cardType({ type: 'identify', labels: { name: 'X' }, media: IMG }), 'identify');
    assert.equal(cardType({ type: 'IDENTIFY' }), 'identify'); // case-insensitive
    // Back-compat: no type field → infer from shape exactly as before.
    assert.equal(cardType({ question: 'Q', pairs: [] }), 'matching');
    assert.equal(cardType({ question: 'Q', options: ['a'], correct: [0] }), 'mc');
    assert.equal(cardType({ question: 'Q', answer: 'A' }), 'text');
    // Shape fallback for identify (labels + media, no explicit type).
    assert.equal(cardType({ labels: { name: 'X' }, media: IMG }), 'identify');
});

test('isSafeMediaSrc: allows image data URIs and http(s), rejects scripts', () => {
    assert.ok(isSafeMediaSrc(IMG));
    assert.ok(isSafeMediaSrc('https://example.com/a.png'));
    assert.ok(!isSafeMediaSrc('javascript:alert(1)'));
    assert.ok(!isSafeMediaSrc('data:text/html;base64,AAAA'));
    assert.ok(!isSafeMediaSrc(''));
    assert.ok(!isSafeMediaSrc(null));
});

test('canonicalLabel: joins labelParts in order', () => {
    const card = { labels: { firstName: 'David', lastName: 'Adam' } };
    const cfg = { labelParts: ['firstName', 'lastName'] };
    assert.equal(canonicalLabel(card, cfg), 'David Adam');
    // Missing parts are skipped, order preserved.
    assert.equal(canonicalLabel({ labels: { lastName: 'Adam' } }, cfg), 'Adam');
});

test('acceptedAnswers: anyPart accepts each part and the full name', () => {
    const card = { labels: { firstName: 'David', lastName: 'Adam' } };
    const cfg = { labelParts: ['firstName', 'lastName'], accept: 'anyPart' };
    const acc = acceptedAnswers(card, cfg);
    assert.ok(acc.has(normalizeAnswer('David')));
    assert.ok(acc.has(normalizeAnswer('Adam')));
    assert.ok(acc.has(normalizeAnswer('David Adam')));
    assert.ok(!acc.has(normalizeAnswer('Kevin')));
});

test('acceptedAnswers: full only accepts the full name; allParts allows reorder', () => {
    const card = { labels: { firstName: 'David', lastName: 'Adam' } };
    const full = acceptedAnswers(card, {
        labelParts: ['firstName', 'lastName'],
        accept: 'full',
    });
    assert.ok(full.has(normalizeAnswer('David Adam')));
    assert.ok(!full.has(normalizeAnswer('David')));

    const allParts = acceptedAnswers(card, {
        labelParts: ['firstName', 'lastName'],
        accept: 'allParts',
    });
    assert.ok(allParts.has(normalizeAnswer('David Adam')));
    assert.ok(allParts.has(normalizeAnswer('Adam David')));
    assert.ok(!allParts.has(normalizeAnswer('David')));
});

test('acceptedAnswers: per-card accept overrides add nicknames', () => {
    const card = { labels: { firstName: 'David', lastName: 'Adam' }, accept: ['Dave'] };
    const acc = acceptedAnswers(card, { labelParts: ['firstName', 'lastName'], accept: 'full' });
    assert.ok(acc.has(normalizeAnswer('Dave')));
});

test('foldIdentitySet: folds set config and synthesizes the question key', () => {
    const data = {
        set: { labelParts: ['firstName', 'lastName'], prompt: 'Wer?' },
        cards: [
            { type: 'identify', media: IMG, labels: { firstName: 'David', lastName: 'Adam' } },
            { question: 'Plain', answer: 'A' }, // untouched
        ],
    };
    const [id, plain] = foldIdentitySet(data);
    assert.equal(id.question, 'David Adam'); // synthesized from labels
    assert.equal(id.identify.prompt, 'Wer?'); // folded from set
    assert.equal(id.identify.accept, 'anyPart'); // default merged in
    assert.deepEqual(plain, { question: 'Plain', answer: 'A' }); // non-identify unchanged
});

test('validateCards: accepts a folded identify card, rejects broken ones', () => {
    const good = foldIdentitySet({
        set: { labelParts: ['firstName', 'lastName'] },
        cards: [{ type: 'identify', media: IMG, labels: { firstName: 'David', lastName: 'Adam' } }],
    });
    assert.equal(validateCards(good).length, 1);

    // Absent media → kept (pool-only distractor), not rejected.
    const noMedia = foldIdentitySet({
        set: { labelParts: ['name'] },
        cards: [{ type: 'identify', labels: { name: 'X' } }],
    });
    assert.equal(validateCards(noMedia).length, 1);
    assert.ok(isPoolOnlyIdentify(validateCards(noMedia)[0]));

    // Unsafe media → rejected.
    const badMedia = foldIdentitySet({
        set: { labelParts: ['name'] },
        cards: [{ type: 'identify', media: 'javascript:1', labels: { name: 'X' } }],
    });
    assert.equal(validateCards(badMedia).length, 0);

    // No usable label → rejected.
    const noLabel = foldIdentitySet({
        set: { labelParts: ['name'] },
        cards: [{ type: 'identify', media: IMG, labels: { name: '' } }],
    });
    assert.equal(validateCards(noLabel).length, 0);
});

test('pool-only: a media:null identify card is valid but flagged pool-only', () => {
    // A classmate with no photo — kept so its name can be a distractor.
    const folded = foldIdentitySet({
        set: { labelParts: ['firstName', 'lastName'] },
        cards: [
            { type: 'identify', media: null, labels: { firstName: 'Kevin', lastName: 'Engler' } },
        ],
    });
    const valid = validateCards(folded);
    assert.equal(valid.length, 1); // stored (reachable by the pool)
    assert.equal(valid[0].question, 'Kevin Engler'); // still keyed by name
    assert.ok(isPoolOnlyIdentify(valid[0])); // but not quizzable
});

test('isPoolOnlyIdentify: only media-less identify cards qualify', () => {
    assert.ok(isPoolOnlyIdentify({ type: 'identify', media: null, labels: { name: 'X' } }));
    assert.ok(isPoolOnlyIdentify({ type: 'identify', labels: { name: 'X' } })); // media absent
    assert.ok(!isPoolOnlyIdentify({ type: 'identify', media: IMG, labels: { name: 'X' } }));
    assert.ok(!isPoolOnlyIdentify({ question: 'Q', answer: 'A' })); // not identify
});
