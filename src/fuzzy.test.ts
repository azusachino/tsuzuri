import { describe, expect, test } from "vitest";
import { fuzzyRank, fuzzyScore } from "./fuzzy.ts";

const score = (term: string, text: string) => fuzzyScore(term, text) ?? Number.NEGATIVE_INFINITY;

describe("fuzzy scoring", () => {
  test("matches characters in order and rejects anything else", () => {
    expect(fuzzyScore("cld", "Cognitive load")).not.toBeNull();
    expect(fuzzyScore("dlc", "Cognitive load")).toBeNull();
    expect(fuzzyScore("", "anything")).toBeNull();
  });

  test("rewards word starts, path separators, camelCase, and consecutive runs, as fzf does", () => {
    expect(score("cl", "cognitive load")).toBeGreaterThan(score("cl", "circle"));
    expect(score("t", "notes/topics")).toBeGreaterThan(score("t", "notes/at"));
    expect(score("wm", "WorkingMemory")).toBeGreaterThan(score("wm", "Workman"));
    expect(score("load", "cognitive load")).toBeGreaterThan(score("load", "l-o-a-d"));
  });

  test("uses smart case and folds full-width letters", () => {
    expect(fuzzyScore("plato", "Plato")).not.toBeNull();
    expect(fuzzyScore("Plato", "plato")).toBeNull();
    expect(fuzzyScore("ab", "ＡＢ")).not.toBeNull();
  });

  test("treats the first CJK character after other text as a word start", () => {
    expect(score("乌", "Notes/乌龙茶")).toBeGreaterThan(score("龙", "Notes/乌龙茶"));
    expect(fuzzyScore("乌龙", "乌龙茶")).not.toBeNull();
    expect(fuzzyScore("龙乌", "乌龙茶")).toBeNull();
  });

  test("requires every term, or any term with anyTerm", () => {
    const candidates = [{ item: "a", texts: ["cognitive load"] }];
    expect(fuzzyRank("cog load", candidates, 5)).toHaveLength(1);
    expect(fuzzyRank("cog laod", candidates, 5)).toHaveLength(0);
    expect(fuzzyRank("cog laod", candidates, 5, { anyTerm: true })).toHaveLength(1);
  });
});
