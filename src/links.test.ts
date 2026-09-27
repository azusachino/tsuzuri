import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { splitFrontmatter } from "./frontmatter.ts";
import { extractLinks, frontmatterSpans, linkSpans } from "./links.ts";

const VAULTS = join(import.meta.dirname, "..", "tests");

/** Every Markdown file under a folder, as its text. */
function texts(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.parentPath.includes(".git"))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));
}

describe("link spans", () => {
  const notes = [...texts(join(VAULTS, "fixtures", "vault")), ...texts(join(VAULTS, "vaults", "kepano-obsidian"))];

  test("each place holds the target as written: a wikilink's text, or a Markdown link's encoded destination", () => {
    let checked = 0;
    for (const raw of notes) {
      const { body } = splitFrontmatter(raw);
      const yaml = raw.slice(0, raw.length - body.length);
      for (const [text, spans] of [
        [body, linkSpans(body)],
        [yaml, frontmatterSpans(yaml)],
      ] as const) {
        for (const span of spans) {
          const written = text.slice(span.start, span.end);
          expect(span.kind === "wiki" ? written : decodeURIComponent(written).trim()).toBe(span.target);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("extractLinks is the spans without their places", () => {
    const body = "[[A#h|a]] `[[code]]` ![b](<B note.md>) [c](C%20x.md#part)\n";
    expect(extractLinks(body)).toEqual([
      { target: "A", embed: false, display: "a" },
      { target: "B note.md", embed: true, display: "b" },
      { target: "C x.md", embed: false, display: "c" },
    ]);
    expect(linkSpans(body).map((span) => body.slice(span.start, span.end))).toEqual(["A", "B note.md", "C%20x.md"]);
  });
});
