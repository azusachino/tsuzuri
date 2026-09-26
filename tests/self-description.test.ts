import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "tsuzuri";
import journal from "tsuzuri/extensions/journal";
import { agentTools, validateInput } from "tsuzuri/tools";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const cli = (root: string, ...args: string[]) =>
  spawnSync("node", [CLI, "--vault", root, ...args], { encoding: "utf8" });

describe("self-description", () => {
  test("init previews both starter files, writes once, and refuses either existing target", () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-init-"));
    try {
      const vault = new Vault(root);
      const preview = vault.init({ dryRun: true });
      expect(preview).toMatchObject({
        written: false,
        files: [{ path: "tsuzuri.toml" }, { path: "templates/capture.md" }],
      });
      expect(existsSync(join(root, "tsuzuri.toml"))).toBe(false);
      expect(JSON.parse(cli(root, "init", "--dry-run", "--json").stdout)).toEqual(preview);
      const written = vault.init();
      expect(written.written).toBe(true);
      expect(readFileSync(join(root, "templates", "capture.md"), "utf8")).toBe(preview.files[1]?.content);
      expect(() => vault.init()).toThrow("tsuzuri.toml already exists");
      expect(cli(root, "init").status).toBe(1);
      expect(cli(root, "init", "--dry-run", "--json").status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("init refuses a pre-existing template before writing the config", () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-init-conflict-"));
    try {
      const vault = new Vault(root);
      const template = join(root, "templates", "capture.md");
      mkdirSync(join(root, "templates"));
      writeFileSync(template, "owner content\n");
      expect(() => vault.init()).toThrow("templates/capture.md already exists");
      expect(existsSync(join(root, "tsuzuri.toml"))).toBe(false);
      expect(readFileSync(template, "utf8")).toBe("owner content\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("init does not write through a linked templates folder", () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-init-link-"));
    const outside = mkdtempSync(join(tmpdir(), "tsuzuri-init-outside-"));
    try {
      symlinkSync(outside, join(root, "templates"), "dir");
      expect(() => new Vault(root).init()).toThrow("templates is a symbolic link");
      expect(existsSync(join(outside, "capture.md"))).toBe(false);
      expect(existsSync(join(root, "tsuzuri.toml"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("types and config describe effective routes and provenance", async () => {
    const vault = new Vault(FIXTURE, {
      config: { types: { Book: { folder: "Books", filename: "{{slug}}" } }, tags: { require: true } },
    });
    expect(await vault.types()).toContainEqual({
      type: "book",
      template: "Templates/Book.md",
      folder: "Books",
      filename: "{{slug}}",
    });
    const config = vault.config();
    expect(config.root).toBe(FIXTURE);
    expect(config.settings).toContainEqual({ name: "capture.folder", value: "Inbox", source: "tsuzuri.toml" });
    expect(config.settings).toContainEqual({ name: "tags.require", value: true, source: "options" });
    expect(config.settings).toContainEqual({ name: "types.book.folder", value: "Books", source: "options" });
    expect(config.settings).toContainEqual({ name: "tags.style", value: "as-written", source: "default" });
    expect(JSON.parse(cli(FIXTURE, "types", "--json").stdout)).toContainEqual({
      type: "book",
      template: "Templates/Book.md",
      folder: "Inbox",
      filename: "{{title}}",
    });
    expect(JSON.parse(cli(FIXTURE, "config", "--json").stdout).root).toBe(FIXTURE);
  });

  test("config includes extension table settings and both extension-list sources", () => {
    const root = copyVault();
    try {
      writeFileSync(
        join(root, "tsuzuri.toml"),
        'extensions = ["tsuzuri:journal"]\n[journal.day]\nformat = "YYYY-MM-DD"\n',
      );
      const vault = new Vault(root, {
        extensions: [journal],
        config: { extensions: ["other-extension"], journal: { week: { format: "YYYY-[W]WW" } } },
      });
      expect(vault.config().settings).toContainEqual({
        name: "extensions",
        value: ["tsuzuri:journal", "other-extension"],
        source: "tsuzuri.toml + options",
      });
      expect(vault.config().settings).toContainEqual({
        name: "journal.week.format",
        value: "YYYY-[W]WW",
        source: "options",
      });
      expect(vault.config().settings.some(({ name }) => name === "journal.day.format")).toBe(false);
      expect(new Vault(root, { extensions: [journal] }).config().settings).toContainEqual({
        name: "journal.day.format",
        value: "YYYY-MM-DD",
        source: "tsuzuri.toml",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("check reports template keys and title/tag failures, with CLI exit 1", async () => {
    const root = copyVault();
    try {
      writeFileSync(join(root, "Inbox", "Bad book.md"), '---\ntype: book\ntitle: Bad Title\ntags: ["Bad Tag"]\n---\n');
      writeFileSync(
        join(root, "tsuzuri.toml"),
        '[templates]\nfolder = "Templates"\n[tags]\nstyle = "kebab"\n[titles]\ncase = "lowercase"\n',
      );
      const vault = new Vault(root);
      const checked = await vault.check("Bad book");
      expect(checked).toMatchObject({ path: "Inbox/Bad book.md", type: "book", ok: false });
      expect(checked.missing).toEqual(["author", "rating", "year"]);
      expect(checked.errors.join(" ")).toContain("kebab-case");
      expect(checked.errors.join(" ")).toContain("[titles]");
      const result = cli(root, "check", "Bad book", "--json");
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual(checked);
      expect(JSON.parse(cli(root, "check", "People/Plato.md", "--json").stdout).ok).toBe(false);
      const tools = agentTools(vault);
      const typeTool = tools.find((tool) => tool.name === "tsuzuri_types");
      const checkTool = tools.find((tool) => tool.name === "tsuzuri_check");
      expect(await typeTool?.run(vault, validateInput(typeTool, {}))).toEqual(await vault.types());
      expect(await checkTool?.run(vault, validateInput(checkTool, { note: "Bad book" }))).toEqual(checked);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("check accepts a note created from its template", async () => {
    const root = copyVault();
    try {
      const vault = new Vault(root);
      const created = await vault.create("book", "Dune");
      expect(await vault.check(created.path)).toMatchObject({ ok: true, missing: [], errors: [] });
      expect(cli(root, "check", created.path, "--json").status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
