'use strict';

/**
 * Work style in two forms (owner, 2026-09-27): a plain description the owner
 * edits, instructions the agent gets (src/shared/workStyleText.ts).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const W = loadTs('src/shared/workStyleText.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const pack = JSON.parse(read('resources/packs/restaurant-food.json'));
const pam = pack.agents.find((a) => a.id === 'pam').workStyle;
const ctx = { name: 'Erin', title: 'Executive Admin', business: { name: 'Taco Shop', city: 'Austin' } };

test('the quick plain rewrite drops the agent-facing opening and markdown', () => {
  const plain = W.plainFallback(pam);
  assert.doesNotMatch(plain, /The owner set this work style|###|\{Business\}/);
  assert.match(plain, /^The job:/m);
  assert.match(plain, /^How the work is done:/m);
  assert.match(plain, /^Asks the owner first:/m);
});

test('the quick instructions rewrite restores the house opening and headings', () => {
  const back = W.instructionsFallback(W.plainFallback(pam), ctx);
  assert.match(back, /^The owner set this work style for your role at Taco Shop, Austin\./);
  for (const h of ['### The job', '### How to work', "### Needs the owner's approval"]) assert.ok(back.includes(h), h);
});

test('the instructions prompt carries the house prompting rules and the previous wording', () => {
  const p = W.toInstructionsPrompt('The job: sorts mail.', ctx, 'old text');
  assert.match(p, /Start with exactly this line: "The owner set this work style for your role at Taco Shop, Austin\."/);
  assert.match(p, /each with its reason after "because" or "so"/);
  assert.match(p, /no "must", "never" or "critical"/);
  assert.match(p, /without "try to" or "if possible"/);
  assert.match(p, /add no duties of your own/);
  assert.match(p, /under 300 words/);
  assert.match(p, /--- PREVIOUS WORK STYLE ---\nold text/);
  assert.match(W.toPlainPrompt(pam, ctx), /Write about the team member by role, never by name/);
  assert.equal(W.cleanAnswer('```\nhello\n```'), 'hello');
});

test('the wizard shows a picked job in plain words and hires with the instructions as written', () => {
  // Value: protects=the hire gets exactly the job the owner saw, with no second rewrite at Hire (work-style-change-request.md, D2); fails_when=Hire converts again or the picked job is not shown in plain words; why_new=the job became read only; seam=source pin
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /setInstructions\(copy\.workStyle, name\.trim\(\), copy\.title\);/);
  assert.doesNotMatch(modal, /to: 'instructions'/);
  const start = modal.indexOf('const submitHire = async');
  const flow = modal.slice(start, modal.indexOf('\n  return (', start));
  assert.match(flow, /const goal = instructions\.trim\(\);/);
  assert.match(flow, /goalPlain: plainSaved && plain\.trim\(\) \? \{ text: plain\.trim\(\), of: jobFingerprint\(goal\) \} : undefined,/, 'the words the owner read are saved with the job (D5)');
  const main = read('src/main/workStyleConvert.ts');
  assert.match(main, /const INSTRUCTIONS_MODEL = 'claude-sonnet-5';/);
  assert.match(main, /noTools: true,/);
});

test('Edit Agent shows the saved plain words, writes stale ones once, and never rewrites the job on Save', () => {
  // Value: protects=the owner reads the words saved with the job, Michael his default (F6), and words another writer left stale are written again once (D5, OV3); fails_when=every open paraphrases again, stale words are saved over newer instructions, or Save touches the goal; why_new=the job became read only; seam=source pin
  const edit = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(edit, /const instructions = effectiveWorkStyle\(live\);\s*const savedPlain = plainFor\(live, instructions\);/);
  assert.match(edit, /if \(savedPlain \|\| !instructions\.trim\(\)\) return;/, 'saved words are shown as they are');
  assert.match(edit, /if \(now && jobFingerprint\(effectiveWorkStyle\(now\)\) === of\) updateAgent\(agent\.id, \{ goalPlain: \{ text: res\.text, of \} \}\);/, 'only while they still describe the job');
  assert.match(edit, /if \(gone \|\| res\.source !== 'ai' \|\| !res\.text\) return;/, 'a rules rewrite is shown, never saved');
  const save = edit.slice(edit.indexOf('const save = async'), edit.indexOf('const remove = async'));
  assert.doesNotMatch(save, /goal|workStyleConvert|workStyleRevise/);
  assert.doesNotMatch(edit, /Check every number twice/, 'no prompt-style placeholder');
});

test('the plain description names the owner and Michael, never "you" (owner, 2026-09-27)', () => {
  const p = W.toPlainPrompt(pam, { ...ctx, manager: 'Michael' });
  assert.match(p, /Never write "you" or "your"/);
  assert.match(p, /The business owner is "the owner"\. Michael is the office manager/);
  assert.match(p, /anything this role sends, reports or asks for approval goes to Michael/);
  assert.doesNotMatch(p.slice(0, p.indexOf('--- INSTRUCTIONS ---')), /\bErin\b/, 'the name never reaches the rewrite');
  assert.match(p, /Call a teammate by their role, such as the Sales Director; where the instructions give only a name, say "a teammate"\. Michael is the only name to keep\./);
  assert.match(p, /"Asks the owner first:"/);
  assert.match(W.toInstructionsPrompt('x', { ...ctx, manager: 'Michael' }), /Team members send reports and approvals to Michael, never to the owner directly\./);
  const quick = W.plainFallback('### How to work\nYou are the admin. Send your summary to Michael so you can move on.', W.roleLabel('Executive Admin'));
  assert.doesNotMatch(quick, /\byou\b|\byour\b/i);
  assert.match(quick, /Executive Admin is the admin\. Send Executive Admin's summary to Michael so Executive Admin can move on\./, 'the role stands in for "you", never a name');
  assert.equal(W.roleLabel(''), 'This role');
  assert.match(W.plainFallback('### The job\nYou sort mail.', W.roleLabel(undefined)), /This role sorts mail\./);
  // The owner's old label still reads back as the approval heading.
  assert.match(W.instructionsFallback('Asks you first: refunds.', ctx), /### Needs the owner's approval\nrefunds\./);
});

test('the quick rewrite gives an s only to a verb: "you" as an object, and "don\'t", read right', () => {
  const s = (text) => W.thirdPerson(text, 'Support');
  assert.equal(s('When Michael asks you to draft a reply, keep it short.'), 'When Michael asks Support to draft a reply, keep it short.');
  assert.equal(s('Anything between you and a customer stays in the thread.'), 'Anything between Support and a customer stays in the thread.');
  assert.equal(s('Michael tells you what to do. Thank you for waiting.'), 'Michael tells Support what to do. Thank Support for waiting.');
  assert.equal(s('If you don\'t know a price, ask first.'), 'If Support doesn\'t know a price, ask first.');
  assert.equal(s('You haven\'t the authority, and you aren\'t the buyer.'), 'Support hasn\'t the authority, and Support isn\'t the buyer.');
  assert.equal(s('You won\'t send it and you can\'t refund.'), 'Support won\'t send it and Support can\'t refund.');
  assert.equal(s('You sort mail and you check the inbox.'), 'Support sorts mail and Support checks the inbox.', 'a verb still gets its s');
  // The shipped default for Michael reads cleanly too.
  const { MICHAEL_WORK_STYLE } = loadTs('src/shared/michaelWorkStyle.ts');
  const michael = W.plainFallback(MICHAEL_WORK_STYLE, W.roleLabel('Office Manager'));
  assert.match(michael, /the owner asks Office Manager in their conversation/);
  assert.doesNotMatch(michael, /\b\w+s't\b| ins | tos | ands | fors /);
});

test('the Add and Edit agent views read a work style by role, never by the agent\'s name', () => {
  // Value: protects=no name reaches the plain description an owner edits and saves; fails_when=a view passes the agent's name to plainFallback or the rewrite; why_new=owner 2026-10-03: "fix the card job view to not use names either"; seam=source pin
  const read = (p) => require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', p), 'utf8');
  for (const f of ['AddAgentModal', 'EditAgentModal']) {
    const src = read(`src/renderer/src/components/${f}.tsx`);
    assert.doesNotMatch(src, /plainFallback\([^)]*\b(agent\.name|pendingHire\.name|forName)\)/, `${f} passes a name`);
    assert.match(src, /plainFallback\([^\n]*roleLabel\(/, `${f} passes the role`);
  }
  assert.match(read('src/main/workStyleConvert.ts'), /plainFallback\(req\.text, roleLabel\(req\.ctx\.title\)\)/);
});

test('a role with a dollar sign reads as typed in the plain description', () => {
  // Value: protects=the owner's role title is shown as typed; fails_when=String.replace reads $$ or $& in the role as a pattern; why_new=same mistake as swapName and fillBusiness; seam=none
  assert.equal(
    W.thirdPerson('You sort the inbox. Your notes stay with you.', 'A$$P $& Desk'),
    "A$$P $& Desk sorts the inbox. A$$P $& Desk's notes stay with A$$P $& Desk."
  );
});
