import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError, PermissionError, Vault, WriteConflictError } from "tsuzuri";
import { TOOLS, validateInput } from "tsuzuri/tools";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const NOW = new Date(2026, 8, 26, 11, 22, 33);

describe("delete", () => {
  test("moves a note into .trash under its path with a timestamp, keeping every byte", async () => {
    const root = copyVault();
    const before = readFileSync(join(root, "Topics", "Working memory.md"));
    const result = await new Vault(root).delete("Working memory", { now: NOW });
    expect(result).toMatchObject({
      path: "Topics/Working memory.md",
      trashed: ".trash/Topics/Working memory.md.20260926112233",
      written: true,
    });
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(false);
    expect(readFileSync(join(root, ".trash", "Topics", "Working memory.md.20260926112233"))).toEqual(before);
  });

  test("hides the note from reads, and leaves links to it unresolved", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const unresolved = (await vault.unresolved()).length;
    await vault.delete("Working memory");
    await expect(vault.get("Working memory")).rejects.toThrow(NotFoundError);
    expect((await vault.notes()).some((note) => note.path.startsWith(".trash"))).toBe(false);
    const now = await vault.unresolved();
    expect(now.length).toBeGreaterThan(unresolved);
    expect(now.map((link) => link.target)).toContain("Working memory");
  });

  test("adds a counter when a note of the same path was trashed in the same second", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    await vault.delete("Existing idea", { now: NOW });
    writeFileSync(join(root, "Inbox", "Existing idea.md"), "again\n");
    vault.reload();
    const second = await vault.delete("Existing idea", { now: NOW });
    expect(second.trashed).toBe(".trash/Inbox/Existing idea.md.20260926112233-2");
    expect(readFileSync(join(root, second.trashed), "utf8")).toBe("again\n");
  });

  test("a dry run and a stale hash change nothing", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const dry = await vault.delete("Working memory", { dryRun: true, now: NOW });
    expect(dry).toMatchObject({ written: false, trashed: ".trash/Topics/Working memory.md.20260926112233" });
    await expect(vault.delete("Working memory", { ifHash: "0" })).rejects.toThrow(WriteConflictError);
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(true);
    // The fixture keeps a .trash of its own, so the check is that nothing was added under the note's folder.
    expect(existsSync(join(root, ".trash", "Topics"))).toBe(false);
    const { hash } = await vault.get("Working memory");
    expect((await vault.delete("Working memory", { ifHash: hash })).written).toBe(true);
  });

  test("under a mask, needs delete for the note's folder", async () => {
    const root = copyVault();
    const before = readFileSync(join(root, "Inbox", "Existing idea.md"));
    await expect(new Vault(root, { allow: ["read", "edit"] }).delete("Existing idea")).rejects.toThrow(PermissionError);
    const inbox = new Vault(root, { allow: ["read", { ops: ["delete"], under: ["Inbox"] }] });
    await expect(inbox.delete("Topics/Working memory.md")).rejects.toThrow(PermissionError);
    expect(existsSync(join(root, "Topics", "Working memory.md"))).toBe(true);
    const deleted = await inbox.delete("Existing idea", { now: NOW });
    expect(deleted.trashed).toBe(".trash/Inbox/Existing idea.md.20260926112233");
    expect(readFileSync(join(root, deleted.trashed))).toEqual(before);
  });

  test("runs from the CLI and as a tool", async () => {
    const root = copyVault();
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    const dry = run("delete", "Existing idea", "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/^Inbox\/Existing idea\.md\t\.trash\/Inbox\/Existing idea\.md\.\d{14}\t\(dry run\)/);
    expect(run("delete", "Existing idea").status).toBe(0);
    expect(run("delete", "Existing idea").status).toBe(1);
    const tool = TOOLS.find((each) => each.name === "tsuzuri_delete");
    if (!tool) throw new Error("no tsuzuri_delete");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const result = await tool.run(new Vault(root), validateInput(tool, { note: "Working memory" }));
    expect(result).toMatchObject({ path: "Topics/Working memory.md", written: true });
  });
});
