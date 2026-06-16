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
    SR_STEP_MINUTES,
    SR_PASS_SCORE,
} = require('../cards.js');

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
