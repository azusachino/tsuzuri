import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CaptureError, captureInputFromMarkdown, renderCapture } from "./capture.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { resolveSettings, type TsuzuriConfig } from "./settings.ts";

const NOW = new Date(2026, 8, 24, 19, 5);

/** A vault that declares a strict house style, the way a vault's own tsuzuri.toml would. */
const STRICT: TsuzuriConfig = {
  capture: {
    folder: "queue",
    filename: "slug",
    properties: ["title", "created", "modified", "kind", "tags", "source"],
    values: { kind: "capture" },
    title_style: "lowercase",
    tag_style: "kebab",
    require_tags: true,
    reject_tags: ["todo"],
  },
};

/** An empty folder, so settings resolve from code options and neutral defaults alone. */
const empty = () => mkdtempSync(join(tmpdir(), "tsuzuri-settings-"));
const defaults = resolveSettings(empty()).capture;
const strict = resolveSettings(empty(), STRICT).capture;

describe("default capture settings", () => {
  test("name files after the title, record only tags, and write at the vault root", () => {
    expect(defaults).toMatchObject({ folder: "", filename: "title", properties: ["tags", "source"] });
    const { content } = renderCapture({ text: "Body line", title: "A Title", tags: ["learning"], now: NOW }, defaults);
    expect(content).toBe("---\ntags:\n  - learning\n---\n\nBody line\n");
  });

  test("shorten a long title without splitting an emoji", () => {
    const { title } = renderCapture({ text: "Body", title: `${"a".repeat(79)}😀😀`, now: NOW }, defaults);
    expect(title).toBe(`${"a".repeat(79)}😀…`);
    expect(title.isWellFormed()).toBe(true);
  });

  test("write no frontmatter when there is nothing to record", () => {
    expect(renderCapture({ text: "Just text", now: NOW }, defaults).content).toBe("Just text\n");
  });

  test("keep titles and tags as written, checking Obsidian's tag syntax", () => {
    const { title, content } = renderCapture(
      { text: "Using the API", tags: ["#Area/Sub_topic", "2026-plans"] },
      defaults,
    );
    expect(title).toBe("Using the API");
    expect(content).toContain("tags:\n  - Area/Sub_topic\n  - 2026-plans\n");
    expect(() => renderCapture({ text: "x", tags: ["two words"] }, defaults)).toThrow("not a valid tag");
    expect(() => renderCapture({ text: "x", tags: ["2026"] }, defaults)).toThrow("not a valid tag");
    expect(() => renderCapture({ text: "x", tags: ["a,b"] }, defaults)).toThrow("not a valid tag");
    expect(renderCapture({ text: "x", tags: ["0🌲", "日本語"] }, defaults).content).toContain("  - 0🌲\n  - 日本語\n");
  });
});

describe("configured capture settings", () => {
  test("write the declared properties in order", () => {
    const { content } = renderCapture({ text: "Body", title: "An Idea", tags: ["Agent_Harness"], now: NOW }, strict);
    expect(content).toBe(
      [
        "---",
        "title: an idea",
        "created: 2026-09-24",
        "modified: 2026-09-24",
        "kind: capture",
        "tags:",
        "  - agent-harness",
        "---",
        "",
        "Body",
        "",
      ].join("\n"),
    );
  });

  test("quote values YAML would misread, and they round-trip", () => {
    const { content } = renderCapture(
      { text: "x", title: "read: this", tags: ["x"], source: "a #b", now: NOW },
      strict,
    );
    expect(content).toContain('title: "read: this"');
    expect(splitFrontmatter(content).data).toMatchObject({ title: "read: this", source: "a #b" });
  });

  test("take the title from the first line, without Markdown syntax", () => {
    expect(renderCapture({ text: "\n## Some Heading\nmore", tags: ["x"] }, strict).title).toBe("some heading");
    expect(renderCapture({ text: "- a list item", tags: ["x"] }, strict).title).toBe("a list item");
    expect(renderCapture({ text: "x".repeat(100), tags: ["x"] }, strict).title).toHaveLength(81);
  });

  test("lowercase titles except allowlisted words, and space CJK", () => {
    const allow = { ...strict, titleAllow: ["API", "iPhone"] };
    expect(renderCapture({ text: "Using the API on iPhone", tags: ["x"] }, allow).title).toBe(
      "using the API on iPhone",
    );
    expect(renderCapture({ text: "Two APIs", tags: ["x"] }, allow).title).toBe("two APIs");
    expect(renderCapture({ text: "学习Kafka原理", tags: ["x"] }, allow).title).toBe("学习 kafka 原理");
  });

  test("enforce required, kebab-case, and rejected tags", () => {
    expect(
      renderCapture({ text: "x", tags: [" Agent_Harness ", "agent-harness", "分布式"] }, strict).content,
    ).toContain("tags:\n  - agent-harness\n  - 分布式\n");
    expect(() => renderCapture({ text: "x", tags: [] }, strict)).toThrow("requires at least one tag");
    expect(() => renderCapture({ text: "x", tags: ["todo"] }, strict)).toThrow('does not allow the tag "todo"');
    expect(() => renderCapture({ text: "x", tags: ["c++"] }, strict)).toThrow("not a valid tag");
    expect(() => renderCapture({ text: "  ", tags: ["x"] }, strict)).toThrow(CaptureError);
  });

  test("write created and modified in the configured timestamp format", () => {
    const timed = resolveSettings(empty(), {
      capture: { ...STRICT.capture, timestamp_format: "YYYY-MM-DD HH:mm" },
    }).capture;
    const { content } = renderCapture({ text: "Body", title: "An Idea", tags: ["x"], now: NOW }, timed);
    expect(content).toContain("created: 2026-09-24 19:05\nmodified: 2026-09-24 19:05\n");
  });
});

describe("captureInputFromMarkdown", () => {
  const draft = [
    "---",
    "title: A drafted idea",
    "tags:",
    "  - learning",
    "source: https://example.com/post",
    "author: Someone",
    "kind: draft",
    "rating: 4",
    "---",
    "",
    "# A heading that is not the title",
    "",
    "Body text.",
    "",
  ].join("\n");

  test("takes title, tags, and source from the file's properties and keeps the body", () => {
    const input = captureInputFromMarkdown(draft, "tmp/draft.md");
    expect(input).toMatchObject({
      title: "A drafted idea",
      tags: ["learning"],
      source: "https://example.com/post",
      properties: { author: "Someone", kind: "draft", rating: 4 },
    });
    expect(input.text).toBe("\n# A heading that is not the title\n\nBody text.\n");
  });

  test("falls back to the first heading, then the file name", () => {
    expect(captureInputFromMarkdown("## First heading ##\n\ntext\n", "x.md").title).toBe("First heading");
    expect(captureInputFromMarkdown("plain text\n", "tmp/My draft.md").title).toBe("My draft");
    expect(captureInputFromMarkdown("plain text\n").title).toBeUndefined();
  });

  test("keeps the file's other properties after the declared ones, never duplicating a declared key", () => {
    const { content } = renderCapture({ ...captureInputFromMarkdown(draft, "draft.md"), now: NOW }, strict);
    const { data } = splitFrontmatter(content);
    expect(data).toMatchObject({ title: "a drafted idea", kind: "capture", author: "Someone", rating: 4 });
    expect(content.match(/^kind:/gm)).toHaveLength(1);
    expect(content.indexOf("author:")).toBeGreaterThan(content.indexOf("source:"));
  });
});
