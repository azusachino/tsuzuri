import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitFrontmatter } from "../src/frontmatter.ts";
import { parseToml, parseYaml } from "../src/providers.ts";
import { Vault } from "../src/vault.ts";

const vaults = join(import.meta.dirname, "vaults");
const roots = [join(import.meta.dirname, "fixtures", "vault")];
const tempRoot = mkdtempSync(join(tmpdir(), "tsuzuri-toml-"));
for (const name of ["kepano-obsidian", "obsidian-help"]) {
  const path = join(vaults, name);
  if (existsSync(path) && readdirSync(path).length > 0) roots.push(path);
}
try {
  for (const root of roots) {
    parseYaml.force("Bun.YAML");
    const bunNotes = await new Vault(root).notes();
    parseYaml.force("yaml");
    assert.deepStrictEqual(await new Vault(root).notes(), bunNotes);
  }

  const blocks = [
    "created: {{date}}\ntitle: {{title}}",
    "a: {b: 1, b: 2}",
    "a: 1\na: 2",
    '"a": 1\na: 2',
    "a:\n  b: 1\n  b: 2",
    "base: &b {k: 1}\nc:\n  <<: *b",
    "a: !!int '3'",
    "? a\n: 1",
    "%YAML 1.1\n---\na: yes",
    "a: yes\nb: 2026-09-24\nc: 0o17\nd: .inf\ne: ~",
  ];
  for (const block of blocks) {
    parseYaml.force("Bun.YAML");
    const bun = splitFrontmatter(`---\n${block}\n---\nbody`).data;
    parseYaml.force("yaml");
    assert.deepStrictEqual(splitFrontmatter(`---\n${block}\n---\nbody`).data, bun);
  }

  writeFileSync(
    join(tempRoot, "casing.toml"),
    '[allow]\nwords = ["OpenAI", "iPhone"]\nmore = { names = ["GitHub"] }\n',
  );
  writeFileSync(
    join(tempRoot, "tsuzuri.toml"),
    '[capture]\nfolder = "Inbox"\nproperties = ["title", "created", "tags"]\nvalues = { kind = "capture" }\ntitle_allowlist = "casing.toml"\nrequire_tags = true\n[templates]\nfolder = "Templates"\ndate_format = "GGGG-[W]WW"\n',
  );
  parseToml.force("Bun.TOML");
  const bunSettings = new Vault(tempRoot).settings;
  parseToml.force("smol-toml");
  assert.deepStrictEqual(new Vault(tempRoot).settings, bunSettings);
  console.log("ok  Bun and portable YAML/TOML providers agree");
} finally {
  parseYaml.force();
  parseToml.force();
  rmSync(tempRoot, { recursive: true, force: true });
}
