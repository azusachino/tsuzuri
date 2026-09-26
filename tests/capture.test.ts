import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, type TsuzuriConfig, Vault } from "tsuzuri";
import { describe, expect, test } from "vitest";
import { copyVault, FIXTURE } from "./git.ts";

const NOW = new Date(2026, 8, 24, 19, 5);

/** A vault that declares a strict house style, the way a vault's own tsuzuri.toml would. */
const STRICT: TsuzuriConfig = {
  capture: {
    folder: "queue",
    filename: "slug",
    properties: ["title", "created", "modified", "kind", "tags", "source"],
    values: { kind: "capture" },
    title_style: "lowercase",
    tag_style: "kebab",
    require_tags: true,
    reject_tags: ["todo"],
  },
};

describe("capture settings in a vault", () => {
  test("fall back to the vault root without a capture folder setting", () => {
    expect(new Vault(join(FIXTURE, "People")).settings.capture.folder).toBe("");
  });

  test("read the title allowlist named in tsuzuri.toml", async () => {
    const root = copyVault();
    writeFileSync(join(root, "casing.toml"), '[allow]\nwords = ["OpenAI"]\n');
    writeFileSync(
      join(root, "tsuzuri.toml"),
      '[capture]\nfolder = "Inbox"\ntitle_style = "lowercase"\ntitle_allowlist = "casing.toml"\n',
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
    expect(withToml('[capture]\nfilename = "Slug"\n')).toThrow("capture.filename must be one of title, slug");
    expect(withToml("[capture]\nrequire_tags = 1\n")).toThrow("capture.require_tags must be a boolean");
    expect(withToml('[capture]\nreject_tags = "todo"\n')).toThrow("reject_tags must be a list of strings");
    expect(
      () => new Vault(FIXTURE, { config: { capture: { tag_style: "Kebab" } } as unknown as TsuzuriConfig }),
    ).toThrow("options: capture.tag_style must be one of as-written, kebab");
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
