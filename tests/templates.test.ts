import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureInputFromMarkdown,
  NotFoundError,
  propertyValue,
  type TsuzuriConfig,
  UnsupportedError,
  Vault,
} from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const NOW = new Date(2026, 8, 24, 19, 5);
const KEPANO = join(import.meta.dirname, "vaults", "kepano-obsidian");
const kepanoPresent = existsSync(KEPANO) && readdirSync(KEPANO).length > 0;
/** A note's frontmatter, parsed through the prelude's YAML reading, and the text after it. */
function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const data = match ? (propertyValue(match[1] ?? "") as Record<string, unknown>) : {};
  return {
    data: typeof data === "object" && data !== null ? data : {},
    body: match ? text.slice(match[0].length) : text,
  };
}

const SETTINGS = { folder: "Templates", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm", source: "tsuzuri.toml" };

describe("template settings", () => {
  test("come from tsuzuri.toml or code options, and nothing is assumed", () => {
    expect(new Vault(FIXTURE).settings.templates).toEqual(SETTINGS);
    const config: TsuzuriConfig = { templates: { folder: "Notes", date_format: "DD.MM.YYYY" } };
    expect(new Vault(FIXTURE, { config }).settings.templates).toMatchObject({
      folder: "Notes",
      dateFormat: "DD.MM.YYYY",
      source: "options",
    });
    const bare = copyVault();
    writeFileSync(join(bare, "tsuzuri.toml"), '[capture]\nfolder = "Inbox"\n');
    mkdirSync(join(bare, ".obsidian"), { recursive: true });
    writeFileSync(join(bare, ".obsidian", "templates.json"), '{ "folder": "Templates" }');
    expect(new Vault(bare).settings.templates).toBeUndefined();
  });
});

describe("new", () => {
  test("creates a note from the fixture's template, placed and checked as capture does", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const result = await vault.create("book", "Dune", { now: NOW });
    expect(result.path).toBe("Inbox/Dune.md");
    const { data, body } = splitFrontmatter(readFileSync(join(root, result.path), "utf8"));
    expect(data).toMatchObject({ type: "book", year: "2026", tags: ["reading"], author: null, rating: null });
    expect(body).toContain("# Dune");
    expect(body).toContain("Started 2026-09-24 at 19:05.");
    expect((await vault.find("Dune")).path).toBe("Inbox/Dune.md");
  });

  test("applies the vault's capture rules, and adds tags", async () => {
    const vault = new Vault(copyVault(), {
      config: { capture: { folder: "queue", filename: "slug", tag_style: "kebab", properties: ["title", "tags"] } },
    });
    const result = await vault.create("book", "The Left Hand of Darkness", { now: NOW, tags: ["Science Fiction"] });
    expect(result.path).toBe("queue/the-left-hand-of-darkness.md");
    expect(splitFrontmatter(result.content).data).toMatchObject({
      title: "The Left Hand of Darkness",
      tags: ["reading", "science-fiction"],
    });
  });

  test("names the templates that exist when the type has none, and needs a template folder", async () => {
    await expect(new Vault(copyVault()).create("song", "x")).rejects.toThrow("there are: Book");
    await expect(new Vault(copyVault()).create("song", "x")).rejects.toThrow(NotFoundError);
    const bare = copyVault();
    writeFileSync(join(bare, "tsuzuri.toml"), '[capture]\nfolder = "Inbox"\n');
    await expect(new Vault(bare).create("book", "x")).rejects.toThrow(UnsupportedError);
  });

  test("keeps a template's own title, tags, and source even when the capture settings do not declare them", async () => {
    const root = copyVault();
    writeFileSync(
      join(root, "Templates", "Note.md"),
      '---\ntitle: "{{title}}"\ntags:\n  - idea\nsource: "{{date}}"\nkind: note\n---\n\nbody\n',
    );
    const vault = new Vault(root, { config: { capture: { folder: "Inbox", properties: ["created"] } } });
    const { content } = await vault.create("note", "Dune", { now: NOW, dryRun: true });
    expect(splitFrontmatter(content).data).toEqual({
      created: "2026-09-24",
      title: "Dune",
      tags: ["idea"],
      source: "2026-09-24",
      kind: "note",
    });
  });
});

describe("capture from a Markdown file", () => {
  test("keeps the file's title property, which the default capture settings do not declare", async () => {
    const input = captureInputFromMarkdown("---\ntitle: A drafted idea\nkind: draft\n---\n\nbody\n", "draft.md");
    const { content } = await new Vault(copyVault()).capture({ ...input, now: NOW }, { dryRun: true });
    expect(splitFrontmatter(content).data).toEqual({ title: "A drafted idea", kind: "draft" });
  });
});

// kepano-obsidian names its templates folder only in .obsidian, which tsuzuri does not read (ADR 0011).
const KEPANO_TEMPLATES = { config: { templates: { folder: "Templates" } } };

describe.skipIf(!kepanoPresent)("kepano-obsidian templates", () => {
  test("a book renders with valid frontmatter, its properties, blanks, and tags kept", async () => {
    const result = await new Vault(KEPANO, KEPANO_TEMPLATES).create("book", "Dune", { now: NOW, dryRun: true });
    const { data } = splitFrontmatter(result.content);
    expect(result.written).toBe(false);
    expect(data).toMatchObject({ categories: ["[[Books]]"], created: "2026-09-24", tags: ["to-read"], cover: null });
  });

  test("every template renders to parseable frontmatter", async () => {
    const vault = new Vault(KEPANO, KEPANO_TEMPLATES);
    const types = readdirSync(join(KEPANO, "Templates"))
      .filter((name) => name.endsWith(" Template.md"))
      .map((name) => name.replace(/ Template\.md$/, ""));
    expect(types.length).toBeGreaterThan(10);
    for (const type of types) {
      const { content } = await vault.create(type, `A ${type}`, { now: NOW, dryRun: true });
      if (content.startsWith("---\n")) expect(Object.keys(splitFrontmatter(content).data).length).toBeGreaterThan(0);
      expect(content).not.toContain("{{date");
    }
  });
});
