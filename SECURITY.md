# Security Policy

## Scope

Don't Be Michael is a **local-first desktop app**. It spawns local processes in PTYs and
reads/writes files under directories you register. What it listens on:

- **The hook server**: a Unix domain socket in the hive folder (on Windows, a named
  pipe with a random name for each launch), for agents' hook events. Each agent start
  gets its own secret, kept only in the app's memory and handed to that agent in its
  environment (`HIVE_HOOK_SEAL`); the app takes an event's sender from that secret. An
  event with no secret, an unknown one or one from an earlier start reaches nothing, and a
  tool check from it is refused (issue #61). Known limit: another program running as you
  can read an agent's environment, so a member that deliberately looks there could send
  events as a teammate; moving the secret out of the environment is planned.
- **The integration broker**: an HTTP server bound to `127.0.0.1` that agents call to
  reach connected apps. Each call needs the agent's own capability token.
- **The telemetry receiver**: an HTTP server bound to `127.0.0.1` for usage data from
  the agents.
- **The webhook server**, only while a webhook is turned on: an HTTP server bound to
  `127.0.0.1`, reached from the internet through a public tunnel. Every request needs
  the webhook's secret. The tunnel's address is public for as long as it is open.

Nothing else on the local network can reach these listeners.

## Supported versions

This is an early prototype. Security fixes target the `main` branch only.

| Version | Supported |
|---|---|
| `main` | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Use GitHub's **private vulnerability reporting**: the *Security → Report a
  vulnerability* tab on https://github.com/agentvivekkumar/dontbemichael, with a
  description, reproduction steps, and impact.

You can expect an acknowledgement within a few days. Once a fix is available we'll
credit you (unless you prefer to stay anonymous).

## Notes for reviewers

- Renderer ↔ main IPC goes through a typed `contextBridge` (`window.cth`); the renderer
  has no direct Node access (`nodeIntegration: false`, `contextIsolation: true`).
- All `fs:*` / `git:*` IPC calls are sandboxed and path-validated in the main process,
  rooted at an agent's working directory.
- The hive commits to a local git repo from a **single committer** (the main process);
  agents only write plain files.
- **The internet boundary** (every office; `docs/designs/research-agent-privacy.md`):
  only the Research team member (agent id `research`, named Pete unless the owner renames
  it; every rule checks the id) may use web tools or a shell
  network. Everyone else, Michael included, is refused WebFetch and WebSearch by the
  PreToolUse hook and gets an empty strict `sandbox.network` list, with commands kept
  inside the sandbox. Every message to Pete passes an inbound trust layer (pass, clean or
  deny against the owner's data classes, fixed patterns before and after) and every
  message from him an outbound one (instructions aimed at agents removed, likely
  injection flagged to Michael); anything unsure, slow or failing is denied. Pete's own
  walls: no reads of the home folder, the business folder or the hive; his file tools
  open no temp folder but his own, and his shell only /tmp, which Claude Code needs;
  writes to his own folders only, no settings files but the app's, no keys or tokens in
  his commands' environment, Claude only. Known limits: Windows has no shell sandbox
  (#187); members on other engines keep their own web tools; another member's shell
  command can still write to /tmp, which Pete's shell can read.
