import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, NotFoundError, PermissionError, UnsupportedError, Vault } from "tsuzuri";
import journal from "tsuzuri/extensions/journal";
import { agentTools, validateInput } from "tsuzuri/tools";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const JOURNAL = [
  'extensions = ["tsuzuri:journal"]',
  "[capture]",
  'folder = "Inbox"',
  "[journal.day]",
  'folder = "Daily"',
  'format = "YYYY-MM-DD"',
  "[journal.week]",
  'folder = "Weekly"',
  'format = "gggg-[W]ww"',
  "[templates]",
  'folder = "Templates"',
].join("\n");

/** A copy of the fixture whose tsuzuri.toml is this. */
function vaultWith(toml: string): string {
  const root = copyVault();
  writeFileSync(join(root, "tsuzuri.toml"), `${toml}\n`);
  return root;
}

/** An extension module a vault holds: a plain object, since a vault has no node_modules to import tsuzuri from. */
const HELLO = `export default {
  name: "hello",
  operations: [{
    name: "hello",
    kind: "read",
    command: "hello",
    summary: "Count the notes.",
    input: { greeting: { type: "string", description: "A word to say", required: true } },
    run: async (vault, input) => \`\${input.greeting}: \${(await vault.list()).length} notes\`,
    format: (result) => String(result),
  }],
};
`;

describe("the bundled journal", () => {
  test("opens with a vault that lists it, and reads the note for a date in either week convention", async () => {
    const vault = await Vault.open(vaultWith(JOURNAL));
    expect(vault.skipped).toEqual([]);
    const day = (await vault.run("journal", { period: "day", date: "2026-09-16" })) as { path: string; note: unknown };
    expect(day.path).toBe("Daily/2026-09-16.md");
    expect(day.note).toMatchObject({ path: "Daily/2026-09-16.md" });
    expect(await vault.run("journal", { period: "day", date: "2026-09-17" })).toEqual({
      path: "Daily/2026-09-17.md",
      note: null,
    });
    expect(await vault.run("journal", { period: "week", date: "2026-09-16" })).toMatchObject({
      note: { path: "Weekly/2026-W38.md" },
    });
    const both = await Vault.open(copyVault(), {
      config: {
        extensions: ["tsuzuri:journal"],
        journal: { day: { format: "YYYY" }, week: { folder: "log", format: "GGGG/[weekly]/GGGG-[w]WW" } },
      },
    });
    expect(await both.run("journal", { period: "week", date: "2021-01-01" })).toMatchObject({
      path: "log/2020/weekly/2020-w53.md",
    });
    await expect(both.run("journal", { period: "month" })).rejects.toThrow(UnsupportedError);
    await expect(both.run("journal", { period: "day", date: "2026-13-01" })).rejects.toThrow("not a calendar date");
  });

  test("appends to a note that exists, with a dry run, and refuses one not written yet", async () => {
    const root = vaultWith(JOURNAL);
    const vault = await Vault.open(root);
    const dry = await vault.run("journalAppend", {
      period: "day",
      text: "- planned",
      date: "2026-09-16",
      dryRun: true,
    });
    expect(dry).toMatchObject({ written: false, diff: expect.stringContaining("+- planned") });
    await vault.run("journalAppend", { period: "day", text: "- done", date: "2026-09-16" });
    expect(readFileSync(join(root, "Daily", "2026-09-16.md"), "utf8")).toContain("- done");
    await expect(vault.run("journalAppend", { period: "day", text: "x", date: "2026-09-17" })).rejects.toThrow(
      NotFoundError,
    );
  });

  test("its settings are valid only while it is listed, and a host can pass it in code", async () => {
    const unlisted = JOURNAL.replace('extensions = ["tsuzuri:journal"]\n', "");
    expect(() => new Vault(vaultWith(unlisted))).toThrow("needs the journal extension");
    const typo = `${JOURNAL}\n[journal.fortnight]\nformat = "YYYY"`;
    await expect(Vault.open(vaultWith(typo))).rejects.toThrow(ConfigError);
    // Constructed directly, the listed extension is reported as skipped, and its table is left for it.
    const direct = new Vault(vaultWith(JOURNAL));
    expect(direct.skipped).toMatchObject([{ extension: "tsuzuri:journal" }]);
    expect(direct.operations().map((operation) => operation.name)).not.toContain("journal");
    const passed = new Vault(vaultWith(JOURNAL), { extensions: [journal] });
    expect(passed.skipped).toEqual([]);
    expect(await passed.run("journal", { period: "day", date: "2026-09-16" })).toMatchObject({
      path: "Daily/2026-09-16.md",
    });
  });

  test("the mask covers its operations, and every call they make", async () => {
    const root = vaultWith(JOURNAL);
    const reader = await Vault.open(root, { allow: ["read"] });
    expect(await reader.run("journal", { period: "day", date: "2026-09-16" })).toMatchObject({ note: {} });
    await expect(reader.run("journalAppend", { period: "day", text: "x", date: "2026-09-16" })).rejects.toThrow(
      PermissionError,
    );
    // Allowing the operation by name does not allow the append it makes.
    const named = await Vault.open(root, { allow: ["read", "journalAppend"] });
    await expect(named.run("journalAppend", { period: "day", text: "x", date: "2026-09-16" })).rejects.toThrow(
      "does not allow append",
    );
    const editor = await Vault.open(root, { allow: ["read", "edit"] });
    expect(await editor.run("journalAppend", { period: "day", text: "x", date: "2026-09-16" })).toMatchObject({
      written: true,
    });
  });

  test("refuses a folder scope on an extension operation it cannot enforce", async () => {
    const root = vaultWith(JOURNAL);
    await expect(Vault.open(root, { allow: [{ ops: ["journal"], under: ["Inbox"] }, "get"] })).rejects.toThrow(
      ConfigError,
    );
    await expect(Vault.open(root, { allow: [{ ops: ["read"], under: ["Inbox"] }] })).rejects.toThrow(ConfigError);
    const scopedInnerRead = await Vault.open(root, { allow: ["journal", { ops: ["get"], under: ["Inbox"] }] });
    await expect(scopedInnerRead.run("journal", { period: "day", date: "2026-09-16" })).rejects.toThrow(
      PermissionError,
    );
  });

  test("becomes agent tools the mask filters", async () => {
    const vault = await Vault.open(vaultWith(JOURNAL), { allow: ["read", "capture"] });
    const tools = agentTools(vault);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("tsuzuri_journal");
    expect(names).not.toContain("tsuzuri_journal_append");
    const tool = tools.find((each) => each.name === "tsuzuri_journal");
    if (!tool) throw new Error("no tsuzuri_journal");
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.inputSchema.required).toEqual(["period"]);
    const result = await tool.run(vault, validateInput(tool, { period: "day", date: "2026-09-16" }));
    expect(result).toMatchObject({ path: "Daily/2026-09-16.md" });
    expect(() => validateInput(tool, { period: "fortnight" })).toThrow("must be one of");
  });

  test("runs from the CLI, with its own options and help", () => {
    const root = vaultWith(JOURNAL);
    const run = (...args: string[]) => spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });
    const day = run("journal", "day", "--date", "2026-09-16");
    expect(day.status).toBe(0);
    expect(day.stdout.startsWith("Daily/2026-09-16.md")).toBe(true);
    const dry = run("journal", "append", "day", "- a bullet", "--date", "2026-09-16", "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("+- a bullet");
    expect(JSON.parse(run("journal", "day", "--date", "2026-09-17", "--json").stdout)).toEqual({
      path: "Daily/2026-09-17.md",
      note: null,
    });
    expect(run("journal", "fortnight").status).toBe(2);
    expect(run("journal", "day", "--bogus").status).toBe(2);
    expect(run("journal", "--help").stdout).toContain("usage: tsuzuri journal <period>");
    const help = JSON.parse(run("help", "--json").stdout) as { extensions: { name: string; operation: string }[] };
    expect(help.extensions.map((command) => command.name)).toEqual(["journal", "journal append"]);
    expect(spawnSync("node", [CLI, "--vault", copyVault(), "journal", "day"], { encoding: "utf8" }).status).toBe(2);
  });
});

describe("a vault's own extension", () => {
  function helloVault(): string {
    const root = vaultWith('extensions = [".tsuzuri/hello.js"]\n[capture]\nfolder = "Inbox"');
    mkdirSync(join(root, ".tsuzuri"));
    writeFileSync(join(root, ".tsuzuri", "hello.js"), HELLO);
    return root;
  }

  test("runs only when the caller trusts the vault, and is reported as skipped otherwise", async () => {
    const root = helloVault();
    const untrusted = await Vault.open(root);
    expect(untrusted.skipped).toEqual([
      { extension: ".tsuzuri/hello.js", reason: "the vault is not trusted to run its own code" },
    ]);
    await expect(untrusted.run("hello", { greeting: "hi" })).rejects.toThrow(NotFoundError);
    const trusted = await Vault.open(root, { trust: true });
    expect(await trusted.run("hello", { greeting: "hi" })).toMatch(/^hi: \d+ notes$/);
  });

  test("runs from the CLI with --trust, or when the user's trust list names the vault", () => {
    const root = helloVault();
    const config = mkdtempSync(join(tmpdir(), "tsuzuri-xdg-"));
    const run = (env: Record<string, string>, ...args: string[]) =>
      spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
    const skipped = run({ XDG_CONFIG_HOME: config }, "hello", "hi");
    expect(skipped.status).toBe(2);
    expect(skipped.stderr).toContain("skipped extensions .tsuzuri/hello.js");
    expect(run({ XDG_CONFIG_HOME: config }, "hello", "hi", "--trust").stdout).toMatch(/^hi: \d+ notes/);
    mkdirSync(join(config, "tsuzuri"));
    writeFileSync(join(config, "tsuzuri", "trust.toml"), `vaults = [${JSON.stringify(root)}]\n`);
    expect(run({ XDG_CONFIG_HOME: config }, "hello", "hi").stdout).toMatch(/^hi: \d+ notes/);
  });

  test("refuses a name that clashes, an unknown bundled extension, and a module outside the vault", async () => {
    const clash = { name: "twice", operations: [{ ...journal.operations[0], name: "get" }] };
    expect(() => new Vault(copyVault(), { extensions: [clash as typeof journal] })).toThrow("already exists");
    await expect(Vault.open(vaultWith('extensions = ["tsuzuri:nope"]'))).rejects.toThrow("no bundled extension");
    const outside = vaultWith('extensions = ["../elsewhere.js"]');
    await expect(Vault.open(outside, { trust: true })).rejects.toThrow("leaves the vault");
  });
});
