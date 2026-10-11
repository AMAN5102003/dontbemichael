# Keep your place in the conversation

New replies follow the reader only while they are at the bottom of the dock.
When they scroll back, the dock keeps the visible message at its previous
offset and offers a quiet button to catch up. Opening, sending and question
links remain explicit navigation actions, including repeated navigation to
the same question.

The footer is reserved so the button does not resize the reading viewport.
Its count is local to this open dock: distinct arriving replies, with notes
shown as Jump to latest. It does not change the persisted unread count or
the existing read and notification policy. Earlier history, repeated polls
and status edits do not add to the arrival count. Expanding More preserves
the text being read, including at the bottom. The baseline includes folded
exchanges, so revealing Earlier never counts an existing reply. New reply
IDs below the reader count even if their timestamps precede the latest
known reply. Catching up cancels any unresolved question target.

## Try it without an agent

After `npm ci`, run:

```sh
node test/dock-scroll.electron.test.cjs --preview
```

This opens the actual dock component and store in Electron with fictional
messages. Only the main-process boundary is replaced. It uses a temporary
profile, does not access an office or send to an agent, and removes its
temporary files when the window closes.

1. At the bottom, click Deliver two replies. Both should remain in view.
2. Reset, then scroll back until an earlier answer is visible.
3. Click Deliver two replies. The passage should stay in place and the footer
   should say 2 new replies. Click it to catch up.
4. Repeat using Deliver notes. The button should say Jump to latest.
5. Go to question 4, scroll elsewhere, and deliver replies. The question
   should not be recentered. Press Go to question 4 again to navigate again.
6. Expand More while reading, switch themes and languages, resize the window,
   and use Tab then Space on the catch-up button. Esc closes the dock.

Reset restores the fictional history and clears the local component state.
The test composer is a focus target; this preview's send cases are exercised
by the automated test through the production `sendToMichael` path.

## Automated verification

```sh
node --test test/dock-scroll.electron.test.cjs
npm run typecheck
npm run test:focused
npm run build
```

The Electron test mounts the production component with actual Chromium
geometry, using a temporary path containing spaces. It checks normal and
reduced motion, following, visible anchors, arrivals, duplicate polls, notes,
status reflow, Earlier, hidden and missing targets, repeated navigation,
quotes, expansion, resize, asynchronous child layout, item removal, send
success and failure, delayed targets, initial history, reopening, Escape,
file chips, folded exchanges, delayed arrivals below the reader, catch-up
superseding pending navigation, all locales, both themes, keyboard focus
and a short window.
Geometry comparisons allow one CSS pixel for fractional layout rounding.

For an installed-office smoke test, use `npm run dev` and repeat the reading
and catch-up sequence with existing conversations. Verify notification
navigation and normal composer sending in that environment. Fixture results
do not establish provider delivery, OS notifications or screen-reader speech.
Windows and Linux need their own run; Linux needs a graphical session or Xvfb.
