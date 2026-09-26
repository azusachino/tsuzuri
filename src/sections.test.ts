import { describe, expect, test } from "vitest";
import { SectionError } from "./index.ts";
import { findSection, headingsOf } from "./sections.ts";

const PLAN = [
  "---",
  "# a YAML comment",
  "title: Plan",
  "---",
  "",
  "# Plan",
  "",
  "Intro.",
  "",
  "## Work",
  "",
  "- ship grep",
  "",
  "### Work details",
  "",
  "```sh",
  "# a shell comment, not a heading",
  "## nor this",
  "```",
  "",
  "## Home",
  "",
  "- water the plants",
  "",
  "## Empty",
  "",
  "## Last",
  "- tail item",
].join("\n");

describe("sections", () => {
  test("skip frontmatter and fenced code, and end at the next heading of the same or higher level", () => {
    expect(headingsOf(PLAN).map((heading) => heading.text)).toEqual([
      "Plan",
      "Work",
      "Work details",
      "Home",
      "Empty",
      "Last",
    ]);
    const work = findSection(PLAN, "work");
    expect(PLAN.slice(work?.heading.start, work?.end)).toContain("# a shell comment");
    expect(PLAN.slice(work?.heading.start, work?.end)).not.toContain("## Home");
  });

  test("refuse a heading that names two sections", () => {
    expect(() => findSection("## A\n\n## A\n", "A")).toThrow(SectionError);
  });
});
