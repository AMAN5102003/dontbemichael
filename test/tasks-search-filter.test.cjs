'use strict';

/**
 * Tests for Tasks Kanban search and filters (GitHub Issue #158).
 * Ensures users can search tasks by title or keyword, and filter
 * by task status and assigned team member.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Tasks Kanban has search and filter controls in the UI', () => {
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');

  // Search input
  assert.match(kanban, /placeholder=\{t\('kanban\.searchPlaceholder'\)\}/);
  assert.match(kanban, /aria-label=\{t\('kanban\.searchAria'\)\}/);
  assert.match(kanban, /setSearchQuery\(e\.target\.value\)/);

  // Status filter select
  assert.match(kanban, /aria-label=\{t\('kanban\.filterStatus'\)\}/);
  assert.match(kanban, /setStatusFilter\(e\.target\.value as Status \| 'all'\)/);
  assert.match(kanban, /<option value="all">\{t\('kanban\.allStatuses'\)\}<\/option>/);

  // Member filter select
  assert.match(kanban, /aria-label=\{t\('kanban\.filterMember'\)\}/);
  assert.match(kanban, /setMemberFilter\(e\.target\.value\)/);
  assert.match(kanban, /<option value="all">\{t\('kanban\.allMembers'\)\}<\/option>/);
  assert.match(kanban, /<option value="unassigned">\{t\('kanban\.unassigned'\)\}<\/option>/);

  // Clear filters button
  assert.match(kanban, /\{t\('kanban\.clearFilters'\)\}/);
  assert.match(kanban, /t\('kanban\.showingFiltered', \{ count: filteredTasks\.length, total: tasks\.length \}\)/);
});

test('Search and filter localization keys exist in en, ar, and zh-CN', () => {
  const keys = [
    'searchPlaceholder',
    'searchAria',
    'filterStatus',
    'filterMember',
    'allStatuses',
    'allMembers',
    'clearFilters',
    'showingFiltered',
    'noMatchingTasks'
  ];

  for (const loc of ['en', 'ar', 'zh-CN']) {
    const k = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;
    for (const key of keys) {
      assert.ok(k[key], `${loc} kanban.${key} exists`);
    }
    assert.match(k.showingFiltered, /\{\{count\}\}/, `${loc} showingFiltered count`);
    assert.match(k.showingFiltered, /\{\{total\}\}/, `${loc} showingFiltered total`);
  }
});

test('Search filters tasks by title, keyword (description, notes, waitingOn, assignee, id)', () => {
  const sampleTasks = [
    { id: '1', title: 'Prepare monthly invoice', description: 'Check Stripe logs', status: 'todo', assignee: 'pam' },
    { id: '2', title: 'Fix auth bug', description: 'Token expired', notes: 'Need OAuth client secret', status: 'doing', assignee: 'jim' },
    { id: '3', title: 'Customer onboarding', status: 'waiting', waitingOn: 'Dwight', assignee: 'angela' },
    { id: '4', title: 'Deploy release v1.0', status: 'done', assignee: undefined }
  ];

  function filterTasks(tasks, { q = '', status = 'all', member = 'all' } = {}) {
    const trimmed = q.trim().toLowerCase();
    const cleanQ = trimmed.replace(/^#/, '');
    return tasks.filter((task) => {
      if (status !== 'all' && task.status !== status) return false;
      if (member !== 'all') {
        if (member === 'unassigned') {
          if (task.assignee) return false;
        } else if (task.assignee !== member) {
          return false;
        }
      }
      if (trimmed) {
        const title = (task.title ?? '').toLowerCase();
        const desc = (task.description ?? '').toLowerCase();
        const notes = (task.notes ?? '').toLowerCase();
        const id = (task.id ?? '').toLowerCase().replace(/^#/, '');
        const waiting = (task.waitingOn ?? '').toLowerCase();
        const assignee = (task.assignee ?? '').toLowerCase();
        const matches =
          title.includes(trimmed) ||
          desc.includes(trimmed) ||
          notes.includes(trimmed) ||
          id.includes(cleanQ) ||
          waiting.includes(trimmed) ||
          assignee.includes(trimmed);
        if (!matches) return false;
      }
      return true;
    });
  }

  // Title search
  assert.equal(filterTasks(sampleTasks, { q: 'invoice' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: 'invoice' })[0].id, '1');

  // Description keyword search
  assert.equal(filterTasks(sampleTasks, { q: 'stripe' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: 'stripe' })[0].id, '1');

  // Notes keyword search
  assert.equal(filterTasks(sampleTasks, { q: 'oauth' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: 'oauth' })[0].id, '2');

  // WaitingOn keyword search
  assert.equal(filterTasks(sampleTasks, { q: 'dwight' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: 'dwight' })[0].id, '3');

  // ID search (with or without #)
  assert.equal(filterTasks(sampleTasks, { q: '2' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: '#2' }).length, 1);

  // Status filter
  assert.equal(filterTasks(sampleTasks, { status: 'doing' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { status: 'doing' })[0].title, 'Fix auth bug');

  // Member filter
  assert.equal(filterTasks(sampleTasks, { member: 'pam' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { member: 'pam' })[0].title, 'Prepare monthly invoice');

  // Unassigned filter
  assert.equal(filterTasks(sampleTasks, { member: 'unassigned' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { member: 'unassigned' })[0].title, 'Deploy release v1.0');

  // Combined filters
  assert.equal(filterTasks(sampleTasks, { q: 'bug', status: 'doing', member: 'jim' }).length, 1);
  assert.equal(filterTasks(sampleTasks, { q: 'bug', status: 'done' }).length, 0);
});
