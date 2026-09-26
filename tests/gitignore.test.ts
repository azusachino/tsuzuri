import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFoundError, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { FIXTURE } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

/**
 * A copy of the fixture with a .gitignore. It is built per test rather than checked in: a .gitignore inside the
 * fixture would also apply to this repository and keep the ignored notes out of it.
 */
function ignoringVault(): string {
  const root = mkdtempSync(join(tmpdir(), "tsuzuri-ignore-"));
  cpSync(FIXTURE, root, { recursive: true });
  writeFileSync(join(root, ".gitignore"), "Drafts/\n*.private.md\n!Notes/keep.private.md\n");
  mkdirSync(join(root, "Drafts"));
  writeFileSync(join(root, "Drafts", "Secret plan.md"), "---\ntags: [secret]\n---\n\nzephyr plan [[Home]]\n");
  writeFileSync(join(root, "Notes", "diary.private.md"), "zephyr diary\n");
  writeFileSync(join(root, "Notes", "keep.private.md"), "zephyr kept\n");
  return root;
}

describe("the vault's .gitignore", () => {
  test("hides ignored folders and globs from every read, and honours negation", async () => {
    const vault = new Vault(ignoringVault());
    const paths = (await vault.notes()).map((note) => note.path);
    expect(paths).toContain("Notes/keep.private.md");
    expect(paths.some((path) => path.startsWith("Drafts/") || path === "Notes/diary.private.md")).toBe(false);

    expect((await vault.grep("zephyr")).map((hit) => hit.path)).toEqual(["Notes/keep.private.md"]);
    expect((await vault.search("zephyr")).map((hit) => hit.path)).toEqual(["Notes/keep.private.md"]);
    expect((await vault.suggest("secret plan")).map((hit) => hit.path)).not.toContain("Drafts/Secret plan.md");
    expect((await vault.tags()).map((entry) => entry.tag)).not.toContain("secret");
    expect((await vault.backlinks("Home")).map((note) => note.path)).not.toContain("Drafts/Secret plan.md");
    expect((await vault.nav()).folders.map((folder) => folder.path)).not.toContain("Drafts");
    await expect(vault.get("Drafts/Secret plan.md")).rejects.toThrow(NotFoundError);
  });

  test("hides ignored notes from the CLI", () => {
    const root = ignoringVault();
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    expect(run("grep", "zephyr", "--format", "paths").stdout).toBe("Notes/keep.private.md\n");
    expect(run("list", "--under", "Drafts", "--json").stdout.trim()).toBe("[]");
    expect(run("get", "Secret plan").status).toBe(1);
  });

  test("changes nothing in a vault without one", async () => {
    expect((await new Vault(FIXTURE).notes()).length).toBeGreaterThan(0);
  });
});
