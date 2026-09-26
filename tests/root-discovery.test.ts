import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { copyVault } from "./git.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const config = (cwd: string, variable = "", ...args: string[]) => {
  const result = spawnSync("node", [CLI, ...args, "config", "--json"], {
    cwd,
    env: { ...process.env, TSUZURI_VAULT: variable },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { root: string };
};

describe("CLI vault root discovery", () => {
  test("walks to the nearest ancestor with tsuzuri.toml", () => {
    const root = copyVault();
    try {
      const nested = join(root, "Topics", "Deep");
      mkdirSync(nested);
      expect(config(nested).root).toBe(realpathSync(root));
      writeFileSync(join(root, "Topics", "tsuzuri.toml"), "# nested vault\n");
      expect(config(nested).root).toBe(realpathSync(join(root, "Topics")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses cwd when no ancestor has a config", () => {
    const root = mkdtempSync(join(tmpdir(), "tsuzuri-no-config-"));
    try {
      const nested = join(root, "nested");
      mkdirSync(nested);
      expect(config(nested).root).toBe(realpathSync(nested));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flag wins over the variable, and the variable wins over discovery", () => {
    const root = copyVault();
    const explicit = mkdtempSync(join(tmpdir(), "tsuzuri-explicit-"));
    try {
      const nested = join(root, "Topics");
      expect(config(nested, explicit).root).toBe(explicit);
      expect(config(nested, explicit, "--vault", root).root).toBe(root);
      expect(config(nested, "", "--vault", explicit).root).toBe(explicit);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(explicit, { recursive: true, force: true });
    }
  });
});
