/** Temporary vaults and Git repositories for the tests that write. */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURE = join(import.meta.dirname, "fixtures", "vault");

/** A throwaway copy of the fixture vault, outside any Git repository. */
export function copyVault(): string {
  const root = mkdtempSync(join(tmpdir(), "tsuzuri-vault-"));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** A copy of the fixture committed to a fresh repository whose `origin` is a bare repository. */
export function gitVault(): { root: string; remote: string } {
  const remote = mkdtempSync(join(tmpdir(), "tsuzuri-remote-"));
  git(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const root = copyVault();
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.name", "owner");
  git(root, "config", "user.email", "owner@example.com");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--quiet", "-u", "origin", "main");
  return { root, remote };
}
