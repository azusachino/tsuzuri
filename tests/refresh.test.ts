import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const NOTE = "Topics/Working memory.md";

describe("the watch policy", () => {
  test("a live vault sees a changed and a new file on its next read", async () => {
    const root = copyVault();
    const vault = new Vault(root, { watch: 0 });
    expect((await vault.get(NOTE)).body).toContain("a few items");
    writeFileSync(join(root, NOTE), "Working memory, rewritten while the vault was live.\n");
    writeFileSync(join(root, "Notes", "Arrived.md"), "A note that arrived later.\n");
    expect((await vault.get(NOTE)).body).toBe("Working memory, rewritten while the vault was live.\n");
    expect((await vault.find("Arrived")).path).toBe("Notes/Arrived.md");
  });

  test("without watch, the scan is kept until reload", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    await vault.notes();
    writeFileSync(join(root, "Notes", "Unseen.md"), "not yet\n");
    await expect(vault.find("Unseen")).rejects.toThrow();
    vault.reload();
    expect((await vault.find("Unseen")).path).toBe("Notes/Unseen.md");
  });

  test("checks at most once per interval, so reads in between do not rescan", async () => {
    const root = copyVault();
    const vault = new Vault(root, { watch: 60_000 });
    await vault.notes();
    writeFileSync(join(root, "Notes", "Later.md"), "later\n");
    expect((await vault.notes()).some((note) => note.path === "Notes/Later.md")).toBe(false);
  });

  test("reads that arrive during a scan share it", async () => {
    const vault = new Vault(copyVault());
    const scans = await Promise.all([vault.notes(), vault.notes(), vault.search("memory"), vault.notes()]);
    expect(scans[1]).toBe(scans[0]);
    expect(scans[3]).toBe(scans[0]);
    vault.reload();
    const [again] = await Promise.all([vault.notes(), vault.notes()]);
    expect(again).not.toBe(scans[0]);
  });
});
