import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError, NotFoundError, OPERATION_KINDS, OPERATIONS, PermissionError, Vault } from "tsuzuri";
import { TOOLS } from "tsuzuri/tools";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");

/** Every file under a vault with its content, to show a refused write changed nothing. */
function snapshot(root: string): Record<string, string> {
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return Object.fromEntries(
    files.map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [path.slice(root.length), readFileSync(path, "utf8")];
    }),
  );
}

describe("the operations table", () => {
  test("names every Vault method that touches files, each with a kind", () => {
    // TypeScript's private methods are still on the prototype, so the internal ones are named here. A new public
    // method that is in neither list fails this test until it is added to the table.
    const internal = ["constructor", "reload", "allows", "skipped", "operations", "definition", "run", "change"];
    internal.push("recorded", "captureAs", "reachable", "resolve");
    internal.push("visibleResolution", "load", "graph", "scan", "paths", "fingerprint");
    const methods = Object.getOwnPropertyNames(Vault.prototype).filter((name) => !internal.includes(name));
    expect(methods.sort()).toEqual(Object.keys(OPERATIONS).sort());
    for (const kind of Object.values(OPERATIONS)) expect(OPERATION_KINDS).toContain(kind);
  });

  test("is what every CLI command and agent tool runs", () => {
    const help = JSON.parse(spawnSync("node", [CLI, "help", "--json"], { encoding: "utf8" }).stdout) as {
      commands: { name: string; operation?: string }[];
    };
    for (const { name, operation } of help.commands) {
      if (name === "help") continue;
      expect(operation !== undefined && operation in OPERATIONS, name).toBe(true);
    }
    for (const { name, operation } of TOOLS) expect(Object.keys(OPERATIONS), name).toContain(operation);
  });
});

describe("a mask", () => {
  test("allows everything when unset", async () => {
    const result = await new Vault(copyVault()).write("Notes/Free.md", "x\n");
    expect(result.written).toBe(true);
  });

  test("allows by kind, refusing other kinds before touching a file", async () => {
    const root = copyVault();
    const before = snapshot(root);
    const vault = new Vault(root, { allow: ["read"] });
    expect((await vault.get("Cognitive load")).path).toBe("Topics/Cognitive load.md");
    await expect(vault.append("Cognitive load", "- more")).rejects.toThrow(PermissionError);
    await expect(vault.setProperty("Cognitive load", "status", "done")).rejects.toThrow(PermissionError);
    await expect(vault.write("Notes/New.md", "x\n")).rejects.toThrow(PermissionError);
    await expect(vault.capture({ text: "an idea" })).rejects.toThrow("does not allow capture");
    expect(snapshot(root)).toEqual(before);
  });

  test("allows one operation by name without the rest of its kind", async () => {
    const root = copyVault();
    const vault = new Vault(root, { allow: ["read", "capture"] });
    expect((await vault.capture({ text: "an idea" }, { dryRun: true })).path).toBe("Inbox/an idea.md");
    await expect(vault.create("book", "Dune", { dryRun: true })).rejects.toThrow("does not allow create");
  });

  test("limits a rule to folders, refusing every path outside them", async () => {
    const root = copyVault();
    const before = snapshot(root);
    const vault = new Vault(root, { allow: ["read", { ops: ["create", "edit"], under: ["Inbox"] }] });
    for (const path of ["Notes/Out.md", "Inbox/../Notes/Out.md", "INBOX/../Notes/Out.md", "../Out.md"]) {
      await expect(vault.write(path, "x\n"), path).rejects.toThrow();
    }
    await expect(vault.write("Notes/Out.md", "x\n")).rejects.toThrow(PermissionError);
    await expect(vault.append("Topics/Cognitive load.md", "- more")).rejects.toThrow(PermissionError);
    await expect(vault.put("Topics/Cognitive load.md", "gone\n")).rejects.toThrow(PermissionError);
    // By name, a note outside the folders is simply not there for the operation.
    await expect(vault.append("Cognitive load", "- more")).rejects.toThrow(NotFoundError);
    expect(snapshot(root)).toEqual(before);

    expect((await vault.append("Existing idea", "- more")).path).toBe("Inbox/Existing idea.md");
    expect((await vault.write("Inbox/New.md", "x\n")).written).toBe(true);
    expect((await vault.put("Inbox/New.md", "y\n")).written).toBe(true);
    expect((await vault.capture({ text: "an idea" })).path).toBe("Inbox/an idea.md");
    expect(existsSync(join(root, "Notes", "Out.md"))).toBe(false);
  });

  test("checks where a capture would land before writing it", async () => {
    const vault = new Vault(copyVault(), { allow: [{ ops: ["capture"], under: ["Notes"] }] });
    await expect(vault.capture({ text: "an idea" })).rejects.toThrow("does not allow capture on Inbox/an idea.md");
  });

  test("hides the notes outside a read rule's folders from every read", async () => {
    const vault = new Vault(FIXTURE, { allow: [{ ops: ["read"], under: ["Topics"] }] });
    const inTopics = (paths: string[]) => paths.every((path) => path.startsWith("Topics/"));
    const paths = (items: { path: string }[]) => items.map((item) => item.path);

    expect(inTopics(paths(await vault.notes()))).toBe(true);
    expect(inTopics(paths(await vault.list()))).toBe(true);
    expect(paths(await vault.search("Plato"))).toEqual(["Topics/Cognitive load.md"]);
    expect(paths(await vault.suggest("plato"))).toEqual([]);
    expect(inTopics((await vault.grep("memory")).map((hit) => hit.path))).toBe(true);
    await expect(vault.get("People/Plato.md")).rejects.toThrow(PermissionError);
    await expect(vault.get("Plato")).rejects.toThrow(NotFoundError);

    expect(paths(await vault.backlinks("Cognitive load"))).toEqual(["Topics/index.md"]);
    const links = await vault.links("Cognitive load");
    expect(links.map((link) => link.target)).not.toContain("History/Overview");
    expect(links.find((link) => link.target === "Plato")?.resolution).toEqual({ status: "ambiguous", candidates: [] });
    for (const { from } of await vault.unresolved()) expect(from.startsWith("Topics/")).toBe(true);
    expect((await vault.nav()).folders.map((folder) => folder.path)).toEqual(["Topics"]);
  });

  test("refuses a rule that names nothing, or a folder outside the vault", () => {
    expect(() => new Vault(FIXTURE, { allow: ["everything" as "read"] })).toThrow(ConfigError);
    expect(() => new Vault(FIXTURE, { allow: [{ ops: ["read"], under: ["../elsewhere"] }] })).toThrow(ConfigError);
  });
});
