# Security Policy

## Scope

Don't Be Michael is a **local-first desktop app**. It spawns local processes in PTYs and
reads/writes files under directories you register. What it listens on:

- **The hook server**: a Unix domain socket in the hive folder (on Windows, a named
  pipe with a random name for each launch), for agents' hook events.
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
