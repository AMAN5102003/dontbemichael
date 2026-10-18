'use strict';

/**
 * Right-click a link in the app and "Copy link address" copies its real
 * address (TODOS.md, named links D4). A named link shows "HubSpot", so
 * selecting its text copies the name, not the URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { copyableLink, menuLabel, DEFAULT_COPY_LINK_LABEL } = loadTs('src/shared/linkMenu.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('web and email links get the menu, with the address as given', () => {
  // Value: protects=the copied text is the link's address; fails_when=a web or email link gets no menu or a changed address; why_new=no context menu existed; seam=none; no_claim=the native menu itself
  assert.equal(copyableLink('https://app.hubspot.com/contacts/1/record/0-2/18164826678'), 'https://app.hubspot.com/contacts/1/record/0-2/18164826678');
  assert.equal(copyableLink('http://example.com/a?b=c#d'), 'http://example.com/a?b=c#d');
  assert.equal(copyableLink('HTTPS://Example.com'), 'HTTPS://Example.com');
  assert.equal(copyableLink('mailto:francis@example.com'), 'mailto:francis@example.com');
  assert.equal(copyableLink('  https://x.io/a  '), 'https://x.io/a');
});

test('anything that is not a web or email link gets no menu', () => {
  // Value: protects=only the schemes the app opens are offered; fails_when=file, script or app page links get a menu; why_new=no context menu existed; seam=none; no_claim=the native menu itself
  for (const url of ['', '   ', 'file:///Users/me/notes.md', 'javascript:alert(1)', 'http://', 'mailto:', 'ftp://x.io', 'about:blank', 'app.hubspot.com/contacts/1']) {
    assert.equal(copyableLink(url), null, url);
  }
  for (const v of [undefined, null, 42, {}]) assert.equal(copyableLink(v), null);
});

test('the label the renderer sends becomes one short line, else the default', () => {
  // Value: protects=the menu always has a readable label; fails_when=an empty, multi line or non text label reaches the menu; why_new=the label comes over IPC; seam=none; no_claim=translation quality
  assert.equal(menuLabel('نسخ عنوان الرابط'), 'نسخ عنوان الرابط');
  assert.equal(menuLabel('  Copy\nlink   address '), 'Copy link address');
  assert.equal(menuLabel('x'.repeat(200)).length, 60);
  for (const v of ['', '  ', undefined, null, 7]) assert.equal(menuLabel(v), DEFAULT_COPY_LINK_LABEL);
});

test('every language has the label, and main and the app are wired to it', () => {
  // Value: protects=the label is translated and reaches main; fails_when=a locale misses the key or the menu or sync is unhooked; why_new=new key and IPC; seam=source pin like the neighbouring tests, no IPC harness; no_claim=runtime menu display
  for (const lng of ['en', 'zh-CN', 'ar']) {
    const label = JSON.parse(read(`src/renderer/src/i18n/locales/${lng}.json`)).markdown.copyLinkAddress;
    assert.ok(typeof label === 'string' && label.trim(), lng);
  }
  const main = read('src/main/index.ts');
  assert.match(main, /webContents\.on\('context-menu'[\s\S]{0,200}copyableLink\(params\.linkURL\)/);
  assert.match(main, /ipcMain\.on\('app:setCopyLinkLabel'/);
  assert.match(read('src/renderer/src/App.tsx'), /useCopyLinkLabelSync\(\);/);
});
