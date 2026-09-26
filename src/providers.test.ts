/**
 * Every provider of a fallback chain must return what the portable one returns (ADR 0006). These tests force each
 * provider in turn, which only tsuzuri's own code can do, over real notes: the test package's fixture vault and
 * corpora, read by path because no other package has the vaults to check against.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Chain } from "./chain.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { parseToml, parseYaml } from "./providers.ts";
import { Vault } from "./vault.ts";

const VAULTS = join(import.meta.dirname, "..", "tests");
const FIXTURE = join(VAULTS, "fixtures", "vault");

/** Run `read` with each provider of `chain` forced in turn, and return every output by provider name. */
async function eachProvider<T, R>(chain: Chain<T>, read: () => R | Promise<R>): Promise<Record<string, R>> {
  const outputs: Record<string, R> = {};
  try {
    for (const provider of chain.providers.filter((candidate) => candidate.available())) {
      chain.force(provider.name);
      outputs[provider.name] = await read();
    }
  } finally {
    chain.force();
  }
  return outputs;
}

/** Every provider must return exactly what the last, portable provider returns. */
function expectIdentical<R>(outputs: Record<string, R>): void {
  const values = Object.values(outputs);
  for (const value of values) expect(value).toEqual(values[values.length - 1] as R);
}

describe("every provider returns the same result", () => {
  test("parse YAML, on the fixture vault", async () => {
    expectIdentical(await eachProvider(parseYaml, () => new Vault(FIXTURE).notes()));
  });

  const kepano = join(VAULTS, "vaults", "kepano-obsidian");
  test.skipIf(!existsSync(kepano) || readdirSync(kepano).length === 0)("parse YAML, on kepano-obsidian", async () => {
    expectIdentical(await eachProvider(parseYaml, () => new Vault(kepano).notes()));
  });

  test("parse YAML, where Bun.YAML alone would differ", async () => {
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
      expectIdentical(await eachProvider(parseYaml, () => splitFrontmatter(`---\n${block}\n---\nbody`).data));
    }
  });

  test("parse TOML, for tsuzuri.toml and its title allowlist", async () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-toml-"));
    writeFileSync(join(root, "casing.toml"), '[allow]\nwords = ["OpenAI", "iPhone"]\nmore = { names = ["GitHub"] }\n');
    writeFileSync(
      join(root, "tsuzuri.toml"),
      [
        "[capture]",
        'folder = "Inbox"',
        'properties = ["title", "created", "tags"]',
        'values = { kind = "capture" }',
        'title_allowlist = "casing.toml"',
        "require_tags = true",
        "[templates]",
        'folder = "Templates"',
        'date_format = "GGGG-[W]WW"',
      ].join("\n"),
    );
    const outputs = await eachProvider(parseToml, () => new Vault(root).settings);
    expectIdentical(outputs);
    expect(outputs["smol-toml"]?.capture.titleAllow).toEqual(["OpenAI", "iPhone", "GitHub"]);
  });
});

describe("portability", () => {
  test("uses Bun-only APIs only in chain providers", () => {
    const src = import.meta.dirname;
    // Recursive, so the bundled extensions are held to it too.
    const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter(
        (file) =>
          file.endsWith(".ts") &&
          file !== "providers.ts" &&
          !file.endsWith(".test.ts") &&
          /\bBun\./.test(readFileSync(join(src, file), "utf8")),
      )
      .sort();
    expect(offenders).toEqual([]);
  });
});
