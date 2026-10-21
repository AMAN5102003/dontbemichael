'use strict';

/**
 * A render crash shows a short line and a Reload button, never a blank window.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./load-ts.cjs');

loadTs('src/renderer/src/i18n/index.ts');
const { ErrorBoundary } = loadTs('src/renderer/src/components/ErrorBoundary.tsx');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function Broken() {
  throw new Error('boom in a card');
}

test('a child that throws turns the window into the short recovery screen', (t) => {
  // Value: protects=a render crash shows a way back instead of a blank window; fails_when=the boundary stops catching or the fallback loses its line or button; why_new=main had no error boundary; seam=React's catch steps driven by hand, the server renderer runs no boundaries
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args); });

  let thrown;
  try { renderToStaticMarkup(createElement(Broken)); } catch (e) { thrown = e; }
  assert.ok(thrown, 'the child really throws');

  const boundary = new ErrorBoundary({ children: createElement(Broken) });
  assert.equal(boundary.state.failed, false);
  Object.assign(boundary.state, ErrorBoundary.getDerivedStateFromError(thrown));
  boundary.componentDidCatch(thrown, { componentStack: '\n    at Broken' });

  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /role="alert"/);
  assert.match(html, /Something went wrong on this screen\./);
  assert.match(html, />Reload</);
  assert.doesNotMatch(html, /boom in a card/, 'the owner never sees the raw error');
  assert.equal(logged.length, 1, 'the error goes to the console');
  assert.equal(logged[0][1], thrown);
});

test('a healthy screen passes straight through', () => {
  const html = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'All good')));
  assert.equal(html, '<p>All good</p>');
});

test('the whole app sits inside the boundary', () => {
  const main = read('src/renderer/src/main.tsx');
  assert.match(main, /<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/);
});

test('the recovery screen has its words in every language, with no dashes', () => {
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const crash = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).crash;
    for (const key of ['line', 'reload']) {
      assert.equal(typeof crash?.[key], 'string', `${loc}: crash.${key}`);
      assert.ok(crash[key].trim(), `${loc}: crash.${key} is not empty`);
      assert.doesNotMatch(crash[key], /[–—]| - /, `${loc}: crash.${key} has no dash`);
    }
  }
});
