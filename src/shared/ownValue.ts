/**
 * `table[key]` when the table itself holds `key`, else undefined.
 *
 * A plain object lookup also finds Object.prototype members, so a key that
 * comes from outside (a file's extension, an agent's status or caption, a
 * heading in a work style) such as "constructor" or "__proto__" would return a
 * function or an object instead of nothing. Every lookup table keyed by
 * outside text goes through here.
 */
export function ownValue<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}
