/**
 * What a watch-only terminal (a team member outside 1:1) still sends to its
 * program. Keys, paste and drop are stopped before xterm sees them, but a
 * program that turns on mouse tracking or focus events would still get the
 * owner's clicks, wheel and focus changes as input. Those are dropped here.
 * The terminal's own replies to the program's queries (cursor position,
 * device attributes, colours) go through.
 */

// SGR mouse reports (ESC [ < b ; x ; y M or m), focus in and out (ESC [ I,
// ESC [ O), and the up and down arrows xterm turns the wheel into on a
// full-screen program. The old X10 mouse encoding goes through onBinary,
// which the pool never forwards.
const OWNER_INPUT = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[IO]|\x1b[[O][AB]/g;

export function watchOnlyData(data: string): string {
  return data.replace(OWNER_INPUT, '');
}
