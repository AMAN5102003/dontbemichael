'use strict';

/**
 * 2026-10-11 (#131): saving a webhook body format that does not parse showed
 * the owner the plain words callout, but the parser's own message, which says
 * where the mistake is, was stored and then thrown away. Save now logs it to
 * the console once, keeps the same callout, and a valid schema clears it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const HELPER = 'src/renderer/src/components/triggers/schemaParseError.ts';
const EDITOR = 'src/renderer/src/components/triggers/WebhookSchemaEditor.tsx';

const { schemaParseError } = loadTs(HELPER);
const editor = fs.readFileSync(path.join(__dirname, '..', EDITOR), 'utf8');
// The body of save: from its declaration to the end of the function, searched
// from there on (the effect above it also says "if (!open)").
const saveStart = editor.indexOf('const save = () =>');
const save = editor.slice(saveStart, editor.indexOf('\n  };', saveStart));

function parserMessage(text) {
  try {
    JSON.parse(text);
  } catch (e) {
    return e.message;
  }
  throw new Error(`expected ${text} not to parse`);
}

test('a schema that does not parse gives the parser its own message', () => {
  // Value: protects=a developer can see where the mistake was; fails_when=the message is dropped or replaced with a generic one; why_new=the editor stored the message and never used it; seam=none
  for (const bad of ['{ "type": "object",', '{ type: "object" }', 'not json at all', '']) {
    assert.equal(schemaParseError(bad), parserMessage(bad), `message for ${JSON.stringify(bad)}`);
  }
});

test('a schema that parses gives no message', () => {
  // Value: protects=a valid schema is never treated as broken; fails_when=valid JSON reports a problem; why_new=the parse check moved into a helper; seam=none
  for (const good of ['{}', '{"type":"object","properties":{"name":{"type":"string"}}}', '[]', 'null']) {
    assert.equal(schemaParseError(good), null, `no message for ${good}`);
  }
});

test('save logs the parser message once, keeps the owner callout, and a valid schema clears it', () => {
  // Value: protects=the owner sees the same plain words while the console gets the detail; fails_when=save logs twice, logs nothing, persists a broken schema, or leaves the callout up after a valid save; why_new=save never logged; seam=source check, the editor is a React component
  assert.ok(saveStart !== -1 && save.includes('onSave(text);'), 'found the body of save');
  assert.match(editor, /const \[error, setError\] = useState\(false\);/, 'the error is a yes/no flag');

  const failed = save.slice(save.indexOf('if (problem !== null)'), save.indexOf('return;'));
  assert.match(save, /const problem = schemaParseError\(text\);/, 'save checks through the helper');
  assert.equal((save.match(/console\.error\(/g) ?? []).length, 1, 'save logs exactly once');
  assert.match(failed, /console\.error\([^;]*, problem\);/, 'the log carries the parser message');
  assert.match(failed, /setError\(true\);/, 'a failed save flags the error');
  assert.doesNotMatch(failed, /onSave\(/, 'a broken schema is never saved');

  const passed = save.slice(save.indexOf('return;'));
  assert.ok(passed.indexOf('setError(false);') !== -1, 'a valid save clears the error');
  assert.ok(passed.indexOf('setError(false);') < passed.indexOf('onSave(text);'), 'the error clears before the schema is saved');

  assert.match(editor, /\{error && <Callout>\{t\('webhooksSection\.notValidJson'\)\}<\/Callout>\}/, 'the owner still sees the plain words callout');
});
