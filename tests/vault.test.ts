import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LineRangeError, NotFoundError, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const vault = new Vault(FIXTURE);

describe("scanning", () => {
  test("skips dot folders and submodule paths", async () => {
    const paths = (await vault.notes()).map((note) => note.path);
    expect(paths).toContain("Topics/Cognitive load.md");
    expect(paths.some((path) => path.startsWith(".trash/") || path.startsWith("libs/"))).toBe(false);
  });

  test("uses the file name as the title when there is no title property", async () => {
    expect((await vault.find("Home")).title).toBe("Home");
    expect((await vault.find("乌龙茶")).path).toBe("Notes/乌龙茶.md");
  });

  test("uses a first H1 after frontmatter, with property then filename precedence", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-heading-title-"));
    try {
      writeFileSync(join(root, "01.md"), "---\ntags: [docs]\n---\n\n# Getting started\n\nDetails.\n");
      writeFileSync(join(root, "02.md"), "---\ntitle: Explicit title\n---\n\n# Different heading\n");
      writeFileSync(join(root, "03.md"), "Introduction\n\n# Later heading\n");
      writeFileSync(join(root, "04.md"), "## Subheading\n");
      const local = new Vault(root);
      expect((await local.find("01.md")).title).toBe("Getting started");
      expect((await local.find("02.md")).title).toBe("Explicit title");
      expect((await local.find("03.md")).title).toBe("03");
      expect((await local.find("04.md")).title).toBe("04");
      expect((await local.find("Getting started")).path).toBe("01.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a missing vault", () => {
    expect(() => new Vault(join(FIXTURE, "nowhere"))).toThrow(NotFoundError);
  });
});

describe("get by line", () => {
  const ref = "Topics/Cognitive load.md";

  test("counts lines from the top of the file, frontmatter included", async () => {
    const slice = await vault.get(ref, { lines: { start: 7, end: 9 } });
    expect(slice).toMatchObject({ start: 7, end: 9, total: 27 });
    expect(slice.body).toBe("---\n\nCognitive load theory explains why working memory limits learning.");
    expect((await vault.get(ref, { lines: { start: 1, end: 1 } })).body).toBe("---");
  });

  test("runs an open-ended range to the first or last line", async () => {
    expect(await vault.get(ref, { lines: { start: 26 } })).toMatchObject({ start: 26, end: 27 });
    expect(await vault.get(ref, { lines: { end: 2 } })).toMatchObject({ start: 1, end: 2, body: "---\naliases:" });
    expect(await vault.get(ref, { lines: { start: 20, end: 500 } })).toMatchObject({ start: 20, end: 27 });
  });

  test("reads around a line, clipped at either end of the file", async () => {
    expect(await vault.get(ref, { around: { line: 9, context: 1 } })).toMatchObject({ start: 8, end: 10 });
    expect(await vault.get(ref, { around: { line: 2 } })).toMatchObject({ start: 1, end: 7 });
    expect(await vault.get(ref, { around: { line: 27, context: 0 } })).toMatchObject({ start: 27, end: 27 });
  });

  test("refuses a range the note cannot serve, naming its length", async () => {
    await expect(vault.get(ref, { lines: { start: 28 } })).rejects.toThrow("has 27 lines");
    await expect(vault.get(ref, { lines: { start: 9, end: 3 } })).rejects.toThrow(LineRangeError);
    await expect(vault.get(ref, { lines: { start: 0 } })).rejects.toThrow(LineRangeError);
    await expect(vault.get(ref, { around: { line: 40 } })).rejects.toThrow(LineRangeError);
    await expect(vault.get(ref, { lines: { start: 1 }, around: { line: 2 } })).rejects.toThrow("not both");
  });

  test("leaves a plain get without line fields", async () => {
    const whole = await vault.get(ref);
    expect(whole.start).toBeUndefined();
    expect(whole.body.startsWith("\nCognitive load theory")).toBe(true);
  });
});

describe("find and get", () => {
  test("resolves a path, stem, title, or alias", async () => {
    for (const ref of ["Topics/Cognitive load.md", "Topics/Cognitive load", "cognitive load", "clt"]) {
      expect((await vault.find(ref)).path).toBe("Topics/Cognitive load.md");
    }
  });

  test("refuses an ambiguous stem and names the candidates", async () => {
    await expect(vault.find("Plato")).rejects.toThrow("People/Greek/Plato.md, People/Plato.md");
  });

  test("returns a content hash and marks truncation", async () => {
    const full = await vault.get("Working memory");
    const cut = await vault.get("Working memory", { maxChars: 10 });
    expect(full.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(full.truncated).toBe(false);
    expect(cut.body).toHaveLength(10);
    expect(cut.truncated).toBe(true);
    expect(cut.hash).toBe(full.hash);
  });
});

describe("list", () => {
  test("filters by property, tag, and folder", async () => {
    expect((await vault.list({ type: "person" })).map((note) => note.path)).toEqual([
      "People/Greek/Plato.md",
      "People/Plato.md",
    ]);
    expect((await vault.list({ tag: "psychology/memory", under: "Topics" })).length).toBe(2);
    expect((await vault.list({ status: "draft" })).map((note) => note.path)).toEqual(["Inbox/Existing idea.md"]);
  });
});

describe("links", () => {
  test("resolves each wikilink form the way Obsidian does", async () => {
    const byTarget = Object.fromEntries(
      (await vault.links("Cognitive load")).map((link) => [link.target, link.resolution]),
    );
    expect(byTarget["Topics/Working memory"]).toEqual({ status: "resolved", path: "Topics/Working memory.md" });
    expect(byTarget["Working memory"]).toEqual({ status: "resolved", path: "Topics/Working memory.md" });
    expect(byTarget.index).toEqual({ status: "resolved", path: "Topics/index.md" });
    expect(byTarget["History/Timeline"]).toEqual({ status: "resolved", path: "Topics/History/Timeline.md" });
    expect(byTarget["History/Overview"]).toEqual({ status: "resolved", path: "History/Overview.md" });
    expect(byTarget.Plato).toEqual({ status: "ambiguous", candidates: ["People/Greek/Plato.md", "People/Plato.md"] });
    expect(byTarget["Missing note"]).toEqual({ status: "missing" });
    expect(byTarget["diagram.png"]).toEqual({ status: "asset" });
  });

  test("skips code, strips heading targets, and reads escaped table pipes", async () => {
    const links = await vault.links("Cognitive load");
    expect(links.map((link) => link.target)).not.toContain("in-code");
    expect(links.map((link) => link.target)).not.toContain("fenced");
    expect(links.find((link) => link.display === "capacity")?.target).toBe("Working memory");
    expect(links.filter((link) => link.display === "wm")).toHaveLength(2);
  });

  test("counts frontmatter wikilinks and local Markdown links, as Obsidian does", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-links-"));
    writeFileSync(join(root, "Target.md"), "t\n");
    writeFileSync(join(root, "My Note.md"), "m\n");
    writeFileSync(join(root, "Linked.md"), '---\nrelated:\n  - "[[Target]]"\n---\n');
    writeFileSync(
      join(root, "Markdown.md"),
      "[t](Target.md#part) [m](My%20Note.md) [a](<My Note.md>) [web](https://example.com/x.md) `[c](Code.md)`\n",
    );
    const linked = new Vault(root);
    expect((await linked.links("Linked")).map((link) => link.target)).toEqual(["Target"]);
    expect((await linked.links("Markdown")).map(({ target, display }) => `${target}|${display}`)).toEqual([
      "Target.md|t",
      "My Note.md|m",
      "My Note.md|a",
    ]);
    expect((await linked.backlinks("Target")).map((note) => note.path)).toEqual(["Linked.md", "Markdown.md"]);
    expect((await linked.orphans()).map((note) => note.path)).toEqual(["Linked.md", "Markdown.md"]);
  });

  test("resolves a note whose name has a dot before calling it an attachment", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-dotted-"));
    writeFileSync(join(root, "Node.js.md"), "n\n");
    writeFileSync(join(root, "From.md"), "[[Node.js]] ![[image.png]]\n");
    const byTarget = Object.fromEntries(
      (await new Vault(root).links("From")).map((link) => [link.target, link.resolution]),
    );
    expect(byTarget["Node.js"]).toEqual({ status: "resolved", path: "Node.js.md" });
    expect(byTarget["image.png"]).toEqual({ status: "asset" });
  });

  test("skips links in a fence that holds a shorter fence, as headings do", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-fences-"));
    const note = "````md\n```\n[[Inner]]\n# not a heading\n```\n````\n[[Outer]]\n## real\n";
    writeFileSync(join(root, "index.md"), note);
    const fenced = new Vault(root);
    expect((await fenced.links("index")).map((link) => link.target)).toEqual(["Outer"]);
    expect((await fenced.outline("index")).map((heading) => heading.text)).toEqual(["real"]);
    expect((await fenced.nav()).index?.headings).toEqual(["real"]);
  });

  test("skips links in code spans and raw HTML blocks, as Obsidian does not render them there", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-raw-"));
    const note = [
      "Spans: `[[single]]`, ``a `[[double]]` b``, and ` `` [[unmatched]] ` stay code.",
      "",
      '<div class="comment">',
      "[[div]] is raw HTML until a blank line",
      "</div>",
      "",
      "<pre>",
      "",
      "[[pre]] is raw across a blank line",
      "</pre>",
      "<!-- [[comment]]",
      "-->",
      "",
      "<span>",
      "[[span]] follows a lone tag after a blank line",
      "",
      "A paragraph goes on",
      "<span>",
      "[[Paragraph]], since a lone tag cannot interrupt it.",
      "",
      "    <div>",
      "[[Indented]] after a tag indented four spaces, which is no HTML block.",
      "",
      "```",
      "<div>",
      "```",
      "[[Fence]] after a tag in a fence.",
      "",
      "<div>",
      "```",
      "</div>",
      "",
      "[[Unfenced]] after a fence marker inside HTML.",
    ].join("\n");
    writeFileSync(join(root, "index.md"), note);
    const targets = (await new Vault(root).links("index")).map((link) => link.target);
    expect(targets).toEqual(["Paragraph", "Indented", "Fence", "Unfenced"]);
  });

  test("sees a new link after a write, since the link graph goes with the scan", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-graph-"));
    writeFileSync(join(root, "A.md"), "a\n");
    writeFileSync(join(root, "B.md"), "b\n");
    const graph = new Vault(root);
    expect((await graph.orphans()).map((note) => note.path)).toEqual(["A.md", "B.md"]);
    await graph.append("A", "[[B]]");
    expect((await graph.backlinks("B")).map((note) => note.path)).toEqual(["A.md"]);
    expect((await graph.orphans()).map((note) => note.path)).toEqual(["A.md"]);
  });

  test("finds backlinks and unresolved links", async () => {
    expect((await vault.backlinks("Cognitive load")).map((note) => note.path)).toEqual(["Home.md", "Topics/index.md"]);
    const unresolved = (await vault.unresolved()).map(({ target, resolution }) => `${target}:${resolution.status}`);
    expect(unresolved).toEqual(["Plato:ambiguous", "Missing note:missing"]);
  });
});

describe("nav", () => {
  test("uses README.md as the folder index, with index.md taking precedence", async () => {
    const root = copyVault();
    try {
      mkdirSync(join(root, "Guides"));
      writeFileSync(join(root, "Guides", "README.md"), "# Guides for readers\n\nWelcome.\n");
      writeFileSync(join(root, "Guides", "Topic.md"), "# A topic\n");
      const local = new Vault(root);
      expect((await local.nav()).folders).toContainEqual({ path: "Guides", title: "Guides for readers", notes: 2 });
      const guides = await local.nav("Guides");
      expect(guides.index).toMatchObject({ path: "Guides/README.md", title: "Guides for readers" });
      expect(guides.notes.map((note) => note.path)).toEqual(["Guides/Topic.md"]);
      writeFileSync(join(root, "Guides", "index.md"), "# Canonical index\n");
      local.reload();
      expect((await local.nav("Guides")).index?.path).toBe("Guides/index.md");
      expect((await local.nav()).folders.find((folder) => folder.path === "Guides")?.title).toBe("Canonical index");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shows the root folders and notes", async () => {
    const root = await vault.nav();
    expect(root.index).toBeUndefined();
    expect(root.folders.map((folder) => folder.path)).toEqual([
      "Daily",
      "History",
      "Inbox",
      "Notes",
      "People",
      "Templates",
      "Topics",
      "Weekly",
    ]);
    expect(root.notes).toMatchObject([{ path: "Home.md", title: "Home" }]);
  });

  test("shows a folder's index note and headings", async () => {
    const topics = await vault.nav("Topics/");
    expect(topics.folder).toBe("Topics");
    expect(topics.index).toMatchObject({ path: "Topics/index.md", title: "index", headings: ["reading order"] });
    expect(topics.folders).toEqual([{ path: "Topics/History", title: "History", notes: 1 }]);
    expect(topics.notes.map((note) => note.path)).toEqual(["Topics/Cognitive load.md", "Topics/Working memory.md"]);
  });
});

describe("search", () => {
  test("keeps paths, BM25 scores, and snippets from the uncached calculation", async () => {
    const cognitive = await vault.search("cognitive load");
    expect(cognitive.map(({ path, score }) => [path, score])).toEqual([
      ["Topics/Cognitive load.md", 5.207],
      ["Topics/index.md", 2.854],
      ["Home.md", 2.205],
      ["Topics/Working memory.md", 1.942],
    ]);
    expect(cognitive[0]?.snippet).toBe(
      "Cognitive load theory explains why working memory limits learning. - Background: [[Topics/Working memory]] and [[Working memory|wm]]. - Folder index: [[index]…",
    );
    expect((await vault.search("student of Socrates")).map(({ path, score }) => [path, score])).toEqual([
      ["People/Plato.md", 8.712],
      ["Topics/History/Timeline.md", 2.442],
    ]);
    expect((await vault.search("乌龙茶")).map(({ path, score, snippet }) => [path, score, snippet])).toEqual([
      ["Notes/乌龙茶.md", 8.335, "今天喝了乌龙茶，很好喝。乌龙茶适合下午。"],
    ]);
  });

  test("rebuilds search statistics with the scan after a reload", async () => {
    const root = copyVault();
    try {
      const local = new Vault(root);
      expect(await local.search("newtoken")).toEqual([]);
      writeFileSync(join(root, "Home.md"), "# Home\n\nnewtoken appears here.\n");
      local.reload();
      expect((await local.search("newtoken")).map((hit) => hit.path)).toEqual(["Home.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ranks a title match first", async () => {
    const hits = await vault.search("cognitive load");
    expect(hits[0]?.path).toBe("Topics/Cognitive load.md");
    expect(hits.map((hit) => hit.path)).toContain("Topics/Working memory.md");
  });

  test("matches CJK text as a substring", async () => {
    const hits = await vault.search("乌龙茶");
    expect(hits.map((hit) => hit.path)).toEqual(["Notes/乌龙茶.md"]);
    expect(hits[0]?.snippet).toContain("乌龙茶");
  });

  test("returns the same summary as list, plus score and snippet", async () => {
    const [hit] = await vault.search("student of Socrates", { type: "person" });
    const [listed] = (await vault.list({ type: "person" })).filter((note) => note.path === hit?.path);
    expect(hit).toMatchObject({ ...listed, snippet: expect.stringContaining("Socrates") });
    expect(hit).toMatchObject({ created: "2026-09-01 10:00", modified: "2026-09-20 08:30", tags: ["philosophy"] });
  });

  test("selects summary fields and frontmatter keys, null when absent", async () => {
    const hits = await vault.search("student of Socrates");
    expect(await vault.select(hits.slice(0, 1), ["path", "score", "born", "rating"])).toEqual([
      { path: "People/Plato.md", score: hits[0]?.score, born: -428, rating: null },
    ]);
  });

  test("matches Latin words on word boundaries and honours filters", async () => {
    expect(await vault.search("cogn")).toEqual([]);
    expect((await vault.search("load", { under: "People" })).map((hit) => hit.path)).toEqual([]);
    expect(await vault.search("   ")).toEqual([]);
  });
});
