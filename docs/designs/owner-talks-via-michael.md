# The owner talks to team members through Michael, except in 1:1

Status: design reviewed (2026-09-25).

## Proposal (owner, 2026-09-25)

Today the owner can message any agent directly, bypassing Michael. Disallow this unless
the agent is in 1:1 mode.

## What exists today (from the code)

Three ways the owner reaches a team member directly, in the agent panel
(`AgentDetailPanel.tsx`) and focus mode (`FullscreenTerminal.tsx`):

| # | Channel | Effect |
|---|---|---|
| 1 | Terminal keyboard (`PtyTerminalView`) | types into the agent's session |
| 2 | Message composer (`MessageQueueComposer`) | queues a message into the agent |
| 3 | "steer" box (`AgentControlStrip`) | a note the agent reads on its next turn |

1:1 already exists: the "1:1" button (`AgentHoldButton.tsx`) sets `onHold` in the registry,
and Michael stops routing work to that agent. Nothing gates the three channels on it.

Constraint: the app itself writes into agent terminals to deliver inbox mail, so the lock
must stop the owner's keystrokes only, never the app's own delivery.

## Design decisions

### 1A. Outside 1:1: watch-only terminal plus a bar (approved 2026-09-25)

- A team member's terminal stays visible and live, but ignores the owner's keystrokes.
  A "watching" tag sits in its top corner.
- The composer is replaced by a bar: "{{name}} takes work from {{godName}}. To ask {{name}}
  something, tell {{godName}}, or talk to {{name}} 1:1." with two buttons:
  `Message {{godName}} about {{name}}` (primary) and `Talk 1:1`.
- In 1:1 (`onHold`), the terminal accepts typing and the composer is back, exactly as today.
- Michael's own panel is unchanged.
- Wireframe: `~/.gstack/projects/agentvivekkumar-dontbemichael/designs/owner-talks-via-michael-20260925/panel.html` (variant A).

### 2A. Steer only in 1:1 (approved 2026-09-25; brakes amended same day)

The steer box is hidden outside 1:1.

**Amended (owner, after the build):** "Block tools" and "stop after this step" are hidden
too, behind `SHOW_AGENT_BRAKES` in `buildFeatures.ts`; the circuit breaker still steps in
on its own. The top "1:1" button is removed: 1:1 lives only at the bottom, "Talk 1:1" in
the bar, and while in 1:1 a line above the message box: "In 1:1 with {{name}}. {{godName}}
sends {{name}} no work until you end it." with `End 1:1`. Outside 1:1 the top strip shows
nothing and is not rendered.

### 3A. An agent stuck on a question routes to Michael, then ASK ME (owner, 2026-09-25)

Owner's direction: "explore if this can be routed to Michael and to ASK ME if Michael can't
help either."

- **Questions the agent asks itself:** for team members, the PreToolUse hook refuses the
  in-terminal question tool (`AskUserQuestion`) with the reason: "Don't ask here. Send the
  question to Michael through your outbox." Michael answers it, or raises it on ASK ME per
  his instructions. (0 uses in current transcripts; this closes the path.)
- **Prompts the session raises** (sign-in, trust this folder, a permission when auto mode is
  off): the `Notification` hook tells Michael with the prompt text. Michael can't type into
  that terminal, so his instructions say to raise it on ASK ME: "{{name}} is waiting on
  something in their terminal: <text>. Talk 1:1 with {{name}} to answer."
- While that agent's status is "needs you", the panel bar leads with "{{name}} is waiting on
  something in their terminal. Talk 1:1 to answer." and `Talk 1:1` becomes the primary button.
  **Superseded (owner, 2026-10-15):** the owner is never sent to a terminal or a 1:1 for
  this. The app restarts the member (Restart & Continue, with resume), which clears the
  prompt, and tells Michael not to put it on Ask me. Only when the prompt comes back within
  30 minutes of that restart does Michael move the member's work to a teammate and raise a
  plain ask saying they are stuck, with no mention of terminals, prompts or 1:1
  (`hooks.ts` `stuckOnPrompt`). The panel line reads "{name} stopped on something in their
  session. The app restarts them to clear it.", with no coral and the usual button order
  (owner kept Talk 1:1 as the everyday main button). The inbox nudge never types into an open
  prompt, however long it waits (`workerWake.ts`).

### 4A. "Message {{godName}} about {{name}}" jumps to Michael (owner choice 2026-09-25)

Selects Michael, opens his terminal tab, and starts his message box with
"About {{name}}: " (focused, cursor at the end). Nothing is sent until the owner sends it.
(Recommended inline box, 4B, declined.)

## Implementation tasks

- [ ] **M1 (P1)**: gate owner keystrokes into a team member's PTY on `onHold` (renderer: `PtyTerminalView` input handler for non-god agents); app-originated writes (inbox delivery, nudges) untouched. "watching" tag.
- [ ] **M2 (P1)**: replace `MessageQueueComposer` with the bar outside 1:1 (agent panel and focus mode); `Talk 1:1` calls the existing hold toggle.
- [ ] **M3 (P1)**: hide the steer input outside 1:1 in `AgentControlStrip`; keep block tools and stop after this step.
- [ ] **M4 (P1)**: PreToolUse refuses `AskUserQuestion` for non-god agents with the outbox reason; worker briefing line.
- [ ] **M5 (P1)**: Notification hook (permission or elicitation prompt, not idle) sends Michael an inform with the prompt text; Michael's instructions: raise it on ASK ME with "Talk 1:1 to answer".
- [ ] **M6 (P2)**: "Message {{godName}} about {{name}}": select Michael, open his terminal tab, seed his composer "About {{name}}: ".
- [ ] **M7 (P1)**: strings in en, zh-CN, ar (godName interpolated, no dashes); tests: keystrokes dropped outside 1:1 and passed in 1:1, app delivery still writes, steer hidden, question tool refused for workers and allowed for Michael, prompt notification reaches Michael.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | ollama (design outside voice) | Independent 2nd opinion | 1 | skipped | owner skipped |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 3/10 → 9/10, 4 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** ollama, design phase, skipped (owner chose to skip).
- **VERDICT:** DESIGN CLEARED. eng review required.

NO UNRESOLVED DECISIONS
