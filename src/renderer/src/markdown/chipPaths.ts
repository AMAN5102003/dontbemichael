/**
 * The files a piece of Markdown draws as chips, read from the same parse that
 * draws them (remark with GFM and remarkFileChips, as MarkdownPreview runs
 * it). A chip is enabled only when its path was checked, so the checked list
 * must be exactly the drawn one: a separate reader of link syntax drifts from
 * the renderer on parentheses, escapes, titles and blank lines, and every
 * drift greys a chip out.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkFileChips } from './remarkFileChips';

interface Node {
  children?: Node[];
  data?: { hName?: string; hProperties?: { dataPath?: unknown } };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFileChips);

/** Each chip's path once, in the order the text names them. */
export function chipPaths(source: string): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    const p = n.data?.hName === 'cth-file' ? n.data.hProperties?.dataPath : undefined;
    if (typeof p === 'string' && !out.includes(p)) out.push(p);
    for (const c of n.children ?? []) walk(c);
  };
  walk(processor.runSync(processor.parse(source), source) as Node);
  return out;
}
