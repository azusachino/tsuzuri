import { describe, expect, test } from "vitest";
import { countTags, noteTags, tagMatches } from "./tags.ts";

describe("reading tags", () => {
  test("reads a list, a comma- or space-separated string, and # prefixes", () => {
    expect(noteTags(["a", "#b", "  c "])).toEqual(["a", "b", "c"]);
    expect(noteTags("#History, overview")).toEqual(["History", "overview"]);
    expect(noteTags("one two,three")).toEqual(["one", "two", "three"]);
    expect(noteTags(undefined)).toEqual([]);
    expect(noteTags(["a", "a", 3, null])).toEqual(["a"]);
  });
});

describe("matching tags", () => {
  test("is case-insensitive and lets a parent match its nested tags", () => {
    expect(tagMatches(["History"], "history")).toBe(true);
    expect(tagMatches(["history/timeline"], "History")).toBe(true);
    expect(tagMatches(["history/timeline"], "#history/timeline")).toBe(true);
    expect(tagMatches(["historical"], "history")).toBe(false);
    expect(tagMatches(["history"], "history/timeline")).toBe(false);
  });
});

describe("counting tags", () => {
  test("counts notes per tag, parents of nested tags included, case variants merged", () => {
    const counts = countTags([{ tags: ["Area/sub", "x"] }, { tags: ["area", "area/other"] }, { tags: ["AREA/sub"] }]);
    expect(counts).toEqual([
      { tag: "Area", notes: 3 },
      { tag: "Area/sub", notes: 2 },
      { tag: "area/other", notes: 1 },
      { tag: "x", notes: 1 },
    ]);
  });
});
