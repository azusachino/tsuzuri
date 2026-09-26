import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vault, WriteConflictError } from "tsuzuri";
import { expect, test } from "vitest";
import { copyVault } from "./git.ts";

const NOTE = "Topics/Cognitive load.md";

test("get's hash is the SHA-256 of the note's text, and a write refuses it once the note changes", async () => {
  const root = copyVault();
  const vault = new Vault(root);
  const { hash } = await vault.get(NOTE);
  expect(hash).toBe(
    createHash("sha256")
      .update(readFileSync(join(root, NOTE), "utf8"))
      .digest("hex"),
  );
  expect((await vault.append(NOTE, "one more line", { ifHash: hash })).written).toBe(true);
  await expect(vault.append(NOTE, "again", { ifHash: hash })).rejects.toThrow(WriteConflictError);
});
