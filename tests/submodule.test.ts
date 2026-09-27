/**
 * A vault as a real one often sits: checked out as a submodule of another repository, and shared on one machine
 * between its owner and a bot. The bot captures without Git, so the owner's staged and unstaged work stays theirs.
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { git, gitVault } from "./git.ts";

const NOTE = "Topics/Working memory.md";

/** A superproject whose `vault/` is a submodule checkout of the fixture: its `.git` is a `gitdir:` file. */
function submoduleVault(): { superproject: string; root: string } {
  const { remote } = gitVault();
  const superproject = mkdtempSync(join(tmpdir(), "tsuzuri-super-"));
  git(superproject, "init", "--quiet", "--initial-branch=main");
  git(superproject, "config", "user.name", "owner");
  git(superproject, "config", "user.email", "owner@example.com");
  git(superproject, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", remote, "vault");
  git(superproject, "commit", "--quiet", "-m", "add the vault");
  const root = join(superproject, "vault");
  git(root, "config", "user.name", "owner");
  git(root, "config", "user.email", "owner@example.com");
  return { superproject, root };
}

describe("a vault checked out as a submodule", () => {
  test("a vault at the superproject's root skips the checked-out submodule", async () => {
    const { superproject } = submoduleVault();
    writeFileSync(join(superproject, "Readme.md"), "the superproject's own note\n");
    const paths = (await new Vault(superproject).notes()).map((note) => note.path);
    expect(paths).toEqual(["Readme.md"]);
  });
});

describe("a bot sharing its owner's checkout", () => {
  test("captures one new file and leaves the owner's staged and unstaged work alone", async () => {
    const { root } = gitVault();
    writeFileSync(join(root, "Home.md"), "staged by the owner\n");
    git(root, "add", "Home.md");
    writeFileSync(join(root, NOTE), "edited, not staged\n");
    const staged = git(root, "diff", "--cached");
    const bot = new Vault(root, { watch: 0 });
    const result = await bot.capture({ text: "From the bot", tags: ["inbox"] });
    expect(result).toMatchObject({ path: "Inbox/From the bot.md", written: true });
    const names = (...args: string[]) => git(root, "-c", "core.quotePath=false", ...args);
    expect(names("diff", "--cached", "--name-only")).toBe("Home.md");
    expect(names("diff", "--name-only")).toBe(NOTE);
    expect(names("ls-files", "--others", "--exclude-standard")).toBe("Inbox/From the bot.md");
    expect(git(root, "diff", "--cached")).toBe(staged);
  });

  test("a watching reader sees the owner's uncommitted edit on its next read", async () => {
    const { root } = gitVault();
    const bot = new Vault(root, { watch: 0 });
    expect((await bot.get(NOTE)).body).not.toContain("draft in progress");
    writeFileSync(join(root, NOTE), "a draft in progress, longer than the note was\n");
    expect((await bot.get(NOTE)).body).toBe("a draft in progress, longer than the note was\n");
    expect(existsSync(join(root, ".git", "index.lock"))).toBe(false);
  });
});
