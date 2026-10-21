'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { onWindows } = require('./platform.cjs');

const { linkWorktreeDeps, unlinkWorktreeDeps } = loadTs('src/main/worktreeDeps.ts');
const { removeWorktree } = loadTs('src/main/git.ts');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makeHarness() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-worktree-deps-'));
  const repo = path.join(home, 'repo with spaces');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const wtRoot = path.join(home, 'worktrees with spaces');
  fs.mkdirSync(wtRoot);
  return { repo, wtRoot };
}

function addWorktree(repo, wtRoot, name) {
  const wtPath = path.join(wtRoot, name);
  git(repo, 'worktree', 'add', '-q', wtPath, '-b', `agent/${name}`, 'main');
  return wtPath;
}

function parentAlias(repo, wtRoot) {
  const alias = path.join(wtRoot, 'parent alias');
  fs.symlinkSync(path.dirname(repo), alias, onWindows ? 'junction' : 'dir');
  return alias;
}

test('links the base node_modules into an isolated worktree', async () => {
  const { repo, wtRoot } = makeHarness();
  const baseNodeModules = path.join(repo, 'node_modules');
  fs.mkdirSync(baseNodeModules);
  fs.writeFileSync(path.join(baseNodeModules, 'sentinel.txt'), 'base\n');
  const wtPath = addWorktree(repo, wtRoot, 'agent-a');

  const result = await linkWorktreeDeps(repo, wtPath);

  assert.deepEqual(result, { ok: true, skipped: false });
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true);
  // A Windows junction reads back with a trailing separator.
  assert.equal(path.resolve(fs.readlinkSync(worktreeNodeModules)), baseNodeModules);
  assert.equal(fs.readFileSync(path.join(worktreeNodeModules, 'sentinel.txt'), 'utf8'), 'base\n');
});

test('skips linking when the base checkout has no node_modules', async () => {
  const { repo, wtRoot } = makeHarness();
  const wtPath = addWorktree(repo, wtRoot, 'agent-b');

  const result = await linkWorktreeDeps(repo, wtPath);

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.throws(() => fs.lstatSync(path.join(wtPath, 'node_modules')), /ENOENT/);
});

test('does not replace an existing worktree node_modules entry', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const wtPath = addWorktree(repo, wtRoot, 'agent-c');
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  fs.mkdirSync(worktreeNodeModules);
  fs.writeFileSync(path.join(worktreeNodeModules, 'own.txt'), 'own\n');

  const result = await linkWorktreeDeps(repo, wtPath);

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(worktreeNodeModules, 'own.txt'), 'utf8'), 'own\n');
});

test('does not follow the dependency symlink when removing a worktree', async () => {
  const { repo, wtRoot } = makeHarness();
  const baseNodeModules = path.join(repo, 'node_modules');
  fs.mkdirSync(baseNodeModules);
  const sentinel = path.join(baseNodeModules, 'must-survive.txt');
  fs.writeFileSync(sentinel, 'still here\n');
  const wtPath = addWorktree(repo, wtRoot, 'agent-d');

  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true, 'symlink must exist before removal');
  assert.deepEqual(await removeWorktree(repo, wtPath), { ok: true });

  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'still here\n');
  assert.equal(fs.existsSync(wtPath), false);
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('agent/agent-d'), false);
});

test('refuses removal with a dependency link to a foreign directory', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const foreign = path.join(wtRoot, 'foreign dependencies');
  fs.mkdirSync(foreign);
  const sentinel = path.join(foreign, 'must-survive.txt');
  fs.writeFileSync(sentinel, 'foreign dependencies\n');
  const wtPath = addWorktree(repo, wtRoot, 'foreign-link');
  const link = path.join(wtPath, 'node_modules');
  fs.symlinkSync(foreign, link, onWindows ? 'junction' : 'dir');

  const result = await removeWorktree(repo, wtPath);

  assert.equal(result.ok, false, 'a foreign link must not reach recursive Git removal');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'foreign dependencies\n');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('agent/foreign-link'), true);
});

test('does not unlink dependencies in an unregistered directory', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const outside = path.join(wtRoot, 'not a worktree');
  fs.mkdirSync(outside);
  assert.deepEqual(await linkWorktreeDeps(repo, outside), { ok: true, skipped: false });

  assert.equal((await removeWorktree(repo, outside)).ok, false);
  assert.equal(fs.lstatSync(path.join(outside, 'node_modules')).isSymbolicLink(), true);
});

test('does not unlink dependencies when Git refuses a locked worktree', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const wtPath = addWorktree(repo, wtRoot, 'locked');
  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });
  git(repo, 'worktree', 'lock', '--reason', 'keep this checkout', wtPath);

  assert.equal((await removeWorktree(repo, wtPath)).ok, false);
  assert.equal(fs.lstatSync(path.join(wtPath, 'node_modules')).isSymbolicLink(), true);
});

test('does not change dependency links in the main checkout', async () => {
  const { repo, wtRoot } = makeHarness();
  const deps = path.join(wtRoot, 'shared dependencies');
  fs.mkdirSync(deps);
  fs.writeFileSync(path.join(deps, 'must-survive.txt'), 'shared dependencies\n');
  const link = path.join(repo, 'node_modules');
  fs.symlinkSync(deps, link, onWindows ? 'junction' : 'dir');

  assert.equal((await removeWorktree(repo, repo)).ok, false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(deps, 'must-survive.txt'), 'utf8'), 'shared dependencies\n');
});

test('refuses removal with a dangling dependency link', async () => {
  const { repo, wtRoot } = makeHarness();
  const wtPath = addWorktree(repo, wtRoot, 'dangling');
  const link = path.join(wtPath, 'node_modules');
  fs.symlinkSync(path.join(wtRoot, 'missing dependencies'), link, onWindows ? 'junction' : 'dir');

  assert.equal((await removeWorktree(repo, wtPath)).ok, false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('agent/dangling'), true);
});

test('force removal still removes dirty worktrees with their own dependencies', async () => {
  const { repo, wtRoot } = makeHarness();
  const wtPath = addWorktree(repo, wtRoot, 'dirty');
  fs.mkdirSync(path.join(wtPath, 'node_modules'));
  fs.writeFileSync(path.join(wtPath, 'node_modules', 'own.txt'), 'own dependency\n');
  fs.writeFileSync(path.join(wtPath, 'README.md'), 'uncommitted edit\n');
  fs.writeFileSync(path.join(wtPath, 'untracked.txt'), 'untracked\n');

  assert.deepEqual(await removeWorktree(repo, wtPath), { ok: true });
  assert.equal(fs.existsSync(wtPath), false);
});

test('removes dependencies safely when the worktree argument is relative to cwd', async () => {
  const { repo, wtRoot } = makeHarness();
  const deps = path.join(repo, 'node_modules');
  fs.mkdirSync(deps);
  fs.writeFileSync(path.join(deps, 'must-survive.txt'), 'base dependencies\n');
  const wtPath = addWorktree(repo, wtRoot, 'relative');
  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });

  assert.deepEqual(await removeWorktree(repo, path.relative(repo, wtPath)), { ok: true });
  assert.equal(fs.readFileSync(path.join(deps, 'must-survive.txt'), 'utf8'), 'base dependencies\n');
  assert.equal(fs.existsSync(wtPath), false);
});

test('removes a registered worktree through an aliased parent directory', async () => {
  const { repo, wtRoot } = makeHarness();
  const deps = path.join(repo, 'node_modules');
  fs.mkdirSync(deps);
  fs.writeFileSync(path.join(deps, 'must-survive.txt'), 'base dependencies\n');
  const wtPath = addWorktree(repo, wtRoot, 'aliased');
  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });
  const alias = parentAlias(repo, wtRoot);
  const aliasedRepo = path.join(alias, path.basename(repo));
  const aliasedWorktree = path.join(alias, path.basename(wtRoot), path.basename(wtPath));

  assert.deepEqual(await removeWorktree(aliasedRepo, aliasedWorktree), { ok: true });
  assert.equal(fs.existsSync(wtPath), false);
  assert.equal(fs.readFileSync(path.join(deps, 'must-survive.txt'), 'utf8'), 'base dependencies\n');
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('agent/aliased'), false);
});

test('recognizes a locked worktree through an aliased parent directory', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const wtPath = addWorktree(repo, wtRoot, 'aliased-locked');
  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });
  git(repo, 'worktree', 'lock', wtPath);
  const alias = parentAlias(repo, wtRoot);
  const aliasedWorktree = path.join(alias, path.basename(wtRoot), path.basename(wtPath));

  assert.deepEqual(await removeWorktree(repo, aliasedWorktree), { ok: false, error: 'worktree is locked' });
  assert.equal(fs.lstatSync(path.join(wtPath, 'node_modules')).isSymbolicLink(), true);
});

test('refuses the main checkout through an aliased parent directory', async () => {
  const { repo, wtRoot } = makeHarness();
  const deps = path.join(wtRoot, 'shared dependencies');
  fs.mkdirSync(deps);
  fs.writeFileSync(path.join(deps, 'must-survive.txt'), 'shared dependencies\n');
  const link = path.join(repo, 'node_modules');
  fs.symlinkSync(deps, link, onWindows ? 'junction' : 'dir');
  const alias = parentAlias(repo, wtRoot);

  assert.equal((await removeWorktree(repo, path.join(alias, path.basename(repo)))).ok, false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(deps, 'must-survive.txt'), 'utf8'), 'shared dependencies\n');
});

test('leaves a dangling worktree dependency symlink untouched', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const wtPath = addWorktree(repo, wtRoot, 'agent-e');
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  const missing = path.resolve('/does-not-exist'); // absolute on this platform
  fs.symlinkSync(missing, worktreeNodeModules);

  const result = await linkWorktreeDeps(repo, wtPath);

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(fs.readlinkSync(worktreeNodeModules), missing);
});

test('reports a failed link without throwing', async () => {
  const { repo } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const notADirectory = path.join(repo, 'not-a-directory');
  fs.writeFileSync(notADirectory, 'file\n');

  const result = await linkWorktreeDeps(repo, notADirectory);

  assert.equal(result.ok, false);
  // Windows names a link under a file ENOENT; POSIX says EEXIST or ENOTDIR.
  assert.match(result.error, onWindows ? /ENOENT/ : /EEXIST|ENOTDIR/);
});

test('removes only the linked dependencies before checking worktree status', async () => {
  const { repo, wtRoot } = makeHarness();
  const baseNodeModules = path.join(repo, 'node_modules');
  fs.mkdirSync(baseNodeModules);
  // Git lists a Windows junction as a folder, and an empty folder is never untracked.
  fs.writeFileSync(path.join(baseNodeModules, 'dep.txt'), 'dep\n');
  const wtPath = addWorktree(repo, wtRoot, 'agent-f');
  const worktreeNodeModules = path.join(wtPath, 'node_modules');

  assert.deepEqual(await linkWorktreeDeps(repo, wtPath), { ok: true, skipped: false });
  assert.notEqual(git(wtPath, 'status', '--porcelain'), '', 'the unignored link makes the worktree dirty');

  assert.deepEqual(await unlinkWorktreeDeps(repo, wtPath), { ok: true, removed: true });
  assert.throws(() => fs.lstatSync(worktreeNodeModules), /ENOENT/);
  assert.equal(git(wtPath, 'status', '--porcelain'), '', 'removing the link restores a clean worktree');
  assert.equal(fs.existsSync(baseNodeModules), true, 'the base dependencies must remain');
});

test('does not remove a real worktree node_modules directory', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const wtPath = addWorktree(repo, wtRoot, 'agent-g');
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  fs.mkdirSync(worktreeNodeModules);
  const sentinel = path.join(worktreeNodeModules, 'must-survive.txt');
  fs.writeFileSync(sentinel, 'worktree dependencies\n');

  const result = await unlinkWorktreeDeps(repo, wtPath);
  assert.equal(fs.lstatSync(worktreeNodeModules).isDirectory(), true);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'worktree dependencies\n');
  assert.deepEqual(result, { ok: true, removed: false });
});

test('does not remove a worktree node_modules link to another directory', async () => {
  const { repo, wtRoot } = makeHarness();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  const foreignNodeModules = path.join(repo, 'foreign-node-modules');
  fs.mkdirSync(foreignNodeModules);
  const sentinel = path.join(foreignNodeModules, 'must-survive.txt');
  fs.writeFileSync(sentinel, 'foreign dependencies\n');
  const wtPath = addWorktree(repo, wtRoot, 'agent-h');
  const worktreeNodeModules = path.join(wtPath, 'node_modules');
  fs.symlinkSync(foreignNodeModules, worktreeNodeModules);

  const result = await unlinkWorktreeDeps(repo, wtPath);
  assert.equal(fs.lstatSync(worktreeNodeModules).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(worktreeNodeModules), foreignNodeModules);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'foreign dependencies\n');
  assert.deepEqual(result, { ok: true, removed: false });
});

test('wires dependency linking into successful isolated worktree creation', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const activeSource = indexSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  assert.match(activeSource, /from ['"]\.\/worktreeDeps['"]/);
  const successBranch = activeSource.slice(
    activeSource.indexOf('if (wt.ok)'),
    activeSource.indexOf('} else {', activeSource.indexOf('if (wt.ok)'))
  );
  assert.match(successBranch, /await linkWorktreeDeps\(origCwd, wtPath\)/);
});

test('removes linked dependencies before worker retention checks', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const activeSource = indexSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  const beforeRetention = activeSource.slice(0, activeSource.indexOf('const work = await worktreeHasUnintegratedWork'));
  assert.match(beforeRetention, /await unlinkWorktreeDeps\(origCwd, wtPath\)/);
  const beforeGc = activeSource.slice(0, activeSource.indexOf('safe = await worktreeIsGcSafe'));
  assert.match(beforeGc, /await unlinkWorktreeDeps\(e\.origCwd, e\.wtPath\)/);
});

test('uses a Windows junction for the directory link', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/main/worktreeDeps.ts'), 'utf8');

  assert.match(source, /process\.platform === ['"]win32['"] \? ['"]junction['"] :/);
});
