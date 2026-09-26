/**
 * Invariants checked against real public Obsidian vaults, pinned as submodules under test/vaults/. Exact counts would
 * freeze behaviour this suite cannot confirm against the Obsidian app, so these tests assert properties any correct
 * reader must hold. A corpus that is not checked out is skipped; `make corpus` fetches the opt-in ones.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";

const VAULTS = join(import.meta.dirname, "vaults");
const present = (dir: string) => existsSync(dir) && readdirSync(dir).length > 0;

/** Markdown files outside dot folders, counted independently of the scanner. */
function markdownFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return markdownFiles(root, path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

async function expectConsistentLinks(vault: Vault): Promise<void> {
  const notes = await vault.notes();
  const paths = new Set(notes.map((note) => note.path));
  const stems = new Set(notes.map((note) => posix.basename(note.path, ".md").toLowerCase()));
  for (const note of notes) {
    for (const { target, resolution } of await vault.links(note.path)) {
      if (resolution.status === "resolved") expect(paths.has(resolution.path)).toBe(true);
      if (resolution.status === "ambiguous") expect(resolution.candidates.length).toBeGreaterThan(1);
      if (resolution.status === "missing") {
        const wanted = target.replace(/\.md$/i, "").toLowerCase();
        expect(wanted.includes("/") || !stems.has(wanted)).toBe(true);
      }
    }
  }
}

const KEPANO = join(VAULTS, "kepano-obsidian");

describe.skipIf(!present(KEPANO))("kepano-obsidian", () => {
  const vault = new Vault(KEPANO);

  test("reads every Markdown note, each with a title", async () => {
    const notes = await vault.notes();
    expect(notes.length).toBe(markdownFiles(KEPANO).length);
    expect(notes.every((note) => note.title.trim() !== "")).toBe(true);
  });

  test("resolves links consistently", async () => {
    await expectConsistentLinks(vault);
  });

  test("counts category links written in frontmatter", async () => {
    const orphans = new Set((await vault.orphans()).map((note) => note.path));
    expect(orphans.has("Categories/Books.md")).toBe(false);
    expect((await vault.backlinks("Categories/Books")).length).toBeGreaterThan(1);
  });

  test("reads nothing from the vault's own .obsidian settings", () => {
    expect(existsSync(join(KEPANO, ".obsidian", "daily-notes.json"))).toBe(true);
    expect(vault.settings.templates).toBeUndefined();
    expect(vault.settings.capture.folder).toBe("");
  });

  test("finds template notes by title", async () => {
    const hits = await vault.search("template", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.path.startsWith("Templates/"))).toBe(true);
  });
});

const HELP = join(VAULTS, "obsidian-help");

describe.skipIf(!present(HELP))("obsidian-help (opt-in: make corpus)", () => {
  for (const language of ["en", "zh"]) {
    test(`${language}: reads every note and resolves links consistently`, async () => {
      const vault = new Vault(join(HELP, language));
      expect((await vault.notes()).length).toBe(markdownFiles(join(HELP, language)).length);
      await expectConsistentLinks(vault);
    });
  }

  test("zh: finds Chinese text", async () => {
    const hits = await new Vault(join(HELP, "zh")).search("链接", { limit: 5 });
    expect(hits.length).toBe(5);
    expect(hits.every((hit) => hit.snippet.includes("链接") || hit.title.includes("链接"))).toBe(true);
  });

  test("loads the whole repository, every language at once, within two seconds", async () => {
    const vault = new Vault(HELP);
    const started = performance.now();
    const notes = await vault.notes();
    expect(notes.length).toBe(markdownFiles(HELP).length);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
