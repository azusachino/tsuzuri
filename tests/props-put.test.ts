import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundError, propertyValue, Vault, WriteConflictError } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const COMMENTED = [
  "---",
  "# kept by the owner",
  "zeta: 1 # why zeta comes first",
  'title: "A quoted title"',
  "tags:",
  "  - a",
  "  - b",
  "alpha: [x, y]",
  "---",
  "",
  "Body stays.",
  "",
].join("\n");

function vaultWith(name: string, content: string): { vault: Vault; read: () => string; root: string } {
  const root = copyVault();
  writeFileSync(join(root, name), content);
  return { root, vault: new Vault(root), read: () => readFileSync(join(root, name), "utf8") };
}

describe("prop set", () => {
  test("keeps comments, key order, quoting, and every other line", async () => {
    const { vault, read } = vaultWith("Commented.md", COMMENTED);
    await vault.setProperty("Commented", "zeta", 2);
    await vault.setProperty("Commented", "rating", 4);
    expect(read()).toBe(
      COMMENTED.replace("zeta: 1 #", "zeta: 2 #").replace("alpha: [x, y]\n", "alpha: [x, y]\nrating: 4\n"),
    );
    expect((await vault.find("Commented")).frontmatter).toMatchObject({ zeta: 2, rating: 4, title: "A quoted title" });
  });

  test("fills an empty frontmatter block instead of adding a second one", async () => {
    const { vault, read } = vaultWith("Empty.md", "---\n---\nBody.\n\n---\n\nAfter a rule.\n");
    expect((await vault.find("Empty")).body).toBe("Body.\n\n---\n\nAfter a rule.\n");
    await vault.setProperty("Empty", "status", "draft");
    expect(read()).toBe("---\nstatus: draft\n---\nBody.\n\n---\n\nAfter a rule.\n");
    expect(await vault.outline("Empty")).toEqual([]);
  });

  test("adds a block to a note without frontmatter, leaving the body as it was", async () => {
    const { vault, read } = vaultWith("Plain.md", "Just text.\n");
    await vault.setProperty("Plain", "status", "draft");
    expect(read()).toBe("---\nstatus: draft\n---\nJust text.\n");
  });

  test("refuses frontmatter YAML cannot parse, and reads CLI values as YAML", async () => {
    const { vault } = vaultWith("Broken.md", "---\nkey: [unclosed\n---\nbody\n");
    await expect(vault.setProperty("Broken", "x", 1)).rejects.toThrow(WriteConflictError);
    expect(propertyValue("4")).toBe(4);
    expect(propertyValue("[a, b]")).toEqual(["a", "b"]);
    expect(propertyValue("true")).toBe(true);
    expect(propertyValue("plain words")).toBe("plain words");
    expect(propertyValue("2026-09-25")).toBe("2026-09-25");
  });

  test("works from the CLI, negative numbers included", () => {
    const { root, read } = vaultWith("Commented.md", COMMENTED);
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    expect(run("prop", "set", "Commented", "born", "-428").status).toBe(0);
    expect(run("prop", "set", "Commented", "genre", "[sf, classic]").status).toBe(0);
    expect(read()).toContain("born: -428\ngenre:\n  - sf\n  - classic\n---");
    expect(run("prop", "set", "Commented", "x").status).toBe(2);
  });
});

describe("write", () => {
  test("creates a note at any .md path in the vault, and refuses an existing file", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    expect(await vault.write("Deep/New/Place.md", "# New\n")).toMatchObject({ created: true, written: true });
    expect(readFileSync(join(root, "Deep", "New", "Place.md"), "utf8")).toBe("# New\n");
    expect((await vault.get("Place")).path).toBe("Deep/New/Place.md");
    await expect(vault.write("Deep/New/Place.md", "again\n")).rejects.toThrow("write only creates");
    expect(readFileSync(join(root, "Deep", "New", "Place.md"), "utf8")).toBe("# New\n");
  });

  test("refuses paths outside the vault or not ending in .md", async () => {
    const vault = new Vault(copyVault());
    for (const path of ["../escape.md", "/abs.md", "Notes/x.txt", "Notes/../../out.md", ".."]) {
      await expect(vault.write(path, "x"), path).rejects.toThrow(WriteConflictError);
    }
  });

  test("reports a dry run without writing", async () => {
    const root = copyVault();
    const result = await new Vault(root).write("Notes/Dry.md", "x\n", { dryRun: true });
    expect(result).toMatchObject({ path: "Notes/Dry.md", created: true, written: false });
    expect(existsSync(join(root, "Notes", "Dry.md"))).toBe(false);
  });
});

describe("put", () => {
  test("replaces a whole note by any reference, with no hash needed", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const replaced = await vault.put("Existing idea", "# Replaced\n");
    expect(replaced).toMatchObject({ path: "Inbox/Existing idea.md", created: false, written: true });
    expect(readFileSync(join(root, "Inbox", "Existing idea.md"), "utf8")).toBe("# Replaced\n");
  });

  test("refuses a stale hash, and a note that does not exist", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const { hash } = await vault.get("Existing idea");
    expect((await vault.put("Existing idea", "# First\n", { ifHash: hash })).written).toBe(true);
    await expect(vault.put("Existing idea", "# Stale\n", { ifHash: hash })).rejects.toThrow(WriteConflictError);
    expect(readFileSync(join(root, "Inbox", "Existing idea.md"), "utf8")).toBe("# First\n");
    await expect(vault.put("Notes/Nowhere.md", "x")).rejects.toThrow(NotFoundError);
    expect(existsSync(join(root, "Notes", "Nowhere.md"))).toBe(false);
  });

  test("takes text, --file, or stdin from the CLI, and exits 1 when refused", () => {
    const root = copyVault();
    const run = (args: string[], input?: string) =>
      spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8", input });
    expect(run(["write", "Notes/From stdin.md"], "piped\n").status).toBe(0);
    expect(readFileSync(join(root, "Notes", "From stdin.md"), "utf8")).toBe("piped\n");
    expect(run(["write", "Notes/From stdin.md", "again"]).status).toBe(1);
    expect(run(["put", "From stdin", "replaced"]).status).toBe(0);
    expect(readFileSync(join(root, "Notes", "From stdin.md"), "utf8")).toBe("replaced");
    expect(run(["put", "Notes/Nowhere.md", "x"]).status).toBe(1);
    expect(run(["write", "Notes/Dry.md", "x", "--dry-run"]).stdout).toContain("+x");
    expect(existsSync(join(root, "Notes", "Dry.md"))).toBe(false);
  });
});
