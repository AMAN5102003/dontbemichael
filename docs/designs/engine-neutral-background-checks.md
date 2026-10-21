# Engine-neutral background checks (issue #85)

All six background operations call `runHiddenModel`: standing approval, hire
overlap, work-style conversion, focus-area check, work-style suggestion, and
memory tidy. The main process supplies `godProvider` and `godModel` from the
owner's configuration. An absent provider keeps legacy Claude behavior. The
command names the executable; it does not choose the engine.

## Execution and model choice

- Claude delegates to `runHiddenClaude` with the same Haiku/Sonnet model,
  timeout, settings, tools, authentication, preview and cancellation options
  each caller used before this change. `hiddenClaude.ts` is unchanged.
- Codex uses the owner's `godModel`, when set, or the CLI's default. It never
  receives the callers' Claude models. This increment does not introduce
  automatic quick/careful model selection (see review of PR #176).
- Gemini and every other unimplemented engine return unavailable immediately.
  A request to give Codex tools also returns unavailable.

## Codex boundary

Use the command documented in TODOS.md and tested by the author of #85:
`exec --ephemeral --ignore-user-config --skip-git-repo-check -s read-only`,
disable `shell_tool`, `unified_exec`, `apps`, `browser_use`, `computer_use`,
and set `web_search="disabled"`. Also explicitly disable local image viewing,
multi-agent tools, hooks, remote plugins and skill dependency installation.
These additional controls are documented in the
[official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The installed CLI exposes image viewing as the `view_image` feature; the older
`tools.view_image` config key is ignored by that build. Use `--disable view_image`
and `--strict-config`, so unsupported configuration is an error instead of a
silently weakened restriction. All six callers request `noTools: true`.

Each invocation gets a private temporary root and an empty workspace inside
it. Its `-o` answer file is a sibling of that workspace, unique to this call.
The prompt goes through stdin, not argv, and no shell is launched. This also
avoids Windows command-line length limits for memory notes. Known Windows npm
shims use the terminal's existing parser to launch their interpreter directly;
unknown batch files return unavailable.

Only a zero exit code with a nonempty answer at most 1 MiB counts as success.
Cancel, timeout and process errors stop the process tree. Every exit path
attempts to remove the temporary files. CLI stdout and stderr are not exposed
as model answers or logged with customer text. Codex's work-style preview is
the final answer only; Claude's existing live preview is preserved.

The existing fallbacks remain: standing approval asks the owner, hire overlap
uses rules, conversion uses plain text, focus remains unchecked, suggestion
returns empty, and memory tidy restores pending notes without changing the
index.

## Validation boundary

The tests use fake model answers and a real local fake CLI process. They check
argument/configuration construction, stdin transport, output isolation,
failure/cancel/timeout, cleanup, and each caller's success/unavailable paths.
They do not prove a real Codex release exposes no tools. The real CLI must be
verified against these restrictions before Codex can enter `BUILD_ENGINES`.
That engine list and all other engine-readiness gaps are unchanged here.

### Optional live acceptance checks

Run `node tools/verify-background-codex.cjs --live` after signing in to Codex.
Set `CODEX_TEST_BINARY` to an installed binary's path if it is not on PATH.
The explicit `--live` opt-in uses the CLI's existing authentication and model
usage. It sends synthetic fixtures only; no mailbox is connected or email sent.

The nine checks exercise both standing-approval outcomes, hiring, both
work-style conversion directions, focus checking, suggestion, memory tidy and
a file-access canary. The CLI's JSON event stream must contain only reasoning
and answer items. The canary's contents must stay unread and its requested
output file must not appear. All fixture files are removed afterwards.

This validates the background runner, not the other engine-readiness gaps or
an entire office. `BUILD_ENGINES` stays Claude only.

### Recorded validation, 2026-10-13

After merging upstream `c7a191ad`, the feature source at `b11919d2` passed the
full suites on the fork's validation branch. That branch's only extra file was
the Linux CI workflow, which is not part of the upstream PR.

| Platform | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| macOS | 2,416 | 0 | 3 |
| Windows | 2,384 | 0 | 35 |
| Linux | 2,409 | 0 | 10 |

[macOS and Windows CI](https://github.com/kimtour/dontbemichael/actions/runs/38464053624)
also passed the production build, both type checks and release-link checks.
[Linux validation](https://github.com/kimtour/dontbemichael/actions/runs/38464053792)
passed type checks, the production build and its complete test suite. Skips
follow the repository's platform-specific tests; the new Windows npm-shim
execution test passed on Windows.

On macOS 26.3 with Codex CLI `0.162.0-alpha.17.2`, nine checks using the real
Codex service and synthetic fixtures passed. Only answer items were emitted;
the canary stayed unread and its requested output file was not created. The
initial positive email fixture promised a pickup date and was correctly
rejected; the passing positive fixture was a plain acknowledgement. No
production restrictions were weakened to obtain these results.
