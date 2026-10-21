'use strict';
// A fake CLI: no model, credential, network or paid call. The runner must use
// the real child-process lifecycle and stdin/output-file protocol to reach it.
const fs = require('node:fs');
const args = process.argv.slice(2);
const answer = args[args.indexOf('-o') + 1];
const mode = process.env.DBM_FAKE_MODE;
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (s) => { prompt += s; });
process.stdin.on('end', () => {
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  if (mode === 'missing') return;
  fs.writeFileSync(answer, mode === 'empty' ? '' : mode === 'oversized' ? 'x'.repeat(1_048_577) : prompt);
  // Even an output file is not a successful answer after a failed invocation.
  if (mode === 'fail') process.exitCode = 1;
});
