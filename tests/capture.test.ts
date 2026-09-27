import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, type TsuzuriConfig, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const NOW = new Date(2026, 8, 24, 19, 5);

/** A vault that declares a strict house style, the way a vault's own tsuzuri.toml would. */
const STRICT: TsuzuriConfig = {
  capture: { folder: "queue", filename: "{{slug}}" },
  titles: { case: "lowercase" },
  tags: { style: "kebab", require: true, reject: ["todo"] },
};

describe("capture settings in a vault", () => {
  test("fall back to the vault root without a capture folder setting", () => {
    expect(new Vault(join(FIXTURE, "People")).settings.capture.folder).toBe("");
  });

  test("read the inline title keep list in tsuzuri.toml", async () => {
    const root = copyVault();
    writeFileSync(
      join(root, "tsuzuri.toml"),
      '[capture]\nfolder = "Inbox"\n[titles]\ncase = "lowercase"\nkeep = ["OpenAI"]\n',
    );
    const result = await new Vault(root).capture({ text: "Trying OpenAI Tools" }, { dryRun: true });
    expect(result.path).toBe("Inbox/trying OpenAI tools.md");
  });
});

describe("settings shape", () => {
  const withToml = (toml: string) => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-config-"));
    writeFileSync(join(root, "tsuzuri.toml"), toml);
    return () => new Vault(root);
  };

  test("rejects a misspelled key, naming the keys the table takes", () => {
    expect(withToml('[capture]\ntag-style = "kebab"\n')).toThrow(
      /unknown key capture\.tag-style; capture takes folder/,
    );
    expect(withToml('[journals.day]\nformat = "YYYY"\n')).toThrow(/unknown key journals/);
  });

  test("refuses journal settings unless the journal extension is loaded, from the file or code", () => {
    expect(withToml('[journal.day]\nformat = "YYYY-MM-DD"\n')).toThrow(/needs the journal extension/);
    const config = { journal: { day: { format: "YYYY" } } } as unknown as TsuzuriConfig;
    expect(() => new Vault(FIXTURE, { config })).toThrow(ConfigError);
  });

  test("rejects a value outside a setting's choices or type", () => {
    expect(withToml("[capture]\nfilename = 1\n")).toThrow("capture.filename must be a string");
    expect(withToml("[tags]\nrequire = 1\n")).toThrow("tags.require must be a boolean");
    expect(withToml('[tags]\nreject = "todo"\n')).toThrow("tags.reject must be a list of strings");
    expect(() => new Vault(FIXTURE, { config: { tags: { style: "Kebab" } } as unknown as TsuzuriConfig })).toThrow(
      "options: tags.style must be one of as-written, kebab",
    );
  });

  test("names the new home of retired capture settings", () => {
    const migrated = new Map([
      ['properties = ["title"]', "templates/capture.md"],
      ['values = { kind = "capture" }', "templates/capture.md"],
      ['timestamp_format = "YYYY"', "{{date:FORMAT}}"],
      ['title_style = "lowercase"', "[titles] case"],
      ['title_allowlist = "casing.toml"', "[titles] keep"],
      ['tag_style = "kebab"', "[tags] style"],
      ["require_tags = true", "[tags] require"],
      ['reject_tags = ["todo"]', "[tags] reject"],
    ]);
    for (const [oldKey, destination] of migrated) {
      expect(withToml(`[capture]\n${oldKey}\n`)).toThrow(destination);
    }
  });
});

describe("capture", () => {
  test("dry run writes nothing", async () => {
    const root = copyVault();
    const result = await new Vault(root).capture({ text: "An idea", now: NOW }, { dryRun: true });
    expect(result).toMatchObject({ path: "Inbox/An idea.md", written: false });
    expect(existsSync(join(root, result.path))).toBe(false);
  });

  test("creates a new file, never overwriting one", async () => {
    const root = copyVault();
    const vault = new Vault(root);
    const first = await vault.capture({ text: "Existing idea", now: NOW });
    const slugged = await new Vault(root, { config: STRICT }).capture({ text: "Existing idea", tags: ["x"], now: NOW });
    const again = await new Vault(root, { config: STRICT }).capture({ text: "Existing idea", tags: ["x"], now: NOW });
    expect([first.path, slugged.path, again.path]).toEqual([
      "Inbox/Existing idea 2.md",
      "queue/existing-idea.md",
      "queue/existing-idea-2.md",
    ]);
    expect(readFileSync(join(root, "Inbox/Existing idea.md"), "utf8")).toContain("Captured earlier.");
  });

  test("makes file names safe, falling back to a timestamp", async () => {
    const vault = new Vault(copyVault());
    expect((await vault.capture({ text: 'What is "a/b"? [draft]', now: NOW }, { dryRun: true })).path).toBe(
      "Inbox/What is a b draft.md",
    );
    expect((await vault.capture({ text: "乌龙茶笔记", now: NOW }, { dryRun: true })).path).toBe("Inbox/乌龙茶笔记.md");
    const strict = new Vault(copyVault(), { config: STRICT });
    expect((await strict.capture({ text: "乌龙茶", tags: ["tea"], now: NOW }, { dryRun: true })).path).toBe(
      "queue/capture-20260924-1905.md",
    );
  });
});
