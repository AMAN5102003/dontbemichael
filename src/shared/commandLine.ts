/** Split a command string into argv, respecting double/single quotes so a model
 *  value with spaces (agy's `--model "Gemini 3.1 Pro (High)"`) stays one token.
 *  Quotes are stripped from the result. A quote may also sit inside a token, the
 *  way a shell reads it, so a typed `--model="Gemini 3.1 Pro (High)"` is one
 *  token too. A quote with no closing partner stays a literal character.
 *
 *  Shared because BOTH sides split command lines: the renderer's spawn flows
 *  (AddAgentModal, restore, command center) and main's god-hired-worker path
 *  (processSpawnRequest). They used to carry byte-identical copies, which is an
 *  invitation for the two to drift — and a worker whose command line splits
 *  differently from the renderer's is exactly the class of silent breakage the
 *  spawn-request fix exists to prevent. */
export function tokenizeCommand(command: string): string[] {
  const out: string[] = [];
  // A token is a run of non-space characters and quoted spans, so a span may
  // hold spaces and may start mid-token (`--model="a b"`).
  const re = /(?:"[^"]*"|'[^']*'|\S)+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) out.push(m[0].replace(/"([^"]*)"|'([^']*)'/g, (_, d, s) => d ?? s));
  return out;
}
