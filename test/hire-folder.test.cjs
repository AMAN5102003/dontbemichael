'use strict';

/**
 * Hiring after setup (owner, 2026-09-25): the hire dialog has the same Role,
 * Role description and Work style fields as Edit Agent, and on a business
 * install a new team member's folder goes inside Michael's, named after the
 * role, so same-role hires share it. Michael's folder and the Office can't be a
 * team member's own folder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const modal = read('src/renderer/src/components/AddAgentModal.tsx');
const wizard = read('src/renderer/src/components/OnboardingWizard.tsx');
const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));

test('the hire wizard asks for Role and what they will do, stored as Role: description', () => {
  for (const key of ['addAgent.role', 'addAgent.roleHelp', 'jobChange.whatWillDo', 'jobChange.handles']) {
    assert.match(modal, new RegExp(`tr\\('${key.replace('.', '\\.')}'`), key);
  }
  assert.match(modal, /const description = hireRole\(title, routing\);/, 'stored as Role: description');
  assert.match(modal, /const split = splitAgentRole\(m\.description\);/, 'an imported hire fills both fields');
  assert.equal(en.addAgent.description, undefined, 'the old Description field is gone');
});

test('a new team member gets its own folder inside Michael\'s, suffixed with its name on a clash', () => {
  assert.match(modal, /const michaelFolder = config\.businessFolder;/);
  assert.match(modal, /window\.cth\.foldersExist\(michaelFolder, candidates\)/);
  assert.match(modal, /setFolderName\(hireFolderName\(base, n, \(f\) => !!onDisk\[f\] \|\| used\.has\(f\.toLowerCase\(\)\)\)\)/, 'on disk or used by a teammate');
  assert.match(modal, /if \(michaelFolder && !customCwd\) \{\s*const \[made\] = await window\.cth\.foldersEnsure\(\[cwd\]\)/, 'made on hire, never overwritten');
});

test('Michael\'s folder is never a team member\'s own folder', () => {
  assert.match(modal, /if \(michaelFolder && samePath\(michaelFolder, cwd\)\)/);
  assert.match(wizard, /key !== OFFICE_KEY && same\(michaelFolderFor\(folderSuggestions, folderOverrides\)\)/);
  assert.doesNotMatch(en.addAgent.errFolderShared, /[–—]/);
});
