import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * True when `child` is `parent` itself or sits anywhere below it.
 *
 * Built on `relative()` so it works with whatever separator the platform uses.
 * A hand built `${parent}/` prefix never matches a Windows path such as
 * `C:\work\repo\sub`, which is how a "is anything running in this folder"
 * check can quietly miss every nested folder there.
 */
export function isSameOrInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '') return true;
  // A different drive on Windows comes back absolute; an outside folder starts with "..".
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
