import type { Note } from "./vault.ts";

export interface GrepOptions {
  /** Match the pattern as literal text, like `rg -F`. */
  fixed?: boolean;
  /** Lines of context either side of each match, like `rg -C`. */
  context?: number;
  /** Number of matching lines to skip in path and line order. */
  offset?: number;
}

export interface GrepLine {
  line: number;
  text: string;
}

/** One matching line; line numbers count from the top of the file, frontmatter included, as `rg -n` does. */
export interface GrepHit extends GrepLine {
  path: string;
  /** With `context`: the lines before and after, excluding other matches' own lines. */
  before?: GrepLine[];
  after?: GrepLine[];
}

/**
 * ripgrep's smart case: case-insensitive unless the pattern has an uppercase letter. Escapes such as `\S` or `\W`
 * are not letters of the pattern, so they do not count.
 */
function smartCaseFlags(pattern: string, fixed: boolean): string {
  const literal = fixed ? pattern : pattern.replace(/\\./gu, "");
  return /\p{Lu}/u.test(literal) ? "u" : "iu";
}

export function grepPattern(pattern: string, options: GrepOptions = {}): RegExp {
  const source = options.fixed ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  return new RegExp(source, smartCaseFlags(pattern, options.fixed ?? false));
}

function fileLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Every line of the notes matching the pattern, in path then line order. No index: every call scans the notes. */
export function grep(notes: Note[], pattern: string, options: GrepOptions = {}): GrepHit[] {
  const regex = grepPattern(pattern, options);
  const context = options.context ?? 0;
  const hits: GrepHit[] = [];
  for (const note of notes) {
    const lines = fileLines(note.raw);
    const matched = new Set<number>();
    lines.forEach((text, index) => {
      if (regex.test(text)) matched.add(index);
    });
    for (const index of matched) {
      const hit: GrepHit = { path: note.path, line: index + 1, text: lines[index] as string };
      if (context > 0) {
        const around = (from: number, to: number) =>
          lines
            .slice(Math.max(0, from), Math.max(0, to))
            .map((text, offset) => ({ line: Math.max(0, from) + offset + 1, text }))
            .filter(({ line }) => !matched.has(line - 1));
        hit.before = around(index - context, index);
        hit.after = around(index + 1, index + 1 + context);
      }
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * ripgrep's text layout: `path:line:text` for matches and `path-line-text` for context, with `--` between groups
 * that are not contiguous when context was asked for.
 */
export function formatGrep(hits: GrepHit[]): string {
  const grouped = hits.some((hit) => hit.before !== undefined);
  const out: string[] = [];
  let last: { path: string; line: number } | undefined;
  const print = (path: string, { line, text }: GrepLine, separator: string) => {
    if (grouped && last && (last.path !== path || line > last.line + 1)) out.push("--");
    if (!last || last.path !== path || line > last.line) {
      out.push(`${path}${separator}${line}${separator}${text}`);
      last = { path, line };
    }
  };
  for (const hit of hits) {
    for (const line of hit.before ?? []) print(hit.path, line, "-");
    print(hit.path, hit, ":");
    for (const line of hit.after ?? []) print(hit.path, line, "-");
  }
  return out.join("\n");
}
