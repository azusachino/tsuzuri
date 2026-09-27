import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MoveResult, PermissionError, Vault, WriteConflictError } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const KEPANO = join(import.meta.dirname, "vaults", "kepano-obsidian");
const kepanoPresent = existsSync(KEPANO) && readdirSync(KEPANO).length > 0;

/** Each note's links in order, as the path each resolves to, or its status when it resolves to no one note. */
async function resolutions(vault: Vault): Promise<Map<string, string[]>> {
  const all = new Map<string, string[]>();
  for (const note of await vault.notes()) {
    const links = await vault.links(note.path);
    all.set(
      note.path,
      links.map(({ resolution }) => (resolution.status === "resolved" ? resolution.path : resolution.status)),
    );
  }
  return all;
}

/** Move, then require every link to resolve as before, with the moved path mapped, and nothing newly unresolved. */
async function moveKeepingLinks(root: string, from: string, to: string): Promise<MoveResult> {
  const vault = new Vault(root);
  const before = await resolutions(vault);
  const unresolvedBefore = (await vault.unresolved()).length;
  const result = await vault.move(from, to);
  const place = (path: string) => (path === from ? to : path);
  const after = await resolutions(new Vault(root));
  expect([...after.keys()].sort()).toEqual([...before.keys()].map(place).sort());
  for (const [path, targets] of before) expect(after.get(place(path)), path).toEqual(targets.map(place));
  expect((await new Vault(root).unresolved()).length).toBeLessThanOrEqual(unresolvedBefore);
  return result;
}

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

describe("move", () => {
  test("renames a note, rewriting every link to it and keeping headings and display text", async () => {
    const root = copyVault();
    writeFileSync(
      join(root, "Topics", "Code.md"),
      "Code: `[[Working memory]]`\n\n<div>\n[[Working memory]]\n</div>\n\nReal: [[Working memory]]\n",
    );
    await moveKeepingLinks(root, "Topics/Working memory.md", "Topics/Short-term memory.md");
    const note = read(root, "Topics/Cognitive load.md");
    expect(note).toContain("[[Short-term memory]] and [[Short-term memory|wm]]");
    expect(note).toContain("[[Short-term memory#Capacity|capacity]]");
    expect(note).toContain("| [[Short-term memory\\|wm]] |");
    expect(note).not.toContain("Working memory]]");
    expect(read(root, "Topics/Code.md")).toBe(
      "Code: `[[Working memory]]`\n\n<div>\n[[Working memory]]\n</div>\n\nReal: [[Short-term memory]]\n",
    );
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(false);
    expect((await new Vault(root).get("Short-term memory")).path).toBe("Topics/Short-term memory.md");
  });

  test("moves across folders, keeping relative links from and to the note, and its attachments", async () => {
    const root = copyVault();
    writeFileSync(
      join(root, "Topics", "Rel.md"),
      "[see](./Working%20memory.md) [up](../History/Overview.md) ![img](<./diagram one.png>)\n",
    );
    writeFileSync(join(root, "Topics", "Points at rel.md"), "[rel](./Rel.md#part)\n");
    await moveKeepingLinks(root, "Topics/Rel.md", "Notes/Deep/Rel.md");
    expect(read(root, "Notes/Deep/Rel.md")).toBe(
      "[see](../../Topics/Working%20memory.md) [up](../../History/Overview.md) ![img](<../../Topics/diagram one.png>)\n",
    );
    expect(read(root, "Topics/Points at rel.md")).toBe("[rel](../Notes/Deep/Rel.md#part)\n");
  });

  test("rewrites parsed frontmatter links while leaving comments and other YAML intact", async () => {
    const root = copyVault();
    writeFileSync(join(root, "Target.md"), "target\n");
    writeFileSync(
      join(root, "Ref.md"),
      [
        "---",
        'related: "[[\\x54arget]]" # keep',
        "list:",
        '  - "[[Target]]"',
        "block: |",
        "  [[Target]]",
        "# [[Target]] is a comment",
        "---",
        "Body [[Target]]",
        "",
      ].join("\n"),
    );
    const vault = new Vault(root);
    expect((await vault.links("Ref.md")).filter((link) => link.resolution.status === "resolved")).toHaveLength(4);
    await vault.move("Target.md", "Renamed.md");
    expect(read(root, "Ref.md")).toBe(
      [
        "---",
        'related: "[[Renamed]]" # keep',
        "list:",
        '  - "[[Renamed]]"',
        "block: |",
        "  [[Renamed]]",
        "# [[Target]] is a comment",
        "---",
        "Body [[Renamed]]",
        "",
      ].join("\n"),
    );
    expect((await vault.links("Ref.md")).filter((link) => link.resolution.status === "resolved")).toHaveLength(4);
  });

  test("refuses a move when YAML escapes hide a link's delimiters", async () => {
    const root = copyVault();
    writeFileSync(join(root, "Target.md"), "target\n");
    const original = '---\nrelated: "\\x5b\\x5bTarget]]"\n---\n';
    writeFileSync(join(root, "Ref.md"), original);
    const vault = new Vault(root);
    expect((await vault.links("Ref.md"))[0]?.resolution).toEqual({ status: "resolved", path: "Target.md" });
    await expect(vault.move("Target.md", "Renamed.md")).rejects.toThrow(WriteConflictError);
    expect(read(root, "Ref.md")).toBe(original);
    expect(read(root, "Target.md")).toBe("target\n");
  });

  test("writes a path wherever a name the move makes ambiguous would no longer find its note", async () => {
    const root = copyVault();
    await moveKeepingLinks(root, "Topics/Working memory.md", "Notes/Cognitive load.md");
    // Home.md is at the root, where the name now matches two notes; Topics/index.md still prefers its own folder.
    expect(read(root, "Home.md")).toContain("[[Topics/Cognitive load]]");
    expect(read(root, "Topics/index.md")).toContain("1. [[Cognitive load]]");
    expect(read(root, "Topics/Cognitive load.md")).toContain("[[Notes/Cognitive load#Capacity|capacity]]");
  });

  test("a dry run returns every diff and changes nothing", async () => {
    const root = copyVault();
    const before = read(root, "Topics/Cognitive load.md");
    const result = await new Vault(root).move("Working memory", "Topics/Short-term memory.md", { dryRun: true });
    expect(result).toMatchObject({
      from: "Topics/Working memory.md",
      to: "Topics/Short-term memory.md",
      written: false,
    });
    expect(result.diff).toContain("+++ b/Topics/Short-term memory.md");
    expect(result.rewritten.map((write) => write.path)).toEqual(["Topics/Cognitive load.md"]);
    expect(result.rewritten[0]?.diff).toContain("+- Background: [[Short-term memory]]");
    expect(read(root, "Topics/Cognitive load.md")).toBe(before);
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(true);
  });

  test("refuses an existing target, a path outside the vault, and a stale hash, changing nothing", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    await expect(vault.move("Working memory", "Topics/Cognitive load.md")).rejects.toThrow("exists");
    await expect(vault.move("Working memory", "../out.md")).rejects.toThrow(WriteConflictError);
    await expect(vault.move("Working memory", "Topics/x.txt")).rejects.toThrow(WriteConflictError);
    await expect(vault.move("Working memory", "Topics/Elsewhere.md", { ifHash: "0" })).rejects.toThrow("changed");
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(true);
  });

  test.skipIf(process.platform !== "linux")("a case-only move cannot overwrite a different note", async () => {
    const root = copyVault();
    writeFileSync(join(root, "A.md"), "first\n");
    writeFileSync(join(root, "a.md"), "second\n");
    await expect(new Vault(root).move("A.md", "a.md")).rejects.toThrow(WriteConflictError);
    expect(read(root, "A.md")).toBe("first\n");
    expect(read(root, "a.md")).toBe("second\n");
  });

  test("a case-only move renames its own file", async () => {
    const root = copyVault();
    const result = await new Vault(root).move("Topics/Working memory.md", "Topics/WORKING MEMORY.md");
    expect(result.written).toBe(true);
    expect((await new Vault(root).get("Topics/WORKING MEMORY.md")).path).toBe("Topics/WORKING MEMORY.md");
  });

  test("refuses when a note it would rewrite changed since the scan", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    await vault.notes();
    const edited = `${read(root, "Topics/Cognitive load.md")}\nEdited meanwhile.\n`;
    writeFileSync(join(root, "Topics", "Cognitive load.md"), edited);
    await expect(vault.move("Working memory", "Topics/Short-term memory.md")).rejects.toThrow("changed since tsuzuri");
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(true);
    expect(read(root, "Topics/Cognitive load.md")).toBe(edited);
  });

  test("under a mask, needs move for both paths and edit for every note it rewrites", async () => {
    const root = copyVault();
    const before = read(root, "Topics/Cognitive load.md");
    const noEdit = new Vault(root, { allow: ["read", "move"] });
    await expect(noEdit.move("Working memory", "Topics/Short-term memory.md")).rejects.toThrow(PermissionError);
    const scoped = new Vault(root, { allow: ["read", "edit", { ops: ["move"], under: ["Topics"] }] });
    await expect(scoped.move("Working memory", "Notes/Short-term memory.md")).rejects.toThrow(PermissionError);
    expect(read(root, "Topics/Cognitive load.md")).toBe(before);
    const allowed = new Vault(root, { allow: ["read", "edit", "move"] });
    expect((await allowed.move("Working memory", "Topics/Short-term memory.md")).written).toBe(true);
  });

  test("runs from the CLI, printing each diff on a dry run", () => {
    const root = copyVault();
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    const dry = run("move", "Working memory", "Topics/Short-term memory.md", "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("+- Background: [[Short-term memory]]");
    const done = run("move", "Working memory", "Topics/Short-term memory.md");
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("rewrote\tTopics/Cognitive load.md");
    expect(run("move", "Working memory").status).toBe(2);
  });
});

describe.skipIf(!kepanoPresent)("move on kepano-obsidian", () => {
  test("keeps a real frontmatter link and the surrounding note intact", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-kepano-frontmatter-"));
    try {
      cpSync(KEPANO, root, { recursive: true, filter: (path) => path !== join(KEPANO, ".git") });
      await new Vault(root).move("Categories/Podcast episodes.md", "Categories/Podcast notes.md");
      expect(read(root, "Categories/Podcasts.md")).toBe(
        '---\ntags:\n  - categories\nrelated: "[[Podcast notes]]"\n---\n\n![[Podcasts.base]]\n',
      );
      expect((await new Vault(root).links("Categories/Podcasts.md"))[0]?.resolution).toEqual({
        status: "resolved",
        path: "Categories/Podcast notes.md",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("renames the most linked note and moves another across folders, breaking no link", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-kepano-move-"));
    cpSync(KEPANO, root, { recursive: true, filter: (path) => path !== join(KEPANO, ".git") });
    const vault = new Vault(root);
    const counted = await Promise.all(
      (await vault.notes()).map(async (note) => [note.path, (await vault.backlinks(note.path)).length] as const),
    );
    const [mostLinked, backlinks] = counted.sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const renamed = await moveKeepingLinks(root, mostLinked, mostLinked.replace(/[^/]+\.md$/, "Renamed by tsuzuri.md"));
    expect(renamed.rewritten.length).toBe(backlinks);

    const other = counted.find(([path]) => path.includes("/") && path !== mostLinked)?.[0] ?? "";
    await moveKeepingLinks(root, other, `Moved/Deeper/${other.split("/").pop()}`);
  });
});
