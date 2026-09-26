import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);
const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const hasRipgrep = spawnSync("rg", ["--version"]).status === 0;

/** ripgrep over the fixture with tsuzuri's exclusions: dot folders are hidden by default, submodule paths excluded. */
function ripgrep(...args: string[]): string {
  const result = spawnSync("rg", ["-n", "-S", "--sort", "path", "--glob", "*.md", "--glob", "!libs", ...args, "."], {
    cwd: FIXTURE,
    encoding: "utf8",
  });
  return result.stdout.replaceAll("./", "").trimEnd();
}

function tsuzuri(...args: string[]): string {
  return spawnSync("node", [CLI, "--vault", FIXTURE, "grep", ...args], { encoding: "utf8" }).stdout.trimEnd();
}

describe("grep", () => {
  test("numbers lines from the top of the file, frontmatter included", async () => {
    const hits = await vault.grep("psychology/memory");
    expect(hits.map(({ path, line }) => `${path}:${line}`)).toEqual([
      "Topics/Cognitive load.md:6",
      "Topics/Working memory.md:3",
    ]);
  });

  test("matches literal text with fixed, and regular expressions otherwise", async () => {
    expect(await vault.grep("[[index]]", { fixed: true })).toHaveLength(1);
    expect((await vault.grep("^- Folder")).map((hit) => hit.line)).toEqual([12]);
    await expect(vault.grep("(")).rejects.toThrow(SyntaxError);
  });

  test("honours the note filters", async () => {
    const paths = new Set((await vault.grep("type: person", { under: "People/Greek" })).map((hit) => hit.path));
    expect([...paths]).toEqual(["People/Greek/Plato.md"]);
    expect(await vault.grep("type: person", { type: "no-such-type" })).toEqual([]);
  });

  test("attaches context lines, leaving other matches as matches", async () => {
    const [hit] = await vault.grep("^Cognitive load theory", { context: 1 });
    expect(hit?.before).toEqual([{ line: 8, text: "" }]);
    expect(hit?.after).toEqual([{ line: 10, text: "" }]);
    const both = await vault.grep("memory\\]\\]", { context: 2 });
    expect(both.flatMap((h) => [...(h.before ?? []), ...(h.after ?? [])]).some((l) => l.line === both[1]?.line)).toBe(
      false,
    );
  });
});

describe.skipIf(!hasRipgrep)("grep against ripgrep", () => {
  for (const args of [["working memory"], ["Working"], ["-F", "[[Plato]]"], ["-C", "1", "-F", "Plato"], ["^tags:"]]) {
    test(`matches rg -n ${args.join(" ")}`, () => {
      expect(tsuzuri(...args)).toBe(ripgrep(...args));
    });
  }
});

describe("cli grep", () => {
  test("prints unique paths with --format paths and exits 2 for a bad pattern", () => {
    expect(tsuzuri("memory", "--format", "paths").split("\n")).toEqual([
      "Topics/Cognitive load.md",
      "Topics/Working memory.md",
    ]);
    expect(spawnSync("node", [CLI, "--vault", FIXTURE, "grep", "("]).status).toBe(2);
  });
});
