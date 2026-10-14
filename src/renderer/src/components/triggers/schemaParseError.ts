/**
 * Why a webhook's body format (JSON Schema text) does not parse: the parser's
 * own message, or null when it parses. Kept pure, apart from the editor, so a
 * test can check both cases without rendering anything.
 */
export function schemaParseError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
