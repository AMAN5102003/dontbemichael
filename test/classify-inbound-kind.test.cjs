'use strict';

/**
 * classifyInboundKind — the conservative heuristic that decides whether an
 * inbound webhook message is a directive (needs approval in communication-only
 * mode) or communication (flows through).
 *
 * The function deliberately leans toward 'directive': anything it isn't
 * confident is chatter is treated as a directive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { classifyInboundKind } = loadTs('src/shared/triggers.ts');

/* ── empty / whitespace → communication ──────────────────────────────── */

test('empty text is communication', () => {
  assert.equal(classifyInboundKind(''), 'communication');
});

/* ── "can you" / "could you" / "would you" / "will you" → directive ── */

test('"Can you pay the invoice?" is a directive', () => {
  assert.equal(classifyInboundKind('Can you pay the invoice?'), 'directive');
});

test('"Could you email the client the quote?" is a directive', () => {
  assert.equal(classifyInboundKind('Could you email the client the quote?'), 'directive');
});

test('"Can you approve the PR?" is a directive', () => {
  assert.equal(classifyInboundKind('Can you approve the PR?'), 'directive');
});

test('"Can you see the dashboard?" is a directive (held, safe side)', () => {
  assert.equal(classifyInboundKind('Can you see the dashboard?'), 'directive');
});

test('"Would you restart the worker?" is a directive', () => {
  assert.equal(classifyInboundKind('Would you restart the worker?'), 'directive');
});

test('"Will you send the report?" is a directive', () => {
  assert.equal(classifyInboundKind('Will you send the report?'), 'directive');
});

test('"Could you please deploy the new build?" is a directive', () => {
  assert.equal(classifyInboundKind('Could you please deploy the new build?'), 'directive');
});

test('"Can you please stop the process?" is a directive', () => {
  assert.equal(classifyInboundKind('Can you please stop the process?'), 'directive');
});

/* ── "please" anywhere → directive ───────────────────────────────────── */

test('"Please stop the deploy pipeline." is a directive', () => {
  assert.equal(classifyInboundKind('Please stop the deploy pipeline.'), 'directive');
});

/* ── pure questions (no request pattern) → communication ─────────────── */

test('"What is the status of the release?" is communication', () => {
  assert.equal(classifyInboundKind('What is the status of the release?'), 'communication');
});

test('"Is the test suite green?" is communication', () => {
  assert.equal(classifyInboundKind('Is the test suite green?'), 'communication');
});

test('"Who is on call today?" is communication', () => {
  assert.equal(classifyInboundKind('Who is on call today?'), 'communication');
});

test('"How long has the job been running?" is communication', () => {
  assert.equal(classifyInboundKind('How long has the job been running?'), 'communication');
});

/* ── question-word + original verb → directive ───────────────────────── */

test('"Can you deploy the new build?" is a directive (original verb)', () => {
  assert.equal(classifyInboundKind('Can you deploy the new build?'), 'directive');
});

test('"Could you delete the old logs?" is a directive (original verb)', () => {
  assert.equal(classifyInboundKind('Could you delete the old logs?'), 'directive');
});

test('a question-word sentence with "deploy" is a directive', () => {
  assert.equal(classifyInboundKind('Did anyone deploy the hotfix?'), 'directive');
});

/* ── bare imperatives are always directives ───────────────────────────── */

test('a bare imperative is a directive', () => {
  assert.equal(classifyInboundKind('Start the server'), 'directive');
});

test('a statement (no ?) is a directive', () => {
  assert.equal(classifyInboundKind('The build is broken, fix it now.'), 'directive');
});
