'use strict';
/**
 * A fake AI engine for tests (issue #326, eng R5; reusable for #83): it prints
 * to its terminal like an engine at work and, only when HOOK_AFTER_MS is set,
 * checks in with the app once over the hook socket, the way a real engine's
 * SessionStart hook does. No AI, no paid calls.
 *
 * Env: HIVE_SOCK (socket path), HIVE_HOOK_SEAL (the per start token),
 *      AGENT_ID, HOOK_AFTER_MS (optional).
 */
const net = require('node:net');

const tick = setInterval(() => process.stdout.write('working...\n'), 100);

const after = Number(process.env.HOOK_AFTER_MS);
if (Number.isFinite(after) && after >= 0) {
  setTimeout(() => {
    const c = net.createConnection(process.env.HIVE_SOCK, () => {
      c.write(JSON.stringify({
        hook_token: process.env.HIVE_HOOK_SEAL,
        agent_id: process.env.AGENT_ID,
        hook_event_name: 'SessionStart',
        session_id: 'fake-session',
        cwd: process.cwd()
      }) + '\n');
    });
    c.on('data', () => c.end());
    c.on('error', () => { /* the app is gone: nothing to report to */ });
  }, after);
}

process.on('SIGTERM', () => { clearInterval(tick); process.exit(0); });
