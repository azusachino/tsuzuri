import { describe, expect, test } from "vitest";
import { grepPattern } from "./grep.ts";
import { formatGrep } from "./index.ts";

describe("grep", () => {
  test("uses smart case, ignoring escapes", () => {
    expect(grepPattern("memory").flags).toContain("i");
    expect(grepPattern("Memory").flags).not.toContain("i");
    expect(grepPattern("\\Smemory").flags).toContain("i");
    expect(grepPattern("A.", { fixed: true }).flags).not.toContain("i");
  });

  test("prints matches and context in ripgrep's layout", () => {
    const text = formatGrep([
      { path: "a.md", line: 2, text: "hit", before: [{ line: 1, text: "b" }], after: [{ line: 3, text: "c" }] },
      { path: "a.md", line: 9, text: "hit", before: [], after: [] },
    ]);
    expect(text).toBe("a.md-1-b\na.md:2:hit\na.md-3-c\n--\na.md:9:hit");
    expect(formatGrep([{ path: "a.md", line: 2, text: "x" }])).toBe("a.md:2:x");
  });
});
